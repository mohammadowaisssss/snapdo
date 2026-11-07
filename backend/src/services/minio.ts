import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { uid } from '../utils/utils.js';

export interface MinioConfig {
  endpoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
  region: string;
}

export const MINIO_BUCKET = process.env.MINIO_BUCKET || 'snapsec-attachments';

export function getMinioConfig(): MinioConfig {
  return {
    endpoint: process.env.MINIO_ENDPOINT || 'minio',
    port: Number(process.env.MINIO_PORT || 9000),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER || 'snapsec_minio',
    secretKey: process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD || 'snapsec_minio_secret',
    bucket: process.env.MINIO_BUCKET || MINIO_BUCKET,
    region: process.env.MINIO_REGION || 'us-east-1',
  };
}

function resolvePersistentObjectsDir(): string {
  const baseDataDir = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
  const preferred = path.join(baseDataDir, 'minio-objects');
  try {
    if (!fs.existsSync(preferred)) {
      fs.mkdirSync(preferred, { recursive: true });
    }
    fs.accessSync(preferred, fs.constants.W_OK);
    return preferred;
  } catch {
    const fallback = path.join(os.tmpdir(), 'snapsec-data', 'minio-objects');
    try {
      if (!fs.existsSync(fallback)) {
        fs.mkdirSync(fallback, { recursive: true });
      }
      return fallback;
    } catch {
      return os.tmpdir();
    }
  }
}

export const MINIO_OBJECTS_DIR = resolvePersistentObjectsDir();

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodeS3UriPath(uriPath: string): string {
  return uriPath
    .split('/')
    .map(segment =>
      encodeURIComponent(segment).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`),
    )
    .join('/');
}

/**
 * Generates AWS Signature Version 4 headers for S3 / MinIO REST API requests.
 */
export function signMinioS3Request(opts: {
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  uriPath: string;
  payload?: Buffer;
  contentType?: string;
  config?: MinioConfig;
  now?: Date;
}): Record<string, string> {
  const cfg = opts.config || getMinioConfig();
  const date = opts.now || new Date();
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const bodyBuf = opts.payload || Buffer.alloc(0);
  const payloadHash = sha256Hex(bodyBuf);

  const isStandardPort = (cfg.useSSL && cfg.port === 443) || (!cfg.useSSL && cfg.port === 80);
  const hostHeader = isStandardPort ? cfg.endpoint : `${cfg.endpoint}:${cfg.port}`;

  const canonicalUri = encodeS3UriPath(opts.uriPath.startsWith('/') ? opts.uriPath : `/${opts.uriPath}`);
  const headersMap: Record<string, string> = {
    host: hostHeader,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (opts.contentType) {
    headersMap['content-type'] = opts.contentType;
  }

  const sortedHeaderKeys = Object.keys(headersMap).sort();
  const canonicalHeaders = sortedHeaderKeys.map(k => `${k}:${headersMap[k].trim()}\n`).join('');
  const signedHeaders = sortedHeaderKeys.join(';');

  const canonicalRequest = [
    opts.method,
    canonicalUri,
    '', // query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmacSha256(`AWS4${cfg.secretKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, cfg.region);
  const kService = hmacSha256(kRegion, 's3');
  const kSigning = hmacSha256(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const authorization = `${algorithm} Credential=${cfg.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const outHeaders: Record<string, string> = {
    Host: hostHeader,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    Authorization: authorization,
  };
  if (opts.contentType) {
    outHeaders['Content-Type'] = opts.contentType;
  }
  if (opts.method === 'PUT') {
    outHeaders['Content-Length'] = String(bodyBuf.length);
  }
  return outHeaders;
}

function performMinioRequest(opts: {
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  uriPath: string;
  payload?: Buffer;
  contentType?: string;
  timeoutMs?: number;
}): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  const cfg = getMinioConfig();
  const signedHeaders = signMinioS3Request({
    method: opts.method,
    uriPath: opts.uriPath,
    payload: opts.payload,
    contentType: opts.contentType,
    config: cfg,
  });
  const canonicalUri = encodeS3UriPath(opts.uriPath.startsWith('/') ? opts.uriPath : `/${opts.uriPath}`);
  const client = cfg.useSSL ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(
      {
        hostname: cfg.endpoint,
        port: cfg.port,
        path: canonicalUri,
        method: opts.method,
        headers: signedHeaders,
        timeout: opts.timeoutMs || 3500,
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 500,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error('MinIO request timed out'));
    });
    req.on('error', err => reject(err));
    if (opts.payload && opts.payload.length > 0) {
      req.write(opts.payload);
    }
    req.end();
  });
}

let minioBucketEnsured = false;
let minioReachable = false;

export function isMinioReachable(): boolean {
  return minioReachable;
}

export async function ensureMinioBucket(): Promise<boolean> {
  if (process.env.NODE_ENV === 'test' && !process.env.MINIO_LIVE_TEST) {
    return false;
  }
  const cfg = getMinioConfig();
  try {
    const headRes = await performMinioRequest({
      method: 'HEAD',
      uriPath: `/${cfg.bucket}`,
      timeoutMs: 2500,
    });
    if (headRes.statusCode === 200 || headRes.statusCode === 204) {
      minioBucketEnsured = true;
      minioReachable = true;
      return true;
    }
    if (headRes.statusCode === 404) {
      const putRes = await performMinioRequest({
        method: 'PUT',
        uriPath: `/${cfg.bucket}`,
        timeoutMs: 3000,
      });
      if (putRes.statusCode === 200 || putRes.statusCode === 204 || putRes.statusCode === 409) {
        minioBucketEnsured = true;
        minioReachable = true;
        return true;
      }
    }
  } catch {
    minioReachable = false;
  }
  return false;
}

function sanitizeStorageKey(rawKey: string): string {
  return String(rawKey || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180) || `obj_${Date.now()}`;
}

function getLocalObjectPaths(storageKey: string) {
  const safeKey = sanitizeStorageKey(storageKey);
  return {
    safeKey,
    binPath: path.join(MINIO_OBJECTS_DIR, safeKey),
    metaPath: path.join(MINIO_OBJECTS_DIR, `${safeKey}.meta.json`),
  };
}

export function inferMimeFromFilename(name: string, fallback = 'application/octet-stream'): string {
  const ext = (String(name || '').split('.').pop() || '').toLowerCase();
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    pdf: 'application/pdf',
    txt: 'text/plain; charset=utf-8',
    md: 'text/markdown; charset=utf-8',
    csv: 'text/csv; charset=utf-8',
    json: 'application/json; charset=utf-8',
    zip: 'application/zip',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return map[ext] || fallback;
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function parseDataUrlToBuffer(dataUrl: string): { buffer: Buffer; mime: string } | null {
  if (typeof dataUrl !== 'string') return null;
  const trimmed = dataUrl.trim();
  const match = trimmed.match(/^data:([^;,]+);base64,([\s\S]+)$/i);
  if (!match) return null;
  const mime = match[1].toLowerCase().trim();
  const b64 = match[2].replace(/\s+/g, '');
  try {
    const buffer = Buffer.from(b64, 'base64');
    return { buffer, mime };
  } catch {
    return null;
  }
}

/**
 * Synchronously persists the object to the persistent volume and triggers async upload to MinIO S3.
 * Returns the canonical MinIO object descriptor and `/api/files/object/:key` URL.
 */
export function storeBufferInMinio(opts: {
  key?: string;
  id?: string;
  name: string;
  buffer: Buffer;
  mime?: string;
}): {
  storageKey: string;
  bucket: string;
  url: string;
  mime: string;
  sizeBytes: number;
  sizeFormatted: string;
} {
  const cfg = getMinioConfig();
  const cleanName = String(opts.name || 'attachment').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'attachment';
  const rawKey = opts.key || `${opts.id || uid('f')}_${cleanName}`;
  const { safeKey, binPath, metaPath } = getLocalObjectPaths(rawKey);
  const contentType = opts.mime || inferMimeFromFilename(cleanName);

  try {
    if (!fs.existsSync(MINIO_OBJECTS_DIR)) {
      fs.mkdirSync(MINIO_OBJECTS_DIR, { recursive: true });
    }
    fs.writeFileSync(binPath, opts.buffer);
    fs.writeFileSync(
      metaPath,
      JSON.stringify({
        storageKey: safeKey,
        bucket: cfg.bucket,
        name: opts.name || cleanName,
        contentType,
        sizeBytes: opts.buffer.length,
        createdAt: Date.now(),
      }),
      'utf8',
    );
  } catch {
    // volume fallback handled
  }

  // Push object to MinIO S3 server in background if not in isolated unit test
  if (process.env.NODE_ENV !== 'test' || process.env.MINIO_LIVE_TEST) {
    (async () => {
      try {
        if (!minioBucketEnsured) {
          await ensureMinioBucket();
        }
        await performMinioRequest({
          method: 'PUT',
          uriPath: `/${cfg.bucket}/${safeKey}`,
          payload: opts.buffer,
          contentType,
          timeoutMs: 8000,
        });
        minioReachable = true;
      } catch {
        // Object remains safely persisted in /app/data/minio-objects volume
      }
    })();
  }

  return {
    storageKey: safeKey,
    bucket: cfg.bucket,
    url: `/api/files/object/${encodeURIComponent(safeKey)}`,
    mime: contentType,
    sizeBytes: opts.buffer.length,
    sizeFormatted: formatByteSize(opts.buffer.length),
  };
}

/**
 * Awaits the upload to MinIO S3 and persistent volume directly.
 */
export async function uploadBufferToMinioAsync(
  optsOrBuffer:
    | {
        key?: string;
        id?: string;
        name: string;
        buffer: Buffer;
        mime?: string;
      }
    | Buffer,
  nameArg?: string,
  mimeArg?: string,
  _folderArg?: string,
) {
  const opts = Buffer.isBuffer(optsOrBuffer)
    ? {
        name: nameArg || 'attachment',
        buffer: optsOrBuffer,
        mime: mimeArg,
      }
    : optsOrBuffer;

  const stored = storeBufferInMinio(opts);
  const cfg = getMinioConfig();
  let uploadedToMinioServer = false;
  if (process.env.NODE_ENV !== 'test' || process.env.MINIO_LIVE_TEST) {
    try {
      if (!minioBucketEnsured) {
        await ensureMinioBucket();
      }
      const res = await performMinioRequest({
        method: 'PUT',
        uriPath: `/${cfg.bucket}/${stored.storageKey}`,
        payload: opts.buffer,
        contentType: stored.mime,
        timeoutMs: 8000,
      });
      uploadedToMinioServer = res.statusCode >= 200 && res.statusCode < 300;
      if (uploadedToMinioServer) minioReachable = true;
    } catch {
      uploadedToMinioServer = false;
    }
  }
  return {
    ...stored,
    key: stored.storageKey,
    size: stored.sizeBytes,
    uploadedToMinioServer,
  };
}

/**
 * Converts a `data:...;base64,...` URL (or text content) into a MinIO object and returns
 * the updated `dataUrl` (`/api/files/object/:key`), `storageKey`, and `bucket`.
 */
export function ensureAttachmentStoredInMinio(
  input: {
    id?: string;
    name?: string;
    dataUrl?: string | null;
    textContent?: string | null;
    mime?: string | null;
    storageKey?: string | null;
    bucket?: string | null;
  },
  _folder = 'attachments',
): {
  dataUrl: string | null;
  storageKey: string | null;
  bucket: string | null;
  mime: string | null;
} {
  const cfg = getMinioConfig();
  const safeName = String(input?.name || 'attachment');
  const rawCandidate = typeof input?.dataUrl === 'string' ? input.dataUrl.trim() : '';

  // Reject unsafe schemes (e.g. javascript:, vbscript:, data:text/html)
  const isSafeUrl =
    rawCandidate.startsWith('/api/files/object/') ||
    /^https?:\/\//i.test(rawCandidate) ||
    /^data:(?:image\/(?:png|jpeg|jpg|gif|webp)|application\/pdf|text\/plain);base64,[A-Za-z0-9+/=\s]+$/i.test(
      rawCandidate,
    );
  const rawUrl = isSafeUrl ? rawCandidate : '';

  // Already a MinIO object URL
  if (rawUrl.startsWith('/api/files/object/')) {
    const keyFromUrl = decodeURIComponent(rawUrl.slice('/api/files/object/'.length).split('?')[0]);
    return {
      dataUrl: rawUrl,
      storageKey: input.storageKey || sanitizeStorageKey(keyFromUrl),
      bucket: input.bucket || cfg.bucket,
      mime: input.mime || inferMimeFromFilename(safeName),
    };
  }

  // Convert base64 data: URL into MinIO object
  if (rawUrl.startsWith('data:')) {
    const parsed = parseDataUrlToBuffer(rawUrl);
    if (parsed) {
      const stored = storeBufferInMinio({
        id: input.id,
        name: safeName,
        buffer: parsed.buffer,
        mime: input.mime || parsed.mime,
      });
      return {
        dataUrl: stored.url,
        storageKey: stored.storageKey,
        bucket: stored.bucket,
        mime: stored.mime,
      };
    }
  }

  // If textContent is provided without a dataUrl, also store in MinIO
  if (!rawUrl && typeof input.textContent === 'string' && input.textContent.length > 0) {
    const buf = Buffer.from(input.textContent, 'utf8');
    const stored = storeBufferInMinio({
      id: input.id,
      name: safeName,
      buffer: buf,
      mime: input.mime || inferMimeFromFilename(safeName, 'text/plain; charset=utf-8'),
    });
    return {
      dataUrl: stored.url,
      storageKey: stored.storageKey,
      bucket: stored.bucket,
      mime: stored.mime,
    };
  }

  return {
    dataUrl: rawUrl || null,
    storageKey: input.storageKey || null,
    bucket: input.bucket || (rawUrl ? cfg.bucket : null),
    mime: input.mime || null,
  };
}

/**
 * Scans Markdown text (e.g. Task Description or Comment) for inline `![alt](data:image/...;base64,...)`
 * images, uploads each to MinIO, and rewrites the Markdown image link to `/api/files/object/<key>`.
 */
export function externalizeInlineImagesToMinio(markdownText: string, _folder = 'inline'): string {
  if (typeof markdownText !== 'string' || !markdownText.includes('data:image/')) {
    return markdownText || '';
  }

  return markdownText.replace(
    /!\[([^\]]*)\]\((data:image\/(?:png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=\s]+)\)/gi,
    (full, alt, dataUrl) => {
      const parsed = parseDataUrlToBuffer(dataUrl);
      if (!parsed) return full;
      const ext = parsed.mime.split('/')[1] || 'png';
      const cleanAlt = String(alt || `screenshot.${ext}`).trim() || `screenshot.${ext}`;
      const fileName = /\.[a-z0-9]{2,5}$/i.test(cleanAlt) ? cleanAlt : `${cleanAlt}.${ext}`;
      const fid = uid('f');
      const stored = storeBufferInMinio({
        id: fid,
        name: fileName,
        buffer: parsed.buffer,
        mime: parsed.mime,
      });
      return `![${alt}](${stored.url})`;
    },
  );
}

/**
 * Retrieves an object from MinIO S3 or persistent volume cache.
 */
export async function getObjectFromMinio(storageKey: string): Promise<{
  buffer: Buffer;
  contentType: string;
  mime: string;
  name: string;
  sizeBytes: number;
} | null> {
  const { safeKey, binPath, metaPath } = getLocalObjectPaths(storageKey);
  const cfg = getMinioConfig();

  let meta: any = null;
  try {
    if (fs.existsSync(metaPath)) {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    }
  } catch {
    meta = null;
  }

  // 1. Check local persistent volume cache first for sub-millisecond response
  try {
    if (fs.existsSync(binPath)) {
      const buffer = fs.readFileSync(binPath);
      const contentType = meta?.contentType || inferMimeFromFilename(safeKey);
      return {
        buffer,
        contentType,
        mime: contentType,
        name: meta?.name || safeKey,
        sizeBytes: buffer.length,
      };
    }
  } catch {
    // proceed to MinIO server fetch
  }

  // 2. Fetch from MinIO S3 server and warm local volume cache
  if (process.env.NODE_ENV !== 'test' || process.env.MINIO_LIVE_TEST) {
    try {
      const res = await performMinioRequest({
        method: 'GET',
        uriPath: `/${cfg.bucket}/${safeKey}`,
        timeoutMs: 6000,
      });
      if (res.statusCode === 200 && res.body) {
        const contentType = String(res.headers['content-type'] || meta?.contentType || inferMimeFromFilename(safeKey));
        try {
          fs.writeFileSync(binPath, res.body);
        } catch {
          // ignore cache write failure
        }
        return {
          buffer: res.body,
          contentType,
          mime: contentType,
          name: meta?.name || safeKey,
          sizeBytes: res.body.length,
        };
      }
    } catch {
      // MinIO unreachable
    }
  }

  return null;
}

/**
 * Deletes an object from MinIO S3 and persistent volume cache.
 */
export async function deleteObjectFromMinio(storageKey: string): Promise<boolean> {
  if (!storageKey) return false;
  const { safeKey, binPath, metaPath } = getLocalObjectPaths(storageKey);
  const cfg = getMinioConfig();
  let removed = false;

  try {
    if (fs.existsSync(binPath)) {
      fs.unlinkSync(binPath);
      removed = true;
    }
    if (fs.existsSync(metaPath)) {
      fs.unlinkSync(metaPath);
    }
  } catch {
    // ignore
  }

  if (process.env.NODE_ENV !== 'test' || process.env.MINIO_LIVE_TEST) {
    try {
      const res = await performMinioRequest({
        method: 'DELETE',
        uriPath: `/${cfg.bucket}/${safeKey}`,
        timeoutMs: 4000,
      });
      if (res.statusCode >= 200 && res.statusCode < 300) {
        removed = true;
      }
    } catch {
      // ignore
    }
  }

  return removed;
}

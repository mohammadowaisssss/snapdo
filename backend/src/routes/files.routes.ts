import { Router } from 'express';
import {
  deleteFileSql,
  duplicateFileSql,
  getFileByIdSql,
  insertFileSql,
  listFilesSql,
  renameFileSql,
} from '../db/repository.ts';
import {
  MINIO_BUCKET,
  ensureAttachmentStoredInMinio,
  getObjectFromMinio,
  parseDataUrlToBuffer,
  uploadBufferToMinioAsync,
} from '../services/minio.ts';
import { safeString } from '../utils/security.ts';

export const filesRouter = Router();

filesRouter.get('/files', (req, res) => {
  const { project, type } = req.query;
  const files = listFilesSql({
    project: project !== undefined ? safeString(project, 64) : undefined,
    type: type !== undefined ? safeString(type, 32) : undefined,
  });
  res.json({ files, total: files.length });
});

/**
 * Direct MinIO S3 object upload endpoint for task attachments, project files,
 * and pasted inline screenshots.
 */
filesRouter.post('/files/minio-upload', async (req, res) => {
  try {
    const body = req.body || {};
    const name = safeString(body.name, 255, 'attachment') || 'attachment';
    const folder = safeString(body.folder, 80, 'attachments') || 'attachments';
    const parsed = typeof body.dataUrl === 'string' ? parseDataUrlToBuffer(body.dataUrl) : null;

    if (parsed) {
      const stored = await uploadBufferToMinioAsync(
        parsed.buffer,
        name,
        body.mime || parsed.mime,
        folder,
      );
      res.status(201).json({
        ok: true,
        url: stored.url,
        dataUrl: stored.url,
        storageKey: stored.key,
        bucket: stored.bucket,
        mime: stored.mime,
        sizeBytes: stored.size,
      });
      return;
    }

    const info = ensureAttachmentStoredInMinio(body, folder);
    res.status(201).json({
      ok: true,
      url: info.dataUrl,
      dataUrl: info.dataUrl,
      storageKey: info.storageKey,
      bucket: info.bucket || MINIO_BUCKET,
      mime: info.mime,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to upload object to MinIO' });
  }
});

/**
 * Streams an object directly from MinIO S3 storage (`snapsec-attachments` bucket).
 */
filesRouter.get('/files/object/*', async (req, res) => {
  const rawKey = (req.params as Record<string, string>)[0] || '';
  const storageKey = decodeURIComponent(rawKey);
  if (!storageKey) {
    res.status(400).json({ error: 'Missing object storage key' });
    return;
  }
  const obj = await getObjectFromMinio(storageKey);
  if (!obj) {
    res.status(404).json({ error: 'Object not found in MinIO storage' });
    return;
  }
  res.setHeader('Content-Type', obj.mime || 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(obj.buffer);
});

filesRouter.get('/files/:id/content', async (req, res) => {
  const file = getFileByIdSql(req.params.id);
  if (!file) {
    res.status(404).json({ error: 'File not found' });
    return;
  }
  if (file.storageKey) {
    const obj = await getObjectFromMinio(file.storageKey);
    if (obj) {
      res.setHeader('Content-Type', file.mime || obj.mime || 'application/octet-stream');
      res.send(obj.buffer);
      return;
    }
  }
  if (typeof file.textContent === 'string') {
    res.setHeader('Content-Type', file.mime || 'text/plain; charset=utf-8');
    res.send(file.textContent);
    return;
  }
  res.status(404).json({ error: 'File content not found' });
});

filesRouter.post('/files', (req, res) => {
  const { name } = req.body || {};
  if (!name || !String(name).trim()) {
    res.status(400).json({ error: 'File name is required' });
    return;
  }
  const { file, updatedAt } = insertFileSql(req.body);
  res.status(201).json({ ok: true, file, updatedAt });
});

filesRouter.patch('/files/:id', (req, res) => {
  const { name } = req.body || {};
  if (!name || !String(name).trim()) {
    res.status(400).json({ error: 'New file name is required' });
    return;
  }
  const result = renameFileSql(req.params.id, name);
  if (!result) {
    res.status(404).json({ error: 'File not found' });
    return;
  }
  res.json({ ok: true, file: result.file, updatedAt: result.updatedAt });
});

filesRouter.post('/files/:id/duplicate', (req, res) => {
  const result = duplicateFileSql(req.params.id);
  if (!result) {
    res.status(404).json({ error: 'File not found' });
    return;
  }
  res.status(201).json({ ok: true, file: result.file, updatedAt: result.updatedAt });
});

filesRouter.delete('/files/:id', (req, res) => {
  const { ok, updatedAt } = deleteFileSql(req.params.id);
  if (!ok) {
    res.status(404).json({ error: 'File not found' });
    return;
  }
  res.json({ ok: true, updatedAt });
});

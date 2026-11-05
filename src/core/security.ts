// Central security utilities for Snapsec TaskTracker (Frontend + Backend)

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Recursively strips prototype-pollution keys (__proto__, constructor, prototype)
 * and null bytes from strings across any JSON-like payload.
 */
export function stripDangerousKeys<T = any>(input: T, depth = 0): T {
  if (depth > 25 || input === null || input === undefined) return input;
  if (typeof input === 'string') {
    return input.replace(/\0/g, '') as unknown as T;
  }
  if (Array.isArray(input)) {
    return input.map((item) => stripDangerousKeys(item, depth + 1)) as unknown as T;
  }
  if (typeof input === 'object') {
    const clean: Record<string, any> = {};
    for (const key of Object.keys(input as Record<string, any>)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      // Reject MongoDB/NoSQL operator keys like $ne, $gt, $where, $regex
      if (key.startsWith('$')) continue;
      clean[key] = stripDangerousKeys((input as Record<string, any>)[key], depth + 1);
    }
    return clean as T;
  }
  return input;
}

/**
 * Coerces a query/body value to a safe primitive string (prevents SQLi/NoSQLi type confusion
 * where Express parses ?project[$ne]=1 as an object or ?project=a&project=b as an array).
 */
export function safeString(val: unknown, maxLength = 2000, fallback = ''): string {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'string') {
    return val.replace(/\0/g, '').slice(0, maxLength);
  }
  if (typeof val === 'number' || typeof val === 'boolean') {
    return String(val).slice(0, maxLength);
  }
  // Reject objects and arrays in scalar string fields
  return fallback;
}

/**
 * Strictly validates image URLs to prevent XSS via javascript:, vbscript:, data:text/html,
 * or data:image/svg+xml (which can embed <script> tags).
 */
export function safeImageSrc(url: unknown): string {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim().replace(/[\u0000-\u001F\u007F]/g, '');
  if (!trimmed) return '';
  if (/^https?:\/\/[^\s"'<>]+$/i.test(trimmed)) return trimmed;
  if (/^\/[^\s"'<>]*$/.test(trimmed) && !trimmed.startsWith('//')) return trimmed;
  if (/^blob:https?:\/\/[^\s"'<>]+$/i.test(trimmed)) return trimmed;
  // Only allow safe raster image data URLs (png, jpeg, jpg, gif, webp) — never svg+xml or text/html
  if (/^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(trimmed)) {
    return trimmed;
  }
  return '';
}

/**
 * Strictly validates PDF data URLs for iframe rendering.
 */
export function safePdfSrc(url: unknown): string {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim().replace(/[\u0000-\u001F\u007F]/g, '');
  if (/^data:application\/pdf;base64,[A-Za-z0-9+/=\s]+$/i.test(trimmed)) {
    return trimmed;
  }
  return '';
}

/**
 * Strictly validates download / attachment data URLs or http(s) URLs.
 */
export function safeDownloadUrl(url: unknown): string {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim().replace(/[\u0000-\u001F\u007F]/g, '');
  if (!trimmed) return '';
  if (/^https?:\/\/[^\s"'<>]+$/i.test(trimmed)) return trimmed;
  if (/^blob:https?:\/\/[^\s"'<>]+$/i.test(trimmed)) return trimmed;
  // Allow safe base64 data URLs except text/html, image/svg+xml, application/javascript, text/javascript
  if (/^data:([a-z0-9!#$&-^_]+\/[a-z0-9!#$&-^_.+]+);base64,[A-Za-z0-9+/=\s]+$/i.test(trimmed)) {
    const mimeMatch = trimmed.match(/^data:([^;]+);base64,/i);
    const mime = (mimeMatch?.[1] || '').toLowerCase();
    const blockedMimes = new Set([
      'text/html',
      'application/xhtml+xml',
      'image/svg+xml',
      'text/javascript',
      'application/javascript',
      'application/x-javascript',
      'text/xml',
      'application/xml',
    ]);
    if (!blockedMimes.has(mime)) return trimmed;
  }
  return '';
}

/**
 * Strictly validates anchor href URLs (blocks javascript:, data:, vbscript:, file:).
 */
export function safeHref(url: unknown): string {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim().replace(/[\u0000-\u001F\u007F]/g, '');
  if (!trimmed) return '';
  if (/^(https?:\/\/|mailto:)[^\s"'<>]+$/i.test(trimmed)) return trimmed;
  if (/^\/[^\s"'<>]*$/.test(trimmed) && !trimmed.startsWith('//')) return trimmed;
  if (/^#[A-Za-z0-9_-]+$/.test(trimmed)) return trimmed;
  return '';
}

/**
 * Validates CSS color token to prevent style attribute breakout.
 */
export function safeCssColor(color: unknown, fallback = '#6E56CF'): string {
  if (typeof color !== 'string') return fallback;
  const trimmed = color.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed;
  if (/^(rgb|rgba|hsl|hsla)\([0-9.,%\s]+\)$/.test(trimmed)) return trimmed;
  if (/^var\(--[a-zA-Z0-9_-]+\)$/.test(trimmed)) return trimmed;
  if (/^[a-zA-Z]{3,20}$/.test(trimmed)) return trimmed;
  return fallback;
}

/**
 * Strips CRLF and null characters to prevent HTTP / MIME / Email header injection.
 */
export function sanitizeHeaderValue(val: unknown, maxLength = 300): string {
  if (typeof val !== 'string') return '';
  return val.replace(/[\r\n\0]+/g, ' ').trim().slice(0, maxLength);
}

/**
 * Validates baseUrl for invitation links to prevent Open Redirect & javascript: injection.
 */
export function sanitizeBaseUrl(url: unknown, fallback = 'https://app.snapsec.co'): string {
  if (typeof url !== 'string' || !url.trim()) return fallback;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return fallback;
    }
    if (parsed.username || parsed.password) {
      return fallback;
    }
    return parsed.origin;
  } catch {
    return fallback;
  }
}

/**
 * Validates SMTP host and port to prevent Server-Side Request Forgery (SSRF)
 * against loopback, RFC1918 private networks, cloud metadata endpoints, and non-SMTP ports.
 */
export function isSafeSmtpTarget(host: unknown, port: unknown): { ok: boolean; reason?: string } {
  if (typeof host !== 'string' || !host.trim()) {
    return { ok: false, reason: 'SMTP host is required' };
  }
  const h = host.trim().toLowerCase();

  // Only allow valid hostname characters
  if (!/^[a-z0-9.-]+$/.test(h) || h.startsWith('.') || h.endsWith('.')) {
    return { ok: false, reason: 'Invalid SMTP hostname format' };
  }

  // Block localhost and internal domains
  const blockedHosts = new Set([
    'localhost',
    'localhost.localdomain',
    '0.0.0.0',
    '127.0.0.1',
    '::1',
    '[::1]',
    'metadata.google.internal',
    'metadata',
    '169.254.169.254',
  ]);
  if (blockedHosts.has(h) || h.endsWith('.internal') || h.endsWith('.local') || h.endsWith('.localhost')) {
    return { ok: false, reason: 'Internal or loopback SMTP hosts are forbidden for security reasons' };
  }

  // Check if IPv4 literal in private / reserved range
  const ipv4Match = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [a, b] = [Number(ipv4Match[1]), Number(ipv4Match[2])];
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    ) {
      return { ok: false, reason: 'Private or reserved IP addresses are not permitted for SMTP' };
    }
  }

  const p = Number(port);
  const allowedPorts = new Set([25, 465, 587, 2525]);
  if (!Number.isInteger(p) || !allowedPorts.has(p)) {
    return { ok: false, reason: 'SMTP port must be a standard mail port (25, 465, 587, or 2525)' };
  }

  return { ok: true };
}

/**
 * Validates a reaction emoji string so it cannot contain HTML/script payloads.
 */
export function isSafeEmoji(emoji: unknown): boolean {
  if (typeof emoji !== 'string') return false;
  const trimmed = emoji.trim();
  if (!trimmed || trimmed.length > 16) return false;
  if (/[<>"'`&\r\n\0]/.test(trimmed)) return false;
  return true;
}

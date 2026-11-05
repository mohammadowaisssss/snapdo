/* =====================================================================
   CENTRAL SECURITY UTILITIES (Frontend + Backend)
   Pure ES Module JavaScript (.js) for universal browser & server MIME compatibility.
   ===================================================================== */

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function stripDangerousKeys(input, depth = 0) {
  if (depth > 25 || input === null || input === undefined) return input;
  if (typeof input === 'string') {
    return input.replace(/\0/g, '');
  }
  if (Array.isArray(input)) {
    return input.map(item => stripDangerousKeys(item, depth + 1));
  }
  if (typeof input === 'object') {
    const clean = {};
    for (const key of Object.keys(input)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      if (key.startsWith('$')) continue;
      clean[key] = stripDangerousKeys(input[key], depth + 1);
    }
    return clean;
  }
  return input;
}

export function safeString(val, maxLength = 2000, fallback = '') {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'string') {
    return val.replace(/\0/g, '').slice(0, maxLength);
  }
  if (typeof val === 'number' || typeof val === 'boolean') {
    return String(val).slice(0, maxLength);
  }
  return fallback;
}

export function safeImageSrc(url) {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim().replace(/[\u0000-\u001F\u007F]/g, '');
  if (!trimmed) return '';
  if (/^https?:\/\/[^\s"'<>]+$/i.test(trimmed)) return trimmed;
  if (/^\/[^\s"'<>]*$/.test(trimmed) && !trimmed.startsWith('//')) return trimmed;
  if (/^blob:https?:\/\/[^\s"'<>]+$/i.test(trimmed)) return trimmed;
  if (/^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(trimmed)) {
    return trimmed;
  }
  return '';
}

export function safePdfSrc(url) {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim().replace(/[\u0000-\u001F\u007F]/g, '');
  if (/^data:application\/pdf;base64,[A-Za-z0-9+/=\s]+$/i.test(trimmed)) {
    return trimmed;
  }
  return '';
}

export function safeDownloadUrl(url) {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim().replace(/[\u0000-\u001F\u007F]/g, '');
  if (!trimmed) return '';
  if (/^https?:\/\/[^\s"'<>]+$/i.test(trimmed)) return trimmed;
  if (/^blob:https?:\/\/[^\s"'<>]+$/i.test(trimmed)) return trimmed;
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

export function safeHref(url) {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim().replace(/[\u0000-\u001F\u007F]/g, '');
  if (!trimmed) return '';
  if (/^(https?:\/\/|mailto:)[^\s"'<>]+$/i.test(trimmed)) return trimmed;
  if (/^\/[^\s"'<>]*$/.test(trimmed) && !trimmed.startsWith('//')) return trimmed;
  if (/^#[A-Za-z0-9_-]+$/.test(trimmed)) return trimmed;
  return '';
}

export function safeCssColor(color, fallback = '#6E56CF') {
  if (typeof color !== 'string') return fallback;
  const trimmed = color.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed;
  if (/^(rgb|rgba|hsl|hsla)\([0-9.,%\s]+\)$/.test(trimmed)) return trimmed;
  if (/^var\(--[a-zA-Z0-9_-]+\)$/.test(trimmed)) return trimmed;
  if (/^[a-zA-Z]{3,20}$/.test(trimmed)) return trimmed;
  return fallback;
}

export function sanitizeHeaderValue(val, maxLength = 300) {
  if (typeof val !== 'string') return '';
  return val.replace(/[\r\n\0]+/g, ' ').trim().slice(0, maxLength);
}

export function sanitizeBaseUrl(url, fallback = 'https://app.snapsec.co') {
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

export function isSafeSmtpTarget(host, port) {
  if (typeof host !== 'string' || !host.trim()) {
    return { ok: false, reason: 'SMTP host is required' };
  }
  const h = host.trim().toLowerCase();

  if (!/^[a-z0-9.-]+$/.test(h) || h.startsWith('.') || h.endsWith('.')) {
    return { ok: false, reason: 'Invalid SMTP hostname format' };
  }

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

export function isSafeEmoji(emoji) {
  if (typeof emoji !== 'string') return false;
  const trimmed = emoji.trim();
  if (!trimmed || trimmed.length > 16) return false;
  if (/[<>"'`&\r\n\0]/.test(trimmed)) return false;
  return true;
}

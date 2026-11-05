import express from 'express';
import path from 'node:path';
import { EXPLICIT_MIME_TYPES } from '../config/mime.ts';
import { stripDangerousKeys } from '../utils/security.ts';

/**
 * Sets CORS, Content-Security-Policy, X-Content-Type-Options, Referrer-Policy,
 * Permissions-Policy, and explicit MIME types for static assets.
 */
export function securityHeadersMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://apis.google.com https://*.gstatic.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https: http:",
      "connect-src 'self' http: https: ws: wss: https://*.googleapis.com",
      "worker-src 'self' blob:",
      "frame-src 'self' data: https://accounts.google.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  );

  // Guarantee explicit Content-Type for static JS/CSS/SVG/WASM/Font requests regardless of host OS /etc/mime.types
  if (!req.path.startsWith('/api/')) {
    const cleanPath = req.path.split('?')[0];
    const ext = path.extname(cleanPath).toLowerCase();
    if (ext && EXPLICIT_MIME_TYPES[ext]) {
      res.setHeader('Content-Type', EXPLICIT_MIME_TYPES[ext]);
    }
  }
  next();
}

/**
 * Strips prototype-pollution keys (__proto__, constructor, prototype) and NoSQL
 * operator keys ($ne, $where, etc.) from request bodies and query parameters.
 */
export function payloadSanitizerMiddleware(
  req: express.Request,
  _res: express.Response,
  next: express.NextFunction,
) {
  if (req.body && typeof req.body === 'object') {
    req.body = stripDangerousKeys(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    const cleanQuery = stripDangerousKeys(req.query);
    for (const k of Object.keys(req.query)) {
      delete (req.query as any)[k];
    }
    Object.assign(req.query, cleanQuery);
  }
  next();
}

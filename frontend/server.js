/* ============================================================================
   Snapsec TaskTracker — Production Frontend Node.js Server (No Nginx)
   Serves compiled SPA assets on port 4000 with explicit MIME types and
   forwards /api/* requests to the Backend service on port 5000.
   ============================================================================ */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4000);
const BACKEND_URL = (process.env.BACKEND_URL || 'http://backend:5000').replace(/\/+$/, '');
const distPath = path.join(__dirname, 'dist');
const distIndex = path.join(distPath, 'index.html');

const EXPLICIT_MIME_TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.svgz': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf',
};

const app = express();
app.disable('x-powered-by');

// 1. Security Headers & Explicit MIME-Type Enforcement
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');

  if (!req.path.startsWith('/api/')) {
    const cleanPath = req.path.split('?')[0];
    const ext = path.extname(cleanPath).toLowerCase();
    if (ext && EXPLICIT_MIME_TYPES[ext]) {
      res.setHeader('Content-Type', EXPLICIT_MIME_TYPES[ext]);
    }
  }
  next();
});

// 2. Native Node.js Reverse Proxy for /api/* -> BACKEND_URL (http://backend:5000)
app.use('/api', express.raw({ type: '*/*', limit: '15mb' }), async (req, res) => {
  try {
    const targetUrl = `${BACKEND_URL}${req.originalUrl}`;
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (k.toLowerCase() === 'host' || k.toLowerCase() === 'connection' || k.toLowerCase() === 'content-length') {
        continue;
      }
      if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(', ') : String(v);
    }

    const hasBody = !['GET', 'HEAD'].includes(req.method.toUpperCase()) && req.body && req.body.length > 0;
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
    });

    res.status(upstream.status);
    upstream.headers.forEach((val, key) => {
      if (!['transfer-encoding', 'content-encoding', 'content-length'].includes(key.toLowerCase())) {
        res.setHeader(key, val);
      }
    });

    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    res.status(502).json({
      error: 'Backend service unreachable',
      details: err instanceof Error ? err.message : String(err),
    });
  }
});

// 3. Static SPA Assets with Explicit Content-Type Headers
app.use(
  express.static(distPath, {
    setHeaders(res, filePath) {
      const ext = path.extname(filePath).toLowerCase();
      if (ext && EXPLICIT_MIME_TYPES[ext]) {
        res.setHeader('Content-Type', EXPLICIT_MIME_TYPES[ext]);
      }
    },
  }),
);

// 4. Resilient fallback if a browser with a cached index.html requests an older hashed /assets/*.js or /assets/*.css
app.get('/assets/:file', (req, res, next) => {
  const requested = req.params.file || '';
  const ext = path.extname(requested).toLowerCase();
  const assetsDir = path.join(distPath, 'assets');
  if ((ext === '.js' || ext === '.mjs' || ext === '.css') && fs.existsSync(assetsDir)) {
    const files = fs.readdirSync(assetsDir);
    const match = files.find(f => path.extname(f).toLowerCase() === ext);
    if (match) {
      res.setHeader('Content-Type', EXPLICIT_MIME_TYPES[ext]);
      res.sendFile(path.join(assetsDir, match));
      return;
    }
  }
  next();
});

// 5. SPA Fallback for Client-Side Routes (never return text/html for missing .js/.css assets)
app.get('*', (req, res) => {
  const ext = path.extname(req.path).toLowerCase();
  if (ext && ext !== '.html' && ext !== '.htm') {
    res.status(404).type('text/plain').send('Asset not found');
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(distIndex);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Snapsec TaskTracker Frontend UI server running on http://0.0.0.0:${PORT} (API proxy -> ${BACKEND_URL})`);
});

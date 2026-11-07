import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { EXPLICIT_MIME_TYPES } from './config/mime.ts';
import { flushToPostgresPool, isPostgresConfigured } from './db/index.ts';
import { ensureRelationalDatabaseSeeded, syncPostgresMirrorIfEnabled } from './db/repository.ts';
import { payloadSanitizerMiddleware, securityHeadersMiddleware } from './middleware/security.ts';
import { apiRouter } from './routes/index.ts';

export { EXPLICIT_MIME_TYPES };

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');

  // Ensure normalized PostgreSQL tables and B-tree indexes are initialized
  ensureRelationalDatabaseSeeded();
  syncPostgresMirrorIfEnabled().catch(() => {});

  // Security headers, CORS, explicit static MIME types, JSON body parser, and payload sanitizer
  app.use(securityHeadersMiddleware);
  app.use(express.json({ limit: '25mb' }));
  app.use(payloadSanitizerMiddleware);

  // Flush mutating requests to PostgreSQL pool before completing the HTTP response
  app.use('/api', (req, res, next) => {
    if (
      isPostgresConfigured() &&
      (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE')
    ) {
      const origJson = res.json.bind(res);
      res.json = ((body: any) => {
        flushToPostgresPool()
          .catch(err => {
            console.warn('PostgreSQL commit warning:', err?.message || err);
          })
          .finally(() => {
            origJson(body);
          });
        return res;
      }) as any;
    }
    next();
  });

  // Mount modular REST API routes under /api
  app.use('/api', apiRouter);

  return app;
}

export function mountCompiledDist(app: express.Express, distPath: string) {
  const distIndex = path.join(distPath, 'index.html');
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

  // Resilient fallback if a browser with a cached index.html requests an older hashed /assets/*.js or /assets/*.css file
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

  if (fs.existsSync(distIndex)) {
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      const ext = path.extname(req.path).toLowerCase();
      // Never return index.html (text/html) for missing .js/.css/.wasm/asset files
      if (ext && ext !== '.html' && ext !== '.htm') {
        res.status(404).type('text/plain').send('Asset not found');
        return;
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.sendFile(distIndex);
    });
  }
}

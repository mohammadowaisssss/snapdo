/* ============================================================================
   Snapsec TaskTracker — Root Unified Server Entrypoint
   Delegates all API routes, middleware, and SQL persistence to the modular
   backend architecture in ./backend/src/app.ts while serving the frontend from ./frontend.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { EXPLICIT_MIME_TYPES, createApp, mountCompiledDist } from './backend/src/app.ts';
import { syncPostgresMirrorIfEnabled } from './backend/src/db/repository.ts';

export { EXPLICIT_MIME_TYPES, createApp, mountCompiledDist };

async function startServer() {
  await syncPostgresMirrorIfEnabled();
  const app = createApp();
  const PORT = Number(process.env.PORT || 3000);
  const distPath = path.join(process.cwd(), 'dist');
  const distIndex = path.join(distPath, 'index.html');
  const frontendDir = path.resolve('frontend');

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      configFile: path.resolve('vite.config.ts'),
      root: frontendDir,
      server: { middlewareMode: true, allowedHosts: true as const },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    if (!fs.existsSync(distIndex)) {
      try {
        console.log('Building production frontend bundle into dist/...');
        const { build } = await import('vite');
        await build();
      } catch (err) {
        console.error('Automatic Vite build failed, falling back to Vite middleware:', err);
      }
    }

    if (fs.existsSync(distIndex)) {
      mountCompiledDist(app, distPath);
    } else {
      const vite = await createViteServer({
        configFile: path.resolve('vite.config.ts'),
        root: frontendDir,
        server: { middlewareMode: true, allowedHosts: true as const },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Snapsec TaskTracker server running on http://localhost:${PORT}`);
  });
}

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

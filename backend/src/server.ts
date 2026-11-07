import { createApp } from './app.ts';
import { ENV } from './config/env.ts';
import { syncPostgresMirrorIfEnabled } from './db/repository.ts';

export async function startBackendServer() {
  // Hydrate existing PostgreSQL data and ensure MinIO bucket before serving requests
  await syncPostgresMirrorIfEnabled();

  const app = createApp();
  const port = ENV.PORT;

  app.listen(port, '0.0.0.0', () => {
    console.log(`Snapsec TaskTracker Backend API running on http://0.0.0.0:${port}`);
  });
}

if (process.env.NODE_ENV !== 'test') {
  startBackendServer().catch(err => {
    console.error('Failed to start backend server:', err);
  });
}

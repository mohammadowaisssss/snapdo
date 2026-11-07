import { Router } from 'express';
import { DATA_DIR } from '../db/index.ts';
import {
  patchPreferencesSql,
  populateAllTablesTransaction,
  queryBootstrapStore,
  queryWorkspaceMetrics,
  resetDatabaseToDefaultSql,
} from '../db/repository.ts';
import { MINIO_BUCKET } from '../services/minio.ts';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  const metrics = queryWorkspaceMetrics();
  res.json({
    status: 'ok',
    service: 'Snapsec TaskTracker Backend',
    database: 'postgresql-drizzle',
    storage: 'minio-s3',
    bucket: MINIO_BUCKET,
    dataDir: DATA_DIR,
    updatedAt: metrics.updatedAt,
    metrics,
  });
});

healthRouter.get('/bootstrap', (_req, res) => {
  const store = queryBootstrapStore();
  const metrics = queryWorkspaceMetrics();
  res.json({
    ok: true,
    version: 3,
    updatedAt: store.updatedAt,
    data: store.data,
    prefs: store.prefs,
    metrics,
  });
});

healthRouter.get('/metrics', (_req, res) => {
  res.json({
    ok: true,
    metrics: queryWorkspaceMetrics(),
  });
});

healthRouter.put('/state', (req, res) => {
  const { data, prefs } = req.body || {};
  if (!data && !prefs) {
    res.status(400).json({ error: 'Payload must contain data or prefs' });
    return;
  }
  if (data && typeof data === 'object' && Array.isArray(data.tasks) && Array.isArray(data.projects)) {
    const store = queryBootstrapStore();
    const nextStore = {
      updatedAt: Date.now(),
      data: { ...store.data, ...data },
      prefs: prefs && typeof prefs === 'object' ? { ...store.prefs, ...prefs } : store.prefs,
      views: store.views || {},
      collapsed: Boolean(store.collapsed),
    };
    populateAllTablesTransaction(nextStore);
    res.json({
      ok: true,
      updatedAt: nextStore.updatedAt,
      metrics: queryWorkspaceMetrics(),
    });
    return;
  }
  if (prefs && typeof prefs === 'object') {
    const updated = patchPreferencesSql(prefs);
    res.json({
      ok: true,
      updatedAt: updated.updatedAt,
      metrics: queryWorkspaceMetrics(),
    });
    return;
  }
  res.status(400).json({ error: 'Invalid state payload' });
});

healthRouter.post('/reset', (_req, res) => {
  const store = resetDatabaseToDefaultSql();
  res.json({
    ok: true,
    data: store.data,
    prefs: store.prefs,
    updatedAt: store.updatedAt,
  });
});

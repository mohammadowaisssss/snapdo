import { Router } from 'express';
import {
  deleteFileSql,
  duplicateFileSql,
  insertFileSql,
  listFilesSql,
  renameFileSql,
} from '../db/repository.ts';
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


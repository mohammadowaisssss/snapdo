import { Router } from 'express';
import {
  deleteProjectSql,
  duplicateProjectSql,
  getProjectByIdSql,
  insertProjectSql,
  listProjectsSql,
  patchProjectSql,
  reorderProjectsSql,
} from '../db/repository.ts';

export const projectsRouter = Router();

projectsRouter.get('/projects', (req, res) => {
  const includeArchived = req.query.archived === 'true';
  const { projects, projOrder } = listProjectsSql();
  const list = includeArchived ? projects : projects.filter((p: any) => !p.archived);
  res.json({ projects: list, projOrder, total: list.length });
});

projectsRouter.get('/projects/:id', (req, res) => {
  const project = getProjectByIdSql(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json({ project });
});

projectsRouter.post('/projects', (req, res) => {
  const { name, tmpl } = req.body || {};
  if (!name || !String(name).trim()) {
    res.status(400).json({ error: 'Project name is required' });
    return;
  }
  const result = insertProjectSql(req.body, tmpl || 'blank');
  const { projOrder } = listProjectsSql();
  res.status(201).json({
    ok: true,
    project: result.project,
    projOrder,
    updatedAt: result.updatedAt,
  });
});

projectsRouter.patch('/projects/:id', (req, res) => {
  const result = patchProjectSql(req.params.id, req.body || {});
  if (!result) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json({
    ok: true,
    project: result.project,
    updatedAt: result.updatedAt,
  });
});

projectsRouter.post('/projects/:id/duplicate', (req, res) => {
  const result = duplicateProjectSql(req.params.id);
  if (!result) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const { projOrder } = listProjectsSql();
  res.status(201).json({
    ok: true,
    project: result.project,
    projOrder,
    updatedAt: result.updatedAt,
  });
});

projectsRouter.post('/projects/:id/archive', (req, res) => {
  const result = patchProjectSql(req.params.id, { archived: true });
  if (!result) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json({ ok: true, project: result.project, updatedAt: result.updatedAt });
});

projectsRouter.post('/projects/:id/restore', (req, res) => {
  const result = patchProjectSql(req.params.id, { archived: false });
  if (!result) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json({ ok: true, project: result.project, updatedAt: result.updatedAt });
});

projectsRouter.delete('/projects/:id', (req, res) => {
  const result = deleteProjectSql(req.params.id);
  if (!result.ok) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const { projOrder } = listProjectsSql();
  res.json({ ok: true, projOrder, updatedAt: result.updatedAt });
});

projectsRouter.put('/projects-order', (req, res) => {
  const { projOrder } = req.body || {};
  if (!Array.isArray(projOrder)) {
    res.status(400).json({ error: 'projOrder array is required' });
    return;
  }
  const result = reorderProjectsSql(projOrder);
  res.json({ ok: true, projOrder: result.projOrder, updatedAt: result.updatedAt });
});

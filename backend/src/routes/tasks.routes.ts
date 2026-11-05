import { Router } from 'express';
import {
  archiveTaskSql,
  deleteSubtaskSql,
  deleteTasksSql,
  duplicateTaskSql,
  insertSubtaskSql,
  insertTaskSql,
  patchSubtaskSql,
  patchTaskSql,
  promoteSubtaskSql,
  queryTaskByIdSql,
  queryTaskCommentsSql,
  queryTasksSql,
  restoreTaskSql,
} from '../db/repository.ts';
import { computeTaskProgress } from '../services/engine.ts';
import { safeString } from '../utils/security.ts';

export const tasksRouter = Router();

tasksRouter.get('/tasks', (req, res) => {
  const { project, status, assignee, priority, fav, archived, q } = req.query;
  const tasks = queryTasksSql({
    project: project !== undefined ? safeString(project, 64) : undefined,
    status: status !== undefined ? safeString(status, 32) : undefined,
    assignee: assignee !== undefined ? safeString(assignee, 64) : undefined,
    priority: priority !== undefined ? safeString(priority, 32) : undefined,
    fav: fav !== undefined ? fav === 'true' : undefined,
    archived: archived !== undefined ? archived === 'true' : false,
    q: q !== undefined ? safeString(q, 250) : undefined,
  });
  res.json({
    tasks: tasks.map((t: any) => ({ ...t, progress: computeTaskProgress(t) })),
    total: tasks.length,
  });
});

tasksRouter.get('/tasks/:id', (req, res) => {
  const t = queryTaskByIdSql(req.params.id);
  if (!t) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  const comments = queryTaskCommentsSql(t.id);
  res.json({ task: { ...t, progress: computeTaskProgress(t) }, comments });
});

tasksRouter.post('/tasks', (req, res) => {
  const { title } = req.body || {};
  if (!title || !String(title).trim()) {
    res.status(400).json({ error: 'Task title is required' });
    return;
  }
  const { task: created, updatedAt } = insertTaskSql(req.body);
  res.status(201).json({
    ok: true,
    task: { ...created, progress: computeTaskProgress(created) },
    updatedAt,
  });
});

tasksRouter.patch('/tasks/:id', (req, res) => {
  const result = patchTaskSql(req.params.id, req.body || {});
  if (!result) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json({
    ok: true,
    task: { ...result.task, progress: computeTaskProgress(result.task) },
    messages: result.messages,
    updatedAt: result.updatedAt,
  });
});

tasksRouter.post('/tasks/:id/duplicate', (req, res) => {
  const result = duplicateTaskSql(req.params.id);
  if (!result) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.status(201).json({
    ok: true,
    task: { ...result.task, progress: computeTaskProgress(result.task) },
    updatedAt: result.updatedAt,
  });
});

tasksRouter.post('/tasks/:id/archive', (req, res) => {
  const result = archiveTaskSql(req.params.id);
  if (!result) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json({ ok: true, task: result.task, updatedAt: result.updatedAt });
});

tasksRouter.post('/tasks/:id/restore', (req, res) => {
  const result = restoreTaskSql(req.params.id);
  if (!result) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json({ ok: true, task: result.task, updatedAt: result.updatedAt });
});

tasksRouter.delete('/tasks/:id', (req, res) => {
  const { deleted, updatedAt } = deleteTasksSql([req.params.id]);
  if (!deleted) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json({ ok: true, deleted, updatedAt });
});

tasksRouter.post('/tasks/bulk', (req, res) => {
  const { ids, action, patch } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) {
    res.status(400).json({ error: 'ids array is required' });
    return;
  }
  if (action === 'delete') {
    const { deleted, updatedAt } = deleteTasksSql(ids);
    res.json({ ok: true, deleted, updatedAt });
    return;
  }
  if (action === 'archive') {
    const updated = ids.map((id: string) => archiveTaskSql(id)?.task).filter(Boolean);
    res.json({ ok: true, tasks: updated, updatedAt: Date.now() });
    return;
  }
  if (patch && typeof patch === 'object') {
    const updated = ids.map((id: string) => patchTaskSql(id, patch)?.task).filter(Boolean);
    res.json({ ok: true, tasks: updated, updatedAt: Date.now() });
    return;
  }
  res.status(400).json({ error: 'Specify action (delete|archive) or patch object' });
});

// Subtasks
tasksRouter.post('/tasks/:id/subtasks', (req, res) => {
  const { title } = req.body || {};
  if (!title || !String(title).trim()) {
    res.status(400).json({ error: 'Subtask title is required' });
    return;
  }
  const result = insertSubtaskSql(req.params.id, title);
  if (!result) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.status(201).json({
    ok: true,
    subtask: result.subtask,
    task: queryTaskByIdSql(req.params.id),
    updatedAt: result.updatedAt,
  });
});

tasksRouter.patch('/tasks/:id/subtasks/:sid', (req, res) => {
  const result = patchSubtaskSql(req.params.id, req.params.sid, req.body || {});
  if (!result) {
    res.status(404).json({ error: 'Subtask or task not found' });
    return;
  }
  res.json({
    ok: true,
    subtask: result.subtask,
    task: queryTaskByIdSql(req.params.id),
    updatedAt: result.updatedAt,
  });
});

tasksRouter.delete('/tasks/:id/subtasks/:sid', (req, res) => {
  const result = deleteSubtaskSql(req.params.id, req.params.sid);
  if (!result.ok) {
    res.status(404).json({ error: 'Subtask or task not found' });
    return;
  }
  res.json({
    ok: true,
    task: queryTaskByIdSql(req.params.id),
    updatedAt: result.updatedAt,
  });
});

tasksRouter.post('/tasks/:id/subtasks/:sid/promote', (req, res) => {
  const result = promoteSubtaskSql(req.params.id, req.params.sid);
  if (!result) {
    res.status(404).json({ error: 'Subtask or task not found' });
    return;
  }
  res.status(201).json({
    ok: true,
    task: result.task,
    parentTask: queryTaskByIdSql(req.params.id),
    updatedAt: result.updatedAt,
  });
});


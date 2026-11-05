import { Router } from 'express';
import {
  deleteCommentSql,
  insertCommentSql,
  queryTaskCommentsSql,
  toggleCommentReactionSql,
} from '../db/repository.ts';

export const commentsRouter = Router();

commentsRouter.get('/tasks/:id/comments', (req, res) => {
  const list = queryTaskCommentsSql(req.params.id);
  res.json({ comments: list });
});

commentsRouter.post('/tasks/:id/comments', (req, res) => {
  const { text, by, attachments } = req.body || {};
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
  if ((!text || !String(text).trim()) && !hasAttachments) {
    res.status(400).json({ error: 'Comment text or attachment is required' });
    return;
  }
  const result = insertCommentSql(req.params.id, text || '', by, attachments);
  if (!result) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.status(201).json({
    ok: true,
    comment: result.comment,
    updatedAt: result.updatedAt,
  });
});

commentsRouter.post('/comments/:cid/reactions', (req, res) => {
  const { emoji, by } = req.body || {};
  if (!emoji) {
    res.status(400).json({ error: 'emoji is required' });
    return;
  }
  const result = toggleCommentReactionSql(req.params.cid, emoji, by);
  if (!result) {
    res.status(404).json({ error: 'Comment not found' });
    return;
  }
  res.json({ ok: true, comment: result.comment, updatedAt: result.updatedAt });
});

commentsRouter.delete('/comments/:cid', (req, res) => {
  const result = deleteCommentSql(req.params.cid);
  if (!result.ok) {
    res.status(404).json({ error: 'Comment not found' });
    return;
  }
  res.json({ ok: true, updatedAt: result.updatedAt });
});


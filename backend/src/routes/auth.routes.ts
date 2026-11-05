import { Router } from 'express';
import {
  authenticateWorkspaceUserSql,
  deleteOtherSessionsSql,
  deleteSessionSql,
  setTwoFactorSql,
} from '../db/repository.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import { validateAuthCredentials } from '../services/engine.ts';

export const authRouter = Router();

authRouter.post('/auth/login', rateLimit(20, 60_000), (req, res) => {
  const check = validateAuthCredentials('login', req.body || {});
  if (!check.valid) {
    res.status(400).json({ errors: check.errors });
    return;
  }
  const email = String(req.body.email).trim();
  const result = authenticateWorkspaceUserSql({ email, name: req.body.name });
  res.json({
    ok: true,
    ...result,
  });
});

authRouter.post('/auth/signup', rateLimit(15, 60_000), (req, res) => {
  const check = validateAuthCredentials('signup', req.body || {});
  if (!check.valid) {
    res.status(400).json({ errors: check.errors });
    return;
  }
  const email = String(req.body.email).trim();
  const name = String(req.body.name).trim();
  const result = authenticateWorkspaceUserSql({ email, name });
  res.status(201).json({
    ok: true,
    status: 'verification_required',
    ...result,
    email,
  });
});

authRouter.post('/auth/google', (req, res) => {
  const email = String(req.body?.email || '').trim();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    res.status(400).json({ error: 'Valid Google account email is required' });
    return;
  }
  const result = authenticateWorkspaceUserSql({
    uid: req.body?.uid,
    name: req.body?.name,
    email,
    photoURL: req.body?.photoURL,
    provider: 'Google',
  });
  res.json({
    ok: true,
    ...result,
  });
});

authRouter.post('/auth/forgot', (req, res) => {
  const email = String(req.body?.email || '').trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    res.status(400).json({ errors: { email: 'Enter the email you use to sign in' } });
    return;
  }
  res.json({ ok: true, email });
});

authRouter.post('/auth/reset', (req, res) => {
  const check = validateAuthCredentials('reset', req.body || {});
  if (!check.valid) {
    res.status(400).json({ errors: check.errors });
    return;
  }
  res.json({ ok: true });
});

authRouter.post('/auth/password', (req, res) => {
  const check = validateAuthCredentials('password', req.body || {});
  if (!check.valid) {
    res.status(400).json({ errors: check.errors });
    return;
  }
  res.json({ ok: true });
});

authRouter.post('/auth/2fa', (req, res) => {
  const { enabled, code } = req.body || {};
  if (enabled && !/^\d{6}$/.test(String(code || '').trim())) {
    res.status(400).json({ error: 'Enter the 6-digit code from your app' });
    return;
  }
  const { tfa, updatedAt } = setTwoFactorSql(Boolean(enabled));
  res.json({ ok: true, tfa, updatedAt });
});

authRouter.delete('/sessions/:id', (req, res) => {
  const { sessions, updatedAt } = deleteSessionSql(req.params.id);
  res.json({ ok: true, sessions, updatedAt });
});

authRouter.delete('/sessions', (_req, res) => {
  const { sessions, updatedAt } = deleteOtherSessionsSql();
  res.json({ ok: true, sessions, updatedAt });
});

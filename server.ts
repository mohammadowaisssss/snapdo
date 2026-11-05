import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { createServer as createViteServer } from 'vite';
import {
  PersistedStore,
  acceptInviteTokenRecord,
  addCommentRecord,
  addFileRecord,
  addSubtaskRecord,
  applyTaskPatch,
  archiveTaskRecord,
  authenticateWorkspaceUser,
  buildInvitationEmail,
  computeProjectProgress,
  computeTaskProgress,
  computeWorkspaceMetrics,
  createDefaultState,
  createProjectRecord,
  createTaskRecord,
  createTeamRecord,
  deleteCommentRecord,
  deleteFileRecord,
  deleteProjectRecord,
  deleteSubtaskRecord,
  deleteTaskRecords,
  deleteTeamRecord,
  duplicateFileRecord,
  duplicateProjectRecord,
  duplicateTaskRecord,
  filterTasks,
  inviteMemberRecords,
  promoteSubtaskRecord,
  removeMemberRecord,
  renameFileRecord,
  restoreTaskRecord,
  toggleCommentReaction,
  updateProjectRecord,
  updateSubtaskRecord,
  updateTeamRecord,
  validateAuthCredentials,
} from './src/backend/engine.js';
import { uid } from './src/core/utils.js';
import {
  isSafeSmtpTarget,
  safeCssColor,
  safeImageSrc,
  safeString,
  sanitizeBaseUrl,
  sanitizeHeaderValue,
  stripDangerousKeys,
} from './src/core/security.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'snapsec-db.json');

const ALLOWED_MEMBER_PATCH_KEYS = new Set([
  'name',
  'email',
  'role',
  'team',
  'title',
  'c',
  'status',
  'tz',
  'photoURL',
]);

let cachedEtherealAccount: any = null;

function buildRawMimeEmail(outboxItem: any, fromEmail: string): string {
  const fromName = sanitizeHeaderValue(outboxItem.fromName || 'Snapsec Workspace', 100).replace(/"/g, '');
  const cleanFrom = sanitizeHeaderValue(fromEmail, 150);
  const cleanTo = sanitizeHeaderValue(outboxItem.to, 150);
  const cleanSubject = sanitizeHeaderValue(outboxItem.subject || 'Snapsec Invitation', 200);
  const subject = `=?UTF-8?B?${Buffer.from(cleanSubject, 'utf8').toString('base64')}?=`;
  const lines = [
    `From: "${fromName}" <${cleanFrom}>`,
    `To: ${cleanTo}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(String(outboxItem.html || outboxItem.text || ''), 'utf8').toString('base64'),
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function dispatchOutboxEmail(
  store: PersistedStore,
  outboxItem: any,
  opts: { googleAccessToken?: string; senderEmail?: string } = {},
) {
  if (!outboxItem) return outboxItem;
  if (process.env.NODE_ENV === 'test') {
    outboxItem.status = 'sent';
    outboxItem.transport = 'test';
    outboxItem.deliveredToInbox = true;
    return outboxItem;
  }

  const googleToken = opts.googleAccessToken || '';
  const senderEmail = opts.senderEmail || outboxItem.from || 'mohammadowais616@gmail.com';

  // 1. Try Google OAuth (Gmail REST API first, then smtp.gmail.com:465 XOAUTH2)
  if (googleToken) {
    try {
      const raw = buildRawMimeEmail(outboxItem, senderEmail);
      const gmailRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${googleToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw }),
      });
      if (gmailRes.ok) {
        const gmailData: any = await gmailRes.json();
        outboxItem.messageId = gmailData.id || uid('gmail');
        outboxItem.status = 'sent';
        outboxItem.transport = 'gmail-api';
        outboxItem.deliveredToInbox = true;
        outboxItem.transportError = undefined;
        return outboxItem;
      }
    } catch {
      /* fallback to smtp.gmail.com XOAUTH2 below */
    }

    try {
      const oauthTransporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
          type: 'OAuth2',
          user: senderEmail,
          accessToken: googleToken,
        },
      });
      const info = await oauthTransporter.sendMail({
        from: `"${outboxItem.fromName || 'Snapsec Workspace'}" <${senderEmail}>`,
        to: outboxItem.to,
        subject: outboxItem.subject,
        text: outboxItem.text,
        html: outboxItem.html,
      });
      outboxItem.messageId = info.messageId;
      outboxItem.status = 'sent';
      outboxItem.transport = 'gmail-smtp-oauth';
      outboxItem.deliveredToInbox = true;
      outboxItem.transportError = undefined;
      return outboxItem;
    } catch (oauthErr: any) {
      outboxItem.oauthError = oauthErr?.message || 'Google OAuth SMTP failed';
    }
  }

  // 2. Try Custom SMTP / Gmail App Password (smtp.gmail.com or custom SMTP server)
  const customSmtp = store.data?.smtpConfig;
  const host = (customSmtp?.host || process.env.SMTP_HOST || '').trim();
  const port = Number(customSmtp?.port || process.env.SMTP_PORT || 465);
  const user = (customSmtp?.user || process.env.SMTP_USER || '').trim();
  const rawPass = (customSmtp?.pass || process.env.SMTP_PASS || '').trim();
  const pass = host.includes('gmail.com') ? rawPass.replace(/\s+/g, '') : rawPass;

  if (host && user && pass) {
    try {
      const smtpTransporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
      const info = await smtpTransporter.sendMail({
        from: `"${outboxItem.fromName || 'Snapsec Workspace'}" <${customSmtp?.from || user}>`,
        to: outboxItem.to,
        subject: outboxItem.subject,
        text: outboxItem.text,
        html: outboxItem.html,
      });
      outboxItem.messageId = info.messageId;
      outboxItem.status = 'sent';
      outboxItem.transport = 'custom-smtp';
      outboxItem.deliveredToInbox = true;
      outboxItem.transportError = undefined;
      return outboxItem;
    } catch (smtpErr: any) {
      outboxItem.transportError = smtpErr?.message || 'Custom SMTP authentication failed';
    }
  }

  // 3. Fallback: Ethereal SMTP sandbox (generates live webmail preview URL)
  try {
    if (!cachedEtherealAccount) {
      cachedEtherealAccount = await nodemailer.createTestAccount();
    }
    const transporter = nodemailer.createTransport({
      host: cachedEtherealAccount.smtp.host,
      port: cachedEtherealAccount.smtp.port,
      secure: cachedEtherealAccount.smtp.secure,
      auth: {
        user: cachedEtherealAccount.user,
        pass: cachedEtherealAccount.pass,
      },
    });

    const info = await transporter.sendMail({
      from: `"${outboxItem.fromName || 'Snapsec Workspace'}" <${outboxItem.from || 'noreply@snapsec.co'}>`,
      to: outboxItem.to,
      subject: outboxItem.subject,
      text: outboxItem.text,
      html: outboxItem.html,
    });

    outboxItem.messageId = info.messageId;
    outboxItem.status = 'sent';
    outboxItem.transport = 'ethereal-smtp';
    outboxItem.deliveredToInbox = false;
    const url = nodemailer.getTestMessageUrl(info);
    if (url) outboxItem.previewUrl = String(url);
  } catch (err: any) {
    outboxItem.status = 'ready';
    outboxItem.deliveredToInbox = false;
    outboxItem.transportError = err?.message || 'SMTP relay unavailable';
  }
  return outboxItem;
}

function sanitizeLegacyIdentity(store: PersistedStore) {
  let changed = false;
  if (store?.prefs?.name === 'Tanjim Islam') {
    store.prefs.name = 'Mohammad Owais';
    changed = true;
  }
  const m1 = (store?.data?.members || []).find((m: any) => m.id === 'm1');
  if (m1 && (m1.name === 'Tanjim Islam' || m1.email === 'hello@snapsec.com')) {
    m1.name = store?.prefs?.name || 'Mohammad Owais';
    m1.email = 'mohammadowais616@gmail.com';
    changed = true;
  }
  (store?.data?.comments || []).forEach((c: any) => {
    if (typeof c.text === 'string' && c.text.includes('@Tanjim Islam')) {
      c.text = c.text.replace(/@Tanjim Islam/g, `@${m1?.name || 'Mohammad Owais'}`);
      changed = true;
    }
  });
  (store?.data?.notifs || []).forEach((n: any) => {
    if (typeof n.snippet === 'string' && n.snippet.includes('@Tanjim Islam')) {
      n.snippet = n.snippet.replace(/@Tanjim Islam/g, `@${m1?.name || 'Mohammad Owais'}`);
      changed = true;
    }
  });
  return changed;
}

function loadDatabase(): PersistedStore {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.data && Array.isArray(parsed.data.tasks)) {
        if (sanitizeLegacyIdentity(parsed)) {
          saveDatabase(parsed);
        }
        return parsed;
      }
    }
  } catch (err) {
    console.error('Failed to read database file, re-initializing from seed:', err);
  }
  const initial = createDefaultState();
  saveDatabase(initial);
  return initial;
}

function saveDatabase(store: PersistedStore) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    store.updatedAt = Date.now();
    const tmpFile = `${DB_FILE}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(store), 'utf8');
    fs.renameSync(tmpFile, DB_FILE);
  } catch (err) {
    console.error('Failed to persist database:', err);
  }
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  // 1. Security Headers Middleware (CSP, nosniff, frame-ancestors, Referrer-Policy, Permissions-Policy)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://apis.google.com https://*.firebaseapp.com https://*.gstatic.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: blob: https:",
        "connect-src 'self' ws: wss: https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com",
        "frame-src 'self' data: https://*.firebaseapp.com https://accounts.google.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
    );
    next();
  });

  app.use(express.json({ limit: '15mb' }));

  // 2. Global Prototype Pollution & NoSQL Operator Sanitizer Middleware
  app.use((req, _res, next) => {
    if (req.body && typeof req.body === 'object') {
      req.body = stripDangerousKeys(req.body);
    }
    if (req.query && typeof req.query === 'object') {
      const cleanQuery = stripDangerousKeys(req.query);
      for (const k of Object.keys(req.query)) {
        delete (req.query as any)[k];
      }
      Object.assign(req.query, cleanQuery);
    }
    next();
  });

  // 3. Sliding-Window Rate Limiter for sensitive Auth / Invite / SMTP endpoints
  const rateBuckets = new Map<string, { count: number; resetAt: number }>();
  const rateLimit = (maxRequests: number, windowMs: number) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (process.env.NODE_ENV === 'test') return next();
    const key = `${req.ip || 'local'}:${req.path}`;
    const now = Date.now();
    const entry = rateBuckets.get(key);
    if (!entry || now > entry.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count++;
    if (entry.count > maxRequests) {
      res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
      return;
    }
    next();
  };

  let db: PersistedStore = loadDatabase();

  // --- Health & Bootstrap ---
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'Snapsec TaskTracker Backend',
      updatedAt: db.updatedAt,
      metrics: computeWorkspaceMetrics(db.data),
    });
  });

  app.get('/api/bootstrap', (_req, res) => {
    res.json({
      data: db.data,
      prefs: db.prefs,
      views: db.views,
      collapsed: db.collapsed,
      updatedAt: db.updatedAt,
      metrics: computeWorkspaceMetrics(db.data),
    });
  });

  app.get('/api/metrics', (_req, res) => {
    res.json(computeWorkspaceMetrics(db.data));
  });

  // --- Full State Sync & Reset ---
  app.put('/api/state', (req, res) => {
    const { data, prefs, views, collapsed } = stripDangerousKeys(req.body || {});
    if (!data || !Array.isArray(data.tasks) || !Array.isArray(data.projects)) {
      res.status(400).json({ error: 'Invalid state payload: data.tasks and data.projects are required' });
      return;
    }
    db.data = data;
    if (prefs && typeof prefs === 'object') db.prefs = { ...db.prefs, ...prefs };
    if (views && typeof views === 'object') db.views = views;
    if (typeof collapsed === 'boolean') db.collapsed = collapsed;
    saveDatabase(db);
    res.json({ ok: true, updatedAt: db.updatedAt });
  });

  app.post('/api/reset', (_req, res) => {
    const theme = db.prefs?.theme || 'system';
    db = createDefaultState();
    db.prefs.theme = theme;
    saveDatabase(db);
    res.json({
      ok: true,
      data: db.data,
      prefs: db.prefs,
      views: db.views,
      collapsed: db.collapsed,
      updatedAt: db.updatedAt,
    });
  });

  // --- Tasks API ---
  app.get('/api/tasks', (req, res) => {
    const list = filterTasks(db.data, req.query as Record<string, any>).map(t => ({
      ...t,
      progress: computeTaskProgress(t),
    }));
    res.json({ tasks: list, total: list.length });
  });

  app.get('/api/tasks/:id', (req, res) => {
    const t = (db.data.tasks || []).find((x: any) => x.id === req.params.id);
    if (!t) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    const comments = (db.data.comments || []).filter((c: any) => c.task === t.id);
    res.json({ task: { ...t, progress: computeTaskProgress(t) }, comments });
  });

  app.post('/api/tasks', (req, res) => {
    const title = String(req.body?.title || '').trim();
    if (!title) {
      res.status(400).json({ error: 'Give the task a name' });
      return;
    }
    const task = createTaskRecord(db.data, { ...req.body, title });
    saveDatabase(db);
    res.status(201).json({ task, updatedAt: db.updatedAt });
  });

  app.patch('/api/tasks/:id', (req, res) => {
    const result = applyTaskPatch(db.data, req.params.id, req.body || {});
    if (!result) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    saveDatabase(db);
    res.json({ ...result, updatedAt: db.updatedAt });
  });

  app.post('/api/tasks/:id/duplicate', (req, res) => {
    const copy = duplicateTaskRecord(db.data, req.params.id);
    if (!copy) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    saveDatabase(db);
    res.status(201).json({ task: copy, updatedAt: db.updatedAt });
  });

  app.post('/api/tasks/:id/archive', (req, res) => {
    const task = archiveTaskRecord(db.data, req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    saveDatabase(db);
    res.json({ task, updatedAt: db.updatedAt });
  });

  app.post('/api/tasks/:id/restore', (req, res) => {
    const task = restoreTaskRecord(db.data, req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    saveDatabase(db);
    res.json({ task, updatedAt: db.updatedAt });
  });

  app.delete('/api/tasks/:id', (req, res) => {
    const deleted = deleteTaskRecords(db.data, [req.params.id]);
    if (!deleted) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    saveDatabase(db);
    res.json({ ok: true, deleted, updatedAt: db.updatedAt });
  });

  app.post('/api/tasks/bulk', (req, res) => {
    const { ids, action, patch } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) {
      res.status(400).json({ error: 'Task ids array is required' });
      return;
    }
    if (action === 'delete') {
      const deleted = deleteTaskRecords(db.data, ids);
      saveDatabase(db);
      res.json({ ok: true, deleted, updatedAt: db.updatedAt });
      return;
    }
    if (patch && typeof patch === 'object') {
      const updated = ids.map(id => applyTaskPatch(db.data, id, patch)?.task).filter(Boolean);
      saveDatabase(db);
      res.json({ ok: true, tasks: updated, updatedAt: db.updatedAt });
      return;
    }
    res.status(400).json({ error: 'Specify action="delete" or a patch object' });
  });

  // --- Subtasks API ---
  app.post('/api/tasks/:id/subtasks', (req, res) => {
    const sub = addSubtaskRecord(db.data, req.params.id, String(req.body?.title || ''));
    if (!sub) {
      res.status(400).json({ error: 'Invalid task or empty subtask title' });
      return;
    }
    saveDatabase(db);
    res.status(201).json({ subtask: sub, updatedAt: db.updatedAt });
  });

  app.patch('/api/tasks/:id/subtasks/:sid', (req, res) => {
    const sub = updateSubtaskRecord(db.data, req.params.id, req.params.sid, req.body || {});
    if (!sub) {
      res.status(404).json({ error: 'Subtask not found' });
      return;
    }
    saveDatabase(db);
    res.json({ subtask: sub, updatedAt: db.updatedAt });
  });

  app.delete('/api/tasks/:id/subtasks/:sid', (req, res) => {
    const ok = deleteSubtaskRecord(db.data, req.params.id, req.params.sid);
    if (!ok) {
      res.status(404).json({ error: 'Subtask not found' });
      return;
    }
    saveDatabase(db);
    res.json({ ok: true, updatedAt: db.updatedAt });
  });

  app.post('/api/tasks/:id/subtasks/:sid/promote', (req, res) => {
    const promoted = promoteSubtaskRecord(db.data, req.params.id, req.params.sid);
    if (!promoted) {
      res.status(404).json({ error: 'Subtask not found' });
      return;
    }
    saveDatabase(db);
    res.status(201).json({ task: promoted, updatedAt: db.updatedAt });
  });

  // --- Comments & Reactions API ---
  app.get('/api/tasks/:id/comments', (req, res) => {
    const comments = (db.data.comments || []).filter((c: any) => c.task === req.params.id);
    res.json({ comments });
  });

  app.post('/api/tasks/:id/comments', (req, res) => {
    const comment = addCommentRecord(
      db.data,
      req.params.id,
      req.body?.text,
      req.body?.by,
      req.body?.attachments,
    );
    if (!comment) {
      res.status(400).json({ error: 'Invalid task or empty comment text / attachments' });
      return;
    }
    saveDatabase(db);
    res.status(201).json({ comment, updatedAt: db.updatedAt });
  });

  app.delete('/api/comments/:id', (req, res) => {
    const ok = deleteCommentRecord(db.data, req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Comment not found' });
      return;
    }
    saveDatabase(db);
    res.json({ ok: true, updatedAt: db.updatedAt });
  });

  app.post('/api/comments/:id/reactions', (req, res) => {
    const comment = toggleCommentReaction(db.data, req.params.id, req.body?.emoji, req.body?.by);
    if (!comment) {
      res.status(404).json({ error: 'Comment not found or missing emoji' });
      return;
    }
    saveDatabase(db);
    res.json({ comment, updatedAt: db.updatedAt });
  });

  // --- Projects API ---
  app.get('/api/projects', (_req, res) => {
    const projects = (db.data.projects || []).map((p: any) => ({
      ...p,
      progress: computeProjectProgress(db.data, p.id),
    }));
    res.json({ projects, projOrder: db.data.projOrder });
  });

  app.get('/api/projects/:id', (req, res) => {
    const p = (db.data.projects || []).find((x: any) => x.id === req.params.id);
    if (!p) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const tasks = filterTasks(db.data, { project: p.id });
    res.json({ project: { ...p, progress: computeProjectProgress(db.data, p.id) }, tasks });
  });

  app.post('/api/projects', (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) {
      res.status(400).json({ error: 'Give the project a name' });
      return;
    }
    const project = createProjectRecord(db.data, req.body, req.body?.tmpl || 'blank');
    saveDatabase(db);
    res.status(201).json({ project, updatedAt: db.updatedAt });
  });

  app.patch('/api/projects/:id', (req, res) => {
    const project = updateProjectRecord(db.data, req.params.id, req.body || {});
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    saveDatabase(db);
    res.json({ project, updatedAt: db.updatedAt });
  });

  app.post('/api/projects/:id/duplicate', (req, res) => {
    const project = duplicateProjectRecord(db.data, req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    saveDatabase(db);
    res.status(201).json({ project, updatedAt: db.updatedAt });
  });

  app.post('/api/projects/:id/archive', (req, res) => {
    const project = updateProjectRecord(db.data, req.params.id, { archived: true, archivedAt: Date.now() });
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    saveDatabase(db);
    res.json({ project, updatedAt: db.updatedAt });
  });

  app.post('/api/projects/:id/restore', (req, res) => {
    const project = updateProjectRecord(db.data, req.params.id, { archived: false, archivedAt: null });
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    saveDatabase(db);
    res.json({ project, updatedAt: db.updatedAt });
  });

  app.delete('/api/projects/:id', (req, res) => {
    const ok = deleteProjectRecord(db.data, req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    saveDatabase(db);
    res.json({ ok: true, updatedAt: db.updatedAt });
  });

  app.put('/api/projects/order', (req, res) => {
    if (!Array.isArray(req.body?.projOrder)) {
      res.status(400).json({ error: 'projOrder array is required' });
      return;
    }
    db.data.projOrder = req.body.projOrder;
    saveDatabase(db);
    res.json({ ok: true, projOrder: db.data.projOrder });
  });

  // --- Teams API ---
  app.get('/api/teams', (_req, res) => {
    res.json({ teams: db.data.teams || [] });
  });

  app.post('/api/teams', (req, res) => {
    try {
      const team = createTeamRecord(db.data, req.body || {});
      saveDatabase(db);
      res.status(201).json({ team, updatedAt: db.updatedAt });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to create team' });
    }
  });

  app.patch('/api/teams/:id', (req, res) => {
    const team = updateTeamRecord(db.data, req.params.id, req.body || {});
    if (!team) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }
    saveDatabase(db);
    res.json({ team, updatedAt: db.updatedAt });
  });

  app.delete('/api/teams/:id', (req, res) => {
    const ok = deleteTeamRecord(db.data, req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }
    saveDatabase(db);
    res.json({ ok: true, updatedAt: db.updatedAt });
  });

  // --- Members & Invitation Emails API ---
  app.get('/api/members', (_req, res) => {
    res.json({ members: db.data.members || [], me: db.data.me, outbox: db.data.outbox || [] });
  });

  app.get('/api/outbox', (_req, res) => {
    res.json({
      outbox: db.data.outbox || [],
      smtpConfigured: !!(process.env.SMTP_HOST || db.data.smtpConfig?.host),
    });
  });

  app.post('/api/members/invite', rateLimit(30, 60_000), async (req, res) => {
    try {
      const emails = Array.isArray(req.body?.emails)
        ? req.body.emails
        : String(req.body?.emails || '')
            .split(/[\s,;]+/)
            .map(s => s.trim())
            .filter(Boolean);
      if (!emails.length) {
        res.status(400).json({ error: 'Enter at least one email address' });
        return;
      }
      const fallbackOrigin = `${req.protocol}://${req.get('host') || 'localhost:3000'}`;
      const origin = sanitizeBaseUrl(req.body?.baseUrl, fallbackOrigin);
      const invited = inviteMemberRecords(
        db.data,
        emails,
        safeString(req.body?.role, 40, 'Member') || 'Member',
        safeString(req.body?.team, 80, 'product') || 'product',
        origin,
        safeString(req.body?.projectName, 120),
      );
      const googleAccessToken =
        safeString(req.body?.googleAccessToken, 2048) ||
        (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '');
      const senderEmail = sanitizeHeaderValue(req.body?.senderEmail, 150);
      const sentEmails: any[] = [];
      for (const m of invited) {
        const msg = (db.data.outbox || []).find((o: any) => o.id === m.lastInviteId);
        if (msg) {
          await dispatchOutboxEmail(db, msg, { googleAccessToken, senderEmail });
          sentEmails.push(msg);
        }
      }
      saveDatabase(db);
      res.status(201).json({
        invited,
        emailsSent: sentEmails,
        outbox: db.data.outbox || [],
        updatedAt: db.updatedAt,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Invalid invite payload' });
    }
  });

  app.post('/api/members/:id/resend-invite', rateLimit(30, 60_000), async (req, res) => {
    const m = (db.data.members || []).find((x: any) => x.id === req.params.id);
    if (!m) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }
    const fallbackOrigin = `${req.protocol}://${req.get('host') || 'localhost:3000'}`;
    const origin = sanitizeBaseUrl(req.body?.baseUrl, fallbackOrigin);
    const googleAccessToken =
      safeString(req.body?.googleAccessToken, 2048) ||
      (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '');
    const senderEmail = sanitizeHeaderValue(req.body?.senderEmail, 150);
    const msg = buildInvitationEmail(db.data, m, origin, safeString(req.body?.projectName, 120));
    await dispatchOutboxEmail(db, msg, { googleAccessToken, senderEmail });
    saveDatabase(db);
    res.json({ ok: true, member: m, email: msg, outbox: db.data.outbox || [], updatedAt: db.updatedAt });
  });

  app.post('/api/invites/accept', (req, res) => {
    const tokenOrEmail = safeString(req.body?.token || req.body?.email, 200).trim();
    const member = acceptInviteTokenRecord(db.data, db.prefs, tokenOrEmail);
    if (!member) {
      res.status(404).json({ error: 'Invitation not found or expired' });
      return;
    }
    saveDatabase(db);
    res.json({
      ok: true,
      member,
      me: db.data.me,
      prefs: db.prefs,
      updatedAt: db.updatedAt,
    });
  });

  app.post('/api/settings/smtp', rateLimit(15, 60_000), async (req, res) => {
    const { host, port, user, pass, from } = req.body || {};
    const cleanHost = safeString(host, 255, 'smtp.gmail.com').trim() || 'smtp.gmail.com';
    const cleanPort = Number(port || 465);
    const ssrfCheck = isSafeSmtpTarget(cleanHost, cleanPort);
    if (!ssrfCheck.ok) {
      res.status(400).json({ error: ssrfCheck.reason || 'Invalid SMTP target' });
      return;
    }
    const cleanUser = sanitizeHeaderValue(user, 150);
    const cleanPass = cleanHost.includes('gmail.com')
      ? safeString(pass, 255).replace(/\s+/g, '')
      : safeString(pass, 255).trim();
    db.data.smtpConfig = {
      host: cleanHost,
      port: cleanPort,
      user: cleanUser,
      pass: cleanPass,
      from: sanitizeHeaderValue(from || cleanUser, 150),
    };
    saveDatabase(db);

    let verified = false;
    let verifyError = '';
    if (cleanHost && cleanUser && cleanPass && process.env.NODE_ENV !== 'test') {
      try {
        const transporter = nodemailer.createTransport({
          host: cleanHost,
          port: cleanPort,
          secure: cleanPort === 465,
          auth: { user: cleanUser, pass: cleanPass },
        });
        await transporter.verify();
        verified = true;
      } catch (e: any) {
        verifyError = e?.message || 'Could not verify SMTP credentials';
      }
    }
    res.json({
      ok: true,
      smtpConfigured: !!(cleanHost && cleanUser && cleanPass),
      verified,
      verifyError,
    });
  });

  app.patch('/api/members/:id', (req, res) => {
    const m = (db.data.members || []).find((x: any) => x.id === req.params.id);
    if (!m) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }
    const patch = stripDangerousKeys(req.body || {});
    for (const k of Object.keys(patch)) {
      if (!ALLOWED_MEMBER_PATCH_KEYS.has(k)) continue;
      if (k === 'photoURL') {
        const safePhoto = safeImageSrc(patch.photoURL);
        m.photoURL = safePhoto || '';
      } else if (k === 'c') {
        m.c = safeCssColor(patch.c, m.c || '#5A67D8');
      } else {
        m[k] = safeString(patch[k], 200);
      }
    }
    if (m.id === db.data.me) {
      if (patch.name) db.prefs.name = m.name;
      if (patch.title) db.prefs.title = m.title;
    }
    saveDatabase(db);
    res.json({ member: m, updatedAt: db.updatedAt });
  });

  app.delete('/api/members/:id', (req, res) => {
    const ok = removeMemberRecord(db.data, req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }
    saveDatabase(db);
    res.json({ ok: true, updatedAt: db.updatedAt });
  });

  // --- Files API ---
  app.get('/api/files', (req, res) => {
    let files = [...(db.data.files || [])];
    const projFilter = safeString(req.query.project, 80);
    const typeFilter = safeString(req.query.type, 40);
    if (projFilter) files = files.filter((f: any) => f.project === projFilter);
    if (typeFilter && typeFilter !== 'all') files = files.filter((f: any) => f.type === typeFilter);
    res.json({ files });
  });

  app.post('/api/files', (req, res) => {
    if (!req.body?.name) {
      res.status(400).json({ error: 'File name is required' });
      return;
    }
    const file = addFileRecord(db.data, req.body);
    saveDatabase(db);
    res.status(201).json({ file, updatedAt: db.updatedAt });
  });

  app.patch('/api/files/:id', (req, res) => {
    const file = renameFileRecord(db.data, req.params.id, String(req.body?.name || ''));
    if (!file) {
      res.status(404).json({ error: 'File not found or invalid name' });
      return;
    }
    saveDatabase(db);
    res.json({ file, updatedAt: db.updatedAt });
  });

  app.post('/api/files/:id/duplicate', (req, res) => {
    const file = duplicateFileRecord(db.data, req.params.id);
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    saveDatabase(db);
    res.status(201).json({ file, updatedAt: db.updatedAt });
  });

  app.delete('/api/files/:id', (req, res) => {
    const ok = deleteFileRecord(db.data, req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    saveDatabase(db);
    res.json({ ok: true, updatedAt: db.updatedAt });
  });

  // --- Notifications & Activity API ---
  app.get('/api/notifications', (_req, res) => {
    res.json({ notifications: db.data.notifs || [] });
  });

  app.post('/api/notifications/:id/read', (req, res) => {
    const n = (db.data.notifs || []).find((x: any) => x.id === req.params.id);
    if (!n) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }
    n.read = typeof req.body?.read === 'boolean' ? req.body.read : true;
    saveDatabase(db);
    res.json({ notification: n, updatedAt: db.updatedAt });
  });

  app.post('/api/notifications/read-all', (_req, res) => {
    (db.data.notifs || []).forEach((n: any) => {
      n.read = true;
    });
    saveDatabase(db);
    res.json({ ok: true, updatedAt: db.updatedAt });
  });

  app.delete('/api/notifications/read', (_req, res) => {
    db.data.notifs = (db.data.notifs || []).filter((n: any) => !n.read);
    saveDatabase(db);
    res.json({ ok: true, notifications: db.data.notifs, updatedAt: db.updatedAt });
  });

  app.get('/api/activity', (_req, res) => {
    res.json({ activity: db.data.activity || [] });
  });

  // --- Saved Views, Preferences & Workspace ---
  app.post('/api/views', (req, res) => {
    const sv = {
      id: uid('v'),
      project: req.body?.project || 'p1',
      name: String(req.body?.name || 'Untitled view').trim(),
      type: req.body?.type || 'list',
      filters: Array.isArray(req.body?.filters) ? req.body.filters : [],
    };
    db.data.savedViews = db.data.savedViews || [];
    db.data.savedViews.push(sv);
    saveDatabase(db);
    res.status(201).json({ view: sv, updatedAt: db.updatedAt });
  });

  app.patch('/api/views/:id', (req, res) => {
    const v = (db.data.savedViews || []).find((x: any) => x.id === req.params.id);
    if (!v) {
      res.status(404).json({ error: 'Saved view not found' });
      return;
    }
    if (req.body?.name) v.name = String(req.body.name).trim();
    saveDatabase(db);
    res.json({ view: v, updatedAt: db.updatedAt });
  });

  app.delete('/api/views/:id', (req, res) => {
    db.data.savedViews = (db.data.savedViews || []).filter((x: any) => x.id !== req.params.id);
    saveDatabase(db);
    res.json({ ok: true, updatedAt: db.updatedAt });
  });

  app.patch('/api/preferences', (req, res) => {
    const { prefs, notifPrefs } = req.body || {};
    if (prefs && typeof prefs === 'object') {
      db.prefs = { ...db.prefs, ...prefs };
    }
    if (notifPrefs && typeof notifPrefs === 'object') {
      db.data.notifPrefs = { ...db.data.notifPrefs, ...notifPrefs };
    }
    saveDatabase(db);
    res.json({ prefs: db.prefs, notifPrefs: db.data.notifPrefs, updatedAt: db.updatedAt });
  });

  app.patch('/api/workspace', (req, res) => {
    const { name, url, c, plan } = req.body || {};
    if (name !== undefined && !String(name).trim()) {
      res.status(400).json({ error: "Workspace name can't be empty" });
      return;
    }
    const oldName = db.data.ws.name;
    if (name) db.data.ws.name = String(name).trim();
    if (url) db.data.ws.url = String(url).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    if (c) db.data.ws.c = c;
    if (plan) db.data.plan = plan;
    const w = (db.data.workspaces || []).find((x: any) => x.name === oldName);
    if (w && name) w.name = db.data.ws.name;
    saveDatabase(db);
    res.json({ ws: db.data.ws, workspaces: db.data.workspaces, updatedAt: db.updatedAt });
  });

  // --- Auth & Security API ---
  app.post('/api/auth/login', (req, res) => {
    const check = validateAuthCredentials('login', req.body || {});
    if (!check.valid) {
      res.status(400).json({ errors: check.errors });
      return;
    }
    const email = String(req.body.email).trim();
    const member = authenticateWorkspaceUser(db.data, db.prefs, {
      email,
      name: req.body?.name,
    });
    saveDatabase(db);
    res.json({ ok: true, user: member, me: db.data.me, prefs: db.prefs, email });
  });

  app.post('/api/auth/signup', (req, res) => {
    const check = validateAuthCredentials('signup', req.body || {});
    if (!check.valid) {
      res.status(400).json({ errors: check.errors });
      return;
    }
    const email = String(req.body.email).trim();
    const name = String(req.body.name).trim();
    const member = authenticateWorkspaceUser(db.data, db.prefs, { email, name });
    saveDatabase(db);
    res.status(201).json({
      ok: true,
      status: 'verification_required',
      user: member,
      me: db.data.me,
      prefs: db.prefs,
      email,
    });
  });

  app.post('/api/auth/google', (req, res) => {
    const email = String(req.body?.email || '').trim();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      res.status(400).json({ error: 'Valid Google account email is required' });
      return;
    }
    const member = authenticateWorkspaceUser(db.data, db.prefs, {
      uid: req.body?.uid,
      name: req.body?.name,
      email,
      photoURL: req.body?.photoURL,
      provider: 'Google',
    });
    saveDatabase(db);
    res.json({
      ok: true,
      user: member,
      me: db.data.me,
      prefs: db.prefs,
      updatedAt: db.updatedAt,
    });
  });

  app.post('/api/auth/forgot', (req, res) => {
    const email = String(req.body?.email || '').trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      res.status(400).json({ errors: { email: 'Enter the email you use to sign in' } });
      return;
    }
    res.json({ ok: true, email });
  });

  app.post('/api/auth/reset', (req, res) => {
    const check = validateAuthCredentials('reset', req.body || {});
    if (!check.valid) {
      res.status(400).json({ errors: check.errors });
      return;
    }
    res.json({ ok: true });
  });

  app.post('/api/auth/password', (req, res) => {
    const check = validateAuthCredentials('password', req.body || {});
    if (!check.valid) {
      res.status(400).json({ errors: check.errors });
      return;
    }
    res.json({ ok: true });
  });

  app.post('/api/auth/2fa', (req, res) => {
    const { enabled, code } = req.body || {};
    if (enabled && !/^\d{6}$/.test(String(code || '').trim())) {
      res.status(400).json({ error: 'Enter the 6-digit code from your app' });
      return;
    }
    db.data.tfa = !!enabled;
    saveDatabase(db);
    res.json({ ok: true, tfa: db.data.tfa });
  });

  app.delete('/api/sessions/:id', (req, res) => {
    db.data.sessions = (db.data.sessions || []).filter((s: any) => s.id !== req.params.id);
    saveDatabase(db);
    res.json({ ok: true, sessions: db.data.sessions });
  });

  app.delete('/api/sessions', (_req, res) => {
    db.data.sessions = (db.data.sessions || []).filter((s: any) => s.cur);
    saveDatabase(db);
    res.json({ ok: true, sessions: db.data.sessions });
  });

  return app;
}

async function startServer() {
  const app = createApp();
  const PORT = Number(process.env.PORT || 3000);
  const apiOnly = process.env.API_ONLY === 'true';

  if (!apiOnly) {
    if (process.env.NODE_ENV !== 'production') {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), 'dist');
      if (fs.existsSync(distPath)) {
        app.use(express.static(distPath));
        app.get('*', (_req, res) => {
          res.sendFile(path.join(distPath, 'index.html'));
        });
      }
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Snapsec TaskTracker ${apiOnly ? 'API ' : ''}server running on http://localhost:${PORT}`);
  });
}

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

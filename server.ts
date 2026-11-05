import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { createServer as createViteServer } from 'vite';
import {
  computeTaskProgress,
  validateAuthCredentials,
} from './src/backend/engine.js';
import {
  isSafeSmtpTarget,
  safeString,
  sanitizeBaseUrl,
  sanitizeHeaderValue,
  stripDangerousKeys,
} from './src/core/security.ts';
import { uid } from './src/core/utils.js';
import { isPostgresConfigured } from './src/db/index.ts';
import {
  acceptInviteTokenSql,
  archiveTaskSql,
  authenticateWorkspaceUserSql,
  createResendInviteSql,
  deleteCommentSql,
  deleteFileSql,
  deleteMemberSql,
  deleteOtherSessionsSql,
  deleteProjectSql,
  deleteReadNotificationsSql,
  deleteSavedViewSql,
  deleteSessionSql,
  deleteSubtaskSql,
  deleteTasksSql,
  deleteTeamSql,
  duplicateFileSql,
  duplicateProjectSql,
  duplicateTaskSql,
  ensureRelationalDatabaseSeeded,
  getProjectByIdSql,
  getSmtpConfigSql,
  insertCommentSql,
  insertFileSql,
  insertProjectSql,
  insertSavedViewSql,
  insertSubtaskSql,
  insertTaskSql,
  insertTeamSql,
  inviteMembersSql,
  listActivityLogsSql,
  listFilesSql,
  listMembersAndOutboxSql,
  listNotificationsSql,
  listProjectsSql,
  listTeamsSql,
  markAllNotificationsReadSql,
  markNotificationReadSql,
  patchMemberSql,
  patchPreferencesSql,
  patchProjectSql,
  patchSubtaskSql,
  patchTaskSql,
  patchTeamSql,
  patchWorkspaceSql,
  populateAllTablesTransaction,
  promoteSubtaskSql,
  queryBootstrapStore,
  queryTaskByIdSql,
  queryTaskCommentsSql,
  queryTasksSql,
  queryWorkspaceMetrics,
  renameFileSql,
  renameSavedViewSql,
  reorderProjectsSql,
  resetDatabaseToDefaultSql,
  restoreTaskSql,
  saveSmtpConfigSql,
  setTwoFactorSql,
  syncPostgresMirrorIfEnabled,
  toggleCommentReactionSql,
  updateOutboxItemDeliverySql,
} from './src/db/repository.ts';

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
  outboxItem: any,
  opts: { googleAccessToken?: string; senderEmail?: string } = {},
) {
  if (!outboxItem) return outboxItem;
  if (process.env.NODE_ENV === 'test') {
    outboxItem.status = 'sent';
    outboxItem.transport = 'test';
    outboxItem.deliveredToInbox = true;
    updateOutboxItemDeliverySql(outboxItem);
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
        updateOutboxItemDeliverySql(outboxItem);
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
      updateOutboxItemDeliverySql(outboxItem);
      return outboxItem;
    } catch (oauthErr: any) {
      outboxItem.oauthError = oauthErr?.message || 'Google OAuth SMTP failed';
    }
  }

  // 2. Try Custom SMTP / Gmail App Password (queried directly from SQL database)
  const customSmtp = getSmtpConfigSql();
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
      updateOutboxItemDeliverySql(outboxItem);
      return outboxItem;
    } catch (smtpErr: any) {
      outboxItem.transportError = smtpErr?.message || 'Custom SMTP authentication failed';
    }
  }

  // 3. Fallback: Ethereal SMTP sandbox
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
  updateOutboxItemDeliverySql(outboxItem);
  return outboxItem;
}

export const EXPLICIT_MIME_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.svgz': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf',
};

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  // Ensure relational SQL tables and B-tree indexes are initialized
  ensureRelationalDatabaseSeeded();
  syncPostgresMirrorIfEnabled().catch(() => {});

  // 1. Security Headers & Explicit MIME-Type Enforcement Middleware
  app.use((req, res, next) => {
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
        "img-src 'self' data: blob: https: http:",
        "connect-src 'self' http: https: ws: wss: https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com",
        "worker-src 'self' blob:",
        "frame-src 'self' data: https://*.firebaseapp.com https://accounts.google.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
    );

    // Guarantee explicit Content-Type for static JS/CSS/SVG/WASM/Font requests regardless of host OS /etc/mime.types
    if (!req.path.startsWith('/api/')) {
      const cleanPath = req.path.split('?')[0];
      const ext = path.extname(cleanPath).toLowerCase();
      if (ext && EXPLICIT_MIME_TYPES[ext]) {
        res.setHeader('Content-Type', EXPLICIT_MIME_TYPES[ext]);
      }
    }
    next();
  });

  app.use(express.json({ limit: '15mb' }));

  // 2. Global Prototype Pollution & Operator Sanitizer Middleware
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
  const rateLimit =
    (maxRequests: number, windowMs: number) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
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

  // --- Health & Bootstrap (Backed by Relational SQL Queries & Aggregates) ---
  app.get('/api/health', (_req, res) => {
    const metrics = queryWorkspaceMetrics();
    res.json({
      status: 'ok',
      service: 'Snapsec TaskTracker Backend',
      database: isPostgresConfigured() ? 'postgresql-drizzle' : 'sqlite-wal-drizzle',
      updatedAt: metrics.updatedAt,
      metrics,
    });
  });

  app.get('/api/bootstrap', (_req, res) => {
    const store = queryBootstrapStore();
    const metrics = queryWorkspaceMetrics();
    res.json({
      data: store.data,
      prefs: store.prefs,
      views: store.views,
      collapsed: store.collapsed,
      updatedAt: store.updatedAt,
      metrics,
    });
  });

  app.get('/api/metrics', (_req, res) => {
    res.json(queryWorkspaceMetrics());
  });

  // --- Transactional State Restore & Workspace Reset ---
  app.put('/api/state', (req, res) => {
    const { data, prefs, views, collapsed } = stripDangerousKeys(req.body || {});
    if (!data || !Array.isArray(data.tasks) || !Array.isArray(data.projects)) {
      res.status(400).json({ error: 'Invalid state payload: data.tasks and data.projects are required' });
      return;
    }
    const current = queryBootstrapStore();
    const updatedAt = populateAllTablesTransaction({
      data,
      prefs: prefs && typeof prefs === 'object' ? { ...current.prefs, ...prefs } : current.prefs,
      views: views && typeof views === 'object' ? views : current.views,
      collapsed: typeof collapsed === 'boolean' ? collapsed : current.collapsed,
      updatedAt: Date.now(),
    });
    res.json({ ok: true, updatedAt });
  });

  app.post('/api/reset', (_req, res) => {
    const store = resetDatabaseToDefaultSql();
    res.json({
      ok: true,
      data: store.data,
      prefs: store.prefs,
      views: store.views,
      collapsed: store.collapsed,
      updatedAt: store.updatedAt,
    });
  });

  // --- Tasks API (Indexed SQL Queries & Row-Level ACID Transactions) ---
  app.get('/api/tasks', (req, res) => {
    const list = queryTasksSql(req.query as Record<string, any>).map(t => ({
      ...t,
      progress: computeTaskProgress(t),
    }));
    res.json({ tasks: list, total: list.length });
  });

  app.get('/api/tasks/:id', (req, res) => {
    const t = queryTaskByIdSql(req.params.id);
    if (!t) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    const comments = queryTaskCommentsSql(t.id);
    res.json({ task: { ...t, progress: computeTaskProgress(t) }, comments });
  });

  app.post('/api/tasks', (req, res) => {
    const title = String(req.body?.title || '').trim();
    if (!title) {
      res.status(400).json({ error: 'Give the task a name' });
      return;
    }
    const { task, updatedAt } = insertTaskSql({ ...req.body, title });
    res.status(201).json({ task, updatedAt });
  });

  app.patch('/api/tasks/:id', (req, res) => {
    const result = patchTaskSql(req.params.id, req.body || {});
    if (!result) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json(result);
  });

  app.post('/api/tasks/:id/duplicate', (req, res) => {
    const result = duplicateTaskSql(req.params.id);
    if (!result) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.status(201).json(result);
  });

  app.post('/api/tasks/:id/archive', (req, res) => {
    const result = archiveTaskSql(req.params.id);
    if (!result) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json(result);
  });

  app.post('/api/tasks/:id/restore', (req, res) => {
    const result = restoreTaskSql(req.params.id);
    if (!result) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json(result);
  });

  app.delete('/api/tasks/:id', (req, res) => {
    const { deleted, updatedAt } = deleteTasksSql([req.params.id]);
    if (!deleted) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json({ ok: true, deleted, updatedAt });
  });

  app.post('/api/tasks/bulk', (req, res) => {
    const { ids, action, patch } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) {
      res.status(400).json({ error: 'Task ids array is required' });
      return;
    }
    if (action === 'delete') {
      const { deleted, updatedAt } = deleteTasksSql(ids);
      res.json({ ok: true, deleted, updatedAt });
      return;
    }
    if (patch && typeof patch === 'object') {
      const updated = ids.map(id => patchTaskSql(String(id), patch)?.task).filter(Boolean);
      res.json({ ok: true, tasks: updated, updatedAt: Date.now() });
      return;
    }
    res.status(400).json({ error: 'Specify action="delete" or a patch object' });
  });

  // --- Subtasks API ---
  app.post('/api/tasks/:id/subtasks', (req, res) => {
    const result = insertSubtaskSql(req.params.id, String(req.body?.title || ''));
    if (!result) {
      res.status(400).json({ error: 'Invalid task or empty subtask title' });
      return;
    }
    res.status(201).json(result);
  });

  app.patch('/api/tasks/:id/subtasks/:sid', (req, res) => {
    const result = patchSubtaskSql(req.params.id, req.params.sid, req.body || {});
    if (!result) {
      res.status(404).json({ error: 'Subtask not found' });
      return;
    }
    res.json(result);
  });

  app.delete('/api/tasks/:id/subtasks/:sid', (req, res) => {
    const { ok, updatedAt } = deleteSubtaskSql(req.params.id, req.params.sid);
    if (!ok) {
      res.status(404).json({ error: 'Subtask not found' });
      return;
    }
    res.json({ ok: true, updatedAt });
  });

  app.post('/api/tasks/:id/subtasks/:sid/promote', (req, res) => {
    const result = promoteSubtaskSql(req.params.id, req.params.sid);
    if (!result) {
      res.status(404).json({ error: 'Subtask not found' });
      return;
    }
    res.status(201).json(result);
  });

  // --- Comments & Reactions API ---
  app.get('/api/tasks/:id/comments', (req, res) => {
    res.json({ comments: queryTaskCommentsSql(req.params.id) });
  });

  app.post('/api/tasks/:id/comments', (req, res) => {
    const result = insertCommentSql(
      req.params.id,
      req.body?.text,
      req.body?.by,
      req.body?.attachments,
    );
    if (!result) {
      res.status(400).json({ error: 'Invalid task or empty comment text / attachments' });
      return;
    }
    res.status(201).json(result);
  });

  app.delete('/api/comments/:id', (req, res) => {
    const { ok, updatedAt } = deleteCommentSql(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Comment not found' });
      return;
    }
    res.json({ ok: true, updatedAt });
  });

  app.post('/api/comments/:id/reactions', (req, res) => {
    const result = toggleCommentReactionSql(req.params.id, req.body?.emoji, req.body?.by);
    if (!result) {
      res.status(404).json({ error: 'Comment not found or missing emoji' });
      return;
    }
    res.json(result);
  });

  // --- Projects API ---
  app.get('/api/projects', (_req, res) => {
    res.json(listProjectsSql());
  });

  app.get('/api/projects/:id', (req, res) => {
    const p = getProjectByIdSql(req.params.id);
    if (!p) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const tasks = queryTasksSql({ project: p.id });
    res.json({ project: p, tasks });
  });

  app.post('/api/projects', (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) {
      res.status(400).json({ error: 'Give the project a name' });
      return;
    }
    const result = insertProjectSql(req.body, req.body?.tmpl || 'blank');
    res.status(201).json(result);
  });

  app.patch('/api/projects/:id', (req, res) => {
    const result = patchProjectSql(req.params.id, req.body || {});
    if (!result) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.json(result);
  });

  app.post('/api/projects/:id/duplicate', (req, res) => {
    const result = duplicateProjectSql(req.params.id);
    if (!result) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.status(201).json(result);
  });

  app.post('/api/projects/:id/archive', (req, res) => {
    const result = patchProjectSql(req.params.id, { archived: true, archivedAt: Date.now() });
    if (!result) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.json(result);
  });

  app.post('/api/projects/:id/restore', (req, res) => {
    const result = patchProjectSql(req.params.id, { archived: false, archivedAt: null });
    if (!result) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.json(result);
  });

  app.delete('/api/projects/:id', (req, res) => {
    const { ok, updatedAt } = deleteProjectSql(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.json({ ok: true, updatedAt });
  });

  app.put('/api/projects/order', (req, res) => {
    if (!Array.isArray(req.body?.projOrder)) {
      res.status(400).json({ error: 'projOrder array is required' });
      return;
    }
    const { projOrder, updatedAt } = reorderProjectsSql(req.body.projOrder);
    res.json({ ok: true, projOrder, updatedAt });
  });

  // --- Teams API ---
  app.get('/api/teams', (_req, res) => {
    res.json({ teams: listTeamsSql() });
  });

  app.post('/api/teams', (req, res) => {
    try {
      const result = insertTeamSql(req.body || {});
      res.status(201).json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to create team' });
    }
  });

  app.patch('/api/teams/:id', (req, res) => {
    const result = patchTeamSql(req.params.id, req.body || {});
    if (!result) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }
    res.json(result);
  });

  app.delete('/api/teams/:id', (req, res) => {
    const { ok, updatedAt } = deleteTeamSql(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }
    res.json({ ok: true, updatedAt });
  });

  // --- Members & Invitation Emails API ---
  app.get('/api/members', (_req, res) => {
    const { members, me, outbox } = listMembersAndOutboxSql();
    res.json({ members, me, outbox });
  });

  app.get('/api/outbox', (_req, res) => {
    const { outbox, smtpConfig } = listMembersAndOutboxSql();
    res.json({
      outbox,
      smtpConfigured: !!(process.env.SMTP_HOST || smtpConfig?.host),
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
      const { invited, outboxItems, updatedAt } = inviteMembersSql(
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
      for (const msg of outboxItems) {
        await dispatchOutboxEmail(msg, { googleAccessToken, senderEmail });
        sentEmails.push(msg);
      }
      const { outbox } = listMembersAndOutboxSql();
      res.status(201).json({
        invited,
        emailsSent: sentEmails,
        outbox,
        updatedAt,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Invalid invite payload' });
    }
  });

  app.post('/api/members/:id/resend-invite', rateLimit(30, 60_000), async (req, res) => {
    const fallbackOrigin = `${req.protocol}://${req.get('host') || 'localhost:3000'}`;
    const origin = sanitizeBaseUrl(req.body?.baseUrl, fallbackOrigin);
    const created = createResendInviteSql(req.params.id, origin, safeString(req.body?.projectName, 120));
    if (!created) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }
    const googleAccessToken =
      safeString(req.body?.googleAccessToken, 2048) ||
      (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '');
    const senderEmail = sanitizeHeaderValue(req.body?.senderEmail, 150);
    await dispatchOutboxEmail(created.email, { googleAccessToken, senderEmail });
    const { outbox } = listMembersAndOutboxSql();
    res.json({
      ok: true,
      member: created.member,
      email: created.email,
      outbox,
      updatedAt: created.updatedAt,
    });
  });

  app.post('/api/invites/accept', (req, res) => {
    const tokenOrEmail = safeString(req.body?.token || req.body?.email, 200).trim();
    const result = acceptInviteTokenSql(tokenOrEmail);
    if (!result) {
      res.status(404).json({ error: 'Invitation not found or expired' });
      return;
    }
    res.json({
      ok: true,
      ...result,
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
    saveSmtpConfigSql({
      host: cleanHost,
      port: cleanPort,
      user: cleanUser,
      pass: cleanPass,
      from: sanitizeHeaderValue(from || cleanUser, 150),
    });

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
    const result = patchMemberSql(req.params.id, req.body || {});
    if (!result) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }
    res.json(result);
  });

  app.delete('/api/members/:id', (req, res) => {
    const { ok, updatedAt } = deleteMemberSql(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }
    res.json({ ok: true, updatedAt });
  });

  // --- Files API ---
  app.get('/api/files', (req, res) => {
    res.json({ files: listFilesSql(req.query as Record<string, any>) });
  });

  app.post('/api/files', (req, res) => {
    if (!req.body?.name) {
      res.status(400).json({ error: 'File name is required' });
      return;
    }
    const result = insertFileSql(req.body);
    res.status(201).json(result);
  });

  app.patch('/api/files/:id', (req, res) => {
    const result = renameFileSql(req.params.id, String(req.body?.name || ''));
    if (!result) {
      res.status(404).json({ error: 'File not found or invalid name' });
      return;
    }
    res.json(result);
  });

  app.post('/api/files/:id/duplicate', (req, res) => {
    const result = duplicateFileSql(req.params.id);
    if (!result) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    res.status(201).json(result);
  });

  app.delete('/api/files/:id', (req, res) => {
    const { ok, updatedAt } = deleteFileSql(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    res.json({ ok: true, updatedAt });
  });

  // --- Notifications & Activity API ---
  app.get('/api/notifications', (_req, res) => {
    res.json({ notifications: listNotificationsSql() });
  });

  app.post('/api/notifications/:id/read', (req, res) => {
    const readFlag = typeof req.body?.read === 'boolean' ? req.body.read : true;
    const result = markNotificationReadSql(req.params.id, readFlag);
    if (!result) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }
    res.json(result);
  });

  app.post('/api/notifications/read-all', (_req, res) => {
    res.json(markAllNotificationsReadSql());
  });

  app.delete('/api/notifications/read', (_req, res) => {
    const { notifications, updatedAt } = deleteReadNotificationsSql();
    res.json({ ok: true, notifications, updatedAt });
  });

  app.get('/api/activity', (_req, res) => {
    res.json({ activity: listActivityLogsSql() });
  });

  // --- Saved Views, Preferences & Workspace ---
  app.post('/api/views', (req, res) => {
    const result = insertSavedViewSql(req.body || {});
    res.status(201).json(result);
  });

  app.patch('/api/views/:id', (req, res) => {
    const result = renameSavedViewSql(req.params.id, String(req.body?.name || ''));
    if (!result) {
      res.status(404).json({ error: 'Saved view not found' });
      return;
    }
    res.json(result);
  });

  app.delete('/api/views/:id', (req, res) => {
    res.json(deleteSavedViewSql(req.params.id));
  });

  app.patch('/api/preferences', (req, res) => {
    const { prefs, notifPrefs } = req.body || {};
    res.json(patchPreferencesSql(prefs, notifPrefs));
  });

  app.patch('/api/workspace', (req, res) => {
    const { name } = req.body || {};
    if (name !== undefined && !String(name).trim()) {
      res.status(400).json({ error: "Workspace name can't be empty" });
      return;
    }
    res.json(patchWorkspaceSql(req.body || {}));
  });

  // --- Auth & Security API ---
  app.post('/api/auth/login', (req, res) => {
    const check = validateAuthCredentials('login', req.body || {});
    if (!check.valid) {
      res.status(400).json({ errors: check.errors });
      return;
    }
    const email = String(req.body.email).trim();
    const result = authenticateWorkspaceUserSql({
      email,
      name: req.body?.name,
    });
    res.json({ ok: true, ...result, email });
  });

  app.post('/api/auth/signup', (req, res) => {
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

  app.post('/api/auth/google', (req, res) => {
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
    const { tfa, updatedAt } = setTwoFactorSql(Boolean(enabled));
    res.json({ ok: true, tfa, updatedAt });
  });

  app.delete('/api/sessions/:id', (req, res) => {
    const { sessions, updatedAt } = deleteSessionSql(req.params.id);
    res.json({ ok: true, sessions, updatedAt });
  });

  app.delete('/api/sessions', (_req, res) => {
    const { sessions, updatedAt } = deleteOtherSessionsSql();
    res.json({ ok: true, sessions, updatedAt });
  });

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

async function startServer() {
  const app = createApp();
  const PORT = Number(process.env.PORT || 3000);
  const distPath = path.join(process.cwd(), 'dist');
  const distIndex = path.join(distPath, 'index.html');

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, allowedHosts: true as const },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // If NODE_ENV=production was started without running `npm run build` first, build dist/ automatically
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



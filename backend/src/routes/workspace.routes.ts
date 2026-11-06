import { Router } from 'express';
import nodemailer from 'nodemailer';
import {
  deleteReadNotificationsSql,
  deleteSavedViewSql,
  getSmtpConfigSql,
  insertSavedViewSql,
  listActivityLogsSql,
  listNotificationsSql,
  markAllNotificationsReadSql,
  markNotificationReadSql,
  patchPreferencesSql,
  patchWorkspaceSql,
  queryBootstrapStore,
  renameSavedViewSql,
  saveSmtpConfigSql,
} from '../db/repository.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import { isSafeSmtpTarget } from '../utils/security.ts';

export const workspaceRouter = Router();

// Saved Views
workspaceRouter.get('/views', (_req, res) => {
  const store = queryBootstrapStore();
  res.json({ views: store.data.savedViews });
});

workspaceRouter.post('/views', (req, res) => {
  const { project, name, type, filters } = req.body || {};
  if (!name || !String(name).trim()) {
    res.status(400).json({ error: 'View name is required' });
    return;
  }
  const { view, updatedAt } = insertSavedViewSql({
    id: req.body?.id,
    project,
    name,
    type,
    filters,
  });
  res.status(201).json({ ok: true, view, updatedAt });
});

workspaceRouter.patch('/views/:id', (req, res) => {
  const { name } = req.body || {};
  if (!name || !String(name).trim()) {
    res.status(400).json({ error: 'View name is required' });
    return;
  }
  const result = renameSavedViewSql(req.params.id, name);
  if (!result) {
    res.status(404).json({ error: 'Saved view not found' });
    return;
  }
  res.json({ ok: true, view: result.view, updatedAt: result.updatedAt });
});

workspaceRouter.delete('/views/:id', (req, res) => {
  const { ok, updatedAt } = deleteSavedViewSql(req.params.id);
  if (!ok) {
    res.status(404).json({ error: 'Saved view not found' });
    return;
  }
  res.json({ ok: true, updatedAt });
});

// Notifications & Activity
workspaceRouter.get('/notifications', (_req, res) => {
  res.json({ notifications: listNotificationsSql() });
});

workspaceRouter.patch('/notifications/:id', (req, res) => {
  const result = markNotificationReadSql(req.params.id, req.body?.read !== undefined ? Boolean(req.body.read) : true);
  if (!result) {
    res.status(404).json({ error: 'Notification not found' });
    return;
  }
  res.json({ ok: true, notification: result.notification, updatedAt: result.updatedAt });
});

workspaceRouter.post('/notifications/mark-all-read', (_req, res) => {
  const { updatedAt } = markAllNotificationsReadSql();
  res.json({ ok: true, notifications: listNotificationsSql(), updatedAt });
});

workspaceRouter.delete('/notifications/read', (_req, res) => {
  const { notifications, updatedAt } = deleteReadNotificationsSql();
  res.json({ ok: true, notifications, updatedAt });
});

workspaceRouter.get('/activity', (_req, res) => {
  res.json({ activity: listActivityLogsSql() });
});

// Preferences & Workspace Settings
workspaceRouter.get('/prefs', (_req, res) => {
  const store = queryBootstrapStore();
  res.json({ prefs: store.prefs, ws: store.data.ws, statuses: store.data.statuses });
});

workspaceRouter.patch('/prefs', (req, res) => {
  const body = req.body || {};
  const { prefs, notifPrefs, updatedAt } = patchPreferencesSql(body.prefs || body, body.notifPrefs);
  res.json({ ok: true, prefs, notifPrefs, updatedAt });
});

workspaceRouter.patch('/workspace', (req, res) => {
  const { ws, workspaces, statuses, updatedAt } = patchWorkspaceSql(req.body || {});
  res.json({ ok: true, ws, workspaces, statuses, updatedAt });
});

// SMTP Configuration
workspaceRouter.get('/settings/smtp', (_req, res) => {
  const smtp = getSmtpConfigSql() || {};
  res.json({
    ok: true,
    smtp: {
      host: smtp.host || process.env.SMTP_HOST || '',
      port: Number(smtp.port || process.env.SMTP_PORT || 465),
      user: smtp.user || process.env.SMTP_USER || '',
      from: smtp.from || process.env.SMTP_FROM || '',
      configured: Boolean((smtp.host || process.env.SMTP_HOST) && (smtp.user || process.env.SMTP_USER) && (smtp.pass || process.env.SMTP_PASS)),
    },
  });
});

workspaceRouter.post('/settings/smtp', rateLimit(10, 60_000), async (req, res) => {
  const { host, port, user, pass, from, testEmail } = req.body || {};
  const existing = getSmtpConfigSql() || {};
  const nextSmtp = {
    host: String(host || existing.host || 'smtp.gmail.com').trim(),
    port: Number(port || existing.port || 465),
    user: String(user || existing.user || '').trim(),
    pass: pass ? String(pass).replace(/\s+/g, '') : existing.pass || '',
    from: String(from || user || existing.from || 'mohammadowais616@gmail.com').trim(),
  };

  if (!nextSmtp.host || !nextSmtp.user || !nextSmtp.pass) {
    res.status(400).json({ error: 'SMTP host, email address, and password/app-password are required' });
    return;
  }

  const ssrfCheck = isSafeSmtpTarget(nextSmtp.host, nextSmtp.port);
  if (!ssrfCheck.ok) {
    res.status(400).json({ error: ssrfCheck.reason || 'Invalid SMTP host or port' });
    return;
  }

  if (process.env.NODE_ENV !== 'test') {
    try {
      const transporter = nodemailer.createTransport({
        host: nextSmtp.host,
        port: nextSmtp.port,
        secure: nextSmtp.port === 465,
        auth: { user: nextSmtp.user, pass: nextSmtp.pass },
      });
      await transporter.verify();
      if (testEmail) {
        await transporter.sendMail({
          from: `"Snapsec TaskTracker" <${nextSmtp.from}>`,
          to: testEmail,
          subject: 'Snapsec TaskTracker — Real Email Delivery Configured',
          text: 'Your SMTP configuration for Snapsec TaskTracker is active and verified.',
        });
      }
    } catch (err: any) {
      res.status(400).json({ error: `SMTP Verification Failed: ${err?.message || 'Unable to authenticate with mail server'}` });
      return;
    }
  }

  saveSmtpConfigSql(nextSmtp);
  res.json({
    ok: true,
    smtp: {
      host: nextSmtp.host,
      port: nextSmtp.port,
      user: nextSmtp.user,
      from: nextSmtp.from,
      configured: true,
    },
  });
});

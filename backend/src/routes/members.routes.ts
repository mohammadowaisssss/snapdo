import { Router } from 'express';
import {
  acceptInviteTokenSql,
  createResendInviteSql,
  deleteMemberSql,
  getProjectByIdSql,
  inviteMembersSql,
  listMembersAndOutboxSql,
  patchMemberSql,
  updateOutboxItemDeliverySql,
} from '../db/repository.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import { dispatchOutboxEmail } from '../services/mailer.ts';
import { sanitizeBaseUrl } from '../utils/security.ts';

export const membersRouter = Router();

membersRouter.get('/members', (_req, res) => {
  res.json(listMembersAndOutboxSql());
});

membersRouter.post('/members/invite', rateLimit(15, 60_000), async (req, res) => {
  try {
    const { emails, role, team, project, baseUrl, googleAccessToken, senderEmail } = req.body || {};
    const list = Array.isArray(emails)
      ? emails
      : String(emails || '')
          .split(/[\s,;]+/)
          .filter(Boolean);
    const rawOrigin = baseUrl || process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const origin = sanitizeBaseUrl(rawOrigin, 'http://localhost:4000');
    const projObj = project ? getProjectByIdSql(String(project)) : null;
    const projectName = projObj ? projObj.name : '';
    const { invited, outboxItems, updatedAt } = inviteMembersSql(
      list,
      role || 'Member',
      team || 'product',
      origin,
      projectName,
    );

    const deliveredEmails = [];
    for (const item of outboxItems) {
      const dispatched = await dispatchOutboxEmail(item, { googleAccessToken, senderEmail });
      updateOutboxItemDeliverySql(dispatched);
      deliveredEmails.push(dispatched);
    }

    const latest = listMembersAndOutboxSql();
    res.status(201).json({
      ok: true,
      invited,
      members: latest.members,
      outbox: deliveredEmails,
      updatedAt,
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Unable to send invitations' });
  }
});

membersRouter.post('/members/:id/resend-invite', rateLimit(15, 60_000), async (req, res) => {
  const { baseUrl, googleAccessToken, senderEmail } = req.body || {};
  const rawOrigin = baseUrl || process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const origin = sanitizeBaseUrl(rawOrigin, 'http://localhost:4000');
  const created = createResendInviteSql(req.params.id, origin);
  if (!created) {
    res.status(404).json({ error: 'Member not found' });
    return;
  }

  const dispatched = await dispatchOutboxEmail(created.email, { googleAccessToken, senderEmail });
  updateOutboxItemDeliverySql(dispatched);
  const latest = listMembersAndOutboxSql();
  res.json({
    ok: true,
    member: created.member,
    email: dispatched,
    outbox: latest.outbox,
    updatedAt: created.updatedAt,
  });
});

membersRouter.post('/invites/accept', (req, res) => {
  const { token, email } = req.body || {};
  const result = acceptInviteTokenSql(token || email);
  if (!result) {
    res.status(404).json({ error: 'Invitation not found or already expired' });
    return;
  }
  const latest = listMembersAndOutboxSql();
  res.json({
    ok: true,
    member: result.member,
    me: result.me,
    prefs: result.prefs,
    members: latest.members,
    updatedAt: result.updatedAt,
  });
});

membersRouter.get('/outbox', (_req, res) => {
  res.json({ outbox: listMembersAndOutboxSql().outbox });
});

membersRouter.get('/outbox/:id', (req, res) => {
  const item = listMembersAndOutboxSql().outbox.find((x: any) => x.id === req.params.id);
  if (!item) {
    res.status(404).json({ error: 'Email not found' });
    return;
  }
  res.json({ email: item });
});

membersRouter.patch('/members/:id', (req, res) => {
  const result = patchMemberSql(req.params.id, req.body || {});
  if (!result) {
    res.status(404).json({ error: 'Member not found' });
    return;
  }
  res.json({ ok: true, member: result.member, updatedAt: result.updatedAt });
});

membersRouter.delete('/members/:id', (req, res) => {
  const result = deleteMemberSql(req.params.id);
  if (!result.ok) {
    res.status(404).json({ error: 'Member not found' });
    return;
  }
  res.json({ ok: true, updatedAt: result.updatedAt });
});


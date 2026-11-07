import { Router } from 'express';
import {
  authenticateWorkspaceUserSql,
  changeUserPasswordSql,
  createAuthSessionSql,
  createPasswordResetTokenSql,
  deleteOtherSessionsSql,
  deleteSessionSql,
  loginUserSql,
  logoutSessionTokenSql,
  resendVerificationEmailSql,
  resetPasswordWithTokenSql,
  setTwoFactorSql,
  signupUserSql,
  updateOutboxItemDeliverySql,
  verifyEmailTokenSql,
  verifySessionTokenSql,
} from '../db/repository.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import { getAuthorizedDomains, validateAuthCredentials } from '../services/engine.ts';
import { dispatchOutboxEmail } from '../services/mailer.ts';
import { verifyAuthToken } from '../services/token.ts';
import { sanitizeBaseUrl } from '../utils/security.ts';

export const authRouter = Router();

function extractBearerToken(req: any): string {
  const authHeader = String(req.headers?.authorization || '');
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return String(req.query?.token || req.body?.token || '').trim();
}

authRouter.get('/auth/me', (req, res) => {
  const token = extractBearerToken(req);
  const check = verifySessionTokenSql(token);
  if (!check.valid) {
    res.status(401).json({ ok: false, error: check.reason || 'Unauthorized' });
    return;
  }
  res.json({
    ok: true,
    user: check.user,
    me: check.me,
    prefs: check.prefs,
    token,
    expiresAt: check.expiresAt,
  });
});

authRouter.get('/auth/config', (_req, res) => {
  res.json({
    ok: true,
    authorizedDomains: getAuthorizedDomains(),
    smtpConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER),
  });
});

authRouter.post('/auth/login', rateLimit(20, 60_000), (req, res) => {
  const check = validateAuthCredentials('login', req.body || {});
  if (!check.valid) {
    res.status(400).json({ errors: check.errors });
    return;
  }
  const email = String(req.body.email).trim();
  const password = String(req.body.password);
  const rememberMe = req.body.remember !== false;
  const result = loginUserSql({
    email,
    password,
    rememberMe,
    userAgent: req.get('user-agent') || '',
    ip: req.ip || '127.0.0.1',
  });

  if (!result.ok) {
    res.status(result.status || 401).json({
      ok: false,
      code: (result as any).code,
      email: (result as any).email,
      error: result.error,
      errors: result.errors,
    });
    return;
  }

  res.json({
    ok: true,
    user: result.user,
    me: result.me,
    prefs: result.prefs,
    token: result.token,
    expiresAt: result.expiresAt,
    session: result.session,
    updatedAt: result.updatedAt,
  });
});

authRouter.post('/auth/signup', rateLimit(15, 60_000), async (req, res) => {
  const check = validateAuthCredentials('signup', req.body || {});
  if (!check.valid) {
    res.status(400).json({ errors: check.errors });
    return;
  }
  const email = String(req.body.email).trim();
  const name = String(req.body.name).trim();
  const password = String(req.body.password);
  const rawOrigin = req.body?.baseUrl || process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const origin = sanitizeBaseUrl(rawOrigin, 'http://localhost:4000');

  const result = signupUserSql({
    name,
    email,
    password,
    userAgent: req.get('user-agent') || '',
    ip: req.ip || '127.0.0.1',
    baseUrl: origin,
  });

  if (!result.ok) {
    res.status(result.status || 409).json({
      ok: false,
      error: result.error,
      errors: result.errors,
    });
    return;
  }

  // Dispatch OTP verification email via SMTP / mailer
  let dispatched = null;
  if (result.outboxItem) {
    dispatched = await dispatchOutboxEmail(result.outboxItem);
    updateOutboxItemDeliverySql(dispatched);
  }

  res.status(201).json({
    ok: true,
    status: 'pending_verification',
    otpSent: true,
    user: result.user,
    me: result.me,
    prefs: result.prefs,
    email: result.user.email,
    isFirstOwner: result.isFirstOwner,
    verifyToken: result.verifyToken,
    verifyUrl: result.verifyUrl,
    previewUrl: dispatched?.previewUrl || null,
    deliveredToInbox: dispatched?.deliveredToInbox || false,
    updatedAt: result.updatedAt,
  });
});

authRouter.post('/auth/resend-verification', rateLimit(15, 60_000), async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    res.status(400).json({ error: 'Valid email address is required' });
    return;
  }
  const rawOrigin = req.body?.baseUrl || process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const origin = sanitizeBaseUrl(rawOrigin, 'http://localhost:4000');
  const result = resendVerificationEmailSql(email, origin);
  if (!result.ok) {
    res.status(result.status || 404).json({ error: result.error });
    return;
  }
  const dispatched = await dispatchOutboxEmail(result.outboxItem);
  updateOutboxItemDeliverySql(dispatched);
  res.json({
    ok: true,
    otpSent: true,
    email: result.email,
    verifyToken: result.verifyToken,
    verifyUrl: result.verifyUrl,
    previewUrl: dispatched?.previewUrl || null,
    deliveredToInbox: dispatched?.deliveredToInbox || false,
  });
});

authRouter.post('/auth/verify', rateLimit(20, 60_000), (req, res) => {
  const { token, otp, email } = req.body || {};
  const result = verifyEmailTokenSql({
    token: otp || token,
    otp: otp || token,
    email,
    userAgent: req.get('user-agent') || '',
    ip: req.ip || '127.0.0.1',
  });
  if (!result.ok) {
    res.status(result.status || 400).json({ ok: false, error: result.error });
    return;
  }
  res.json({
    ok: true,
    message: 'Email successfully verified',
    email: result.email,
    user: result.user,
    member: result.member,
    me: result.me,
    prefs: result.prefs,
    token: result.token,
    expiresAt: result.expiresAt,
    session: result.session,
  });
});

authRouter.get('/auth/verify', (req, res) => {
  const token = String(req.query?.otp || req.query?.token || '');
  const email = String(req.query?.email || '');
  const result = verifyEmailTokenSql({
    token,
    otp: token,
    email,
    userAgent: req.get('user-agent') || '',
    ip: req.ip || '127.0.0.1',
  });
  if (!result.ok) {
    res.status(result.status || 400).json({ ok: false, error: result.error });
    return;
  }
  res.json({
    ok: true,
    message: 'Email successfully verified',
    email: result.email,
    user: result.user,
    member: result.member,
    me: result.me,
    prefs: result.prefs,
    token: result.token,
    expiresAt: result.expiresAt,
    session: result.session,
  });
});

authRouter.post('/auth/logout', (req, res) => {
  const token = extractBearerToken(req);
  logoutSessionTokenSql(token);
  res.json({ ok: true });
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
  const sessionInfo = createAuthSessionSql(
    result?.me || 'm1',
    email,
    result?.user?.name || req.body?.name || '',
    req.get('user-agent') || '',
    req.ip || '127.0.0.1',
    true,
  );
  res.json({
    ok: true,
    ...result,
    token: sessionInfo.token,
    expiresAt: sessionInfo.expiresAt,
    session: sessionInfo.session,
  });
});

authRouter.post('/auth/forgot', rateLimit(15, 60_000), async (req, res) => {
  const email = String(req.body?.email || '').trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    res.status(400).json({ errors: { email: 'Enter the email you use to sign in' } });
    return;
  }
  const rawOrigin = req.body?.baseUrl || process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const origin = sanitizeBaseUrl(rawOrigin, 'http://localhost:4000');
  const created = createPasswordResetTokenSql(email, origin);
  if (!created.ok) {
    res.status(created.status || 404).json({
      ok: false,
      error: created.error,
      errors: created.errors,
    });
    return;
  }

  const dispatched = await dispatchOutboxEmail(created.outboxItem);
  updateOutboxItemDeliverySql(dispatched);

  res.json({
    ok: true,
    email: created.email,
    resetToken: created.resetToken,
    resetUrl: created.resetUrl,
    previewUrl: dispatched?.previewUrl || null,
  });
});

authRouter.post('/auth/reset', rateLimit(15, 60_000), (req, res) => {
  const check = validateAuthCredentials('reset', req.body || {});
  if (!check.valid) {
    res.status(400).json({ errors: check.errors });
    return;
  }
  const result = resetPasswordWithTokenSql({
    token: req.body?.token,
    email: req.body?.email,
    password: String(req.body.password),
  });
  if (!result.ok) {
    res.status(result.status || 400).json({
      ok: false,
      error: result.error,
      errors: result.errors,
    });
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
  const token = extractBearerToken(req);
  const verified = token ? verifyAuthToken(token) : { valid: false, payload: undefined };
  const result = changeUserPasswordSql({
    memberId: verified.payload?.sub,
    email: verified.payload?.email || req.body?.email,
    currentPassword: String(req.body.currentPassword),
    newPassword: String(req.body.newPassword),
  });
  if (!result.ok) {
    res.status(result.status || 400).json({ errors: result.errors });
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

authRouter.delete('/sessions', (req, res) => {
  const token = extractBearerToken(req);
  const verified = token ? verifyAuthToken(token) : { valid: false, payload: undefined };
  const { sessions, updatedAt } = deleteOtherSessionsSql(verified.payload?.sid);
  res.json({ ok: true, sessions, updatedAt });
});

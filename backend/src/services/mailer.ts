import nodemailer from 'nodemailer';
import { getSmtpConfigSql, updateOutboxItemDeliverySql } from '../db/repository.ts';
import { uid } from '../utils/utils.js';
import { isSafeSmtpTarget, sanitizeHeaderValue } from '../utils/security.ts';

let cachedEtherealAccount: any = null;

export function buildRawMimeEmail(outboxItem: any, fromEmail: string): string {
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

export function getActiveSmtpConfig(): {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  secure: boolean;
  configured: boolean;
} {
  const runtimeSmtp = (getSmtpConfigSql() || {}) as Record<string, any>;
  const host = String(runtimeSmtp.host || process.env.SMTP_HOST || '').trim();
  const port = Number(runtimeSmtp.port || process.env.SMTP_PORT || (runtimeSmtp.secure ? 465 : 587));
  const user = String(runtimeSmtp.user || process.env.SMTP_USER || '').trim();
  const pass = String(runtimeSmtp.pass || process.env.SMTP_PASS || '').replace(/\s+/g, '');
  const from = String(runtimeSmtp.from || process.env.SMTP_FROM || user || 'mohammadowais616@gmail.com').trim();
  const secure = runtimeSmtp.secure !== undefined ? Boolean(runtimeSmtp.secure) : port === 465;
  const configured = Boolean(host && (user ? pass : true));
  return { host, port, user, pass, from, secure, configured };
}

export async function dispatchOutboxEmail(
  outboxItem: any,
  opts: { googleAccessToken?: string; senderEmail?: string; forceRealTransport?: boolean } = {},
) {
  if (!outboxItem) return outboxItem;
  if (process.env.NODE_ENV === 'test' && !opts.forceRealTransport) {
    outboxItem.status = 'sent';
    outboxItem.transport = 'test';
    outboxItem.deliveredToInbox = true;
    updateOutboxItemDeliverySql(outboxItem);
    return outboxItem;
  }

  const googleToken = opts.googleAccessToken || '';
  const senderEmail = opts.senderEmail || outboxItem.from || 'mohammadowais616@gmail.com';

  // 1. Try real custom SMTP config saved in SQL workspace or environment variables
  const smtp = getActiveSmtpConfig();
  const ssrfCheck = smtp.host ? isSafeSmtpTarget(smtp.host, smtp.port) : { ok: false };
  if (smtp.configured && ssrfCheck.ok) {
    try {
      const transportOpts: any = {
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 20000,
      };
      if (smtp.user) {
        transportOpts.auth = {
          user: smtp.user,
          pass: smtp.pass,
        };
      }
      if (process.env.SMTP_ALLOW_INVALID_CERTS === 'true' || process.env.SMTP_IGNORE_TLS === 'true') {
        transportOpts.tls = { rejectUnauthorized: false };
      }
      const customTransporter = nodemailer.createTransport(transportOpts);

      const cleanFromName = sanitizeHeaderValue(outboxItem.fromName || 'Snapsec Workspace', 100).replace(/"/g, '');
      const cleanFromEmail = sanitizeHeaderValue(smtp.from || smtp.user || outboxItem.from, 150);
      const cleanToName = sanitizeHeaderValue(outboxItem.toName || 'Member', 100).replace(/"/g, '');
      const cleanToEmail = sanitizeHeaderValue(outboxItem.to, 150);

      const info = await customTransporter.sendMail({
        from: `"${cleanFromName}" <${cleanFromEmail}>`,
        to: `"${cleanToName}" <${cleanToEmail}>`,
        replyTo: outboxItem.from || cleanFromEmail,
        subject: sanitizeHeaderValue(outboxItem.subject, 200),
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
    } catch (err: any) {
      console.warn(`[SMTP Delivery Warning] Failed sending to ${outboxItem.to} via ${smtp.host}:${smtp.port}:`, err?.message || err);
      outboxItem.transportError = `SMTP Error: ${err?.message || 'Authentication or network failed'}`;
    }
  }

  // 2. Try Google OAuth (Gmail REST API first, then smtp.gmail.com:465 XOAUTH2)
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
        from: `"${outboxItem.fromName}" <${senderEmail}>`,
        to: `"${outboxItem.toName}" <${outboxItem.to}>`,
        subject: outboxItem.subject,
        text: outboxItem.text,
        html: outboxItem.html,
      });
      outboxItem.messageId = info.messageId;
      outboxItem.status = 'sent';
      outboxItem.transport = 'gmail-oauth2-smtp';
      outboxItem.deliveredToInbox = true;
      outboxItem.transportError = undefined;
      updateOutboxItemDeliverySql(outboxItem);
      return outboxItem;
    } catch (err: any) {
      outboxItem.oauthError = err?.message || 'Gmail OAuth delivery failed';
    }
  }

  // 3. Fallback: Ethereal test SMTP relay so preview URL is always generated and links are testable
  try {
    if (!cachedEtherealAccount) {
      cachedEtherealAccount = await nodemailer.createTestAccount();
    }
    const ethTransporter = nodemailer.createTransport({
      host: cachedEtherealAccount.smtp.host,
      port: cachedEtherealAccount.smtp.port,
      secure: cachedEtherealAccount.smtp.secure,
      auth: {
        user: cachedEtherealAccount.user,
        pass: cachedEtherealAccount.pass,
      },
    });
    const info = await ethTransporter.sendMail({
      from: `"${outboxItem.fromName}" <${outboxItem.from}>`,
      to: `"${outboxItem.toName}" <${outboxItem.to}>`,
      subject: outboxItem.subject,
      text: outboxItem.text,
      html: outboxItem.html,
    });
    outboxItem.messageId = info.messageId;
    outboxItem.status = 'preview_only';
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

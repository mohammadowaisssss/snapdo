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

export async function dispatchOutboxEmail(
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

  // 2. Try runtime SMTP config saved in SQL workspace or environment variables
  const runtimeSmtp = getSmtpConfigSql();
  const smtpHost = runtimeSmtp.host || process.env.SMTP_HOST || '';
  const smtpPort = Number(runtimeSmtp.port || process.env.SMTP_PORT || 465);
  const smtpUser = runtimeSmtp.user || process.env.SMTP_USER || '';
  const smtpPass = runtimeSmtp.pass || process.env.SMTP_PASS || '';
  const smtpFrom = runtimeSmtp.from || process.env.SMTP_FROM || smtpUser || outboxItem.from;

  const ssrfCheck = smtpHost ? isSafeSmtpTarget(smtpHost, smtpPort) : { ok: false };
  if (smtpHost && smtpUser && smtpPass && ssrfCheck.ok) {
    try {
      const customTransporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
      });
      const cleanFromName = sanitizeHeaderValue(outboxItem.fromName || 'Snapsec Workspace', 100).replace(/"/g, '');
      const cleanFromEmail = sanitizeHeaderValue(smtpFrom, 150);
      const cleanToName = sanitizeHeaderValue(outboxItem.toName || 'Member', 100).replace(/"/g, '');
      const cleanToEmail = sanitizeHeaderValue(outboxItem.to, 150);
      const info = await customTransporter.sendMail({
        from: `"${cleanFromName}" <${cleanFromEmail}>`,
        to: `"${cleanToName}" <${cleanToEmail}>`,
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
      outboxItem.transportError = `SMTP Error: ${err?.message || 'Authentication failed'}`;
    }
  }

  // 3. Fallback: Ethereal test SMTP relay so preview URL is always generated
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

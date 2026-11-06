/* ---------------- AUTH ---------------- */
import { esc } from '../core/utils.js';
import { LOGO, ic } from '../core/icons.js';
import { D, S } from '../core/store.js';
import { effectiveDark } from '../core/theme.js';
import { TEMPLATES } from '../overlays/modals.js';
import { strengthMeter } from './settings.js';

export function authShell(inner, topRight = '') {
  return `<div class="auth"><div class="auth-top"><span class="brand">${LOGO(22)}</span><div class="row">${topRight}<button class="ibtn" data-a="toggleDark" data-tip="Toggle theme" aria-label="Toggle theme">${ic(effectiveDark() ? 'sun' : 'moon', 16)}</button></div></div>
    <div class="auth-c">${inner}</div>
    <div class="auth-foot" style="padding:18px;font-size:12px"><span class="faint">© 2026 Snapsec · Terms · Privacy</span></div></div>`;
}

export const ferr = k => (S.ui.errors[k] ? `<span class="err" id="${k}-err">${ic('circle-alert', 12)}${esc(S.ui.errors[k])}</span>` : '');
export const icls = k => (S.ui.errors[k] ? 'is-error' : '');

export function renderAuth() {
  const s = S.ui.auth;
  const e = S.ui.errors;
  const f = S.ui.af || (S.ui.af = { email: '', name: '' });

  if (s === 'onboarding') return renderOnboarding();

  if (s === 'invite') {
    const inv = S.ui.inviteInfo || {};
    const wsName = inv.workspaceName || D().ws?.name || 'Snapsec';
    const invEmail = inv.email || f.email || '';
    const invRole = inv.role || 'Member';
    const invName = f.name || inv.name || '';
    return authShell(
      `<form class="auth-card${S.ui.fx.auth ? ' fx-auth' : ''}" data-submit="doAcceptInvite" novalidate>
        <div style="display:flex;justify-content:center">${LOGO(30)}</div>
        <h1>Accept workspace invitation</h1>
        <p class="sub">You've been invited to join <b>${esc(wsName)}</b> as <b>${esc(invRole)}</b>.</p>
        ${e.invite ? `<div class="alert danger" role="alert">${ic('circle-alert', 15)}<span>${esc(e.invite)}</span></div>` : ''}
        <div class="field">
          <label class="label" for="inv-accept-email">Invited email</label>
          <input class="input input-lg" id="inv-accept-email" type="email" value="${esc(invEmail)}" ${inv.email ? 'readonly style="background:var(--surface-2);color:var(--text-2)"' : ''} placeholder="you@company.com">
          ${ferr('email')}
        </div>
        <div class="field">
          <label class="label" for="inv-accept-name">Full name</label>
          <input class="input input-lg ${icls('name')}" id="inv-accept-name" value="${esc(invName)}" autocomplete="name" placeholder="Your full name">
          ${ferr('name')}
        </div>
        <div class="field">
          <label class="label" for="inv-accept-pw">Create password</label>
          <input class="input input-lg ${icls('pw')}" id="inv-accept-pw" type="password" data-in="pwStrength" value="${esc(S.ui.pwNew || '')}" autocomplete="new-password" placeholder="At least 10 characters">
          ${strengthMeter(S.ui.pwNew || '')}
          ${ferr('pw') || '<span class="hint">At least 10 characters with a number or symbol.</span>'}
        </div>
        <button class="btn btn-primary btn-lg btn-block" data-a="doAcceptInvite" id="invite-accept-btn">Accept invitation &amp; join workspace</button>
        <p class="auth-foot">Already set your password? <button type="button" class="link" data-a="auth" data-v="login">Sign in</button></p>
      </form>`,
      `<button class="btn btn-ghost btn-sm" data-a="auth" data-v="login">Sign in</button>`,
    );
  }

  if (s === 'login')
    return authShell(
      `<form class="auth-card${S.ui.fx.auth ? ' fx-auth' : ''}" data-submit="doLogin" novalidate>
    <div style="display:flex;justify-content:center">${LOGO(30)}</div><h1>Sign in to your account</h1><p class="sub">Enter your email and password to access ${esc(D().ws.name)}</p>
    ${e.login ? `<div class="alert danger" role="alert" style="flex-direction:column;align-items:flex-start;gap:8px"><div class="row" style="gap:8px">${ic('circle-alert', 15)}<span>${esc(e.login)}</span></div>${e.suggestSignup ? `<button type="button" class="btn btn-sm btn-secondary" data-a="auth" data-v="signup">Sign up to create an account</button>` : ''}</div>` : ''}
    <div class="field"><label class="label" for="l-email">Email</label><input class="input input-lg ${icls('email')}" id="l-email" type="email" value="${esc(f.email)}" placeholder="name@company.com" autocomplete="email" aria-invalid="${!!e.email}" aria-describedby="email-err">${ferr('email')}</div>
    <div class="field"><div class="row"><label class="label" for="l-pw">Password</label><span class="sp"></span><button type="button" class="link" style="font-size:12.5px" data-a="auth" data-v="forgot">Forgot password?</button></div>
      <div class="inwrap"><input class="input input-lg ${icls('pw')}" id="l-pw" type="${S.ui.showPw ? 'text' : 'password'}" placeholder="Enter your password" autocomplete="current-password" style="padding-right:38px" aria-invalid="${!!e.pw}"><button type="button" class="ibtn ibtn-sm" style="position:absolute;right:5px" data-a="toggleShowPw" aria-label="${S.ui.showPw ? 'Hide' : 'Show'} password">${ic(S.ui.showPw ? 'eye-off' : 'eye', 15)}</button></div>${ferr('pw')}</div>
    <label class="row" style="font-size:13px;gap:8px;cursor:pointer"><input type="checkbox" class="check" id="l-rem" checked>Remember me for 30 days</label>
    <button class="btn btn-primary btn-lg btn-block" data-a="doLogin" id="login-btn">Sign in</button>
    <p class="auth-foot">Don't have an account? <button type="button" class="link" data-a="auth" data-v="signup">Create account</button></p></form>`,
      `<button class="btn btn-ghost btn-sm" data-a="auth" data-v="signup">Sign up</button>`,
    );

  if (s === 'signup')
    return authShell(
      `<form class="auth-card${S.ui.fx.auth ? ' fx-auth' : ''}" data-submit="doSignup" novalidate>
    <div style="display:flex;justify-content:center">${LOGO(30)}</div><h1>Create your account</h1><p class="sub">Set up your account to manage projects and tasks with your team.</p>
    ${e.signup ? `<div class="alert danger" role="alert">${ic('circle-alert', 15)}<span>${esc(e.signup)}</span></div>` : ''}
    <div class="field"><label class="label" for="s-name">Full name</label><input class="input input-lg ${icls('name')}" id="s-name" value="${esc(f.name)}" autocomplete="name" placeholder="Your full name">${ferr('name')}</div>
    <div class="field"><label class="label" for="s-email">Work email</label><input class="input input-lg ${icls('email')}" id="s-email" type="email" value="${esc(f.email)}" autocomplete="email" placeholder="you@company.com">${ferr('email')}</div>
    <div class="field"><label class="label" for="s-pw">Password</label><input class="input input-lg ${icls('pw')}" id="s-pw" type="password" data-in="pwStrength" value="${esc(S.ui.pwNew || '')}" autocomplete="new-password" placeholder="At least 10 characters">${strengthMeter(S.ui.pwNew || '')}${ferr('pw') || '<span class="hint">At least 10 characters with a number or symbol.</span>'}</div>
    <button class="btn btn-primary btn-lg btn-block" data-a="doSignup" id="signup-btn">Create account</button>
    <p class="hint" style="text-align:center">By creating an account you agree to the Terms and Privacy Policy.</p>
    <p class="auth-foot">Already have an account? <button type="button" class="link" data-a="auth" data-v="login">Sign in</button></p></form>`,
      `<button class="btn btn-ghost btn-sm" data-a="auth" data-v="login">Log in</button>`,
    );

  if (s === 'forgot')
    return authShell(`<form class="auth-card${S.ui.fx.auth ? ' fx-auth' : ''}" data-submit="doForgot" novalidate>
    <div style="display:flex;justify-content:center"><span class="ftype" style="--c:var(--accent);width:44px;height:44px;border-radius:11px">${ic('key-round', 20)}</span></div><h1>Reset your password</h1><p class="sub">Enter your account email and we'll send you a password reset link.</p>
    <div class="field"><label class="label" for="f-email">Email</label><input class="input input-lg ${icls('email')}" id="f-email" type="email" value="${esc(f.email)}" placeholder="name@company.com" autocomplete="email">${ferr('email')}</div>
    <button class="btn btn-primary btn-lg btn-block" data-a="doForgot" id="forgot-btn">Send reset link</button>
    <p class="auth-foot"><button type="button" class="link row" style="display:inline-flex;gap:6px" data-a="auth" data-v="login">${ic('arrow-left', 14)}Back to sign in</button></p></form>`);

  if (s === 'forgot-sent')
    return authShell(`<div class="auth-card${S.ui.fx.auth ? ' fx-auth' : ''}"><div style="display:flex;justify-content:center"><span class="ftype" style="--c:var(--green);width:44px;height:44px;border-radius:11px">${ic('mail-check', 20)}</span></div><h1>Check your email</h1><p class="sub">We dispatched a password reset link to <b style="color:var(--text)">${esc(f.email)}</b>. The link expires in 30 minutes.</p>
    ${S.ui.resetToken ? `<button class="btn btn-primary btn-lg btn-block" data-a="auth" data-v="reset">Continue to password reset</button>` : ''}
    <p class="auth-foot">Didn't get it? <button class="link" data-a="resend" data-v="reset">Resend email</button></p><p class="auth-foot"><button class="link row" style="display:inline-flex;gap:6px" data-a="auth" data-v="login">${ic('arrow-left', 14)}Back to sign in</button></p></div>`);

  if (s === 'reset')
    return authShell(`<form class="auth-card${S.ui.fx.auth ? ' fx-auth' : ''}" data-submit="doReset" novalidate><div style="display:flex;justify-content:center">${LOGO(30)}</div><h1>Choose a new password</h1><p class="sub">${f.email ? `for ${esc(f.email)}` : 'Enter your new account password'}</p>
    <div class="field"><label class="label" for="r-pw">New password</label><input class="input input-lg ${icls('pw')}" id="r-pw" type="password" data-in="pwStrength" value="${esc(S.ui.pwNew || '')}" autocomplete="new-password">${strengthMeter(S.ui.pwNew || '')}${ferr('pw')}</div>
    <div class="field"><label class="label" for="r-pw2">Confirm password</label><input class="input input-lg ${icls('pw2')}" id="r-pw2" type="password" autocomplete="new-password">${ferr('pw2')}</div>
    <button class="btn btn-primary btn-lg btn-block" data-a="doReset" id="reset-btn">Reset password</button></form>`);

  if (s === 'reset-done')
    return authShell(
      `<div class="auth-card${S.ui.fx.auth ? ' fx-auth' : ''}"><div style="display:flex;justify-content:center"><span class="ftype" style="--c:var(--green);width:44px;height:44px;border-radius:11px">${ic('circle-check', 20)}</span></div><h1>Password updated</h1><p class="sub">Your password has been updated. You can now sign in with your new password.</p><button class="btn btn-primary btn-lg btn-block" data-a="auth" data-v="login">Sign in</button></div>`,
    );

  if (s === 'verify')
    return authShell(
      `<form class="auth-card${S.ui.fx.auth ? ' fx-auth' : ''}" data-submit="doVerifyOtp" novalidate>
        <div style="display:flex;justify-content:center"><span class="ftype" style="--c:var(--accent);width:44px;height:44px;border-radius:11px">${ic('mail', 20)}</span></div>
        <h1>Verify your email</h1>
        <p class="sub">We sent a 6-digit verification code (OTP) to <b style="color:var(--text)">${esc(f.email)}</b>. Enter the OTP below to activate your account and sign in.</p>
        ${e.otp ? `<div class="alert danger" role="alert">${ic('circle-alert', 15)}<span>${esc(e.otp)}</span></div>` : ''}
        <div class="field">
          <label class="label" for="v-otp">6-digit verification code (OTP)</label>
          <input class="input input-lg ${icls('otp')}" id="v-otp" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000" value="${esc(S.ui.otpValue || '')}" style="letter-spacing:0.28em;font-family:var(--mono);font-size:20px;font-weight:600;text-align:center">
          ${ferr('otp')}
        </div>
        <button type="submit" class="btn btn-primary btn-lg btn-block" data-a="doVerifyOtp" id="verify-otp-btn">Verify OTP &amp; sign in</button>
        <button type="button" class="btn btn-secondary btn-lg btn-block" data-a="resend" data-v="verify" id="resend-btn" ${S.ui.resendT > 0 ? 'disabled' : ''}>${S.ui.resendT > 0 ? `Resend OTP in <span class="num" id="resend-t">${S.ui.resendT}</span>s` : 'Resend OTP'}</button>
        <p class="auth-foot">Wrong email? <button type="button" class="link" data-a="auth" data-v="signup">Back to sign up</button></p>
      </form>`,
      `<button class="btn btn-ghost btn-sm" data-a="auth" data-v="login">Sign in</button>`,
    );

  return '';
}

/* ---------------- ONBOARDING ---------------- */
export function renderOnboarding() {
  const st = S.ui.onb;
  const o = S.ui.onbData;
  const N = 6;
  const nav = (next = 'Continue', skip = false) =>
    `<div class="row" style="margin-top:6px">${st > 0 && st < 5 ? `<button class="btn btn-ghost" data-a="onbBack">${ic('arrow-left', 14)}Back</button>` : ''}<span class="sp"></span>${skip ? `<button class="btn btn-ghost" data-a="onbNext" data-skip="1">Skip for now</button>` : ''}<button class="btn btn-primary btn-lg" data-a="onbNext" id="onb-next">${next}${ic('arrow-right', 15)}</button></div>`;
  const opt = (k, v, icon, n, s) =>
    `<button class="opt ${o[k] === v ? 'on' : ''}" role="radio" aria-checked="${o[k] === v}" data-a="onbSet" data-k="${k}" data-v="${v}">${ic(icon, 18)}<b>${n}</b>${s ? `<span>${s}</span>` : ''}</button>`;
  let body;
  if (st === 0)
    body = `<h1>What are you working on?</h1><p class="sub">We'll tailor templates and views to fit. You can change this later.</p><div class="opts" role="radiogroup">${[
      ['product', 'target', 'Product', 'Roadmaps & launches'],
      ['design', 'palette', 'Design', 'Reviews & handoff'],
      ['marketing', 'megaphone', 'Marketing', 'Campaigns & content'],
      ['engineering', 'code', 'Engineering', 'Sprints & releases'],
      ['personal', 'user', 'Personal', 'Goals & side projects'],
      ['other', 'sparkles', 'Other', 'Something else'],
    ]
      .map(x => opt('use', ...x))
      .join('')}</div>${nav()}`;
  if (st === 1) {
    const e = S.ui.errors.ws;
    body = `<h1>Create your workspace</h1><p class="sub">A workspace is where your team's projects live.</p>
    <div class="field"><label class="label" for="o-ws">Workspace name</label><input class="input input-lg ${e ? 'is-error' : ''}" id="o-ws" data-in="onbWs" value="${esc(o.ws)}" placeholder="e.g. Acme Engineering" autofocus>${e ? `<span class="err">${ic('circle-alert', 12)}${e}</span>` : ''}</div>
    <div class="field"><label class="label" for="o-url">Workspace URL</label><div class="row" style="gap:0"><span class="input input-lg" style="width:auto;background:var(--surface-2);border-right:0;border-radius:6px 0 0 6px;display:flex;align-items:center;color:var(--text-2)">snapsec.co/</span><input class="input input-lg" id="o-url" value="${esc(o.url || '')}" data-in="onbUrl" style="border-radius:0 6px 6px 0" placeholder="workspace"></div>${o.url ? `<span class="hint" style="color:var(--green);display:flex;gap:4px;align-items:center">${ic('check', 12)}snapsec.co/${esc(o.url)} is available</span>` : ''}</div>${nav()}`;
  }
  if (st === 2)
    body = `<h1>How does your team work?</h1><p class="sub">We'll set your default project view.</p><div class="opts" role="radiogroup" style="grid-template-columns:repeat(2,minmax(0,1fr))">${[
      ['kanban', 'square-kanban', 'Boards', 'Move cards through stages'],
      ['list', 'list-checks', 'Lists', 'Checklists and priorities'],
      ['timeline', 'chart-gantt', 'Timelines', 'Plan with dates & dependencies'],
      ['table', 'table-2', 'Tables', 'Spreadsheet-style tracking'],
    ]
      .map(x => opt('team', ...x))
      .join('')}</div>
    <div class="field"><span class="label">Team size</span><div class="seg" style="width:fit-content">${['Just me', '2-10', '11-50', '51-200', '200+'].map(s => `<button class="${o.size === s ? 'on' : ''}" data-a="onbSet" data-k="size" data-v="${s}">${s}</button>`).join('')}</div></div>${nav()}`;
  if (st === 3)
    body = `<h1>Create your first project</h1><p class="sub">Start from a template or a blank project.</p><div class="field"><label class="label" for="o-proj">Project name</label><input class="input input-lg" id="o-proj" data-in="onbProj" value="${esc(o.proj)}" autofocus></div><div class="tmpls" role="radiogroup">${TEMPLATES.filter(
      t => t.id !== 'blank',
    )
      .map(t => opt('tmpl', t.id, t.icon, t.name, t.tasks.length + ' starter tasks'))
      .join('')}</div>${nav()}`;
  if (st === 4)
    body = `<h1>Invite your team</h1><p class="sub">Snapsec works best with your teammates. They'll get an email invite.</p><div class="col" style="gap:8px">${[0, 1, 2].map(i => `<input class="input input-lg" id="o-inv-${i}" placeholder="teammate@company.com" type="email" value="${esc((o.invites || '').split(',')[i] || '')}" data-in="onbInv" data-i="${i}" aria-label="Teammate email ${i + 1}">`).join('')}</div><button class="btn btn-ghost btn-sm" style="align-self:flex-start" data-a="copyInviteLink">${ic('link', 13)}Copy invite link instead</button>${nav('Send invites', true)}`;
  if (st === 5) {
    const n = (o.invites || '').split(',').filter(x => x.includes('@')).length;
    body = `<div style="display:flex;justify-content:center"><span class="ftype ready-badge" style="--c:var(--green);width:48px;height:48px;border-radius:12px">${ic('circle-check', 22)}</span></div><h1>Your workspace is ready</h1><p class="sub">Here's what we set up for you.</p>
    <div class="panel">${[
      ['building-2', `Workspace “${esc(o.ws || 'My Workspace')}”`, 'snapsec.co/' + esc(o.url || 'workspace')],
      [
        TEMPLATES.find(t => t.id === o.tmpl)?.icon || 'folder',
        `Project “${esc(o.proj)}”`,
        `${TEMPLATES.find(t => t.id === o.tmpl)?.tasks.length || 0} starter tasks · ${{ kanban: 'Board', list: 'List', timeline: 'Timeline', table: 'Table' }[o.team]} view`,
      ],
      [
        'user-plus',
        n ? `${n} invite${n > 1 ? 's' : ''} sent` : 'No invites yet',
        n ? "They'll appear in Members once they join" : 'Invite people any time from the sidebar',
      ],
    ]
      .map(
        ([i, t, s]) =>
          `<div class="row ready-row" style="padding:12px 14px;border-top:1px solid var(--divider);gap:12px"><span class="ftype" style="--c:var(--accent)">${ic(i, 14)}</span><div class="grow"><div style="font-weight:500">${t}</div><div class="faint" style="font-size:12px">${s}</div></div><span class="ok" style="color:var(--green);display:inline-flex">${ic('check', 15)}</span></div>`,
      )
      .join('')}</div>
    <button class="btn btn-primary btn-lg btn-block" data-a="onbFinish" id="onb-finish-btn">Open workspace${ic('arrow-right', 15)}</button>`;
  }
  return authShell(
    `<div class="auth-card onb${S.ui.fx.step ? ' fx-step' : ''}" style="max-width:${st === 5 ? 440 : 560}px">
    <div class="steps" aria-label="Step ${st + 1} of ${N}">${Array.from({ length: N }, (_, i) => `<i class="${i <= st ? 'on' : ''} ${i === st ? 'cur' : ''}"></i>`).join('')}</div>
    <div class="faint" style="text-align:center;font-size:12px">Step ${st + 1} of ${N}</div>
    ${body}</div>`,
    `<button class="btn btn-ghost btn-sm" data-a="onbExit">Skip setup</button>`,
  );
}

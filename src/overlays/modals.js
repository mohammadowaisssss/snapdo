/* ---------------- MODALS ---------------- */
import { $$, MOD, ago, esc, fmtDate } from '../core/utils.js';
import { ic } from '../core/icons.js';
import { PCOLORS, PICONS } from '../core/constants.js';
import { D, S, mem, pColor, proj, task, teamsList } from '../core/store.js';
import { FT, av, fileFullPreview, filePrev, lbl, md, mdToolbar, prPill, stPill } from '../ui/helpers.js';
import { getGmailAccessToken, getGoogleSenderEmail } from '../core/firebase.js';
import { focusKey, render } from '../shell/render.js';
import { teamModal } from '../features/teams.js';

export function openModal(m) {
  S.ui.modalOpeners = S.ui.modalOpeners || [];
  S.ui.modalOpeners[S.ui.modals.length] = S.ui.popOpener && S.ui.pop ? S.ui.popOpener : focusKey(document.activeElement);
  S.ui.modals.push(m);
  S.ui.pop = null;
  render();
  setTimeout(() => {
    const all = $$('.modal');
    const last = all[all.length - 1];
    const af = last?.querySelector('[autofocus]');
    (af || last?.querySelector('input,textarea,button'))?.focus();
  }, 30);
}
export function closeModal() {
  S.ui.modals.pop();
  S.ui.pop = null;
  render();
}
export function modalHtml(m) {
  const H = (title, sub = '') =>
    `<div class="modal-h"><div><h2 id="mt-${m.type}">${title}</h2>${sub ? `<div class="muted" style="font-size:12.5px;margin-top:2px">${sub}</div>` : ''}</div><button class="ibtn ibtn-sm" data-a="closeModal" aria-label="Close">${ic('x', 16)}</button></div>`;
  const wrap = (cls, inner) => `<div class="modal ${cls}" role="dialog" aria-modal="true" aria-labelledby="mt-${m.type}">${inner}</div>`;
  switch (m.type) {
    case 'task':
      return wrap('', taskModal(m, H));
    case 'project':
      return wrap('', projectModal(m, H));
    case 'share':
      return wrap('', shareModal(m, H));
    case 'invite':
      return wrap('', inviteModal(m, H));
    case 'confirm':
      return wrap('sm', confirmModal(m, H));
    case 'prompt':
      return wrap(
        'sm',
        `${H(m.title)}<form class="modal-b" data-submit="promptSubmit"><div class="field"><label class="label" for="prompt-in">${esc(m.label)}</label><input class="input" id="prompt-in" value="${esc(m.value || '')}" autofocus></div></form><div class="modal-f"><span class="sp"></span><button class="btn btn-secondary" data-a="closeModal">Cancel</button><button class="btn btn-primary" data-a="promptSubmit">${esc(m.ok || 'Save')}</button></div>`,
      );
    case 'shortcuts':
      return wrap('lg', shortcutsModal(H));
    case 'team':
      return wrap('', teamModal(m, H));
    case 'filePreview':
      return wrap('lg', filePreviewModal(m, H));
    case 'emailPreview':
      return wrap('lg', emailPreviewModal(m, H));
    case 'saveView':
      return wrap(
        'sm',
        `${H('Save view', 'Save the current filters as a tab on this project.')}<form class="modal-b" data-submit="saveViewSubmit"><div class="field"><label class="label" for="sv-name">View name</label><input class="input" id="sv-name" placeholder="e.g. Design review queue" autofocus></div><div class="field"><label class="label" for="sv-type">Layout</label><select class="select" id="sv-type"><option value="list">List</option><option value="board">Board</option><option value="table">Table</option></select></div>${m.nf ? `<div class="hint">${m.nf} filter${m.nf > 1 ? 's' : ''} will be saved with this view.</div>` : '<div class="alert info">' + ic('info', 14) + '<span>No filters are active — the view will show all tasks. You can add filters after saving.</span></div>'}</form><div class="modal-f"><span class="sp"></span><button class="btn btn-secondary" data-a="closeModal">Cancel</button><button class="btn btn-primary" data-a="saveViewSubmit">Save view</button></div>`,
      );
  }
  return '';
}
export function formChip(pop, html, label) {
  return `<button class="pillbtn bordered" data-a="pop" data-pop="${pop}" data-id="__form" ${pop === 'date' ? `data-field="${label}"` : ''} aria-label="${esc(label)}">${html}</button>`;
}
export function taskModal(m, H) {
  const f = S.ui.form;
  const p = proj(f.project);
  const err = S.ui.errors.title;
  const descPrev = !!(S.ui.mdPrev && S.ui.mdPrev['form:desc']);
  return `${H(m.edit ? 'Edit task' : 'New task', m.edit ? `<span class="mono">${task(m.edit)?.key}</span>` : '')}
  <form class="modal-b" data-submit="submitTask" style="gap:12px">
    <div class="field"><label class="sr" for="f-title">Task name</label><input class="input input-lg ${err ? 'is-error' : ''}" id="f-title" data-in="form" data-f="title" value="${esc(f.title)}" placeholder="Task name" autofocus aria-invalid="${!!err}" aria-describedby="f-title-err" style="font-size:15px;font-weight:500">${err ? `<span class="err" id="f-title-err">${ic('circle-alert', 12)}${err}</span>` : ''}</div>
    <div class="field">
      <div class="row" style="justify-content:space-between;margin-bottom:4px">
        <label class="label" for="f-desc" style="margin:0">Description <span class="faint" style="font-weight:400">(Markdown supported)</span></label>
        ${mdToolbar('f-desc', 'form:desc')}
      </div>
      ${
        descPrev
          ? `<div class="md-preview-box md-body" style="min-height:76px">${f.desc?.trim() ? md(f.desc) : '<span class="faint">Nothing to preview yet…</span>'}</div>`
          : `<textarea class="textarea" id="f-desc" data-in="form" data-f="desc" placeholder="Add a description with **Markdown**, lists, code, or tables… (optional)" rows="3">${esc(f.desc)}</textarea>`
      }
    </div>
    <div class="row" style="flex-wrap:wrap;gap:6px">
      ${formChip('project', `<span class="pdot" style="--c:${pColor(p)}"></span>${esc(p?.name || 'Project')}`, 'Project')}
      ${formChip('status', stPill(f.status), 'Status')}
      ${formChip('assignee', `${av(f.assignee, 'sm', false)}${esc(mem(f.assignee)?.name || 'Assignee')}`, 'Assignee')}
      ${formChip('priority', prPill(f.priority), 'Priority')}
      ${formChip('date', `${ic('calendar', 13)}${f.due ? 'Due ' + fmtDate(f.due) : 'Due date'}`, 'due')}
      ${formChip('date', `${ic('calendar-arrow-up', 13)}${f.start ? 'Starts ' + fmtDate(f.start) : 'Start date'}`, 'start')}
      ${formChip('labels', f.labels.length ? f.labels.map(lbl).join('') : `${ic('tag', 13)}Labels`, 'Labels')}
      ${formChip('recur', `${ic('repeat', 13)}${f.recur || 'Repeat'}`, 'Repeat')}
    </div>
    <div class="field"><span class="label">Subtasks</span>
      ${f.subtasks.map((s, i) => `<div class="subt" style="padding:0 4px">${ic('circle', 13)}<span class="s">${esc(s.title)}</span><button type="button" class="ibtn ibtn-xs x" style="opacity:1" data-a="formRmSub" data-i="${i}" aria-label="Remove">${ic('x', 12)}</button></div>`).join('')}
      <div class="inwrap">${ic('plus', 14)}<input class="input" id="f-sub" data-key-enter="formAddSub" placeholder="Add a subtask and press Enter"></div></div>
    <div class="field"><span class="label">Attachments</span>
      ${f.files.length ? `<div class="col" style="gap:4px">${f.files.map((x, i) => `<div class="upl" style="padding:6px 10px"><span class="ftype" style="--c:${FT[x.type].c};width:22px;height:22px">${ic(FT[x.type].i, 12)}</span><span class="grow trunc">${esc(x.name)}</span><span class="faint" style="font-size:11.5px">${x.size}</span><button type="button" class="ibtn ibtn-xs" data-a="formRmFile" data-i="${i}" aria-label="Remove">${ic('x', 12)}</button></div>`).join('')}</div>` : ''}
      <label class="dropzone" style="padding:10px">${ic('paperclip', 14)}<span>Attach files or paste with ${MOD}+V</span><input type="file" multiple hidden data-in="formFiles"></label></div>
  </form>
  <div class="modal-f">${m.edit ? '' : `<label class="row" style="gap:8px;font-size:12.5px;color:var(--text-2);cursor:pointer"><input type="checkbox" class="toggle" id="f-more" data-in="formMore" ${f.more ? 'checked' : ''}>Create more</label>`}<span class="sp"></span>
    <span class="faint hide-m" style="font-size:11.5px"><kbd>${MOD}</kbd> <kbd>↵</kbd></span>
    <button class="btn btn-secondary" data-a="closeModal">Cancel</button><button class="btn btn-primary" data-a="submitTask" id="f-submit">${m.edit ? 'Save changes' : 'Create task'}</button></div>`;
}
export const TEMPLATES = [
  { id: 'blank', name: 'Blank project', icon: 'file', desc: 'Start from scratch', tasks: [] },
  {
    id: 'product',
    name: 'Product Development',
    icon: 'target',
    desc: 'Discovery to launch',
    tasks: ['Define problem statement', 'User research plan', 'Write PRD', 'Design exploration', 'Build MVP', 'Beta launch'],
  },
  {
    id: 'web',
    name: 'Website',
    icon: 'globe',
    desc: 'IA, design, build, launch',
    tasks: ['Sitemap & information architecture', 'Wireframes', 'Visual design', 'Build page templates', 'Content migration', 'QA & launch'],
  },
  {
    id: 'mkt',
    name: 'Marketing Campaign',
    icon: 'megaphone',
    desc: 'Brief, assets, channels',
    tasks: ['Campaign brief', 'Audience research', 'Creative assets', 'Channel plan', 'Launch campaign', 'Performance report'],
  },
  {
    id: 'design',
    name: 'Design Project',
    icon: 'palette',
    desc: 'Discovery to handoff',
    tasks: ['Discovery workshop', 'Moodboard', 'Concept directions', 'Refinement', 'Developer handoff'],
  },
  {
    id: 'software',
    name: 'Software Development',
    icon: 'code',
    desc: 'Spec, build, ship',
    tasks: ['Technical spec', 'Set up repo & CI', 'Implement core API', 'Write tests', 'Code review', 'Deploy to staging'],
  },
  {
    id: 'personal',
    name: 'Personal Project',
    icon: 'heart',
    desc: 'Plan your own goals',
    tasks: ['Brain dump ideas', 'Pick top 3 priorities', 'Schedule focus time', 'Weekly review'],
  },
];
export function projectModal(m, H) {
  const f = S.ui.pform;
  const err = S.ui.errors.pname;
  const pDescPrev = !!(S.ui.mdPrev && S.ui.mdPrev['pform:desc']);
  return `${H(m.edit ? 'Project settings' : 'New project', m.edit ? '' : 'Projects hold tasks, files, and conversations for one body of work.')}
  <form class="modal-b" data-submit="submitProject">
    <div class="row" style="gap:10px;align-items:flex-start">
      <button type="button" class="picon lg" style="--c:${PCOLORS[f.color]};cursor:default;flex-shrink:0;margin-top:22px" aria-hidden="true" tabindex="-1">${ic(f.icon, 18)}</button>
      <div class="field grow"><label class="label" for="p-name">Project name</label><input class="input ${err ? 'is-error' : ''}" id="p-name" data-in="pform" data-f="name" value="${esc(f.name)}" placeholder="e.g. Website Redesign" autofocus aria-invalid="${!!err}">${err ? `<span class="err">${ic('circle-alert', 12)}${err}</span>` : ''}</div>
    </div>
    <div class="field">
      <div class="row" style="justify-content:space-between;margin-bottom:4px">
        <label class="label" for="p-desc" style="margin:0">Description <span class="faint" style="font-weight:400">(Markdown supported)</span></label>
        ${mdToolbar('p-desc', 'pform:desc')}
      </div>
      ${
        pDescPrev
          ? `<div class="md-preview-box md-body" style="min-height:60px">${f.desc?.trim() ? md(f.desc) : '<span class="faint">Nothing to preview yet…</span>'}</div>`
          : `<textarea class="textarea" id="p-desc" data-in="pform" data-f="desc" rows="2" placeholder="What is this project about? (Supports Markdown)">${esc(f.desc)}</textarea>`
      }
    </div>
    <div class="row" style="gap:16px;align-items:flex-start;flex-wrap:wrap">
      <div class="field" style="flex:1;min-width:220px"><span class="label">Icon</span><div class="iconpick" role="radiogroup" aria-label="Icon">${PICONS.map(i => `<button type="button" role="radio" aria-checked="${f.icon === i}" class="${f.icon === i ? 'on' : ''}" data-a="pformSet" data-f="icon" data-v="${i}" aria-label="${i}">${ic(i, 15)}</button>`).join('')}</div></div>
      <div class="field"><span class="label">Color</span><div class="swatches" role="radiogroup" aria-label="Color" style="max-width:140px">${Object.entries(
        PCOLORS,
      )
        .map(
          ([k, v]) =>
            `<button type="button" role="radio" aria-checked="${f.color === k}" class="sw ${f.color === k ? 'on' : ''}" style="--c:${v};width:22px;height:22px" data-a="pformSet" data-f="color" data-v="${k}" aria-label="${k}">${f.color === k ? ic('check', 12) : ''}</button>`,
        )
        .join('')}</div></div>
    </div>
    <div class="row" style="gap:12px;flex-wrap:wrap">
      <div class="field" style="flex:1;min-width:150px"><label class="label" for="p-team">Team</label><select class="select" id="p-team" data-in="pform" data-f="team">${teamsList()
        .map(t => `<option value="${t.id}" ${f.team === t.id ? 'selected' : ''}>${t.name}</option>`)
        .join('')}</select></div>
      <div class="field" style="flex:1;min-width:150px"><label class="label" for="p-lead">Lead</label><select class="select" id="p-lead" data-in="pform" data-f="lead">${D()
        .members.filter(x => x.status === 'active')
        .map(x => `<option value="${x.id}" ${f.lead === x.id ? 'selected' : ''}>${esc(x.name)}</option>`)
        .join('')}</select></div>
      <div class="field" style="flex:1;min-width:150px"><label class="label" for="p-due">Target date</label><input type="date" class="input" id="p-due" data-in="pform" data-f="due" value="${f.due || ''}"></div>
    </div>
    ${m.edit ? '' : `<div class="field"><span class="label">Template</span><div class="tmpls" role="radiogroup">${TEMPLATES.map(t => `<button type="button" role="radio" aria-checked="${f.tmpl === t.id}" class="opt ${f.tmpl === t.id ? 'on' : ''}" data-a="pformSet" data-f="tmpl" data-v="${t.id}" style="padding:10px">${ic(t.icon, 16)}<b style="font-size:12.5px">${t.name}</b><span>${t.tasks.length ? t.tasks.length + ' starter tasks' : t.desc}</span></button>`).join('')}</div></div>`}
  </form>
  <div class="modal-f"><span class="sp"></span><button class="btn btn-secondary" data-a="closeModal">Cancel</button><button class="btn btn-primary" data-a="submitProject">${m.edit ? 'Save changes' : 'Create project'}</button></div>`;
}
export const PERMS = ['Can view', 'Can comment', 'Can edit', 'Full access'];
export function shareModal(m, H) {
  const p = proj(m.id);
  p.perms = p.perms || {};
  p.access = p.access || 'workspace';
  return `${H(`Share “${esc(p.name)}”`)}
  <div class="modal-b">
    <form class="row" style="gap:6px" data-submit="shareInvite"><div class="grow"><label class="sr" for="share-in">Invite by email</label><input class="input" id="share-in" placeholder="Add people by name or email" value="${esc(S.ui.shareQ || '')}" data-in="shareQ" autofocus></div>
      <select class="select" id="share-perm" style="width:132px" aria-label="Permission">${PERMS.map(x => `<option ${x === 'Can edit' ? 'selected' : ''}>${x}</option>`).join('')}</select>
      <button class="btn btn-primary" data-a="shareInvite" type="button">Invite</button></form>
    ${
      S.ui.shareQ
        ? `<div class="panel" style="padding:4px">${
            D()
              .members.filter(
                x => !p.members.includes(x.id) && (x.name.toLowerCase().includes(S.ui.shareQ.toLowerCase()) || x.email.includes(S.ui.shareQ.toLowerCase())),
              )
              .map(
                x =>
                  `<button class="mi" data-a="shareAdd" data-id="${p.id}" data-mid="${x.id}">${av(x.id, 'sm', false)}${esc(x.name)}<span class="r">${esc(x.email)}</span></button>`,
              )
              .join('') ||
            `<div class="mi faint" style="cursor:default">${S.ui.shareQ.includes('@') ? `Press Invite to send an invitation to ${esc(S.ui.shareQ)}` : 'No matching members — enter an email to invite someone new'}</div>`
          }</div>`
        : ''
    }
    <div><div class="eyebrow" style="margin-bottom:4px">People with access</div>
      ${p.members
        .map(id => {
          const x = mem(id);
          if (!x) return '';
          const perm = id === p.lead ? 'Full access' : p.perms[id] || (x.role === 'Guest' ? 'Can comment' : 'Can edit');
          return `<div class="row" style="height:44px">${av(id, 'md', false)}<div class="grow"><div style="font-weight:500;font-size:13px">${esc(x.name)}${id === D().me ? ' <span class="faint" style="font-weight:400">(you)</span>' : ''}</div><div class="faint" style="font-size:11.5px">${esc(x.email)}${id === p.lead ? ' · Project lead' : ''}</div></div>
          ${id === p.lead ? `<span class="muted" style="font-size:12.5px;padding-right:8px">Full access</span>` : `<select class="select" style="width:auto;height:26px;font-size:12px;border-color:transparent;background-color:transparent" data-in="sharePerm" data-id="${p.id}" data-mid="${id}" aria-label="Permission for ${esc(x.name)}">${PERMS.map(q => `<option ${q === perm ? 'selected' : ''}>${q}</option>`).join('')}<option value="__remove">Remove access</option></select>`}</div>`;
        })
        .join('')}
    </div>
    <div style="border-top:1px solid var(--divider);padding-top:12px"><div class="eyebrow" style="margin-bottom:8px">General access</div>
      <div class="row" style="gap:10px"><span class="ftype" style="--c:var(--text-2)">${ic(p.access === 'private' ? 'lock' : 'building-2', 14)}</span><div class="grow"><select class="select" style="height:28px;width:auto;border-color:transparent;padding-left:4px;font-weight:500" data-in="shareAccess" data-id="${p.id}" aria-label="General access"><option value="private" ${p.access === 'private' ? 'selected' : ''}>Only people invited</option><option value="workspace" ${p.access === 'workspace' ? 'selected' : ''}>Everyone at ${esc(D().ws.name)}</option></select><div class="faint" style="font-size:11.5px;padding-left:4px">${p.access === 'private' ? 'Only people listed above can open this project.' : 'Anyone in the workspace can view and comment.'}</div></div></div></div>
  </div>
  <div class="modal-f"><button class="btn btn-secondary" data-a="copyLink" data-pid="${p.id}">${ic('link', 14)}Copy link</button><span class="sp"></span><button class="btn btn-primary" data-a="closeModal">Done</button></div>`;
}
export function smtpConfigFormHtml() {
  const cfg = D().smtpConfig || {};
  const err = S.ui.errors?.smtp;
  return `<div class="panel" style="padding:12px;background:var(--surface-2);border:1px solid var(--border-strong);border-radius:var(--r);display:flex;flex-direction:column;gap:10px">
    <div class="row" style="justify-content:space-between">
      <div style="font-size:12.5px;font-weight:600;display:flex;align-items:center;gap:6px">${ic('mail', 14)}Direct Gmail / SMTP Delivery Configuration</div>
      <button type="button" class="ibtn ibtn-xs" data-a="toggleSmtpForm" aria-label="Close SMTP form">${ic('x', 13)}</button>
    </div>
    <div class="faint" style="font-size:11.5px;line-height:1.45">Enter a Gmail address + 16-character <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" class="link">Google App Password</a> (or custom SMTP credentials) to deliver invitation emails directly into external Gmail inboxes.</div>
    <div class="row" style="gap:8px;flex-wrap:wrap">
      <div class="field" style="flex:1;min-width:170px"><label class="label" for="smtp-user">Gmail / SMTP Username</label><input class="input" id="smtp-user" placeholder="you@gmail.com" value="${esc(cfg.user || getGoogleSenderEmail() || D().members.find(x => x.id === D().me)?.email || '')}"></div>
      <div class="field" style="flex:1;min-width:170px"><label class="label" for="smtp-pass">Gmail App Password / SMTP Password</label><input class="input" id="smtp-pass" type="password" placeholder="xxxx xxxx xxxx xxxx" value="${esc(cfg.pass || '')}"></div>
    </div>
    <div class="row" style="gap:8px;flex-wrap:wrap">
      <div class="field" style="flex:2;min-width:150px"><label class="label" for="smtp-host">SMTP Host</label><input class="input" id="smtp-host" placeholder="smtp.gmail.com" value="${esc(cfg.host || 'smtp.gmail.com')}"></div>
      <div class="field" style="flex:1;min-width:90px"><label class="label" for="smtp-port">Port</label><input class="input" id="smtp-port" type="number" placeholder="465" value="${esc(cfg.port || 465)}"></div>
    </div>
    ${err ? `<div class="err">${ic('circle-alert', 12)}${esc(err)}</div>` : ''}
    <div class="row" style="justify-content:flex-end;gap:8px">
      <button type="button" class="btn btn-xs btn-secondary" data-a="toggleSmtpForm">Cancel</button>
      <button type="button" class="btn btn-xs btn-primary" data-a="saveSmtpConfig" id="smtp-save-btn">${ic('check', 12)}Verify &amp; Save SMTP</button>
    </div>
  </div>`;
}
export function inviteModal(m, H) {
  const err = S.ui.errors.invite;
  const outbox = (D().outbox || []).slice(0, 3);
  const hasOAuth = !!getGmailAccessToken();
  const smtpUser = D().smtpConfig?.user;
  const senderEmail = getGoogleSenderEmail() || smtpUser || '';
  return `${H('Invite to ' + esc(D().ws.name), 'Invited people get an email with a direct link to join.')}
  <form class="modal-b" data-submit="submitInvite">
    <div class="row" style="padding:8px 11px;border-radius:var(--r);border:1px solid ${hasOAuth || smtpUser ? 'color-mix(in srgb,var(--green) 38%,var(--border))' : 'var(--border)'};background:${hasOAuth || smtpUser ? 'color-mix(in srgb,var(--green) 8%,var(--surface))' : 'var(--surface-2)'};gap:8px;flex-wrap:wrap">
      <span class="badge ${hasOAuth || smtpUser ? 'green' : 'amber'}"><span class="dot"></span>${hasOAuth ? 'Google Mail Connected' : smtpUser ? 'SMTP Active' : 'Direct Gmail Setup'}</span>
      <span class="grow" style="font-size:12px;color:var(--text-2)">${
        hasOAuth
          ? `Sending directly from <b>${esc(senderEmail)}</b> via Gmail API`
          : smtpUser
            ? `Sending directly from <b>${esc(smtpUser)}</b> via ${esc(D().smtpConfig?.host || 'smtp.gmail.com')}`
            : 'Connect Google Mail or SMTP so invites arrive directly in external Gmail inboxes.'
      }</span>
      <button type="button" class="btn btn-xs ${hasOAuth ? 'btn-secondary' : 'btn-primary'}" data-a="connectGmailOAuth">${ic('mail', 12)}${hasOAuth ? 'Reconnect Google' : 'Connect Google Mail'}</button>
      <button type="button" class="btn btn-xs btn-secondary" data-a="toggleSmtpForm">${ic('settings', 12)}SMTP</button>
    </div>
    ${S.ui.showSmtpForm ? smtpConfigFormHtml() : ''}
    <div class="field"><label class="label" for="inv-emails">Email addresses</label><textarea class="textarea ${err ? 'is-error' : ''}" id="inv-emails" placeholder="name@company.com, another@company.com" rows="3" autofocus>${esc(S.ui.inviteDraft || '')}</textarea>${err ? `<span class="err">${ic('circle-alert', 12)}${err}</span>` : '<span class="hint">Separate multiple addresses with commas.</span>'}</div>
    <div class="row" style="gap:12px"><div class="field grow"><label class="label" for="inv-role">Role</label><select class="select" id="inv-role">${['Member', 'Admin', 'Guest'].map(r => `<option>${r}</option>`).join('')}</select></div>
    <div class="field grow"><label class="label" for="inv-team">Team</label><select class="select" id="inv-team">${teamsList()
      .map(t => `<option value="${t.id}">${t.name}</option>`)
      .join('')}</select></div></div>
    <div class="alert info">${ic('info', 14)}<span><b>Guests</b> can only see projects they're added to and can't create projects.</span></div>
    ${
      outbox.length
        ? `<div style="border-top:1px solid var(--divider);padding-top:10px"><div class="eyebrow" style="margin-bottom:6px">Recent invitations sent</div><div class="col" style="gap:6px">${outbox
            .map(
              msg =>
                `<div class="row" style="padding:6px 10px;border:1px solid var(--border);border-radius:7px;background:var(--surface-2);font-size:12px;gap:8px"><span class="badge ${msg.deliveredToInbox ? 'green' : 'amber'}"><span class="dot"></span>${msg.deliveredToInbox ? 'Delivered' : 'Ready'}</span><span class="grow trunc"><b>${esc(msg.to)}</b> · ${esc(msg.role)}</span><button type="button" class="btn btn-xs btn-secondary" data-a="previewInviteEmail" data-id="${msg.id}">${ic('mail', 12)}View email</button><a class="btn btn-xs btn-ghost" href="${esc(msg.gmailComposeUrl)}" target="_blank" rel="noopener noreferrer">${ic('external-link', 12)}Gmail</a></div>`,
            )
            .join('')}</div></div>`
        : ''
    }
  </form>
  <div class="modal-f"><button class="btn btn-ghost" data-a="copyInviteLink">${ic('link', 14)}Copy invite link</button><span class="sp"></span><button class="btn btn-secondary" data-a="closeModal">Cancel</button><button class="btn btn-primary" data-a="submitInvite" id="inv-submit">Send invites</button></div>`;
}
export function confirmModal(m) {
  const needs = m.typeName;
  const ok = !needs || (S.ui.confirmText || '') === needs;
  return `<div class="modal-b" style="padding-top:18px;gap:10px">
    <div class="row" style="gap:12px;align-items:flex-start"><span class="ftype" style="--c:${m.danger ? 'var(--red)' : 'var(--amber)'};width:34px;height:34px;border-radius:9px">${ic(m.icon || (m.danger ? 'trash-2' : 'archive'), 17)}</span>
    <div class="grow"><h2 id="mt-confirm" style="font-size:15px;font-weight:600;margin:4px 0 6px">${esc(m.title)}</h2><p class="muted" style="margin:0;font-size:13px;line-height:1.55">${m.body}</p></div></div>
    ${needs ? `<div class="field" style="margin-top:6px"><label class="label" for="confirm-in" style="font-weight:400;color:var(--text-2)">Type <b style="color:var(--text);font-weight:600">${esc(needs)}</b> to confirm</label><input class="input" id="confirm-in" data-in="confirmText" autocomplete="off" autofocus value="${esc(S.ui.confirmText || '')}"></div>` : ''}
  </div>
  <div class="modal-f"><span class="sp"></span><button class="btn btn-secondary" data-a="closeModal" ${needs ? '' : 'autofocus'}>Cancel</button><button class="btn ${m.danger ? 'btn-danger' : 'btn-primary'}" data-a="confirmOk" ${ok ? '' : 'disabled'}>${esc(m.ok)}</button></div>`;
}
export const SHORTCUTS = [
  [
    'General',
    [
      ['Command menu', [MOD, 'K']],
      ['Search', ['/']],
      ['Keyboard shortcuts', ['?']],
      ['Toggle sidebar', ['[']],
      ['Toggle dark mode', [MOD, 'Shift', 'L']],
      ['Close panel or dialog', ['Esc']],
    ],
  ],
  [
    'Create',
    [
      ['New task', ['N']],
      ['New project', ['P']],
      ['Submit form', [MOD, '↵']],
      ['Send comment', [MOD, '↵']],
      ['Paste attachment', [MOD, 'V']],
    ],
  ],
  [
    'Navigate',
    [
      ['Go to Home', ['G', 'H']],
      ['Go to My Tasks', ['G', 'T']],
      ['Go to Projects', ['G', 'P']],
      ['Go to Inbox', ['G', 'I']],
      ['Go to Calendar', ['G', 'C']],
      ['Go to Settings', ['G', 'S']],
    ],
  ],
  [
    'Command menu',
    [
      ['Move selection', ['↑', '↓']],
      ['Run command', ['↵']],
      ['Search mode', ['Tab']],
    ],
  ],
];
export function shortcutsModal(H) {
  return `${H('Keyboard shortcuts')}<div class="modal-b" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:22px">${SHORTCUTS.map(([g, list]) => `<div><div class="eyebrow" style="margin-bottom:6px">${g}</div>${list.map(([n, k]) => `<div class="row" style="height:30px;font-size:13px;border-bottom:1px solid var(--divider)"><span class="grow">${n}</span>${k.map((x, i) => `${i && k[0] === 'G' ? '<span class="faint" style="font-size:11px">then</span>' : ''}<kbd>${x}</kbd>`).join('')}</div>`).join('')}</div>`).join('')}</div>`;
}
export function filePreviewModal(m, H) {
  const f = m.file;
  if (!f) return `${H('File not found')}<div class="modal-b"><p class="muted">This file may have been deleted.</p></div><div class="modal-f"><button class="btn btn-primary" data-a="closeModal">Close</button></div>`;
  const t = FT[f.type] || FT.other;
  return `${H(esc(f.name), `${t.n} · ${f.size || ''} · Uploaded by ${esc(mem(f.by)?.name || 'you')} ${ago(f.at)}`)}
  <div class="modal-b"><div style="border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden">${fileFullPreview(f)}</div>
  ${m.tid && task(m.tid) ? `<div class="row faint" style="font-size:12.5px">${ic('link', 13)}Attached to <button class="link" data-a="openTask" data-id="${m.tid}">${esc(task(m.tid)?.title)}</button></div>` : ''}</div>
  <div class="modal-f"><button class="btn btn-secondary" data-a="downloadFile" data-fid="${f.id}" data-tid="${m.tid || ''}">${ic('download', 14)}Download</button><button class="btn btn-secondary" data-a="copyLink" data-fid="${f.id}">${ic('link', 14)}Copy link</button><span class="sp"></span><button class="btn btn-primary" data-a="closeModal">Close</button></div>`;
}
export function emailPreviewModal(m, H) {
  const msg = m.email || (D().outbox || []).find(x => x.id === m.id);
  if (!msg) return `${H('Invitation email')}<div class="modal-b"><p class="muted">Invitation details not found.</p></div><div class="modal-f"><button class="btn btn-primary" data-a="closeModal">Close</button></div>`;
  const realInbox = !!msg.deliveredToInbox;
  return `${H(realInbox ? 'Invitation delivered to Gmail inbox' : 'Invitation email ready for Gmail delivery', `To: ${esc(msg.to)} · Role: ${esc(msg.role)} · ${ago(msg.sentAt)}`)}
  <div class="modal-b" style="gap:12px">
    ${
      realInbox
        ? `<div class="alert ok" style="align-items:center">
            ${ic('circle-check', 16)}
            <div class="grow">
              <b>Delivered directly to ${esc(msg.to)}'s real inbox (${esc(msg.transport || 'gmail')})</b>
              <div style="font-size:12px;opacity:.9;margin-top:2px">The invitation email was dispatched through authenticated Gmail/SMTP and is in ${esc(msg.to)}'s inbox now.</div>
            </div>
          </div>`
        : `<div class="alert info" style="align-items:flex-start;gap:10px">
            ${ic('mail', 16)}
            <div class="grow">
              <b>Deliver directly to ${esc(msg.to)}'s real Gmail inbox:</b>
              <div style="font-size:12px;opacity:.92;margin-top:3px;line-height:1.45">Sandbox SMTP servers (Ethereal) only store test previews and cannot deliver to external Gmail addresses. Click <b>Deliver via My Google Account</b> below (or configure Gmail SMTP) to send this email directly into <b>${esc(msg.to)}</b>'s real Gmail inbox right now.</div>
              <div class="row" style="gap:8px;margin-top:9px;flex-wrap:wrap">
                <button type="button" class="btn btn-xs btn-primary" data-a="deliverViaGoogleOAuth" data-id="${esc(msg.id)}" id="deliver-oauth-btn">${ic('send', 12)}Deliver Now via My Google Account</button>
                <button type="button" class="btn btn-xs btn-secondary" data-a="toggleSmtpForm">${ic('settings', 12)}Configure Gmail App Password / SMTP</button>
                ${msg.previewUrl ? `<a class="btn btn-xs btn-ghost" href="${esc(msg.previewUrl)}" target="_blank" rel="noopener noreferrer">${ic('external-link', 12)}Sandbox Preview</a>` : ''}
              </div>
            </div>
          </div>`
    }
    ${S.ui.showSmtpForm ? smtpConfigFormHtml() : ''}
    <div style="border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden;background:#F9FAFB;padding:16px;max-height:320px;overflow-y:auto">
      <div style="font-size:12px;color:#4B5563;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #E5E7EB">
        <div><b>From:</b> ${esc(msg.fromName)} &lt;${esc(msg.from)}&gt;</div>
        <div><b>To:</b> ${esc(msg.to)}</div>
        <div><b>Subject:</b> ${esc(msg.subject)}</div>
      </div>
      ${msg.html}
    </div>
  </div>
  <div class="modal-f" style="flex-wrap:wrap;gap:8px">
    <button class="btn btn-primary" data-a="deliverViaGoogleOAuth" data-id="${esc(msg.id)}">${ic('send', 14)}Send via Google Account</button>
    <a class="btn btn-secondary" href="${esc(msg.gmailComposeUrl)}" target="_blank" rel="noopener noreferrer">${ic('mail', 14)}Open in Gmail Compose</a>
    <button class="btn btn-secondary" data-a="copyText" data-text="${esc(msg.inviteUrl)}">${ic('link', 14)}Copy join link</button>
    <button class="btn btn-secondary" data-a="acceptInviteNow" data-token="${esc(msg.inviteToken)}">${ic('user-check', 14)}Test Join Link</button>
    <span class="sp"></span>
    <button class="btn btn-ghost" data-a="closeModal">Done</button>
  </div>`;
}

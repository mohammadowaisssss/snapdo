import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMarkdownCommand, normalizeHtmlToMarkdown, renderMarkdown } from '../../frontend/src/core/markdown.ts';
import {
  addCommentRecord,
  addFileRecord,
  addSubtaskRecord,
  applyTaskPatch,
  archiveTaskRecord,
  authenticateWorkspaceUser,
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
  makeProjectKey,
  promoteSubtaskRecord,
  removeMemberRecord,
  renameFileRecord,
  restoreTaskRecord,
  toggleCommentReaction,
  updateProjectRecord,
  updateSubtaskRecord,
  updateTeamRecord,
  validateAuthCredentials,
} from './services/engine.ts';

test('createDefaultState initializes Snapsec workspace with Mohammad Owais owner, tasks, projects, teams, and members', () => {
  const store = createDefaultState();
  assert.equal(store.data.ws.name, 'Snapsec');
  assert.equal(store.data.ws.url, 'snapsec');
  assert.equal(store.prefs.name, 'Mohammad Owais');
  assert.equal(store.data.members[0].name, 'Mohammad Owais');
  assert.equal(store.data.members[0].email, 'mohammadowais616@gmail.com');
  assert.ok(store.data.tasks.length >= 40);
  assert.ok(store.data.projects.length >= 7);
  assert.ok(store.data.members.length >= 8);
  assert.ok(store.data.teams.length >= 4);

  const metrics = computeWorkspaceMetrics(store.data);
  assert.equal(metrics.workspaceName, 'Snapsec');
  assert.equal(metrics.totalProjects, 7);
  assert.ok(metrics.openTasks > 0);
  assert.ok(metrics.completedTasks > 0);
});

test('authenticateWorkspaceUser binds actual Google account identity and never falls back to Tanjim Islam', () => {
  const store = createDefaultState();
  const googleUser = authenticateWorkspaceUser(store.data, store.prefs, {
    uid: 'google-uid-12345',
    name: 'Mohammad Owais',
    email: 'mohammadowais616@gmail.com',
    photoURL: 'https://lh3.googleusercontent.com/a/default-user=s96-c',
    provider: 'Google',
  });
  assert.ok(googleUser);
  assert.equal(googleUser.name, 'Mohammad Owais');
  assert.equal(googleUser.email, 'mohammadowais616@gmail.com');
  assert.equal(googleUser.photoURL, 'https://lh3.googleusercontent.com/a/default-user=s96-c');
  assert.equal(store.data.me, googleUser.id);
  assert.equal(store.prefs.name, 'Mohammad Owais');

  // Also test signing in with a brand-new Google account
  const customGoogleUser = authenticateWorkspaceUser(store.data, store.prefs, {
    uid: 'google-uid-99999',
    name: 'Alex Rivera',
    email: 'alex.rivera@gmail.com',
    photoURL: 'https://lh3.googleusercontent.com/a/alex=s96-c',
    provider: 'Google',
  });
  assert.ok(customGoogleUser);
  assert.equal(customGoogleUser.name, 'Alex Rivera');
  assert.equal(customGoogleUser.email, 'alex.rivera@gmail.com');
  assert.equal(store.prefs.name, 'Alex Rivera');
  assert.equal(store.data.me, customGoogleUser.id);
});

test('task creation, patching, recurring scheduling, archive, restore, duplicate, and deletion', () => {
  const { data } = createDefaultState();
  const initialCount = data.tasks.length;

  const created = createTaskRecord(data, {
    title: 'Implement SOC2 audit logging',
    project: 'p1',
    priority: 'urgent',
    status: 'todo',
    due: '2026-11-10',
    recur: 'Weekly',
  });

  assert.equal(data.tasks.length, initialCount + 1);
  assert.equal(created.key, 'WEB-201');
  assert.equal(created.priority, 'urgent');
  assert.equal(computeTaskProgress(created), 5);

  // Mark recurring task done -> schedules next occurrence
  const res = applyTaskPatch(data, created.id, { status: 'done' });
  assert.ok(res);
  assert.equal(res.task.status, 'done');
  assert.equal(computeTaskProgress(res.task), 100);
  assert.equal(res.messages.length, 1);
  assert.equal(data.tasks.length, initialCount + 2);

  // Duplicate task
  const dup = duplicateTaskRecord(data, created.id);
  assert.ok(dup);
  assert.equal(dup.title, 'Implement SOC2 audit logging (copy)');

  // Archive and restore
  archiveTaskRecord(data, created.id);
  assert.equal(created.archived, true);
  assert.equal(filterTasks(data, { q: 'SOC2', archived: false }).length, 2); // recurring + copy
  restoreTaskRecord(data, created.id);
  assert.equal(created.archived, false);

  // Delete tasks
  const deletedCount = deleteTaskRecords(data, [created.id, dup.id]);
  assert.equal(deletedCount, 2);
});

test('subtask lifecycle: add, toggle done, update metadata, promote to full task, and delete', () => {
  const { data } = createDefaultState();
  const t = createTaskRecord(data, { title: 'Penetration test API endpoints', project: 'p2' });

  const s1 = addSubtaskRecord(data, t.id, 'Run OWASP ZAP scan');
  const s2 = addSubtaskRecord(data, t.id, 'Verify JWT signature rotation');
  assert.ok(s1 && s2);
  assert.equal(t.subtasks.length, 2);
  assert.equal(computeTaskProgress(t), 0);

  updateSubtaskRecord(data, t.id, s1.id, { done: true, note: 'No critical findings', assignee: 'm3' });
  assert.equal(computeTaskProgress(t), 50);

  // Promote s2 to a standalone task
  const promoted = promoteSubtaskRecord(data, t.id, s2.id);
  assert.ok(promoted);
  assert.equal(promoted.title, 'Verify JWT signature rotation');
  assert.equal(promoted.project, 'p2');
  assert.equal(t.subtasks.length, 1);

  const removed = deleteSubtaskRecord(data, t.id, s1.id);
  assert.equal(removed, true);
  assert.equal(t.subtasks.length, 0);
});

test('comments, @mentions notifications, and emoji reactions work end-to-end', () => {
  const { data } = createDefaultState();
  const notifCountBefore = data.notifs.length;

  const comment = addCommentRecord(data, 't3', 'Great progress @Sarah Chen — ready for security sign-off!', 'm1');
  assert.ok(comment);
  assert.equal(data.notifs.length, notifCountBefore + 1);
  assert.equal(data.notifs[0].type, 'mention');
  assert.equal(data.notifs[0].task, 't3');

  // Toggle reaction on and off
  toggleCommentReaction(data, comment.id, '👍', 'm2');
  assert.deepEqual(comment.re['👍'], ['m2']);
  toggleCommentReaction(data, comment.id, '👍', 'm2');
  assert.deepEqual(comment.re['👍'], []);

  assert.equal(deleteCommentRecord(data, comment.id), true);
});

test('project creation with templates, progress calculation, duplication, and deletion', () => {
  const { data } = createDefaultState();
  const key = makeProjectKey('Web Security Portal', data.projects);
  assert.equal(key, 'WSP');

  const proj = createProjectRecord(
    data,
    { name: 'Cloud Security Posture', color: 'teal', icon: 'shield', team: 'eng', lead: 'm6' },
    'sprint',
  );
  assert.equal(proj.name, 'Cloud Security Posture');
  const starterTasks = filterTasks(data, { project: proj.id });
  assert.equal(starterTasks.length, 6);
  assert.equal(computeProjectProgress(data, proj.id), 0);

  updateProjectRecord(data, proj.id, { status: 'active', fav: true });
  assert.equal(proj.status, 'active');
  assert.equal(proj.fav, true);

  const dup = duplicateProjectRecord(data, proj.id);
  assert.ok(dup);
  assert.equal(filterTasks(data, { project: dup.id }).length, 6);

  assert.equal(deleteProjectRecord(data, dup.id), true);
  assert.equal(filterTasks(data, { project: dup.id }).length, 0);
});

test('teams, member invitations, and file management work properly', () => {
  const { data } = createDefaultState();

  const secTeam = createTeamRecord(data, {
    name: 'Security Research',
    desc: 'Vulnerability research and red team',
    icon: 'shield',
    color: 'indigo',
    members: ['m6'],
  });
  assert.equal(secTeam.name, 'Security Research');
  assert.throws(() => createTeamRecord(data, { name: 'Security Research' }), /already exists/);

  updateTeamRecord(data, secTeam.id, { desc: 'AppSec & Red Team', members: ['m6', 'm7'] });
  assert.equal(data.members.find((m: any) => m.id === 'm7').team, secTeam.id);

  const invited = inviteMemberRecords(data, ['alex.sec@snapsec.com'], 'Member', secTeam.id);
  assert.equal(invited.length, 1);
  assert.equal(invited[0].name, 'Alex Sec');
  assert.equal(removeMemberRecord(data, invited[0].id), true);

  assert.equal(deleteTeamRecord(data, secTeam.id), true);
  assert.equal(data.members.find((m: any) => m.id === 'm7').team, '');

  // Files
  const f = addFileRecord(data, { name: 'threat-model-2026.pdf', size: '1.4 MB', project: 'p1', task: 't3' });
  assert.equal(f.type, 'pdf');
  renameFileRecord(data, f.id, 'threat-model-final.xlsx');
  assert.equal(f.type, 'sheet');
  const fCopy = duplicateFileRecord(data, f.id);
  assert.ok(fCopy);
  assert.equal(fCopy.name, 'threat-model-final copy.xlsx');
  assert.equal(deleteFileRecord(data, f.id), true);
});

test('auth credentials validation enforces @snapsec.co signup domain and password policies', () => {
  assert.equal(validateAuthCredentials('login', { email: 'bad', password: '' }).valid, false);
  assert.equal(validateAuthCredentials('login', { email: 'user@snapsec.co', password: 'secret' }).valid, true);

  // Non-snapsec.co emails must be rejected on signup
  const nonCompanySignup = validateAuthCredentials('signup', {
    name: 'External User',
    email: 'external@gmail.com',
    password: 'Snapsec!2026',
  });
  assert.equal(nonCompanySignup.valid, false);
  assert.ok(nonCompanySignup.errors.email?.includes('@snapsec.co'));

  const wrongTldSignup = validateAuthCredentials('signup', {
    name: 'Owais',
    email: 'owais@snapsec.com',
    password: 'Snapsec!2026',
  });
  assert.equal(wrongTldSignup.valid, false);
  assert.ok(wrongTldSignup.errors.email?.includes('@snapsec.co'));

  assert.equal(validateAuthCredentials('signup', { name: 'Owais', email: 'owais@snapsec.co', password: 'short' }).valid, false);
  assert.equal(validateAuthCredentials('signup', { name: 'Owais', email: 'owais@snapsec.co', password: 'Snapsec!2026' }).valid, true);

  assert.equal(validateAuthCredentials('reset', { password: 'Snapsec!2026', confirmPassword: 'mismatch' }).valid, false);
  assert.equal(validateAuthCredentials('reset', { password: 'Snapsec!2026', confirmPassword: 'Snapsec!2026' }).valid, true);
});

test('Express REST API endpoints work end-to-end across all domain resources and CRUD operations', async () => {
  process.env.NODE_ENV = 'test';
  const { createApp } = await import('./app.ts');
  const app = createApp();
  const server = await new Promise<any>(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. Reset to clean state & check health/bootstrap
    const resetRes = await fetch(`${base}/api/reset`, { method: 'POST' }).then(r => r.json());
    assert.equal(resetRes.ok, true);
    assert.equal(resetRes.data.ws.name, 'Snapsec');
    assert.equal(resetRes.prefs.name, 'Mohammad Owais');

    const health = await fetch(`${base}/api/health`).then(r => r.json());
    assert.equal(health.status, 'ok');
    assert.equal(health.metrics.workspaceName, 'Snapsec');

    // 2. Tasks CRUD: create, get, patch, duplicate, archive, restore, bulk, delete
    const createTaskRes = await fetch(`${base}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'API Security Audit', project: 'p1', priority: 'high' }),
    }).then(r => r.json());
    const tid = createTaskRes.task.id;
    assert.equal(createTaskRes.task.title, 'API Security Audit');

    const getTaskRes = await fetch(`${base}/api/tasks/${tid}`).then(r => r.json());
    assert.equal(getTaskRes.task.id, tid);

    // Subtasks CRUD: add, patch, promote, delete
    const subRes = await fetch(`${base}/api/tasks/${tid}/subtasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Check CORS headers' }),
    }).then(r => r.json());
    const sid = subRes.subtask.id;
    assert.equal(subRes.subtask.title, 'Check CORS headers');

    const patchSubRes = await fetch(`${base}/api/tasks/${tid}/subtasks/${sid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: true }),
    }).then(r => r.json());
    assert.equal(patchSubRes.subtask.done, true);

    const promoteSubRes = await fetch(`${base}/api/tasks/${tid}/subtasks/${sid}/promote`, {
      method: 'POST',
    }).then(r => r.json());
    assert.equal(promoteSubRes.task.title, 'Check CORS headers');

    // Comments & Reactions CRUD
    const cmtRes = await fetch(`${base}/api/tasks/${tid}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Reviewed by @Sarah Chen', by: 'm1' }),
    }).then(r => r.json());
    const cid = cmtRes.comment.id;
    assert.equal(cmtRes.comment.text, 'Reviewed by @Sarah Chen');

    const reactRes = await fetch(`${base}/api/comments/${cid}/reactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji: '🚀', by: 'm1' }),
    }).then(r => r.json());
    assert.deepEqual(reactRes.comment.re['🚀'], ['m1']);

    const delCmtRes = await fetch(`${base}/api/comments/${cid}`, { method: 'DELETE' }).then(r => r.json());
    assert.equal(delCmtRes.ok, true);

    // Task patch, duplicate, archive, restore, bulk, delete
    const patchTaskRes = await fetch(`${base}/api/tasks/${tid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    }).then(r => r.json());
    assert.equal(patchTaskRes.task.status, 'done');

    const dupTaskRes = await fetch(`${base}/api/tasks/${tid}/duplicate`, { method: 'POST' }).then(r => r.json());
    assert.ok(dupTaskRes.task.id);

    const archTaskRes = await fetch(`${base}/api/tasks/${tid}/archive`, { method: 'POST' }).then(r => r.json());
    assert.equal(archTaskRes.task.archived, true);

    const restTaskRes = await fetch(`${base}/api/tasks/${tid}/restore`, { method: 'POST' }).then(r => r.json());
    assert.equal(restTaskRes.task.archived, false);

    const bulkRes = await fetch(`${base}/api/tasks/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [tid, dupTaskRes.task.id], patch: { priority: 'urgent' } }),
    }).then(r => r.json());
    assert.equal(bulkRes.tasks.length, 2);

    const delTaskRes = await fetch(`${base}/api/tasks/${dupTaskRes.task.id}`, { method: 'DELETE' }).then(r => r.json());
    assert.equal(delTaskRes.ok, true);

    // 3. Projects CRUD: create, get, patch, duplicate, archive, restore, delete
    const projRes = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Zero Trust Rollout', tmpl: 'web' }),
    }).then(r => r.json());
    const pid = projRes.project.id;
    assert.equal(projRes.project.name, 'Zero Trust Rollout');

    const patchProjRes = await fetch(`${base}/api/projects/${pid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active', fav: true }),
    }).then(r => r.json());
    assert.equal(patchProjRes.project.status, 'active');

    const dupProjRes = await fetch(`${base}/api/projects/${pid}/duplicate`, { method: 'POST' }).then(r => r.json());
    assert.ok(dupProjRes.project.id);

    const archProjRes = await fetch(`${base}/api/projects/${dupProjRes.project.id}/archive`, { method: 'POST' }).then(r => r.json());
    assert.equal(archProjRes.project.archived, true);

    const restProjRes = await fetch(`${base}/api/projects/${dupProjRes.project.id}/restore`, { method: 'POST' }).then(r => r.json());
    assert.equal(restProjRes.project.archived, false);

    const delProjRes = await fetch(`${base}/api/projects/${dupProjRes.project.id}`, { method: 'DELETE' }).then(r => r.json());
    assert.equal(delProjRes.ok, true);

    // 4. Teams & Members CRUD
    const teamRes = await fetch(`${base}/api/teams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'SecOps', desc: 'Security Operations' }),
    }).then(r => r.json());
    const tmid = teamRes.team.id;
    assert.equal(teamRes.team.name, 'SecOps');

    const patchTeamRes = await fetch(`${base}/api/teams/${tmid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Cloud SecOps' }),
    }).then(r => r.json());
    assert.equal(patchTeamRes.team.name, 'Cloud SecOps');

    const invRes = await fetch(`${base}/api/members/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails: ['pentest@snapsec.com'], role: 'Member', team: tmid, project: pid }),
    }).then(r => r.json());
    const mid = invRes.invited[0].id;
    assert.equal(invRes.invited.length, 1);
    assert.ok(invRes.invited[0].inviteToken);
    assert.ok(invRes.invited[0].inviteUrl.includes('invite='));
    assert.ok(Array.isArray(invRes.outbox) && invRes.outbox.length >= 1);
    assert.equal(invRes.outbox[0].to, 'pentest@snapsec.com');

    // Resend invite & accept invite token
    const resendRes = await fetch(`${base}/api/members/${mid}/resend-invite`, {
      method: 'POST',
    }).then(r => r.json());
    assert.equal(resendRes.ok, true);
    assert.equal(resendRes.email.to, 'pentest@snapsec.com');

    const acceptRes = await fetch(`${base}/api/invites/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: invRes.invited[0].inviteToken }),
    }).then(r => r.json());
    assert.equal(acceptRes.ok, true);
    assert.equal(acceptRes.member.status, 'active');

    // Comment with attachments (and attachment-only comment)
    const cmtAttRes = await fetch(`${base}/api/tasks/${tid}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Attached proof of concept screenshot',
        by: 'm1',
        attachments: [
          {
            id: 'f-poc-1',
            name: 'poc-screenshot.png',
            type: 'img',
            size: '42 KB',
            dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            mime: 'image/png',
          },
        ],
      }),
    }).then(r => r.json());
    assert.ok(cmtAttRes.comment);
    assert.equal(cmtAttRes.comment.attachments.length, 1);
    assert.equal(cmtAttRes.comment.attachments[0].name, 'poc-screenshot.png');
    assert.ok(cmtAttRes.comment.attachments[0].dataUrl.startsWith('/api/files/object/'));
    assert.ok(cmtAttRes.comment.attachments[0].storageKey);
    assert.equal(cmtAttRes.comment.attachments[0].bucket, 'snapsec-attachments');

    const patchMemRes = await fetch(`${base}/api/members/${mid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'Admin' }),
    }).then(r => r.json());
    assert.equal(patchMemRes.member.role, 'Admin');

    const delMemRes = await fetch(`${base}/api/members/${mid}`, { method: 'DELETE' }).then(r => r.json());
    assert.equal(delMemRes.ok, true);

    const delTeamRes = await fetch(`${base}/api/teams/${tmid}`, { method: 'DELETE' }).then(r => r.json());
    assert.equal(delTeamRes.ok, true);

    // 5. Files CRUD
    const fileRes = await fetch(`${base}/api/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'pentest-report.pdf',
        size: '2.5 MB',
        project: pid,
        task: tid,
        textContent: 'Pentest Executive Summary',
      }),
    }).then(r => r.json());
    const fid = fileRes.file.id;
    assert.equal(fileRes.file.type, 'pdf');
    assert.equal(fileRes.file.textContent, 'Pentest Executive Summary');

    const renFileRes = await fetch(`${base}/api/files/${fid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'pentest-report-v2.pdf' }),
    }).then(r => r.json());
    assert.equal(renFileRes.file.name, 'pentest-report-v2.pdf');

    const dupFileRes = await fetch(`${base}/api/files/${fid}/duplicate`, { method: 'POST' }).then(r => r.json());
    assert.ok(dupFileRes.file.id);

    const delFileRes = await fetch(`${base}/api/files/${dupFileRes.file.id}`, { method: 'DELETE' }).then(r => r.json());
    assert.equal(delFileRes.ok, true);

    // 6. Saved Views, Notifications, Preferences, Workspace, Google Auth
    const viewRes = await fetch(`${base}/api/views`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: pid, name: 'Critical Bugs', type: 'board', filters: [] }),
    }).then(r => r.json());
    const vid = viewRes.view.id;
    assert.equal(viewRes.view.name, 'Critical Bugs');

    const renViewRes = await fetch(`${base}/api/views/${vid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'High Priority' }),
    }).then(r => r.json());
    assert.equal(renViewRes.view.name, 'High Priority');

    const delViewRes = await fetch(`${base}/api/views/${vid}`, { method: 'DELETE' }).then(r => r.json());
    assert.equal(delViewRes.ok, true);

    const googleAuthRes = await fetch(`${base}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: 'google-uid-owais',
        name: 'Mohammad Owais',
        email: 'mohammadowais616@gmail.com',
        photoURL: 'https://lh3.googleusercontent.com/a/owais=s96-c',
      }),
    }).then(r => r.json());
    assert.equal(googleAuthRes.ok, true);
    assert.equal(googleAuthRes.user.name, 'Mohammad Owais');
    assert.equal(googleAuthRes.user.email, 'mohammadowais616@gmail.com');
    assert.equal(googleAuthRes.prefs.name, 'Mohammad Owais');

    // Reset back to clean default state after test
    await fetch(`${base}/api/reset`, { method: 'POST' });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('Markdown engine renders GFM headings, bold/italic, code blocks, checklists, tables, @mentions, and task keys safely', () => {
  const sampleMd = [
    '# Security Review Summary',
    'Please check **critical** and *urgent* items with `npm audit` and ~~legacy~~ config.',
    '',
    '- [x] Patch authentication flow',
    '- [ ] Verify WEB-101 with @Sarah Chen',
    '',
    '> Zero-trust posture enforced',
    '',
    '```ts',
    'const ok = true;',
    '```',
    '',
    '| Service | Status |',
    '| :--- | :---: |',
    '| Auth | Ready |',
  ].join('\n');

  const html = renderMarkdown(sampleMd, {
    tasks: [{ id: 't1', key: 'WEB-101' }],
  });

  assert.ok(html.includes('<h1 class="md-h md-h1">Security Review Summary</h1>'));
  assert.ok(html.includes('<strong>critical</strong>'));
  assert.ok(html.includes('<em>urgent</em>'));
  assert.ok(html.includes('<code class="md-code">npm audit</code>'));
  assert.ok(html.includes('<del>legacy</del>'));
  assert.ok(html.includes('class="md-checklist"'));
  assert.ok(html.includes('class="md-cb md-box on"'));
  assert.ok(html.includes('data-a="openTask" data-id="t1"'));
  assert.ok(html.includes('<span class="mention">@Sarah Chen</span>'));
  assert.ok(html.includes('<blockquote class="md-quote">'));
  assert.ok(html.includes('class="md-codeblock"'));
  assert.ok(html.includes('<table class="md-table">'));

  // XSS protection
  const xss = renderMarkdown('<script>alert(1)</script> [bad](javascript:alert(1))');
  assert.ok(!xss.includes('<script>'));
  assert.ok(!xss.includes('href="javascript:'));

  // HTML to Markdown normalization
  assert.equal(normalizeHtmlToMarkdown('<p>Hello <strong>world</strong></p>'), 'Hello **world**');

  // Toolbar formatting helper
  const boldRes = applyMarkdownCommand('Hello world', 6, 11, 'bold');
  assert.equal(boldRes.value, 'Hello **world**');
});

test('Security Suite: XSS, SQLi/NoSQLi, Prototype Pollution, SSRF, Open Redirect, and Header Injection defenses', async () => {
  const {
    isSafeEmoji,
    isSafeSmtpTarget,
    safeCssColor,
    safeDownloadUrl,
    safeHref,
    safeImageSrc,
    safePdfSrc,
    sanitizeBaseUrl,
    sanitizeHeaderValue,
    stripDangerousKeys,
  } = await import('./utils/security.ts');

  // 1. Advanced XSS vectors in Markdown & HTML normalization
  const xssVectors = [
    '<script>window.__xss = 1;</script>',
    '<img src=x onerror="alert(1)">',
    '<svg onload="alert(1)">',
    '<iframe src="javascript:alert(1)"></iframe>',
    '[Click me](javascript:alert(document.cookie))',
    '[Click me](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    '![evil svg](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIj48L3N2Zz4=)',
    '<p><a href="javascript:alert(1)">Evil Link</a></p>',
    '**[xss](vbscript:msgbox(1))**',
    '![breakout](https://example.com/a.png"onload="alert(1))',
  ];
  for (const payload of xssVectors) {
    const rendered = renderMarkdown(payload);
    assert.ok(!rendered.includes('<script'), `Leaked <script in: ${rendered}`);
    assert.ok(!rendered.includes('<svg'), `Leaked <svg in: ${rendered}`);
    assert.ok(!rendered.includes('<iframe'), `Leaked <iframe in: ${rendered}`);
    assert.ok(!/<[^>]+on(?:error|load)\s*=/i.test(rendered), `Leaked event handler attribute in: ${rendered}`);
    assert.ok(!rendered.includes('href="javascript:'), `Leaked javascript: href in: ${rendered}`);
    assert.ok(!rendered.includes('src="javascript:'), `Leaked javascript: src in: ${rendered}`);
    assert.ok(!rendered.includes('src="data:text/html'), `Leaked data:text/html in: ${rendered}`);
    assert.ok(!rendered.includes('src="data:image/svg+xml'), `Leaked data:image/svg+xml in: ${rendered}`);
  }

  // 2. Safe URL & MIME validators
  assert.equal(safeImageSrc('javascript:alert(1)'), '');
  assert.equal(safeImageSrc('data:text/html,<script>alert(1)</script>'), '');
  assert.equal(safeImageSrc('data:image/svg+xml;base64,PHN2Zz4='), '');
  assert.ok(safeImageSrc('data:image/png;base64,iVBORw0KGgo='));
  assert.ok(safeImageSrc('https://suite.snapsec.co/media/logos/snapsec.svg'));

  assert.equal(safePdfSrc('javascript:alert(1)'), '');
  assert.equal(safePdfSrc('data:text/html;base64,PHNjcmlwdD4='), '');
  assert.ok(safePdfSrc('data:application/pdf;base64,JVBERi0xLjQK'));

  assert.equal(safeDownloadUrl('javascript:alert(1)'), '');
  assert.equal(safeDownloadUrl('data:text/html;base64,PHNjcmlwdD4='), '');
  assert.equal(safeDownloadUrl('data:image/svg+xml;base64,PHN2Zz4='), '');
  assert.ok(safeDownloadUrl('data:application/pdf;base64,JVBERi0xLjQK'));

  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref('data:text/html,<script>'), '');
  assert.equal(safeHref('//evil.com/phish'), '');
  assert.equal(safeHref('https://snapsec.co/docs'), 'https://snapsec.co/docs');

  assert.equal(safeCssColor('red; background:url(javascript:alert(1))', '#000'), '#000');
  assert.equal(safeCssColor('#5A67D8'), '#5A67D8');

  // 3. Prototype Pollution & NoSQL Operator Stripping
  const maliciousPayload = JSON.parse(
    '{"title":"Safe","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"$where":"this.a == 1","nested":{"__proto__":{"bad":1}}}',
  );
  const cleaned = stripDangerousKeys(maliciousPayload);
  assert.equal(({} as any).polluted, undefined);
  assert.equal((cleaned as any).$where, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(cleaned, '__proto__'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(cleaned, 'constructor'), false);

  const { data } = createDefaultState();
  const task = createTaskRecord(data, maliciousPayload);
  applyTaskPatch(data, task.id, JSON.parse('{"__proto__":{"isAdmin":true},"unallowedInternalField":"hacked"}'));
  assert.equal(({} as any).isAdmin, undefined);
  assert.equal((task as any).unallowedInternalField, undefined);

  // 4. SQLi & NoSQLi filter resilience
  const sqliResults = filterTasks(data, {
    project: { $ne: 'p1' } as any,
    status: ['todo', 'done'] as any,
    q: "' OR '1'='1' -- DROP TABLE tasks;",
  });
  assert.equal(sqliResults.length, 0);

  // 5. Reaction Emoji XSS validation
  const cmt = addCommentRecord(data, 't1', 'Security test comment', 'm1');
  assert.ok(cmt);
  const badReaction = toggleCommentReaction(data, cmt.id, '<img src=x onerror=alert(1)>', 'm1');
  assert.equal(badReaction, null);
  assert.equal(isSafeEmoji('<script>'), false);
  assert.equal(isSafeEmoji('🔥'), true);

  // 6. SSRF Target Validation for SMTP
  assert.equal(isSafeSmtpTarget('127.0.0.1', 465).ok, false);
  assert.equal(isSafeSmtpTarget('localhost', 587).ok, false);
  assert.equal(isSafeSmtpTarget('169.254.169.254', 465).ok, false);
  assert.equal(isSafeSmtpTarget('metadata.google.internal', 465).ok, false);
  assert.equal(isSafeSmtpTarget('10.0.0.1', 465).ok, false);
  assert.equal(isSafeSmtpTarget('192.168.1.1', 465).ok, false);
  assert.equal(isSafeSmtpTarget('172.16.0.5', 465).ok, false);
  assert.equal(isSafeSmtpTarget('smtp.gmail.com', 22).ok, false);
  assert.equal(isSafeSmtpTarget('smtp.gmail.com', 6379).ok, false);
  assert.equal(isSafeSmtpTarget('smtp.gmail.com', 465).ok, true);

  // 7. CRLF Header Injection & Open Redirect baseUrl sanitization
  assert.equal(sanitizeHeaderValue('user@snapsec.com\r\nBcc: attacker@evil.com'), 'user@snapsec.com Bcc: attacker@evil.com');
  assert.equal(sanitizeBaseUrl('javascript:alert(1)', 'http://localhost:3000'), 'http://localhost:3000');
  assert.equal(sanitizeBaseUrl('https://user:pass@evil.com/path', 'http://localhost:3000'), 'http://localhost:3000');
  assert.equal(sanitizeBaseUrl('https://suite.snapsec.co/subpath?foo=1', 'http://localhost:3000'), 'https://suite.snapsec.co');

  // 8. End-to-End HTTP Security Headers & Endpoint Penetration Tests
  process.env.NODE_ENV = 'test';
  const { createApp } = await import('./app.ts');
  const app = createApp();
  const server = await new Promise<any>(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const healthResp = await fetch(`${base}/api/health`);
    assert.equal(healthResp.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(healthResp.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.ok(healthResp.headers.get('content-security-policy')?.includes("default-src 'self'"));
    assert.ok(healthResp.headers.get('content-security-policy')?.includes("object-src 'none'"));
    assert.equal(healthResp.headers.get('x-powered-by'), null);

    // SSRF attempt on /api/settings/smtp must return 400
    const ssrfRes = await fetch(`${base}/api/settings/smtp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: '169.254.169.254', port: 80, user: 'root', pass: 'secret' }),
    });
    assert.equal(ssrfRes.status, 400);

    // Malicious XSS reaction via API must return 404/rejected
    const xssReactRes = await fetch(`${base}/api/comments/c1/reactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji: '<svg onload=alert(1)>' }),
    });
    assert.equal(xssReactRes.status, 404);

    // Malicious file upload with javascript: dataUrl must strip dataUrl to null
    const badFileRes = await fetch(`${base}/api/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'exploit.pdf',
        type: 'pdf',
        project: 'p1',
        dataUrl: 'javascript:alert(document.domain)',
      }),
    }).then(r => r.json());
    assert.equal(badFileRes.file.dataUrl, null);
    await fetch(`${base}/api/files/${badFileRes.file.id}`, { method: 'DELETE' });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('Modular Backend (Port 5000), Frontend (Port 4000, Nginx Reverse Proxy), PostgreSQL Database & Zero Firebase', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = process.cwd();

  // 1. Verify /backend folder structure, package.json, Dockerfile (port 5000), and modular source tree
  const backendPkg = JSON.parse(fs.readFileSync(path.join(root, 'backend/package.json'), 'utf8'));
  assert.equal(backendPkg.name, 'snapsec-tasktracker-backend');
  assert.ok(backendPkg.dependencies.express);
  assert.ok(backendPkg.dependencies['drizzle-orm']);
  assert.ok(backendPkg.dependencies.pg);
  assert.equal(backendPkg.dependencies.firebase, undefined);

  const backendDockerfile = fs.readFileSync(path.join(root, 'backend/Dockerfile'), 'utf8');
  assert.ok(backendDockerfile.includes('FROM node:22-alpine'));
  assert.ok(backendDockerfile.includes('RUN npm install --force'));
  assert.ok(backendDockerfile.includes('PORT=5000'));
  assert.ok(backendDockerfile.includes('EXPOSE 5000'));
  assert.ok(backendDockerfile.includes('http://localhost:5000/api/health'));

  const modularBackendFiles = [
    'backend/src/app.ts',
    'backend/src/server.ts',
    'backend/src/config/env.ts',
    'backend/src/config/mime.ts',
    'backend/src/middleware/security.ts',
    'backend/src/middleware/rateLimit.ts',
    'backend/src/db/index.ts',
    'backend/src/db/schema.ts',
    'backend/src/db/repository.ts',
    'backend/src/services/engine.ts',
    'backend/src/services/mailer.ts',
    'backend/src/routes/index.ts',
    'backend/src/routes/health.routes.ts',
    'backend/src/routes/tasks.routes.ts',
    'backend/src/routes/comments.routes.ts',
    'backend/src/routes/projects.routes.ts',
    'backend/src/routes/teams.routes.ts',
    'backend/src/routes/members.routes.ts',
    'backend/src/routes/files.routes.ts',
    'backend/src/routes/workspace.routes.ts',
    'backend/src/routes/auth.routes.ts',
  ];
  for (const relPath of modularBackendFiles) {
    assert.ok(fs.existsSync(path.join(root, relPath)), `Missing modular backend file: ${relPath}`);
  }

  // 2. Verify /frontend folder structure, package.json, Dockerfile (port 4000, Nginx server), and nginx.conf
  const frontendPkg = JSON.parse(fs.readFileSync(path.join(root, 'frontend/package.json'), 'utf8'));
  assert.equal(frontendPkg.name, 'snapsec-tasktracker-frontend');
  assert.equal(frontendPkg.dependencies.firebase, undefined);

  const frontendDockerfile = fs.readFileSync(path.join(root, 'frontend/Dockerfile'), 'utf8');
  assert.ok(frontendDockerfile.includes('FROM node:22-alpine AS builder'));
  assert.ok(frontendDockerfile.includes('RUN npm install --force'));
  assert.ok(frontendDockerfile.includes('RUN npm run build'));
  assert.ok(frontendDockerfile.includes('FROM nginx:1.27-alpine AS runner'));
  assert.ok(frontendDockerfile.includes('EXPOSE 4000'));

  const frontendNginxConf = fs.readFileSync(path.join(root, 'frontend/nginx.conf'), 'utf8');
  assert.ok(frontendNginxConf.includes('listen 4000;'));
  assert.ok(frontendNginxConf.includes('application/javascript') || frontendNginxConf.includes('text/javascript'));
  assert.ok(frontendNginxConf.includes('proxy_pass http://backend:5000/api/;'));

  // 3. Verify root docker-compose.yaml (PostgreSQL + MinIO + persistent backend volume) & .env.example
  const composePath = fs.existsSync(path.join(root, 'docker-compose.yaml')) ? path.join(root, 'docker-compose.yaml') : path.join(root, 'docker-compose.yml');
  assert.ok(fs.existsSync(composePath), 'Missing docker-compose.yaml or docker-compose.yml');
  const composeFile = fs.readFileSync(composePath, 'utf8');
  assert.ok(composeFile.includes('image: postgres:16-alpine'));
  assert.ok(composeFile.includes('image: minio/minio:latest'));
  assert.ok(composeFile.includes('snapsec_pgdata:/var/lib/postgresql/data'));
  assert.ok(composeFile.includes('snapsec_miniodata:/data'));
  assert.ok(composeFile.includes('snapsec_backend_data:/app/data'));
  assert.ok(composeFile.includes('context: ./backend'));
  assert.ok(composeFile.includes('context: ./frontend'));
  assert.ok(composeFile.includes('5000}:5000"') || composeFile.includes('"5000:5000"'));
  assert.ok(composeFile.includes('4000}:4000"') || composeFile.includes('"4000:4000"'));
  assert.equal(backendPkg.dependencies['better-sqlite3'], undefined, 'better-sqlite3 must not be in backend/package.json');

  const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  assert.ok(envExample.includes('FRONTEND_PORT=4000'));
  assert.ok(envExample.includes('BACKEND_PORT=5000'));
  assert.ok(envExample.includes('PGHOST=db'));
  assert.ok(envExample.includes('PGDATABASE=snapsec_tasktracker'));
  assert.ok(envExample.includes('MINIO_ENDPOINT=minio'));
  assert.ok(envExample.includes('MINIO_BUCKET=snapsec-attachments'));
  assert.ok(!envExample.includes('SQLITE_DB_PATH'), 'SQLite env vars must be removed from .env.example');

  // 4. Verify firebase is removed
  assert.equal(fs.existsSync(path.join(root, 'src')), false, 'Root src/ folder must not exist');
  assert.equal(fs.existsSync(path.join(root, 'firebase-applet-config.json')), false);
  assert.equal(fs.existsSync(path.join(root, 'firestore.rules')), false);
  assert.equal(fs.existsSync(path.join(root, 'firebase-blueprint.json')), false);

  // 5. Verify production dist/ bundle exists and serves .js, .css, .svg, and .html with exact Content-Type headers
  const distPath = path.join(root, 'dist');
  if (fs.existsSync(path.join(distPath, 'index.html'))) {
    const { createApp, mountCompiledDist } = await import('./app.ts');
    const app = createApp();
    mountCompiledDist(app, distPath);
    const server = await new Promise<any>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const htmlRes = await fetch(`${base}/`);
      assert.equal(htmlRes.status, 200);
      assert.ok(htmlRes.headers.get('content-type')?.includes('text/html'));

      // Check stale/hashed .js fallback returns text/javascript (never text/html)
      const jsRes = await fetch(`${base}/assets/index-stale-hash.js`);
      assert.equal(jsRes.status, 200);
      assert.ok(
        jsRes.headers.get('content-type')?.includes('text/javascript'),
        `Expected text/javascript for .js bundle, got: ${jsRes.headers.get('content-type')}`,
      );

      // Check stale/hashed .css fallback returns text/css
      const cssRes = await fetch(`${base}/assets/index-stale-hash.css`);
      assert.equal(cssRes.status, 200);
      assert.ok(
        cssRes.headers.get('content-type')?.includes('text/css'),
        `Expected text/css for .css bundle, got: ${cssRes.headers.get('content-type')}`,
      );

      // Check missing top-level .js returns 404 (never text/html)
      const missingJsRes = await fetch(`${base}/missing-module.js`);
      assert.equal(missingJsRes.status, 404);
      assert.ok(!missingJsRes.headers.get('content-type')?.includes('text/html'));
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }
});

test('PostgreSQL Relational Database Engine: B-tree Indexes, ACID Transactions, Persistent Volume Store, and Indexed SQL Queries (Zero SQLite)', async () => {
  const fs = await import('node:fs');
  const { getPgConnection, PG_VOLUME_STORE_FILE, POSTGRES_SCHEMA_DDL } = await import('./db/index.ts');
  const {
    insertTaskSql,
    queryTaskByIdSql,
    queryTasksSql,
    queryWorkspaceMetrics,
    patchTaskSql,
    deleteTasksSql,
  } = await import('./db/repository.ts');

  const conn = getPgConnection();

  // 1. Verify PostgreSQL DDL defines all 13 tables and DOUBLE PRECISION timestamps
  assert.ok(POSTGRES_SCHEMA_DDL.includes('CREATE TABLE IF NOT EXISTS workspaces'));
  assert.ok(POSTGRES_SCHEMA_DDL.includes('CREATE TABLE IF NOT EXISTS tasks'));
  assert.ok(POSTGRES_SCHEMA_DDL.includes('CREATE TABLE IF NOT EXISTS files'));
  assert.ok(POSTGRES_SCHEMA_DDL.includes('storage_key TEXT'));
  assert.ok(POSTGRES_SCHEMA_DDL.includes('bucket TEXT'));

  // 2. Verify B-tree indexes exist on normalized PostgreSQL tables
  const indexes = conn
    .prepare("SELECT indexname AS name, tablename AS tbl_name FROM pg_indexes WHERE indexname LIKE 'idx_pg_%'")
    .all() as Array<{ name: string; tbl_name: string }>;
  const indexNames = new Set(indexes.map(i => i.name));
  assert.ok(indexNames.has('idx_pg_tasks_proj_arch_order'), 'Missing B-tree index idx_pg_tasks_proj_arch_order');
  assert.ok(indexNames.has('idx_pg_tasks_status'), 'Missing B-tree index idx_pg_tasks_status');
  assert.ok(indexNames.has('idx_pg_tasks_assignee'), 'Missing B-tree index idx_pg_tasks_assignee');
  assert.ok(indexNames.has('idx_pg_tasks_priority'), 'Missing B-tree index idx_pg_tasks_priority');
  assert.ok(indexNames.has('idx_pg_tasks_due'), 'Missing B-tree index idx_pg_tasks_due');
  assert.ok(indexNames.has('idx_pg_subtasks_task'), 'Missing B-tree index idx_pg_subtasks_task');
  assert.ok(indexNames.has('idx_pg_comments_task'), 'Missing B-tree index idx_pg_comments_task');
  assert.ok(indexNames.has('idx_pg_files_project_type'), 'Missing B-tree index idx_pg_files_project_type');

  // 3. Verify EXPLAIN uses B-tree index scan on indexed columns
  const planRows = conn
    .prepare("EXPLAIN SELECT * FROM tasks WHERE project_id = 'p1' AND archived = 0 ORDER BY sort_order ASC")
    .all() as Array<{ detail: string }>;
  const planDetail = planRows.map(r => r.detail).join(' ');
  assert.ok(
    planDetail.includes('idx_pg_tasks_proj_arch_order') || planDetail.includes('Index Scan'),
    `Expected B-tree index usage in query plan, got: ${planDetail}`,
  );

  // 4. Verify row-level PostgreSQL CRUD, persistent volume snapshot, and indexed filtering
  const createdRes = insertTaskSql({
    title: 'Verify ACID PostgreSQL Transaction & B-Tree Index',
    project: 'p1',
    status: 'progress',
    priority: 'urgent',
    assignee: 'm1',
    due: '2026-12-01',
    subtasks: [{ id: 's-sql-1', title: 'Confirm PostgreSQL persistence', done: true }],
  });
  const created = createdRes.task;
  assert.ok(created.id);
  assert.equal(created.subtasks.length, 1);
  assert.ok(fs.existsSync(PG_VOLUME_STORE_FILE), 'Volume snapshot file must be persisted on disk');

  const fetched = queryTaskByIdSql(created.id);
  assert.ok(fetched);
  assert.equal(fetched.title, 'Verify ACID PostgreSQL Transaction & B-Tree Index');
  assert.equal(fetched.subtasks[0].done, true);

  const filtered = queryTasksSql({ project: 'p1', status: 'progress', priority: 'urgent', q: 'ACID PostgreSQL' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, created.id);

  // Patch via ACID transaction and verify SQL aggregation metrics
  const patched = patchTaskSql(created.id, { status: 'done' });
  assert.ok(patched);
  assert.equal(patched.task.status, 'done');

  const metrics = queryWorkspaceMetrics();
  assert.equal(metrics.workspaceName, 'Snapsec');
  assert.ok(metrics.completedTasks >= 1);

  // Cleanup test row
  const delRes = deleteTasksSql([created.id]);
  assert.equal(delRes.deleted, 1);
  assert.equal(queryTaskByIdSql(created.id), null);
});

test('Frontend & Backend Auth Guard: puts all workspace pages behind auth check, validates JWT expiration, and redirects unauthenticated/expired users to login', async () => {
  const { generateAuthToken, verifyAuthToken } = await import('./services/token.ts');
  const { PUBLIC_AUTH_ROUTES, isPublicAuthRoute, isTokenValid } = await import('../../frontend/src/core/auth.js');

  // 1. Verify Public vs Protected routes
  const publicRoutes = ['login', 'signup', 'forgot', 'forgot-sent', 'reset', 'reset-done', 'verify', 'onboarding'];
  for (const r of publicRoutes) {
    assert.equal(PUBLIC_AUTH_ROUTES.has(r), true, `Route '${r}' should be public in PUBLIC_AUTH_ROUTES`);
    assert.equal(isPublicAuthRoute(r), true, `isPublicAuthRoute('${r}') should return true`);
    assert.equal(isPublicAuthRoute(`#${r}`), true, `isPublicAuthRoute('#${r}') should return true`);
  }

  const protectedWorkspaceRoutes = [
    'home',
    'inbox',
    'mytasks',
    'favorites',
    'notifications',
    'search',
    'overview',
    'projects',
    'project',
    'tasks',
    'calendar',
    'timeline',
    'members',
    'member',
    'teams',
    'team',
    'activity',
    'settings',
    'system',
    'states',
    'archive',
  ];
  for (const r of protectedWorkspaceRoutes) {
    assert.equal(PUBLIC_AUTH_ROUTES.has(r), false, `Workspace route '${r}' MUST NOT be public`);
    assert.equal(isPublicAuthRoute(r), false, `isPublicAuthRoute('${r}') MUST return false for protected page`);
  }

  // 2. Verify Token Generation & Expiration Checking
  const validUser = { id: 'm1', email: 'mohammadowais616@gmail.com', name: 'Mohammad Owais' };
  const { token: validToken, expiresAt } = generateAuthToken(validUser, true);
  assert.ok(validToken && typeof validToken === 'string');
  assert.ok(expiresAt > Date.now());

  // Client validation of valid token
  assert.equal(isTokenValid(validToken), true, 'Valid JWT should pass client isTokenValid');

  // Server validation of valid token
  const serverVerify = verifyAuthToken(validToken);
  assert.equal(serverVerify.valid, true);
  assert.equal(serverVerify.payload?.email, 'mohammadowais616@gmail.com');

  // Client and server validation of expired token
  const expiredPayload = {
    email: 'mohammadowais616@gmail.com',
    name: 'Mohammad Owais',
    sub: 'm1',
    iat: Math.floor(Date.now() / 1000) - 7200,
    exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
  };
  const crypto = await import('node:crypto');
  const hB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const pB64 = Buffer.from(JSON.stringify(expiredPayload)).toString('base64url');
  const secret = process.env.JWT_SECRET || 'snapsec_super_secret_jwt_key_2026_production';
  const sig = crypto.createHmac('sha256', secret).update(`${hB64}.${pB64}`).digest('base64url');
  const expiredToken = `${hB64}.${pB64}.${sig}`;

  assert.equal(isTokenValid(expiredToken), false, 'Expired token MUST fail client isTokenValid');
  const serverExpiredVerify = verifyAuthToken(expiredToken);
  assert.equal(serverExpiredVerify.valid, false);
  assert.equal(serverExpiredVerify.reason, 'Token has expired');

  // Tampered token check
  const tamperedToken = `${hB64}.${pB64}.invalidsignature123`;
  assert.equal(verifyAuthToken(tamperedToken).valid, false);

  // 3. Verify Express REST Auth & /api/auth/me session check endpoint
  process.env.NODE_ENV = 'test';
  const { createApp } = await import('./app.ts');
  const app = createApp();
  const server = await new Promise<any>(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // Unauthenticated request to /api/auth/me -> 401
    const unauthRes = await fetch(`${base}/api/auth/me`);
    assert.equal(unauthRes.status, 401);
    const unauthData = await unauthRes.json();
    assert.ok(unauthData.error);

    // Request with expired token to /api/auth/me -> 401
    const expiredRes = await fetch(`${base}/api/auth/me`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    assert.equal(expiredRes.status, 401);

    // Authenticated request to /api/auth/me with valid Bearer token -> 200
    const authRes = await fetch(`${base}/api/auth/me`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    assert.equal(authRes.status, 200);
    const authData = await authRes.json();
    assert.equal(authData.ok, true);
    assert.equal(authData.user.email, 'mohammadowais616@gmail.com');

    // Login endpoint issues token and expiration
    const loginRes = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'mohammadowais616@gmail.com', password: 'AnyPassword123!' }),
    });
    assert.equal(loginRes.status, 200);
    const loginData = await loginRes.json();
    assert.ok(loginData.token, 'Login response must provide signed JWT token');
    assert.ok(loginData.expiresAt > Date.now(), 'Login response must provide future expiresAt timestamp');
    assert.equal(isTokenValid(loginData.token), true, 'Returned login token must pass client validation');
  } finally {
    server.close();
  }
});

test('SMTP configuration resolution and mailer utilization for verification & password reset links', async () => {
  const { getActiveSmtpConfig, dispatchOutboxEmail } = await import('./services/mailer.ts');
  const {
    saveSmtpConfigSql,
    getSmtpConfigSql,
    signupUserSql,
    verifyEmailTokenSql,
    resendVerificationEmailSql,
    getOutboxEmailsSql,
  } = await import('./db/repository.ts');
  const { createApp } = await import('./app.ts');

  // 1. Verify getActiveSmtpConfig priority: env vars vs database
  const originalEnv = { ...process.env };
  try {
    // Test env var resolution
    process.env.SMTP_HOST = 'smtp.testdomain.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'notifications@testdomain.com';
    process.env.SMTP_PASS = 'secret_pass_123';
    process.env.SMTP_FROM = 'Snapsec Security <noreply@testdomain.com>';

    const envSmtp = getActiveSmtpConfig();
    assert.equal(envSmtp.host, 'smtp.testdomain.com');
    assert.equal(envSmtp.port, 587);
    assert.equal(envSmtp.user, 'notifications@testdomain.com');
    assert.equal(envSmtp.from, 'Snapsec Security <noreply@testdomain.com>');
    assert.equal(envSmtp.configured, true);

    // Test database persistence overrides or supplements env
    saveSmtpConfigSql({
      host: 'mail.custom-relay.org',
      port: 465,
      user: 'ops@custom-relay.org',
      pass: 'custom_pass_456',
      from: 'Custom Relay <ops@custom-relay.org>',
    });

    const dbSmtp = getActiveSmtpConfig();
    assert.equal(dbSmtp.host, 'mail.custom-relay.org');
    assert.equal(dbSmtp.port, 465);
    assert.equal(dbSmtp.user, 'ops@custom-relay.org');
    assert.equal(dbSmtp.configured, true);
  } finally {
    process.env = originalEnv;
  }

  // 2. Test signup rejects non-@snapsec.co emails and accepts @snapsec.co emails
  const rejectedSignup = signupUserSql({
    name: 'External User',
    email: `external-${Date.now()}@gmail.com`,
    password: 'ValidPassword123!',
    baseUrl: 'https://todo.snapsec.co',
  });
  assert.equal(rejectedSignup.ok, false);
  assert.ok(rejectedSignup.error?.includes('@snapsec.co'));

  const uniqueEmail = `qa-verify-${Date.now()}@snapsec.co`;
  const signupResult = signupUserSql({
    name: 'Verification QA User',
    email: uniqueEmail,
    password: 'ValidPassword123!',
    baseUrl: 'https://todo.snapsec.co',
  });
  assert.equal(signupResult.ok, true);
  assert.ok(signupResult.verifyToken, 'Signup MUST generate a verifyToken');
  assert.ok(signupResult.verifyUrl, 'Signup MUST generate a verifyUrl');
  assert.ok(
    signupResult.verifyUrl.includes(`?verify=${encodeURIComponent(signupResult.verifyToken!)}`),
    'Verification URL must include verify query parameter with token',
  );
  assert.ok(
    signupResult.verifyUrl.includes(`email=${encodeURIComponent(uniqueEmail)}`),
    'Verification URL must include recipient email',
  );
  assert.ok(signupResult.outboxItem, 'Signup MUST generate an outbox email record');
  assert.ok(
    (signupResult.outboxItem.html || '').includes(signupResult.verifyUrl) ||
      (signupResult.outboxItem.text || '').includes(signupResult.verifyUrl),
    'Email body must contain the verification link',
  );

  // 3. Test verification via verifyEmailTokenSql
  const verifyRes = verifyEmailTokenSql({
    token: signupResult.verifyToken,
    email: uniqueEmail,
  });
  assert.equal(verifyRes.ok, true);
  assert.equal(verifyRes.member?.emailVerified, true, 'User emailVerified must be true after verification');

  // Invalid verification token check
  const invalidVerify = verifyEmailTokenSql({
    token: 'invalid-non-existent-token',
    email: uniqueEmail,
  });
  assert.equal(invalidVerify.ok, false);

  // 4. Test Resend Verification Email generates fresh token and outbox record
  const resendResult = resendVerificationEmailSql(uniqueEmail, 'https://todo.snapsec.co');
  assert.equal(resendResult.ok, true);
  assert.ok(resendResult.verifyToken, 'Resend MUST generate a fresh verifyToken');
  assert.ok(resendResult.verifyUrl, 'Resend MUST generate a verifyUrl');
  assert.ok(resendResult.outboxItem, 'Resend MUST create an outbox email record');
  assert.equal(resendResult.outboxItem.to, uniqueEmail);

  // 5. Test Express REST API endpoints for Signup, Resend Verification, and Verify Email
  const app = createApp();
  const server = await new Promise<any>(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // Reject non-@snapsec.co email at API level
    const badDomainReq = await fetch(`${base}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'External User',
        email: `external-${Date.now()}@othercompany.com`,
        password: 'SecurePassword123!',
      }),
    });
    assert.equal(badDomainReq.status, 400);
    const badDomainData = await badDomainReq.json();
    assert.ok(badDomainData.errors?.email?.includes('@snapsec.co'));

    const apiTestEmail = `api-verify-${Date.now()}@snapsec.co`;

    // A. POST /api/auth/signup
    const signupReq = await fetch(`${base}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'API Verify Test',
        email: apiTestEmail,
        password: 'SecurePassword123!',
      }),
    });
    assert.equal(signupReq.status, 201);
    const signupData = await signupReq.json();
    assert.equal(signupData.ok, true);
    assert.ok(signupData.verifyToken, 'API signup must return verifyToken');
    assert.ok(signupData.verifyUrl, 'API signup must return verifyUrl');

    // B. POST /api/auth/resend-verification
    const resendReq = await fetch(`${base}/api/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: apiTestEmail }),
    });
    assert.equal(resendReq.status, 200);
    const resendData = await resendReq.json();
    assert.equal(resendData.ok, true);
    assert.ok(resendData.verifyUrl, 'Resend API must return verifyUrl');

    // C. POST /api/auth/verify
    const verifyReq = await fetch(`${base}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: resendData.verifyToken,
        email: apiTestEmail,
      }),
    });
    assert.equal(verifyReq.status, 200);
    const verifyData = await verifyReq.json();
    assert.equal(verifyData.ok, true);
    assert.equal(verifyData.member.emailVerified, true);

    // D. POST /api/auth/forgot initiates password reset email
    const forgotReq = await fetch(`${base}/api/auth/forgot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: apiTestEmail }),
    });
    assert.equal(forgotReq.status, 200);
    const forgotData = await forgotReq.json();
    assert.equal(forgotData.ok, true);
    assert.ok(forgotData.resetToken, 'Forgot API must issue resetToken');
    assert.ok(forgotData.resetUrl, 'Forgot API must issue resetUrl');
    assert.ok(forgotData.resetUrl.includes('#reset'), 'Reset URL must include #reset hash');

    // Check outbox emails contain the forgot password item
    const outbox = getOutboxEmailsSql();
    const forgotEmail = outbox.find(item => item.to === apiTestEmail && item.subject.includes('Reset'));
    assert.ok(forgotEmail, 'Outbox must contain password reset email for user');

    // E. Seed account shoaib@snapsec.co is ALWAYS present and can log in with default password
    const seedLoginReq = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'shoaib@snapsec.co', password: 'Snapsec@123' }),
    });
    assert.equal(seedLoginReq.status, 200, 'Seed account shoaib@snapsec.co must log in with default password');
    const seedLoginData = await seedLoginReq.json();
    assert.equal(seedLoginData.ok, true);
    assert.ok(seedLoginData.token, 'Seed account login must issue JWT token');
    assert.equal(seedLoginData.user.email, 'shoaib@snapsec.co');

    // F. Unregistered account login fails with 401 and tells user to sign up
    const unknownLoginReq = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `unregistered-${Date.now()}@snapsec.co`, password: 'Snapsec@123' }),
    });
    assert.equal(unknownLoginReq.status, 401);
    const unknownLoginData = await unknownLoginReq.json();
    assert.equal(unknownLoginData.ok, false);
    assert.equal(unknownLoginData.code, 'USER_NOT_FOUND');
    assert.ok(
      unknownLoginData.error.toLowerCase().includes('sign up'),
      'Unregistered login error must tell user to sign up',
    );

    // G. Verify OTP is a 6-digit number and verifying OTP issues an authenticated session token
    assert.match(resendData.verifyToken, /^\d{6}$/, 'OTP code must be 6 digits');
    assert.ok(verifyData.token, 'Verifying OTP must log the user in by returning a session token');

    // H. Verify frontend auth.js does NOT contain any OTP bypass button
    const fs = await import('node:fs');
    const authJsSource = fs.readFileSync(new URL('../../frontend/src/pages/auth.js', import.meta.url), 'utf8');
    assert.ok(
      !authJsSource.includes('data-a="verified"'),
      'auth.js must NOT contain a button that bypasses OTP verification',
    );
    assert.ok(
      authJsSource.includes('data-a="doVerifyOtp"'),
      'auth.js must contain the OTP verification submit button',
    );

    // I. Custom Workspace Statuses CRUD & Persistence + Inline Task Description Screenshot Images
    const customStatuses = [
      { id: 'backlog', name: 'Backlog', c: '#9CA3AF', kind: 'backlog' },
      { id: 'todo', name: 'To Do', c: '#6B7280', kind: 'todo' },
      { id: 'progress', name: 'In Progress', c: '#F59E0B', kind: 'progress' },
      { id: 'qa_testing', name: 'QA Testing', c: '#8B5CF6', kind: 'review' },
      { id: 'done', name: 'Shipped', c: '#10B981', kind: 'done' },
    ];
    const wsPatchRes = await fetch(`${base}/api/workspace`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statuses: customStatuses }),
    }).then(r => r.json());
    assert.equal(wsPatchRes.ok, true);
    assert.equal(wsPatchRes.statuses.length, 5);
    assert.equal(wsPatchRes.statuses[3].id, 'qa_testing');
    assert.equal(wsPatchRes.statuses[3].name, 'QA Testing');
    assert.equal(wsPatchRes.statuses[4].name, 'Shipped');

    const samplePngDataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const inlineDesc = `Steps to reproduce:\n\n![bug-screenshot.png](${samplePngDataUrl})\n\nVerified on staging.`;

    const customTaskRes = await fetch(`${base}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Verify custom status & inline screenshot in description',
        project: 'p1',
        status: 'qa_testing',
        desc: inlineDesc,
      }),
    }).then(r => r.json());
    assert.equal(customTaskRes.ok, true);
    assert.equal(customTaskRes.task.status, 'qa_testing');
    assert.ok(
      customTaskRes.task.desc.includes('![bug-screenshot.png](/api/files/object/'),
      'Inline base64 screenshot in task description must be stored in MinIO and rewritten to /api/files/object/...',
    );

    // Extract MinIO object URL and verify GET /api/files/object/... streams the image bytes
    const matchUrl = customTaskRes.task.desc.match(/!\[bug-screenshot\.png\]\((\/api\/files\/object\/[^)]+)\)/);
    assert.ok(matchUrl && matchUrl[1], 'Must extract MinIO object URL from description');
    const minioObjRes = await fetch(`${base}${matchUrl[1]}`);
    assert.equal(minioObjRes.status, 200);
    assert.equal(minioObjRes.headers.get('content-type'), 'image/png');

    // Verify renderMarkdown renders the inline MinIO screenshot as an <img> inside the description
    const renderedDescHtml = renderMarkdown(customTaskRes.task.desc);
    assert.ok(
      renderedDescHtml.includes(`<img class="md-img" src="${matchUrl[1]}" alt="bug-screenshot.png" loading="lazy">`),
      'Inline MinIO screenshot in task description must render as <img class="md-img">',
    );

    // Verify direct POST /api/files/minio-upload endpoint
    const directUploadRes = await fetch(`${base}/api/files/minio-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'architecture-diagram.png',
        dataUrl: samplePngDataUrl,
        mime: 'image/png',
      }),
    }).then(r => r.json());
    assert.equal(directUploadRes.ok, true);
    assert.ok(directUploadRes.url.startsWith('/api/files/object/'));
    assert.ok(directUploadRes.storageKey);
    assert.equal(directUploadRes.bucket, 'snapsec-attachments');

    // Verify bootstrap returns the persisted custom statuses
    const bootRes = await fetch(`${base}/api/bootstrap`).then(r => r.json());
    assert.ok(Array.isArray(bootRes.data.statuses));
    assert.ok(bootRes.data.statuses.some((s: any) => s.id === 'qa_testing' && s.name === 'QA Testing'));

    // Cleanup test task and restore default statuses
    await fetch(`${base}/api/tasks/${customTaskRes.task.id}`, { method: 'DELETE' });
    await fetch(`${base}/api/reset`, { method: 'POST' });
  } finally {
    server.close();
  }
});




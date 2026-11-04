import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMarkdownCommand, normalizeHtmlToMarkdown, renderMarkdown } from '../core/markdown.ts';
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
} from './engine';

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

test('auth credentials validation enforces email and password policies', () => {
  assert.equal(validateAuthCredentials('login', { email: 'bad', password: '' }).valid, false);
  assert.equal(validateAuthCredentials('login', { email: 'user@snapsec.com', password: 'secret' }).valid, true);

  assert.equal(validateAuthCredentials('signup', { name: 'Owais', email: 'owais@snapsec.com', password: 'short' }).valid, false);
  assert.equal(validateAuthCredentials('signup', { name: 'Owais', email: 'owais@snapsec.com', password: 'Snapsec!2026' }).valid, true);

  assert.equal(validateAuthCredentials('reset', { password: 'Snapsec!2026', confirmPassword: 'mismatch' }).valid, false);
  assert.equal(validateAuthCredentials('reset', { password: 'Snapsec!2026', confirmPassword: 'Snapsec!2026' }).valid, true);
});

test('Express REST API endpoints work end-to-end across all domain resources and CRUD operations', async () => {
  process.env.NODE_ENV = 'test';
  const { createApp } = await import('../../server');
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
    assert.ok(cmtAttRes.comment.attachments[0].dataUrl.startsWith('data:image/png'));

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


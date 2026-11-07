import { seed } from '../db/seed.js';
import { DEFAULT_STATUSES, PCOLORS, PR, PSTAT, ST, TEAMS_SEED, syncStatuses } from '../utils/constants.js';
import { TODAY, addD, dOff, diffD, esc, fmtDate, iso, parse, uid } from '../utils/utils.js';
import {
  isSafeEmoji,
  safeCssColor,
  safeDownloadUrl,
  safeImageSrc,
  safeString,
  sanitizeBaseUrl,
  sanitizeHeaderValue,
  stripDangerousKeys,
} from '../utils/security.ts';

const ALLOWED_TASK_PATCH_KEYS = new Set([
  'project',
  'title',
  'status',
  'assignee',
  'priority',
  'due',
  'start',
  'labels',
  'subtasks',
  'attachments',
  'deps',
  'desc',
  'estimate',
  'order',
  'fav',
  'recur',
  'archived',
  'completedAt',
  'prevStatus',
]);

const ALLOWED_PROJECT_PATCH_KEYS = new Set([
  'name',
  'icon',
  'color',
  'status',
  'team',
  'lead',
  'due',
  'start',
  'fav',
  'members',
  'desc',
  'milestones',
  'archived',
  'archivedAt',
  'private',
  'access',
  'perms',
]);

export const DEFAULT_PREFS = {
  theme: 'system',
  accent: 'indigo',
  side: 'comfortable',
  density: 'comfortable',
  weekStart: 1,
  dateFmt: 'MMM d',
  lang: 'English (US)',
  tz: '(GMT-07:00) Pacific Time',
  motion: 'system',
  home: 'home',
  openTasks: 'drawer',
  name: 'Mohammad Owais',
  title: 'Head of Product',
};

export const RECUR_DAYS: Record<string, number> = {
  Daily: 1,
  Weekly: 7,
  'Every 2 weeks': 14,
  Monthly: 30,
};

export const PROJECT_TEMPLATES: Record<string, { name: string; icon: string; tasks: string[] }> = {
  blank: { name: 'Blank project', icon: 'file', tasks: [] },
  product: {
    name: 'Product launch',
    icon: 'rocket',
    tasks: [
      'Define launch goals and success metrics',
      'Draft positioning and messaging brief',
      'Prepare press kit and launch blog post',
      'Run internal QA and go / no-go review',
      'Brief sales and customer support',
      'Publish announcement and monitor feedback',
    ],
  },
  web: {
    name: 'Website',
    icon: 'globe',
    tasks: [
      'Audit existing pages and analytics',
      'Create sitemap and information architecture',
      'Wireframe key templates',
      'Design visual system and components',
      'Build responsive pages and CMS schema',
      'Run accessibility and performance checks',
    ],
  },
  sprint: {
    name: 'Engineering sprint',
    icon: 'code',
    tasks: [
      'Groom backlog and size stories',
      'Kick off sprint and assign owners',
      'Mid-sprint check-in on blockers',
      'Code review and QA sign-off',
      'Deploy release and write changelog',
      'Run sprint retrospective',
    ],
  },
  campaign: {
    name: 'Marketing campaign',
    icon: 'megaphone',
    tasks: [
      'Define audience, channels, and budget',
      'Write campaign brief and creative direction',
      'Produce ad copy and visual assets',
      'Build landing page and tracking links',
      'Launch campaign across channels',
      'Report on conversions and ROAS',
    ],
  },
};

export interface PersistedStore {
  data: any;
  prefs: Record<string, any>;
  views: Record<string, any>;
  collapsed: boolean;
  updatedAt: number;
}

export const DEFAULT_PROJECT_STATUSES = [
  { id: 'planning', name: 'Planning', c: '#6B7280', kind: 'planning' },
  { id: 'active', name: 'In Progress', c: '#3B82C4', kind: 'active' },
  { id: 'risk', name: 'At Risk', c: '#E05252', kind: 'risk' },
  { id: 'hold', name: 'On Hold', c: '#C48A1E', kind: 'hold' },
  { id: 'complete', name: 'Completed', c: '#3D8E5F', kind: 'complete' },
];

export function createDefaultState(): PersistedStore {
  const data: any = seed();
  if (!data.teams) {
    data.teams = TEAMS_SEED.map((t: any) => ({ ...t }));
  }
  if (!Array.isArray(data.statuses) || !data.statuses.length) {
    data.statuses = DEFAULT_STATUSES.map((s: any) => ({ ...s }));
  }
  syncStatuses(data.statuses);
  if (!Array.isArray(data.projectStatuses) || !data.projectStatuses.length) {
    data.projectStatuses = DEFAULT_PROJECT_STATUSES.map((s: any) => ({ ...s }));
  }
  return {
    data,
    prefs: { ...DEFAULT_PREFS },
    views: {},
    collapsed: false,
    updatedAt: Date.now(),
  };
}

export function detectFileType(name: string): string {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['fig', 'sketch'].includes(ext)) return 'fig';
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'img';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'sheet';
  if (['doc', 'docx', 'txt', 'md'].includes(ext)) return 'doc';
  if (['zip', 'tar', 'gz', 'rar'].includes(ext)) return 'zip';
  if (['js', 'ts', 'json', 'html', 'css', 'py', 'go'].includes(ext)) return 'code';
  return 'doc';
}

export function logActivity(data: any, verb: string, taskObj: any = null, extra = '', projectOverride: string | null = null) {
  data.activity = data.activity || [];
  data.activity.unshift({
    id: uid('a'),
    by: data.me || 'm1',
    verb,
    task: taskObj?.id || null,
    project: taskObj?.project || projectOverride || null,
    at: Date.now(),
    extra,
  });
  if (taskObj) {
    taskObj.updated = Date.now();
  }
}

export function nextTaskKey(project: any): string {
  project.seq = (project.seq || 200) + 1;
  return `${project.key}-${project.seq}`;
}

export function makeProjectKey(name: string, existingProjects: any[]): string {
  let k = String(name || '')
    .split(/\s+/)
    .map(w => w[0] || '')
    .join('')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 3);
  if (k.length < 2) {
    k =
      String(name || '')
        .replace(/[^A-Za-z]/g, '')
        .slice(0, 3)
        .toUpperCase() || 'PRJ';
  }
  while (existingProjects.some(p => p.key === k)) {
    k += 'X';
  }
  return k;
}

export function computeTaskProgress(taskObj: any): number {
  if (!taskObj) return 0;
  if (taskObj.status === 'done') return 100;
  if (Array.isArray(taskObj.subtasks) && taskObj.subtasks.length > 0) {
    const doneCount = taskObj.subtasks.filter((s: any) => s.done).length;
    return Math.round((doneCount / taskObj.subtasks.length) * 100);
  }
  const map: Record<string, number> = { backlog: 0, todo: 5, progress: 45, review: 80 };
  return map[taskObj.status] || 0;
}

export function computeProjectProgress(data: any, projectId: string): number {
  const ts = (data.tasks || []).filter((t: any) => t.project === projectId && !t.archived);
  if (!ts.length) return 0;
  const doneCount = ts.filter((t: any) => t.status === 'done').length;
  return Math.round((doneCount / ts.length) * 100);
}

export function computeWorkspaceMetrics(data: any) {
  const activeProjects = (data.projects || []).filter((p: any) => !p.archived);
  const visibleTasks = (data.tasks || []).filter((t: any) => !t.archived);
  const openTasks = visibleTasks.filter((t: any) => t.status !== 'done');
  const completedTasks = visibleTasks.filter((t: any) => t.status === 'done');
  const myOpenTasks = openTasks.filter((t: any) => t.assignee === data.me);
  const overdueTasks = openTasks.filter((t: any) => t.due && diffD(parse(t.due), TODAY) < 0);
  const dueTodayTasks = openTasks.filter((t: any) => t.due && diffD(parse(t.due), TODAY) === 0);
  const unreadNotifs = (data.notifs || []).filter((n: any) => !n.read).length;

  return {
    workspaceName: data.ws?.name || 'Snapsec',
    totalProjects: activeProjects.length,
    totalTasks: visibleTasks.length,
    openTasks: openTasks.length,
    completedTasks: completedTasks.length,
    myOpenTasks: myOpenTasks.length,
    overdueTasks: overdueTasks.length,
    dueTodayTasks: dueTodayTasks.length,
    unreadNotifications: unreadNotifs,
    totalMembers: (data.members || []).length,
    totalTeams: (data.teams || TEAMS_SEED).length,
  };
}

export function createTaskRecord(data: any, rawInput: Record<string, any>) {
  const input = stripDangerousKeys(rawInput || {});
  const p =
    (data.projects || []).find((pr: any) => pr.id === input.project) ||
    (data.projects || []).find((pr: any) => !pr.archived) ||
    data.projects[0];
  const maxOrder = Math.max(0, ...(data.tasks || []).map((t: any) => Number(t.order) || 0));
  const now = Date.now();
  const rawStatus = typeof input.status === 'string' ? input.status.trim() : '';
  const validStatus = rawStatus && ((ST as any)[rawStatus] || /^[a-z0-9_-]{1,50}$/i.test(rawStatus)) ? rawStatus : 'todo';
  const newTask: any = {
    project: p.id,
    title: safeString(input.title, 500, 'Untitled') || 'Untitled',
    status: validStatus,
    assignee: typeof input.assignee === 'string' ? input.assignee : null,
    priority: typeof input.priority === 'string' && (PR as any)[input.priority] ? input.priority : 'none',
    due: typeof input.due === 'string' ? input.due : null,
    start: typeof input.start === 'string' ? input.start : null,
    labels: Array.isArray(input.labels) ? input.labels.filter((l: any) => typeof l === 'string') : [],
    subtasks: Array.isArray(input.subtasks) ? stripDangerousKeys(input.subtasks) : [],
    attachments: Array.isArray(input.attachments) ? stripDangerousKeys(input.attachments) : [],
    deps: Array.isArray(input.deps) ? input.deps.filter((d: any) => typeof d === 'string') : [],
    desc: typeof input.desc === 'string' ? input.desc : '',
    estimate: input.estimate ?? null,
    created: typeof input.created === 'number' ? input.created : now,
    updated: now,
    order: typeof input.order === 'number' ? input.order : maxOrder + 1,
    fav: !!input.fav,
    recur: typeof input.recur === 'string' ? input.recur : null,
    archived: !!input.archived,
    completedAt: input.completedAt ?? null,
  };
  newTask.project = p.id;
  newTask.id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : uid('t');
  newTask.key = typeof input.key === 'string' && input.key.trim() ? input.key.trim() : nextTaskKey(p);
  if (newTask.start && newTask.due && newTask.start > newTask.due) {
    newTask.start = newTask.due;
  }
  data.tasks.push(newTask);
  logActivity(data, 'created', newTask);
  return newTask;
}

export function applyTaskPatch(data: any, taskId: string, rawPatch: Record<string, any>) {
  const t = (data.tasks || []).find((x: any) => x.id === taskId);
  if (!t) return null;
  const patch = stripDangerousKeys(rawPatch || {});
  const messages: string[] = [];

  for (const k of Object.keys(patch)) {
    if (!ALLOWED_TASK_PATCH_KEYS.has(k)) continue;
    const oldVal = t[k];
    const newVal = patch[k];
    if (JSON.stringify(oldVal) === JSON.stringify(newVal)) continue;
    t[k] = newVal;

    if (k === 'status') {
      if (newVal === 'done') {
        t.completedAt = Date.now();
        t.prevStatus = oldVal;
        logActivity(data, 'completed', t);
      } else {
        const oldName = (ST as any)[oldVal]?.name || oldVal;
        const newName = (ST as any)[newVal]?.name || newVal;
        logActivity(data, 'moved', t, `from ${oldName} to ${newName}`);
      }
      if (newVal === 'done' && t.recur && t.due) {
        const nextDue = iso(addD(parse(t.due), RECUR_DAYS[t.recur] || 7));
        const nextTask = createTaskRecord(data, {
          ...JSON.parse(JSON.stringify(t)),
          id: undefined,
          key: undefined,
          status: 'todo',
          due: nextDue,
          start: nextDue,
          subtasks: (t.subtasks || []).map((s: any) => ({ ...s, done: false })),
          completedAt: null,
          attachments: [],
        });
        delete nextTask.prevStatus;
        messages.push(`Next “${t.title}” scheduled for ${fmtDate(nextDue)}`);
      }
    } else if (k === 'assignee') {
      const m = (data.members || []).find((mem: any) => mem.id === newVal);
      logActivity(data, 'assigned', t, newVal ? `to ${m?.name || newVal}` : '(unassigned)');
    } else if (k === 'priority') {
      const pName = (PR as any)[newVal]?.name || newVal;
      logActivity(data, 'changed priority of', t, `to ${pName}`);
    } else if (k === 'due') {
      logActivity(data, 'changed due date of', t, newVal ? `to ${fmtDate(newVal)}` : '(cleared)');
    } else if (k === 'start') {
      logActivity(data, 'changed start date of', t, newVal ? `to ${fmtDate(newVal)}` : '(cleared)');
    } else if (k === 'project') {
      const p = (data.projects || []).find((pr: any) => pr.id === newVal);
      if (p) {
        t.key = nextTaskKey(p);
        logActivity(data, 'moved', t, `to ${p.name}`);
      }
    } else if (k === 'labels') {
      logActivity(data, 'updated labels on', t);
    } else if (k === 'title') {
      logActivity(data, 'renamed', t, `to “${newVal}”`);
    } else if (k === 'recur') {
      logActivity(data, 'set repeat on', t, newVal ? String(newVal).toLowerCase() : 'off');
    } else if (k === 'estimate') {
      logActivity(data, 'estimated', t, newVal || 'none');
    } else if (k === 'deps') {
      logActivity(data, 'updated dependencies of', t);
    }
    t.updated = Date.now();
  }

  return { task: t, messages };
}

export function duplicateTaskRecord(data: any, taskId: string) {
  const t = (data.tasks || []).find((x: any) => x.id === taskId);
  if (!t) return null;
  const copy = createTaskRecord(data, {
    ...JSON.parse(JSON.stringify(t)),
    id: uid('t'),
    key: undefined,
    title: `${t.title} (copy)`,
    created: Date.now(),
    fav: false,
  });
  return copy;
}

export function archiveTaskRecord(data: any, taskId: string) {
  const t = (data.tasks || []).find((x: any) => x.id === taskId);
  if (!t) return null;
  t.archived = true;
  t.archivedAt = Date.now();
  logActivity(data, 'archived', t);
  return t;
}

export function restoreTaskRecord(data: any, taskId: string) {
  const t = (data.tasks || []).find((x: any) => x.id === taskId);
  if (!t) return null;
  t.archived = false;
  t.archivedAt = null;
  logActivity(data, 'restored', t);
  return t;
}

export function deleteTaskRecords(data: any, taskIds: string[]) {
  const idSet = new Set(taskIds);
  const beforeCount = (data.tasks || []).length;
  data.tasks = (data.tasks || []).filter((t: any) => !idSet.has(t.id));
  (data.tasks || []).forEach((t: any) => {
    if (Array.isArray(t.deps)) {
      t.deps = t.deps.filter((d: string) => !idSet.has(d));
    }
  });
  data.comments = (data.comments || []).filter((c: any) => !idSet.has(c.task));
  return beforeCount - data.tasks.length;
}

export function filterTasks(data: any, query: Record<string, any> = {}) {
  let list = [...(data.tasks || [])];
  const arch = query.archived;
  if (arch === 'true' || arch === true) {
    list = list.filter(t => !!t.archived);
  } else if (arch !== 'all') {
    list = list.filter(t => !t.archived);
  }
  const projectFilter = safeString(query.project, 100);
  if (projectFilter) {
    list = list.filter(t => t.project === projectFilter);
  }
  const statusFilter = safeString(query.status, 50);
  if (statusFilter) {
    list = list.filter(t => t.status === statusFilter);
  }
  const assigneeFilter = safeString(query.assignee, 100);
  if (assigneeFilter) {
    list = list.filter(t => t.assignee === assigneeFilter);
  }
  const priorityFilter = safeString(query.priority, 50);
  if (priorityFilter) {
    list = list.filter(t => t.priority === priorityFilter);
  }
  const qFilter = safeString(query.q, 500).toLowerCase().trim();
  if (qFilter) {
    list = list.filter(
      t =>
        String(t.title || '').toLowerCase().includes(qFilter) ||
        String(t.key || '').toLowerCase().includes(qFilter) ||
        String(t.desc || '').toLowerCase().includes(qFilter),
    );
  }
  return list;
}

/* ---------- Subtasks ---------- */
export function addSubtaskRecord(data: any, taskId: string, title: string) {
  const t = (data.tasks || []).find((x: any) => x.id === taskId);
  if (!t || !title.trim()) return null;
  const sub = { id: uid('s'), title: title.trim(), done: false };
  t.subtasks = t.subtasks || [];
  t.subtasks.push(sub);
  logActivity(data, 'added subtask to', t, `“${sub.title}”`);
  return sub;
}

export function updateSubtaskRecord(data: any, taskId: string, subtaskId: string, patch: Record<string, any>) {
  const t = (data.tasks || []).find((x: any) => x.id === taskId);
  if (!t) return null;
  const s = (t.subtasks || []).find((x: any) => x.id === subtaskId);
  if (!s) return null;

  if (typeof patch.done === 'boolean' && patch.done !== s.done) {
    s.done = patch.done;
    logActivity(data, s.done ? 'completed subtask on' : 'reopened subtask on', t, `“${s.title}”`);
  }
  if (typeof patch.title === 'string' && patch.title.trim()) {
    s.title = patch.title.trim();
  }
  if (typeof patch.note === 'string') {
    s.note = patch.note;
  }
  if ('assignee' in patch) {
    s.assignee = patch.assignee || null;
    const m = (data.members || []).find((mem: any) => mem.id === s.assignee);
    logActivity(data, 'assigned a subtask on', t, s.assignee ? `to ${m?.name || s.assignee}` : '(unassigned)');
  }
  if ('due' in patch) {
    s.due = patch.due || null;
    logActivity(data, 'set a subtask due date on', t, s.due ? fmtDate(s.due) : '(cleared)');
  }
  t.updated = Date.now();
  return s;
}

export function deleteSubtaskRecord(data: any, taskId: string, subtaskId: string) {
  const t = (data.tasks || []).find((x: any) => x.id === taskId);
  if (!t) return false;
  const before = (t.subtasks || []).length;
  t.subtasks = (t.subtasks || []).filter((x: any) => x.id !== subtaskId);
  t.updated = Date.now();
  return t.subtasks.length < before;
}

export function promoteSubtaskRecord(data: any, taskId: string, subtaskId: string) {
  const t = (data.tasks || []).find((x: any) => x.id === taskId);
  if (!t) return null;
  const s = (t.subtasks || []).find((x: any) => x.id === subtaskId);
  if (!s) return null;
  const promoted = createTaskRecord(data, {
    title: s.title,
    project: t.project,
    status: s.done ? 'done' : 'todo',
    assignee: s.assignee || t.assignee,
    priority: t.priority,
    due: s.due || null,
    labels: [...(t.labels || [])],
    desc: s.note ? `<p>${esc(s.note)}</p>` : '',
  });
  t.subtasks = (t.subtasks || []).filter((x: any) => x.id !== subtaskId);
  logActivity(data, 'converted a subtask of', t, `into ${promoted.key}`);
  return promoted;
}

/* ---------- Comments & Reactions ---------- */
export function addCommentRecord(data: any, taskId: string, text: string, byMemberId?: string, attachments?: any[]) {
  const t = (data.tasks || []).find((x: any) => x.id === taskId);
  const cleanText = String(text || '').trim();
  const rawAtts = Array.isArray(attachments) ? attachments : [];
  if (!t || (!cleanText && rawAtts.length === 0)) return null;
  const author = byMemberId || data.me || 'm1';
  const now = Date.now();
  const commentId = uid('c');

  const cleanAttachments = rawAtts.map((rawA: any) => {
    const a = stripDangerousKeys(rawA || {});
    const safeUrl = safeDownloadUrl(a.dataUrl) || null;
    return {
      id: safeString(a.id, 80) || uid('f'),
      name: safeString(a.name, 255, 'attachment') || 'attachment',
      type: safeString(a.type, 20) || detectFileType(String(a.name || 'attachment')),
      size: safeString(a.size, 40, '24 KB') || '24 KB',
      by: safeString(a.by, 80) || author,
      at: typeof a.at === 'number' ? a.at : now,
      project: t.project,
      task: taskId,
      commentId,
      dataUrl: safeUrl,
      textContent: typeof a.textContent === 'string' ? a.textContent.slice(0, 500000) : null,
      mime: safeString(a.mime, 100) || null,
    };
  });

  const comment: {
    id: string;
    task: string;
    by: string;
    at: number;
    text: string;
    attachments: any[];
    re: Record<string, string[]>;
  } = {
    id: commentId,
    task: taskId,
    by: author,
    at: now,
    text: cleanText,
    attachments: cleanAttachments,
    re: {},
  };
  data.comments = data.comments || [];
  data.comments.push(comment);

  if (cleanAttachments.length > 0) {
    t.attachments = t.attachments || [];
    data.files = data.files || [];
    cleanAttachments.forEach((att: any) => {
      if (!t.attachments.some((x: any) => x.id === att.id)) {
        t.attachments.push({ ...att });
      }
      if (!data.files.some((x: any) => x.id === att.id)) {
        data.files.unshift({ ...att });
      }
    });
  }

  logActivity(
    data,
    'commented on',
    t,
    cleanAttachments.length ? `(with ${cleanAttachments.length} attachment${cleanAttachments.length > 1 ? 's' : ''})` : '',
  );

  // Check for @mentions to create notifications
  (data.members || []).forEach((m: any) => {
    if (cleanText.toLowerCase().includes(`@${m.name.toLowerCase()}`)) {
      data.notifs = data.notifs || [];
      data.notifs.unshift({
        id: uid('n'),
        type: 'mention',
        by: author,
        task: taskId,
        text: 'mentioned you in',
        snippet: cleanText || `Attached ${cleanAttachments.map((a: any) => a.name).join(', ')}`,
        at: now,
        read: false,
      });
    }
  });

  return comment;
}

export function deleteCommentRecord(data: any, commentId: string) {
  const before = (data.comments || []).length;
  data.comments = (data.comments || []).filter((c: any) => c.id !== commentId);
  return data.comments.length < before;
}

export function toggleCommentReaction(data: any, commentId: string, emoji: string, memberId?: string) {
  const c = (data.comments || []).find((x: any) => x.id === commentId);
  if (!c || !isSafeEmoji(emoji)) return null;
  const cleanEmoji = emoji.trim();
  const actor = safeString(memberId, 80) || data.me || 'm1';
  c.re = c.re || {};
  const list: string[] = c.re[cleanEmoji] || [];
  c.re[cleanEmoji] = list.includes(actor) ? list.filter(x => x !== actor) : [...list, actor];
  return c;
}

/* ---------- Projects ---------- */
export function createProjectRecord(data: any, input: Record<string, any>, tmplId = 'blank') {
  const name = String(input.name || 'Untitled Project').trim();
  const lead = input.lead || data.me || 'm1';
  const p = {
    id: input.id || uid('p'),
    key: input.key || makeProjectKey(name, data.projects || []),
    name,
    icon: input.icon || 'folder',
    color: input.color || 'indigo',
    status: input.status || 'planning',
    team: input.team ?? 'product',
    lead,
    due: input.due || dOff(30),
    start: input.start || dOff(0),
    fav: !!input.fav,
    members: [...new Set([data.me || 'm1', lead, ...(input.members || [])])],
    desc: input.desc || 'No description yet.',
    milestones: input.milestones || [],
    last: 0,
    archived: false,
  };
  data.projects = data.projects || [];
  data.projects.push(p);
  data.projOrder = data.projOrder || [];
  data.projOrder.unshift(p.id);
  logActivity(data, 'created project', null, '', p.id);

  const tm = PROJECT_TEMPLATES[tmplId];
  if (tm && tm.tasks.length) {
    tm.tasks.forEach((title, i) => {
      createTaskRecord(data, {
        project: p.id,
        title,
        status: i === 0 ? 'todo' : 'backlog',
        assignee: i === 0 ? data.me || 'm1' : null,
        priority: i === 0 ? 'high' : 'medium',
        due: dOff(5 + i * 5),
        start: dOff(i * 5),
      });
    });
  }
  return p;
}

export function updateProjectRecord(data: any, projectId: string, rawPatch: Record<string, any>) {
  const p = (data.projects || []).find((x: any) => x.id === projectId);
  if (!p) return null;
  const patch = stripDangerousKeys(rawPatch || {});
  if (patch.status && patch.status !== p.status && (PSTAT as any)[patch.status]) {
    logActivity(data, 'changed status of project', null, `to ${(PSTAT as any)[patch.status].name}`, p.id);
  }
  for (const k of Object.keys(patch)) {
    if (!ALLOWED_PROJECT_PATCH_KEYS.has(k)) continue;
    p[k] = patch[k];
  }
  if (patch.lead && Array.isArray(p.members) && !p.members.includes(patch.lead)) {
    p.members.push(patch.lead);
  }
  return p;
}

export function duplicateProjectRecord(data: any, projectId: string) {
  const p = (data.projects || []).find((x: any) => x.id === projectId);
  if (!p) return null;
  const copy = createProjectRecord(
    data,
    {
      ...JSON.parse(JSON.stringify(p)),
      id: undefined,
      key: undefined,
      name: `${p.name} copy`,
    },
    'blank',
  );
  const srcTasks = (data.tasks || []).filter((t: any) => t.project === p.id && !t.archived);
  srcTasks.forEach((t: any) => {
    createTaskRecord(data, {
      ...JSON.parse(JSON.stringify(t)),
      id: uid('t'),
      key: undefined,
      project: copy.id,
      status: 'todo',
    });
  });
  return copy;
}

export function deleteProjectRecord(data: any, projectId: string) {
  const p = (data.projects || []).find((x: any) => x.id === projectId);
  if (!p) return false;
  const taskIds = (data.tasks || []).filter((t: any) => t.project === projectId).map((t: any) => t.id);
  deleteTaskRecords(data, taskIds);
  data.projects = (data.projects || []).filter((x: any) => x.id !== projectId);
  data.projOrder = (data.projOrder || []).filter((id: string) => id !== projectId);
  data.files = (data.files || []).filter((f: any) => f.project !== projectId);
  return true;
}

/* ---------- Teams ---------- */
export function createTeamRecord(data: any, rawInput: Record<string, any>) {
  const input = stripDangerousKeys(rawInput || {});
  if (!data.teams) data.teams = TEAMS_SEED.map((t: any) => ({ ...t }));
  const name = safeString(input.name, 120).trim();
  if (!name) throw new Error('Give the team a name');
  if (data.teams.some((t: any) => t.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`A team called “${name}” already exists`);
  }
  const colorHex = (PCOLORS as any)[input.color] || safeCssColor(input.c, PCOLORS.teal);
  const teamObj = {
    id: safeString(input.id, 80) || uid('tm'),
    name,
    desc: safeString(input.desc, 500).trim() || 'No description yet.',
    icon: safeString(input.icon, 40) || 'users',
    c: colorHex,
  };
  data.teams.push(teamObj);
  if (Array.isArray(input.members)) {
    input.members.forEach((mid: string) => {
      const m = (data.members || []).find((x: any) => x.id === mid);
      if (m) m.team = teamObj.id;
    });
  }
  return teamObj;
}

export function updateTeamRecord(data: any, teamId: string, rawInput: Record<string, any>) {
  const input = stripDangerousKeys(rawInput || {});
  if (!data.teams) data.teams = TEAMS_SEED.map((t: any) => ({ ...t }));
  const teamObj = data.teams.find((t: any) => t.id === teamId);
  if (!teamObj) return null;
  if (input.name) teamObj.name = safeString(input.name, 120).trim();
  if (typeof input.desc === 'string') teamObj.desc = safeString(input.desc, 500).trim();
  if (input.icon) teamObj.icon = safeString(input.icon, 40);
  if (input.color && (PCOLORS as any)[input.color]) teamObj.c = (PCOLORS as any)[input.color];
  else if (input.c) teamObj.c = safeCssColor(input.c, teamObj.c);

  if (Array.isArray(input.members)) {
    (data.members || []).forEach((m: any) => {
      if (m.team === teamObj.id && !input.members.includes(m.id)) m.team = '';
    });
    input.members.forEach((mid: string) => {
      const m = (data.members || []).find((x: any) => x.id === mid);
      if (m) m.team = teamObj.id;
    });
  }
  return teamObj;
}

export function deleteTeamRecord(data: any, teamId: string) {
  if (!data.teams) data.teams = TEAMS_SEED.map((t: any) => ({ ...t }));
  const before = data.teams.length;
  data.teams = data.teams.filter((t: any) => t.id !== teamId);
  (data.members || []).forEach((m: any) => {
    if (m.team === teamId) m.team = '';
  });
  (data.projects || []).forEach((p: any) => {
    if (p.team === teamId) p.team = '';
  });
  return data.teams.length < before;
}

/* ---------- Members & Invitation Emails ---------- */
export const EMAIL_REGEX = /^\S+@\S+\.\S+$/;

export function buildInvitationEmail(data: any, member: any, baseUrl = '', projectName = '') {
  const wsName = sanitizeHeaderValue(data.ws?.name || 'Snapsec', 100) || 'Snapsec';
  const inviter = (data.members || []).find((m: any) => m.id === (data.me || 'm1')) || {
    name: 'Mohammad Owais',
    email: 'mohammadowais616@gmail.com',
  };
  const cleanBase = sanitizeBaseUrl(baseUrl, process.env.APP_URL || 'http://localhost:3000');
  const inviteToken = member.inviteToken || uid('inv');
  member.inviteToken = inviteToken;
  const inviteUrl = `${cleanBase}/?invite=${encodeURIComponent(inviteToken)}&email=${encodeURIComponent(member.email)}`;
  member.inviteUrl = inviteUrl;

  const cleanProjName = sanitizeHeaderValue(projectName, 120);
  const inviterName = sanitizeHeaderValue(inviter.name, 100) || 'Snapsec Admin';
  const subject = cleanProjName
    ? `${inviterName} invited you to collaborate on “${cleanProjName}” in ${wsName}`
    : `${inviterName} invited you to join the ${wsName} workspace`;

  const text = [
    `Hi ${member.name},`,
    ``,
    `${inviter.name} (${inviter.email}) has invited you to join ${wsName}${projectName ? ` on project "${projectName}"` : ''} as a ${member.role || 'Member'}.`,
    ``,
    `Accept your invitation and join the workspace:`,
    `${inviteUrl}`,
    ``,
    `Workspace: ${wsName}`,
    `Role: ${member.role || 'Member'}`,
    ``,
    `— The ${wsName} Team`,
  ].join('\n');

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:28px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;color:#111827">
    <div style="margin-bottom:20px">
      <img src="https://suite.snapsec.co/media/logos/snapsec.svg" alt="Snapsec" style="height:28px;width:auto;display:block" />
    </div>
    <h2 style="font-size:20px;font-weight:600;margin:0 0 12px;color:#111827">${esc(inviter.name)} invited you to join ${esc(wsName)}</h2>
    <p style="font-size:14px;line-height:1.6;color:#374151;margin:0 0 16px">
      Hi <strong>${esc(member.name)}</strong>, <strong>${esc(inviter.name)}</strong> (${esc(inviter.email)}) has invited you to collaborate in the <strong>${esc(wsName)}</strong> workspace${projectName ? ` on project <strong>${esc(projectName)}</strong>` : ''} with the <strong>${esc(member.role || 'Member')}</strong> role.
    </p>
    <div style="margin:24px 0">
      <a href="${esc(inviteUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#4F46E5;color:#ffffff;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px;text-decoration:none">Accept invitation &amp; join ${esc(wsName)}</a>
    </div>
    <p style="font-size:12.5px;line-height:1.5;color:#6B7280;margin:0 0 8px">Or copy and paste this direct join link into your browser:</p>
    <div style="font-family:monospace;font-size:12px;padding:10px 12px;background:#F3F4F6;border-radius:6px;word-break:break-all;color:#1F2937">${esc(inviteUrl)}</div>
    <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0 12px" />
    <div style="font-size:11.5px;color:#9CA3AF">Sent by ${esc(wsName)} TaskTracker · Security &amp; Engineering Workspace</div>
  </div>`;

  const gmailComposeUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(member.email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  const mailtoUrl = `mailto:${encodeURIComponent(member.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;

  const outboxItem = {
    id: uid('em'),
    memberId: member.id,
    to: member.email,
    toName: member.name,
    from: inviter.email,
    fromName: inviter.name,
    subject,
    text,
    html,
    inviteToken,
    inviteUrl,
    role: member.role || 'Member',
    team: member.team || 'product',
    projectName: projectName || null,
    sentAt: Date.now(),
    status: 'queued',
    previewUrl: null as string | null,
    gmailComposeUrl,
    mailtoUrl,
  };

  data.outbox = data.outbox || [];
  data.outbox.unshift(outboxItem);
  member.lastInviteId = outboxItem.id;
  member.invitedAt = outboxItem.sentAt;
  return outboxItem;
}

export function inviteMemberRecords(
  data: any,
  emails: string[],
  role = 'Member',
  team = 'product',
  baseUrl = '',
  projectName = '',
) {
  const invited: any[] = [];
  data.members = data.members || [];
  for (const rawEmail of emails) {
    const email = String(rawEmail || '').trim();
    if (!EMAIL_REGEX.test(email)) {
      throw new Error(`${email} isn't a valid email address`);
    }
    let member = (data.members || []).find((m: any) => m.email.toLowerCase() === email.toLowerCase());
    if (!member) {
      member = {
        id: uid('m'),
        name: email
          .split('@')[0]
          .replace(/[._-]+/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase()),
        email,
        role,
        team,
        title: role,
        c: '#6B7280',
        status: 'invited',
        last: null,
        tz: '—',
        inviteToken: uid('inv'),
      };
      data.members.push(member);
    } else {
      member.role = role || member.role;
      member.team = team || member.team;
      if (!member.inviteToken) member.inviteToken = uid('inv');
    }
    buildInvitationEmail(data, member, baseUrl, projectName);
    invited.push(member);
  }
  return invited;
}

export function acceptInviteTokenRecord(data: any, prefs: Record<string, any>, tokenOrEmail: string) {
  const needle = String(tokenOrEmail || '').trim();
  if (!needle) return null;
  data.members = data.members || [];
  const member = data.members.find(
    (m: any) =>
      (m.inviteToken && m.inviteToken === needle) ||
      String(m.email || '').toLowerCase() === needle.toLowerCase() ||
      m.id === needle,
  );
  if (!member) return null;
  member.status = 'active';
  member.last = 0;
  data.me = member.id;
  if (prefs && typeof prefs === 'object') {
    prefs.name = member.name;
    if (member.title) prefs.title = member.title;
  }
  (data.projects || []).forEach((p: any) => {
    p.members = Array.isArray(p.members) ? p.members : [];
    if (!p.members.includes(member.id)) {
      p.members.push(member.id);
    }
  });
  (data.outbox || []).forEach((msg: any) => {
    if (msg.memberId === member.id || msg.inviteToken === needle) {
      msg.status = 'accepted';
      msg.acceptedAt = Date.now();
    }
  });
  logActivity(data, 'joined the workspace', null, member.email);
  return member;
}

export function removeMemberRecord(data: any, memberId: string) {
  const before = (data.members || []).length;
  data.members = (data.members || []).filter((m: any) => m.id !== memberId);
  (data.tasks || []).forEach((t: any) => {
    if (t.assignee === memberId) t.assignee = null;
  });
  (data.projects || []).forEach((p: any) => {
    if (Array.isArray(p.members)) {
      p.members = p.members.filter((id: string) => id !== memberId);
    }
  });
  return data.members.length < before;
}

/* ---------- Files ---------- */
export function addFileRecord(
  data: any,
  rawInput: {
    id?: string;
    name: string;
    size?: string;
    type?: string;
    project: string;
    task?: string | null;
    commentId?: string | null;
    by?: string;
    dataUrl?: string | null;
    textContent?: string | null;
    mime?: string | null;
  },
) {
  const input = stripDangerousKeys(rawInput || ({} as any));
  const cleanName = safeString(input.name, 255, 'attachment') || 'attachment';
  const validDataUrl = safeDownloadUrl(input.dataUrl) || null;
  const rec: any = {
    id: safeString(input.id, 80) || uid('f'),
    name: cleanName,
    type: safeString(input.type, 20) || detectFileType(cleanName),
    size: safeString(input.size, 40, '120 KB') || '120 KB',
    by: safeString(input.by, 80) || data.me || 'm1',
    at: Date.now(),
    project: safeString(input.project, 80) || 'p1',
    task: safeString(input.task, 80) || null,
    commentId: safeString(input.commentId, 80) || null,
    dataUrl: validDataUrl,
    textContent: typeof input.textContent === 'string' ? input.textContent.slice(0, 500000) : null,
    mime: safeString(input.mime, 100) || null,
  };
  data.files = data.files || [];
  const existingIdx = data.files.findIndex((x: any) => x.id === rec.id);
  if (existingIdx >= 0) {
    data.files[existingIdx] = { ...data.files[existingIdx], ...rec };
  } else {
    data.files.unshift(rec);
  }
  if (rec.task) {
    const t = (data.tasks || []).find((x: any) => x.id === rec.task);
    if (t) {
      t.attachments = t.attachments || [];
      if (!t.attachments.some((a: any) => a.id === rec.id)) {
        t.attachments.push({
          id: rec.id,
          name: rec.name,
          type: rec.type,
          size: rec.size,
          by: rec.by,
          at: rec.at,
          commentId: rec.commentId,
          dataUrl: rec.dataUrl,
          textContent: rec.textContent,
          mime: rec.mime,
        });
      }
      logActivity(data, 'added a file to', t, rec.name);
    }
  }
  return rec;
}

export function renameFileRecord(data: any, fileId: string, newName: string) {
  const f = (data.files || []).find((x: any) => x.id === fileId);
  if (!f || !newName.trim()) return null;
  f.name = newName.trim();
  f.type = detectFileType(f.name);
  return f;
}

export function duplicateFileRecord(data: any, fileId: string) {
  const f = (data.files || []).find((x: any) => x.id === fileId);
  if (!f) return null;
  const idx = data.files.indexOf(f);
  const copy = {
    ...f,
    id: uid('f'),
    name: f.name.replace(/(\.[^.]+)$/, ' copy$1'),
    at: Date.now(),
    by: data.me || 'm1',
  };
  data.files.splice(idx + 1, 0, copy);
  return copy;
}

export function deleteFileRecord(data: any, fileId: string) {
  const f = (data.files || []).find((x: any) => x.id === fileId);
  if (!f) return false;
  data.files = (data.files || []).filter((x: any) => x.id !== fileId);
  if (f.task) {
    const t = (data.tasks || []).find((x: any) => x.id === f.task);
    if (t && Array.isArray(t.attachments)) {
      t.attachments = t.attachments.filter((a: any) => a.name !== f.name && a.id !== fileId);
    }
  }
  return true;
}

/* ---------- Auth & Security Validation ---------- */
export const SNAPSEC_EMAIL_DOMAIN = '@snapsec.co';

export function getAuthorizedDomains(customDomains?: string[]): string[] {
  if (customDomains && customDomains.length > 0) {
    return customDomains.map(d => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  }
  if (typeof process !== 'undefined' && process.env?.AUTHORIZED_DOMAINS) {
    const parsed = process.env.AUTHORIZED_DOMAINS.split(',')
      .map(d => d.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean);
    if (parsed.length > 0) return parsed;
  }
  return ['snapsec.co'];
}

export function isAuthorizedRegistrationDomain(email: string, customDomains?: string[]): boolean {
  const clean = String(email || '').trim().toLowerCase();
  if (!EMAIL_REGEX.test(clean)) return false;
  const parts = clean.split('@');
  if (parts.length !== 2) return false;
  const domain = parts[1].toLowerCase();
  const allowed = getAuthorizedDomains(customDomains);
  return allowed.some(d => domain === d || domain.endsWith('.' + d));
}

export function isSnapsecCompanyEmail(email: string): boolean {
  return isAuthorizedRegistrationDomain(email);
}

export function validateAuthCredentials(mode: 'login' | 'signup' | 'reset' | 'password', payload: Record<string, any>) {
  const errors: Record<string, string> = {};
  if (mode === 'login') {
    const email = String(payload.email || '').trim();
    const pw = String(payload.password ?? payload.pw ?? '');
    if (!email) errors.email = 'Enter your email address';
    else if (!EMAIL_REGEX.test(email)) errors.email = 'Enter a valid email, like name@company.com';
    if (!pw) errors.pw = 'Enter your password';
  } else if (mode === 'signup') {
    const name = String(payload.name || '').trim();
    const email = String(payload.email || '').trim();
    const pw = String(payload.password ?? payload.pw ?? '');
    if (!name) errors.name = 'Enter your name';
    if (!EMAIL_REGEX.test(email)) errors.email = 'Enter a valid work email';
    else if (!isAuthorizedRegistrationDomain(email)) {
      const allowed = getAuthorizedDomains();
      errors.email = `Only ${allowed.map(d => '@' + d).join(', ')} company email addresses are allowed to sign up`;
    }
    if (pw.length < 10 || !/[0-9\W]/.test(pw)) {
      errors.pw = 'Use at least 10 characters, including a number or symbol';
    }
  } else if (mode === 'reset') {
    const pw = String(payload.password ?? payload.pw ?? '');
    const pw2 = String(payload.confirmPassword ?? payload.pw2 ?? '');
    if (pw.length < 10 || !/[0-9\W]/.test(pw)) {
      errors.pw = 'Use at least 10 characters, including a number or symbol';
    }
    if (pw !== pw2) {
      errors.pw2 = "Passwords don't match";
    }
  } else if (mode === 'password') {
    const cur = String(payload.currentPassword ?? payload.pwCur ?? '');
    const nw = String(payload.newPassword ?? payload.pwNew ?? '');
    const cf = String(payload.confirmPassword ?? payload.pwConf ?? '');
    if (!cur) errors.pwCur = 'Enter your current password';
    if (nw.length < 10 || !/[0-9\W]/.test(nw)) {
      errors.pwNew = 'Use at least 10 characters, including a number or symbol';
    }
    if (nw !== cf) errors.pwConf = "Passwords don't match";
  }
  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function authenticateWorkspaceUser(
  data: any,
  prefs: Record<string, any>,
  profile: { uid?: string; name?: string; email: string; photoURL?: string; provider?: string },
) {
  const email = String(profile.email || '').trim();
  if (!email) return null;
  const derivedName =
    String(profile.name || '').trim() ||
    email
      .split('@')[0]
      .replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());

  data.members = data.members || [];
  let member =
    (profile.uid && data.members.find((m: any) => m.uid === profile.uid)) ||
    data.members.find((m: any) => String(m.email || '').toLowerCase() === email.toLowerCase());

  if (!member) {
    // Update the primary workspace owner slot (m1) so all workspace projects, tasks, and ownership transfer seamlessly to the signed-in Google user
    const primaryOwner = data.members.find((m: any) => m.id === 'm1') || data.members[0];
    if (primaryOwner) {
      primaryOwner.name = derivedName;
      primaryOwner.email = email;
      if (profile.photoURL !== undefined) primaryOwner.photoURL = profile.photoURL;
      if (profile.uid) primaryOwner.uid = profile.uid;
      primaryOwner.status = 'active';
      primaryOwner.last = 0;
      member = primaryOwner;
    } else {
      member = {
        id: 'm1',
        uid: profile.uid || '',
        name: derivedName,
        email,
        photoURL: profile.photoURL || '',
        role: 'Owner',
        team: 'product',
        title: prefs?.title || 'Head of Product',
        c: '#5A67D8',
        status: 'active',
        last: 0,
        tz: 'San Francisco',
      };
      data.members.unshift(member);
    }
  } else {
    if (profile.name && String(profile.name).trim()) {
      member.name = safeString(profile.name, 120).trim();
    }
    member.email = email;
    const safePhoto = safeImageSrc(profile.photoURL);
    if (safePhoto) member.photoURL = safePhoto;
    if (profile.uid) member.uid = safeString(profile.uid, 128);
    member.status = 'active';
    member.last = 0;
  }

  data.me = member.id;
  if (prefs && typeof prefs === 'object') {
    prefs.name = member.name;
    if (member.title) prefs.title = member.title;
  }

  // Ensure the authenticated user is a member of all active workspace projects
  (data.projects || []).forEach((p: any) => {
    p.members = Array.isArray(p.members) ? p.members : [];
    if (!p.members.includes(member.id)) {
      p.members.unshift(member.id);
    }
  });

  return member;
}


/* ---------- store ---------- */
import { TODAY, diffD, iso, parse, uid } from './utils.js';
import {
  DEFAULT_PROJECT_STATUSES,
  DEFAULT_STATUSES,
  PCOLORS,
  STATUSES,
  TEAMS_SEED,
  syncProjectStatuses,
  syncStatuses,
} from './constants.js';
import { isAuthenticated } from './auth.js';
import { api } from './api.js';

export const STORE_KEY = 'snapsec.v2';
export let _localMutCount = 0;
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
  name: '',
  title: '',
};

export function emptyWorkspaceData() {
  return {
    ws: { name: 'Snapsec', url: 'snapsec', c: '#2F2E2A', brand: true },
    workspaces: [{ id: 'w1', name: 'Snapsec', c: '#2F2E2A', brand: true, plan: 'Business' }],
    plan: 'Business',
    me: 'm1',
    tfa: false,
    statuses: DEFAULT_STATUSES.map(s => ({ ...s })),
    teams: TEAMS_SEED.map(t => ({ ...t })),
    members: [],
    projects: [],
    projOrder: [],
    tasks: [],
    comments: [],
    files: [],
    notifs: [],
    activity: [],
    savedViews: [],
    outbox: [],
    sessions: [],
    notifPrefs: { assign: true, mention: true, comment: true, status: false, due: true, digest: true },
  };
}

export function load() {
  if (!isAuthenticated()) return null;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const j = JSON.parse(raw);
      if (j && j.data && Array.isArray(j.data.tasks)) return j;
    }
  } catch {
    /* storage blocked or corrupt */
  }
  return null;
}

export const saved = load();
export const S = {
  data: saved?.data || emptyWorkspaceData(),
  prefs: Object.assign({}, DEFAULT_PREFS, saved?.prefs || {}),
  views: saved?.views || {},
  ui: {
    fx: {},
    auth: isAuthenticated() ? null : 'login',
    authStep: 'login',
    af: { email: '', name: '' },
    onb: 0,
    onbData: { use: 'product', team: 'kanban', size: '2-10', ws: '', proj: 'Website Launch', tmpl: 'web', invites: '' },
    route: 'home',
    params: {},
    history: [],
    collapsed: !!saved?.collapsed,
    mnav: false,
    expanded: {},
    drawer: null,
    drawerFull: false,
    drawerTab: 'comments',
    modals: [],
    pop: null,
    palette: null,
    loading: false,
    offline: false,
    sel: new Set(),
    composer: null,
    editCell: null,
    openTasks: {},
    collapsedGroups: {},
    calDate: iso(TODAY),
    calMode: 'month',
    tlZoom: 'week',
    tlGroup: 'status',
    fileView: 'grid',
    projView: 'grid',
    homeTab: 'upcoming',
    inboxCat: 'all',
    inboxUnread: false,
    inboxSel: null,
    notifFilter: 'all',
    settings: 'appearance',
    searchQ: '',
    searchCat: 'all',
    myView: 'list',
    membersTab: 'members',
    collapsedCols: {},
    errors: {},
    drafts: {},
    commentFiles: {},
  },
};

if (!Array.isArray(S.data.statuses) || !S.data.statuses.length) {
  S.data.statuses = DEFAULT_STATUSES.map(s => ({ ...s }));
}
syncStatuses(S.data.statuses);

if (!Array.isArray(S.data.projectStatuses) || !S.data.projectStatuses.length) {
  S.data.projectStatuses = DEFAULT_PROJECT_STATUSES.map(s => ({ ...s }));
}
syncProjectStatuses(S.data.projectStatuses);

export let _saveT;
export function save(syncPrefsOnly = false) {
  _localMutCount++;
  if (Array.isArray(S.data?.statuses) && S.data.statuses.length) {
    syncStatuses(S.data.statuses);
  }
  if (Array.isArray(S.data?.projectStatuses) && S.data.projectStatuses.length) {
    syncProjectStatuses(S.data.projectStatuses);
  }
  if (!isAuthenticated()) return;
  const payload = { data: S.data, prefs: S.prefs, views: S.views, collapsed: S.ui.collapsed };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(payload));
  } catch {
    /* storage full or blocked: keep working in memory */
  }
  if (syncPrefsOnly && !S.ui.offline && typeof fetch !== 'undefined') {
    api.updatePreferences({ prefs: S.prefs, notifPrefs: S.data?.notifPrefs }).catch(() => {});
  }
}

export async function hydrateFromBackend(onHydrated) {
  if (!isAuthenticated()) {
    try {
      const r = await fetch('/api/auth/config');
      if (r.ok) {
        const cfg = await r.json();
        if (Array.isArray(cfg?.authorizedDomains) && cfg.authorizedDomains.length) {
          S.data.authorizedDomains = cfg.authorizedDomains;
        }
      }
    } catch {
      /* ignore */
    }
    if (typeof onHydrated === 'function') onHydrated();
    return;
  }
  try {
    const remote = await api.bootstrap();
    if (remote && remote.data && Array.isArray(remote.data.tasks)) {
      S.data = remote.data;
      if (!Array.isArray(S.data.statuses) || !S.data.statuses.length) {
        S.data.statuses = DEFAULT_STATUSES.map(s => ({ ...s }));
      }
      syncStatuses(S.data.statuses);
      if (!Array.isArray(S.data.projectStatuses) || !S.data.projectStatuses.length) {
        S.data.projectStatuses = DEFAULT_PROJECT_STATUSES.map(s => ({ ...s }));
      }
      syncProjectStatuses(S.data.projectStatuses);
      S.prefs = Object.assign({}, DEFAULT_PREFS, remote.prefs || {});
      S.views = remote.views || {};
      S.ui.collapsed = !!remote.collapsed;
      if (S.data.projects?.[0]?.id && Object.keys(S.ui.expanded || {}).length === 0) {
        S.ui.expanded = { [S.data.projects[0].id]: true };
      }
      try {
        localStorage.setItem(
          STORE_KEY,
          JSON.stringify({ data: S.data, prefs: S.prefs, views: S.views, collapsed: S.ui.collapsed }),
        );
      } catch {
        /* ignore localStorage quota error */
      }
      if (typeof onHydrated === 'function') onHydrated();
    }
  } catch {
    /* fallback if backend unreachable */
  }
}

export function applyAuthenticatedUser(profile) {
  if (!profile || !profile.email) return null;
  const email = String(profile.email).trim();
  const derivedName =
    String(profile.name || '').trim() ||
    email
      .split('@')[0]
      .replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());

  const d = S.data;
  d.members = d.members || [];
  let member =
    (profile.id && d.members.find(m => m.id === profile.id)) ||
    (profile.uid && d.members.find(m => m.uid === profile.uid)) ||
    d.members.find(m => String(m.email || '').toLowerCase() === email.toLowerCase());

  if (!member) {
    member = {
      id: profile.id || 'm1',
      uid: profile.uid || '',
      name: derivedName,
      email,
      photoURL: profile.photoURL || '',
      role: profile.role || (d.members.length === 0 ? 'Owner' : 'Member'),
      team: profile.team || 'product',
      title: profile.title || S.prefs.title || (d.members.length === 0 ? 'Workspace Owner' : 'Member'),
      c: profile.c || '#5A67D8',
      status: 'active',
      last: 0,
      tz: profile.tz || 'UTC',
    };
    d.members.unshift(member);
  } else {
    if (profile.name && String(profile.name).trim()) {
      member.name = String(profile.name).trim();
    }
    member.email = email;
    if (profile.photoURL) member.photoURL = profile.photoURL;
    if (profile.uid) member.uid = profile.uid;
    if (profile.role) member.role = profile.role;
    if (profile.title) member.title = profile.title;
    member.status = 'active';
    member.last = 0;
  }

  d.me = member.id;
  S.prefs.name = member.name;
  if (member.title) S.prefs.title = member.title;
  (d.projects || []).forEach(p => {
    p.members = Array.isArray(p.members) ? p.members : [];
    if (!p.members.includes(member.id)) p.members.unshift(member.id);
  });
  save();
  return member;
}

/* ---------- lookups ---------- */
export const D = () => S.data;
export const me = () =>
  D().members.find(m => m.id === D().me) ||
  D().members[0] || {
    id: D().me || 'm1',
    name: S.prefs.name || 'Workspace User',
    email: S.ui.af?.email || '',
    role: 'Owner',
    team: 'product',
    title: S.prefs.title || 'Workspace Owner',
    c: '#5A67D8',
    status: 'active',
    last: 0,
    tz: 'UTC',
  };
export const mem = id => D().members.find(m => m.id === id);
export const proj = id => D().projects.find(p => p.id === id);
export const task = id => D().tasks.find(t => t.id === id);
export const pColor = p => PCOLORS[p?.color] || PCOLORS.slate;
export const visibleProjects = () =>
  D()
    .projOrder.map(proj)
    .filter(Boolean)
    .filter(p => !p.archived);
export const canSee = p => !p || !p.private || (Array.isArray(p.members) && p.members.includes(D().me));
export const tasksOf = pid => D().tasks.filter(t => t.project === pid && !t.archived);
export const allTasks = () => D().tasks.filter(t => !t.archived && canSee(proj(t.project)));
export const isOver = t => t.due && t.status !== 'done' && diffD(parse(t.due), TODAY) < 0;
export const commentsOf = tid => D().comments.filter(c => c.task === tid);
export function progressOf(pid) {
  const ts = tasksOf(pid);
  if (!ts.length) return 0;
  return Math.round((ts.filter(t => t.status === 'done').length / ts.length) * 100);
}
export function taskProg(t) {
  if (t.status === 'done') return 100;
  if (t.subtasks.length) return Math.round((t.subtasks.filter(s => s.done).length / t.subtasks.length) * 100);
  return { backlog: 0, todo: 5, progress: 45, review: 80 }[t.status] || 0;
}

/* ---------- activity + notification helpers ---------- */
export function logAct(verb, t, extra = '') {
  D().activity.unshift({ id: uid('a'), by: D().me, verb, task: t?.id || null, project: t?.project || null, at: Date.now(), extra });
  if (t) t.updated = Date.now();
}

/* ---------- teams (workspace data, seeded on first use) ---------- */
export const NO_TEAM = { id: '', name: 'No team', icon: 'users', c: '#8A867E', desc: '' };
export function teamsList() {
  const d = D();
  if (!d.teams) d.teams = TEAMS_SEED.map(t => ({ ...t }));
  return d.teams;
}
export function team(id) {
  return teamsList().find(t => t.id === id) || null;
}
export const TM = new Proxy({}, { get: (_, k) => team(k) || NO_TEAM });

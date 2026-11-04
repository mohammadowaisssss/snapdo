/* ---------- store ---------- */
import { TODAY, diffD, iso, parse, uid } from './utils.js';
import { PCOLORS, TEAMS_SEED } from './constants.js';
import { seed } from '../data/seed.js';

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
  name: 'Mohammad Owais',
  title: 'Head of Product',
};
function cleanLegacyStore(j) {
  if (!j || !j.data) return j;
  if (j.prefs?.name === 'Tanjim Islam') j.prefs.name = 'Mohammad Owais';
  const m1 = (j.data.members || []).find(m => m.id === 'm1');
  if (m1 && (m1.name === 'Tanjim Islam' || m1.email === 'hello@snapsec.com')) {
    m1.name = j.prefs?.name || 'Mohammad Owais';
    m1.email = 'mohammadowais616@gmail.com';
  }
  return j;
}
export function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const j = JSON.parse(raw);
      if (j && j.data && j.data.tasks) return cleanLegacyStore(j);
    }
  } catch {
    /* storage blocked or corrupt: start from seed data */
  }
  return null;
}
export const saved = load();
export const S = {
  data: saved?.data || seed(),
  prefs: Object.assign({}, DEFAULT_PREFS, saved?.prefs || {}),
  views: saved?.views || {},
  ui: {
    fx: {},
    auth: null,
    authStep: 'login',
    onb: 0,
    onbData: { use: 'product', team: 'kanban', size: '2-10', ws: '', proj: 'Website Launch', tmpl: 'web', invites: '' },
    route: 'home',
    params: {},
    history: [],
    collapsed: !!saved?.collapsed,
    mnav: false,
    expanded: { p1: true },
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
export let _saveT;
export function save() {
  _localMutCount++;
  const payload = { data: S.data, prefs: S.prefs, views: S.views, collapsed: S.ui.collapsed };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(payload));
  } catch {
    /* storage full or blocked: keep working in memory */
  }
  if (!S.ui.offline && typeof fetch !== 'undefined') {
    api.syncState(payload).catch(() => {
      /* offline or network error: local state remains cached */
    });
  }
}

export async function hydrateFromBackend(onHydrated) {
  try {
    const snapCount = _localMutCount;
    const remote = await api.bootstrap();
    if (_localMutCount === snapCount && remote && remote.data && Array.isArray(remote.data.tasks)) {
      cleanLegacyStore(remote);
      S.data = remote.data;
      S.prefs = Object.assign({}, DEFAULT_PREFS, remote.prefs || {});
      S.views = remote.views || {};
      S.ui.collapsed = !!remote.collapsed;
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
    /* fallback to local seed/cache if backend unreachable */
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
    (profile.uid && d.members.find(m => m.uid === profile.uid)) ||
    d.members.find(m => String(m.email || '').toLowerCase() === email.toLowerCase());

  if (!member) {
    const primaryOwner = d.members.find(m => m.id === 'm1') || d.members[0];
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
        title: S.prefs.title || 'Head of Product',
        c: '#5A67D8',
        status: 'active',
        last: 0,
        tz: 'San Francisco',
      };
      d.members.unshift(member);
    }
  } else {
    if (profile.name && String(profile.name).trim()) {
      member.name = String(profile.name).trim();
    }
    member.email = email;
    if (profile.photoURL) member.photoURL = profile.photoURL;
    if (profile.uid) member.uid = profile.uid;
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
export const me = () => D().members.find(m => m.id === D().me) || D().members[0];
export const mem = id => D().members.find(m => m.id === id);
export const proj = id => D().projects.find(p => p.id === id);
export const task = id => D().tasks.find(t => t.id === id);
export const pColor = p => PCOLORS[p?.color] || PCOLORS.slate;
export const visibleProjects = () =>
  D()
    .projOrder.map(proj)
    .filter(Boolean)
    .filter(p => !p.archived);
export const canSee = p => !p.private || p.members.includes(D().me);
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

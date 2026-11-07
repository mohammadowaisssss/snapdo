/* ---------- vocab ---------- */
export const DEFAULT_STATUSES = [
  { id: 'backlog', name: 'Backlog', c: '#8A867E', kind: 'backlog' },
  { id: 'todo', name: 'To Do', c: '#6B7280', kind: 'todo' },
  { id: 'progress', name: 'In Progress', c: '#3B82C4', kind: 'progress' },
  { id: 'review', name: 'Review', c: '#C48A1E', kind: 'review' },
  { id: 'done', name: 'Done', c: '#3D8E5F', kind: 'done' },
];
export const STATUSES = DEFAULT_STATUSES.map(s => ({ ...s }));
const _ST = Object.fromEntries(STATUSES.map(s => [s.id, s]));
export const ST = new Proxy(_ST, {
  get(target, prop) {
    if (typeof prop !== 'string') return target[prop];
    return (
      target[prop] || {
        id: prop,
        name: prop.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        c: '#6B7280',
        kind: prop === 'done' ? 'done' : 'todo',
      }
    );
  },
});
export function syncStatuses(customList) {
  const source = Array.isArray(customList) && customList.length > 0 ? customList : DEFAULT_STATUSES;
  const normalized = source
    .filter(s => s && typeof s.id === 'string' && s.id.trim() && typeof s.name === 'string' && s.name.trim())
    .map(s => {
      const id = String(s.id).trim();
      const def = DEFAULT_STATUSES.find(d => d.id === id);
      return {
        id,
        name: String(s.name).trim(),
        c: String(s.c || def?.c || '#5A67D8').trim(),
        kind: String(s.kind || def?.kind || (id === 'done' ? 'done' : 'todo')).trim(),
      };
    });
  const next = normalized.length > 0 ? normalized : DEFAULT_STATUSES.map(s => ({ ...s }));
  STATUSES.splice(0, STATUSES.length, ...next);
  for (const k of Object.keys(_ST)) delete _ST[k];
  for (const s of STATUSES) _ST[s.id] = s;
  return STATUSES;
}
export const PRIOS = [
  { id: 'urgent', name: 'Urgent', w: 4 },
  { id: 'high', name: 'High', w: 3 },
  { id: 'medium', name: 'Medium', w: 2 },
  { id: 'low', name: 'Low', w: 1 },
  { id: 'none', name: 'No priority', w: 0 },
];
export const PR = Object.fromEntries(PRIOS.map(p => [p.id, p]));
export const LABELS = [
  { id: 'design', name: 'Design', c: 'var(--violet)' },
  { id: 'frontend', name: 'Frontend', c: 'var(--blue)' },
  { id: 'backend', name: 'Backend', c: 'var(--teal)' },
  { id: 'research', name: 'Research', c: 'var(--amber)' },
  { id: 'content', name: 'Content', c: 'var(--rose)' },
  { id: 'bug', name: 'Bug', c: 'var(--red)' },
  { id: 'qa', name: 'QA', c: 'var(--green)' },
  { id: 'growth', name: 'Growth', c: 'var(--orange)' },
];
export const LB = Object.fromEntries(LABELS.map(l => [l.id, l]));
export const DEFAULT_PROJECT_STATUSES = [
  { id: 'planning', name: 'Planning', c: '#6B7280', kind: 'planning' },
  { id: 'active', name: 'In Progress', c: '#3B82C4', kind: 'active' },
  { id: 'risk', name: 'At Risk', c: '#E05252', kind: 'risk' },
  { id: 'hold', name: 'On Hold', c: '#C48A1E', kind: 'hold' },
  { id: 'complete', name: 'Completed', c: '#3D8E5F', kind: 'complete' },
];
export const PROJECT_STATUSES = DEFAULT_PROJECT_STATUSES.map(s => ({ ...s }));
const _PSTAT = Object.fromEntries(PROJECT_STATUSES.map(s => [s.id, s]));
export const PSTAT = new Proxy(_PSTAT, {
  get(target, prop) {
    if (typeof prop !== 'string') return target[prop];
    return (
      target[prop] || {
        id: prop,
        name: prop.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        c: '#6B7280',
        kind: prop === 'complete' ? 'complete' : 'active',
      }
    );
  },
});
export function syncProjectStatuses(customList) {
  const source = Array.isArray(customList) && customList.length > 0 ? customList : DEFAULT_PROJECT_STATUSES;
  const normalized = source
    .filter(s => s && typeof s.id === 'string' && s.id.trim() && typeof s.name === 'string' && s.name.trim())
    .map(s => {
      const id = String(s.id).trim();
      const def = DEFAULT_PROJECT_STATUSES.find(d => d.id === id);
      return {
        id,
        name: String(s.name).trim(),
        c: String(s.c || def?.c || '#3B82C4').trim(),
        kind: String(s.kind || def?.kind || (id === 'complete' ? 'complete' : 'active')).trim(),
      };
    });
  const next = normalized.length > 0 ? normalized : DEFAULT_PROJECT_STATUSES.map(s => ({ ...s }));
  PROJECT_STATUSES.splice(0, PROJECT_STATUSES.length, ...next);
  for (const k of Object.keys(_PSTAT)) delete _PSTAT[k];
  for (const s of PROJECT_STATUSES) _PSTAT[s.id] = s;
  return PROJECT_STATUSES;
}
export const PCOLORS = {
  indigo: '#5A67D8',
  blue: '#3B82C4',
  violet: '#8662C9',
  teal: '#23918A',
  rose: '#C54B78',
  amber: '#C48A1E',
  green: '#3D8E5F',
  slate: '#6B7280',
};
export const PICONS = [
  'globe',
  'smartphone',
  'megaphone',
  'rocket',
  'component',
  'building-2',
  'layout-grid',
  'palette',
  'code',
  'briefcase',
  'target',
  'layers',
  'zap',
  'heart',
  'folder',
  'sparkles',
];
export const ROLES = ['Owner', 'Admin', 'Member', 'Guest'];
export const TEAMS_SEED = [
  { id: 'design', name: 'Design', icon: 'palette', c: '#8662C9', desc: 'Product design, brand, and research' },
  { id: 'eng', name: 'Engineering', icon: 'code', c: '#3B82C4', desc: 'Web, mobile, and platform engineering' },
  { id: 'mkt', name: 'Marketing', icon: 'megaphone', c: '#C54B78', desc: 'Campaigns, content, and growth' },
  { id: 'product', name: 'Product', icon: 'target', c: '#C48A1E', desc: 'Roadmap, planning, and QA' },
];

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_STATUSES, PCOLORS, PR, PSTAT, ST, TEAMS_SEED, syncStatuses } from '../utils/constants.js';
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
import { TODAY, addD, dOff, diffD, esc, fmtDate, iso, parse, uid } from '../utils/utils.js';
import {
  DEFAULT_PREFS,
  EMAIL_REGEX,
  PROJECT_TEMPLATES,
  PersistedStore,
  RECUR_DAYS,
  createDefaultState,
  detectFileType,
  isSnapsecCompanyEmail,
  makeProjectKey,
} from '../services/engine.ts';
import {
  DEFAULT_SEED_EMAIL,
  DEFAULT_SEED_NAME,
  DEFAULT_SEED_PASSWORD,
  FALLBACK_SEED_PASSWORDS,
  generateAuthToken,
  generateOtpCode,
  generateSecureToken,
  hashPassword,
  verifyAuthToken,
  verifyPassword,
} from '../services/token.ts';
import {
  DATA_DIR,
  createPgPool,
  ensurePgSchema,
  getSqliteConnection,
  isPostgresConfigured,
  sqliteDb,
} from './index.ts';
import {
  sqliteActivityLogs,
  sqliteComments,
  sqliteFiles,
  sqliteMembers,
  sqliteNotifications,
  sqliteOutboxEmails,
  sqliteProjects,
  sqliteSavedViews,
  sqliteSessions,
  sqliteSubtasks,
  sqliteTasks,
  sqliteTeams,
  sqliteWorkspaces,
} from './schema.ts';

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

const ALLOWED_MEMBER_PATCH_KEYS = new Set([
  'name',
  'email',
  'role',
  'team',
  'title',
  'c',
  'status',
  'tz',
  'photoURL',
]);

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function touchWorkspaceRow(now = Date.now()) {
  const conn = getSqliteConnection();
  conn.prepare(`UPDATE workspaces SET updated_at = ? WHERE id = 'ws_main'`).run(now);
  return now;
}

function insertActivityRow(
  actorId: string,
  verb: string,
  taskId: string | null = null,
  projectId: string | null = null,
  extra = '',
  at = Date.now(),
) {
  sqliteDb
    .insert(sqliteActivityLogs)
    .values({
      id: uid('a'),
      actorId: actorId || 'm1',
      verb,
      taskId,
      projectId,
      createdAt: at,
      extra: extra || '',
    })
    .run();
}

function getCurrentMeId(): string {
  const row = sqliteDb
    .select({ meMemberId: sqliteWorkspaces.meMemberId })
    .from(sqliteWorkspaces)
    .where(eq(sqliteWorkspaces.id, 'ws_main'))
    .get();
  return row?.meMemberId || 'm1';
}

function isTestRuntime(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    process.execArgv.includes('--test') ||
    process.argv.includes('--test')
  );
}

export function createCleanProductionState(): PersistedStore {
  return {
    data: {
      ws: { name: 'Snapsec', url: 'snapsec', c: '#2F2E2A', brand: true },
      workspaces: [{ id: 'w1', name: 'Snapsec', c: '#2F2E2A', brand: true, plan: 'Business' }],
      plan: 'Business',
      me: 'm_shoaib',
      tfa: false,
      statuses: DEFAULT_STATUSES.map((s: any) => ({ ...s })),
      teams: TEAMS_SEED.map((t: any) => ({ ...t })),
      members: [
        {
          id: 'm_shoaib',
          name: DEFAULT_SEED_NAME,
          email: DEFAULT_SEED_EMAIL,
          passwordHash: hashPassword(DEFAULT_SEED_PASSWORD),
          emailVerified: true,
          role: 'Owner',
          team: 'product',
          title: 'Workspace Owner',
          c: '#5A67D8',
          status: 'active',
          last: 0,
          tz: 'UTC',
        },
      ],
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
    },
    prefs: { ...DEFAULT_PREFS, name: DEFAULT_SEED_NAME, title: 'Workspace Owner' },
    views: {},
    collapsed: false,
    updatedAt: Date.now(),
  };
}

/**
 * Ensures the mandatory seed account (shoaib@snapsec.co) always exists with a default password and verified status.
 */
export function ensureSeedAccountSql(): void {
  const conn = getSqliteConnection();
  const existingSeed = conn
    .prepare(`SELECT id, password_hash, email_verified FROM members WHERE LOWER(email) = LOWER(?) LIMIT 1`)
    .get(DEFAULT_SEED_EMAIL) as { id: string; password_hash: string | null; email_verified: number } | undefined;

  if (!existingSeed) {
    const idExists = conn.prepare(`SELECT id FROM members WHERE id = 'm_shoaib' LIMIT 1`).get();
    const seedId = idExists ? uid('m') : 'm_shoaib';
    sqliteDb
      .insert(sqliteMembers)
      .values({
        id: seedId,
        name: DEFAULT_SEED_NAME,
        email: DEFAULT_SEED_EMAIL,
        passwordHash: hashPassword(DEFAULT_SEED_PASSWORD),
        emailVerified: true,
        role: 'Owner',
        teamId: 'product',
        title: 'Workspace Owner',
        color: '#5A67D8',
        status: 'active',
        lastSeen: 0,
        tz: 'UTC',
      })
      .run();
  } else if (!existingSeed.password_hash || !existingSeed.email_verified) {
    conn
      .prepare(
        `UPDATE members SET password_hash = COALESCE(NULLIF(password_hash, ''), ?), email_verified = 1, status = 'active' WHERE id = ?`,
      )
      .run(hashPassword(DEFAULT_SEED_PASSWORD), existingSeed.id);
  }
}

/**
 * Ensures the relational database is initialized and seeded.
 * Always keeps the seed account (shoaib@snapsec.co) present with its default password.
 */
export function ensureRelationalDatabaseSeeded(): void {
  const conn = getSqliteConnection();
  const isTest = isTestRuntime();
  const existing = conn.prepare(`SELECT id FROM workspaces WHERE id = 'ws_main' LIMIT 1`).get();
  if (existing) {
    if (!isTest) {
      // If database still has legacy unauthenticated seed data (e.g. sarah@snapsec.com and 0 password hashes), wipe fake data once
      const fakeSeedMember = conn
        .prepare(`SELECT id FROM members WHERE LOWER(email) = 'sarah@snapsec.com' LIMIT 1`)
        .get();
      if (fakeSeedMember) {
        populateAllTablesTransaction(createCleanProductionState());
      }
    } else {
      conn
        .prepare(
          `UPDATE members SET name = 'Mohammad Owais', email = 'mohammadowais616@gmail.com'
           WHERE id = 'm1' AND (name = 'Tanjim Islam' OR email = 'hello@snapsec.com')`,
        )
        .run();
    }
    ensureSeedAccountSql();
    return;
  }

  const initialStore = isTest ? createDefaultState() : createCleanProductionState();
  populateAllTablesTransaction(initialStore);
  ensureSeedAccountSql();
}

/**
 * Atomically populates all normalized relational tables inside a single ACID SQL transaction.
 */
export function populateAllTablesTransaction(store: PersistedStore): number {
  const conn = getSqliteConnection();
  const d = store.data || {};
  const now = Date.now();

  const tx = conn.transaction(() => {
    conn.prepare(`DELETE FROM subtasks`).run();
    conn.prepare(`DELETE FROM comments`).run();
    conn.prepare(`DELETE FROM files`).run();
    conn.prepare(`DELETE FROM tasks`).run();
    conn.prepare(`DELETE FROM projects`).run();
    conn.prepare(`DELETE FROM members`).run();
    conn.prepare(`DELETE FROM teams`).run();
    conn.prepare(`DELETE FROM notifications`).run();
    conn.prepare(`DELETE FROM activity_logs`).run();
    conn.prepare(`DELETE FROM saved_views`).run();
    conn.prepare(`DELETE FROM outbox_emails`).run();
    conn.prepare(`DELETE FROM sessions`).run();
    conn.prepare(`DELETE FROM workspaces`).run();

    const ws = d.ws || { name: 'Snapsec', url: 'snapsec', c: '#2F2E2A', brand: true };
    const statuses =
      Array.isArray(d.statuses) && d.statuses.length > 0
        ? d.statuses
        : DEFAULT_STATUSES.map((s: any) => ({ ...s }));
    syncStatuses(statuses);
    const prefs: Record<string, any> = { ...DEFAULT_PREFS, ...(store.prefs || {}), statuses };
    if (prefs.name === 'Tanjim Islam') prefs.name = 'Mohammad Owais';

    sqliteDb
      .insert(sqliteWorkspaces)
      .values({
        id: 'ws_main',
        name: safeString(ws.name, 120, 'Snapsec') || 'Snapsec',
        url: safeString(ws.url, 120, 'snapsec') || 'snapsec',
        color: safeCssColor(ws.c, '#2F2E2A'),
        brand: ws.brand !== undefined ? Boolean(ws.brand) : true,
        plan: safeString(d.plan, 40, 'Business') || 'Business',
        meMemberId: safeString(d.me, 80, 'm1') || 'm1',
        tfa: Boolean(d.tfa),
        projOrderJson: JSON.stringify(Array.isArray(d.projOrder) ? d.projOrder : []),
        workspacesListJson: JSON.stringify(Array.isArray(d.workspaces) ? d.workspaces : []),
        prefsJson: JSON.stringify(prefs),
        notifPrefsJson: JSON.stringify(d.notifPrefs || {}),
        viewsJson: JSON.stringify(store.views || {}),
        collapsed: Boolean(store.collapsed),
        smtpConfigJson: JSON.stringify(d.smtpConfig || null),
        updatedAt: now,
      })
      .run();

    const teams = Array.isArray(d.teams) && d.teams.length ? d.teams : TEAMS_SEED;
    for (const tm of teams) {
      sqliteDb
        .insert(sqliteTeams)
        .values({
          id: String(tm.id),
          name: String(tm.name || 'Team'),
          desc: String(tm.desc || ''),
          icon: String(tm.icon || 'users'),
          color: String(tm.c || '#23918A'),
        })
        .run();
    }

    for (const m of d.members || []) {
      const isLegacyOwner = m.id === 'm1' && (m.name === 'Tanjim Islam' || m.email === 'hello@snapsec.com');
      sqliteDb
        .insert(sqliteMembers)
        .values({
          id: String(m.id),
          uid: m.uid ? String(m.uid) : null,
          name: isLegacyOwner ? prefs.name || 'Mohammad Owais' : String(m.name || 'Member'),
          email: isLegacyOwner ? 'mohammadowais616@gmail.com' : String(m.email || ''),
          passwordHash: m.passwordHash ? String(m.passwordHash) : null,
          emailVerified: Boolean(m.emailVerified),
          photoUrl: m.photoURL ? String(m.photoURL) : null,
          role: String(m.role || 'Member'),
          teamId: String(m.team ?? ''),
          title: String(m.title || m.role || 'Member'),
          color: String(m.c || '#5A67D8'),
          status: String(m.status || 'active'),
          lastSeen: typeof m.last === 'number' ? m.last : null,
          tz: String(m.tz || '—'),
          inviteToken: m.inviteToken ? String(m.inviteToken) : null,
          inviteUrl: m.inviteUrl ? String(m.inviteUrl) : null,
          lastInviteId: m.lastInviteId ? String(m.lastInviteId) : null,
          invitedAt: typeof m.invitedAt === 'number' ? m.invitedAt : null,
        })
        .run();
    }

    const projOrder: string[] = Array.isArray(d.projOrder) ? d.projOrder : [];
    (d.projects || []).forEach((p: any, idx: number) => {
      const orderIdx = projOrder.indexOf(p.id);
      sqliteDb
        .insert(sqliteProjects)
        .values({
          id: String(p.id),
          key: String(p.key || 'PRJ'),
          seq: Number(p.seq || 200),
          name: String(p.name || 'Untitled Project'),
          icon: String(p.icon || 'folder'),
          color: String(p.color || 'indigo'),
          status: String(p.status || 'planning'),
          teamId: String(p.team ?? 'product'),
          leadId: String(p.lead || 'm1'),
          due: p.due ? String(p.due) : null,
          start: p.start ? String(p.start) : null,
          fav: Boolean(p.fav),
          membersJson: JSON.stringify(Array.isArray(p.members) ? p.members : []),
          desc: String(p.desc || ''),
          milestonesJson: JSON.stringify(Array.isArray(p.milestones) ? p.milestones : []),
          lastOpened: Number(p.last || 0),
          archived: Boolean(p.archived),
          archivedAt: typeof p.archivedAt === 'number' ? p.archivedAt : null,
          private: Boolean(p.private),
          access: String(p.access || 'workspace'),
          permsJson: JSON.stringify(p.perms || {}),
          sortOrder: orderIdx >= 0 ? orderIdx : idx,
        })
        .run();
    });

    const insertedFileIds = new Set<string>();

    for (const t of d.tasks || []) {
      sqliteDb
        .insert(sqliteTasks)
        .values({
          id: String(t.id),
          key: String(t.key || 'TSK-1'),
          projectId: String(t.project || 'p1'),
          title: String(t.title || 'Untitled'),
          status: String(t.status || 'todo'),
          assigneeId: t.assignee ? String(t.assignee) : null,
          priority: String(t.priority || 'none'),
          due: t.due ? String(t.due) : null,
          start: t.start ? String(t.start) : null,
          labelsJson: JSON.stringify(Array.isArray(t.labels) ? t.labels : []),
          depsJson: JSON.stringify(Array.isArray(t.deps) ? t.deps : []),
          desc: String(t.desc || ''),
          estimate: t.estimate != null ? String(t.estimate) : null,
          createdAt: Number(t.created || now),
          updatedAt: Number(t.updated || now),
          sortOrder: Number(t.order || 0),
          fav: Boolean(t.fav),
          recur: t.recur ? String(t.recur) : null,
          archived: Boolean(t.archived),
          archivedAt: typeof t.archivedAt === 'number' ? t.archivedAt : null,
          completedAt: typeof t.completedAt === 'number' ? t.completedAt : null,
          prevStatus: t.prevStatus ? String(t.prevStatus) : null,
        })
        .run();

      (t.subtasks || []).forEach((s: any, sIdx: number) => {
        sqliteDb
          .insert(sqliteSubtasks)
          .values({
            id: String(s.id || uid('s')),
            taskId: String(t.id),
            title: String(s.title || ''),
            done: Boolean(s.done),
            assigneeId: s.assignee ? String(s.assignee) : null,
            due: s.due ? String(s.due) : null,
            note: String(s.note || ''),
            sortOrder: sIdx,
          })
          .run();
      });

      (t.attachments || []).forEach((att: any) => {
        const fid = String(att.id || uid('f'));
        if (insertedFileIds.has(fid)) return;
        insertedFileIds.add(fid);
        sqliteDb
          .insert(sqliteFiles)
          .values({
            id: fid,
            name: String(att.name || 'attachment'),
            type: String(att.type || detectFileType(String(att.name || 'attachment'))),
            size: String(att.size || '24 KB'),
            authorId: String(att.by || d.me || 'm1'),
            createdAt: Number(att.at || now),
            projectId: String(t.project || 'p1'),
            taskId: String(t.id),
            commentId: att.commentId ? String(att.commentId) : null,
            dataUrl: att.dataUrl ? String(att.dataUrl) : null,
            textContent: typeof att.textContent === 'string' ? att.textContent : null,
            mime: att.mime ? String(att.mime) : null,
          })
          .run();
      });
    }

    for (const c of d.comments || []) {
      sqliteDb
        .insert(sqliteComments)
        .values({
          id: String(c.id),
          taskId: String(c.task),
          authorId: String(c.by || 'm1'),
          createdAt: Number(c.at || now),
          text: String(c.text || '').replace(/@Tanjim Islam/g, '@Mohammad Owais'),
          reactionsJson: JSON.stringify(c.re || {}),
        })
        .run();

      (c.attachments || []).forEach((att: any) => {
        const fid = String(att.id || uid('f'));
        if (insertedFileIds.has(fid)) {
          conn.prepare(`UPDATE files SET comment_id = ? WHERE id = ?`).run(String(c.id), fid);
          return;
        }
        insertedFileIds.add(fid);
        sqliteDb
          .insert(sqliteFiles)
          .values({
            id: fid,
            name: String(att.name || 'attachment'),
            type: String(att.type || detectFileType(String(att.name || 'attachment'))),
            size: String(att.size || '24 KB'),
            authorId: String(att.by || c.by || 'm1'),
            createdAt: Number(att.at || c.at || now),
            projectId: String(att.project || 'p1'),
            taskId: String(c.task),
            commentId: String(c.id),
            dataUrl: att.dataUrl ? String(att.dataUrl) : null,
            textContent: typeof att.textContent === 'string' ? att.textContent : null,
            mime: att.mime ? String(att.mime) : null,
          })
          .run();
      });
    }

    for (const f of d.files || []) {
      const fid = String(f.id || uid('f'));
      if (insertedFileIds.has(fid)) continue;
      insertedFileIds.add(fid);
      sqliteDb
        .insert(sqliteFiles)
        .values({
          id: fid,
          name: String(f.name || 'file'),
          type: String(f.type || detectFileType(String(f.name || 'file'))),
          size: String(f.size || '120 KB'),
          authorId: String(f.by || 'm1'),
          createdAt: Number(f.at || now),
          projectId: String(f.project || 'p1'),
          taskId: f.task ? String(f.task) : null,
          commentId: f.commentId ? String(f.commentId) : null,
          dataUrl: f.dataUrl ? String(f.dataUrl) : null,
          textContent: typeof f.textContent === 'string' ? f.textContent : null,
          mime: f.mime ? String(f.mime) : null,
        })
        .run();
    }

    for (const n of d.notifs || []) {
      sqliteDb
        .insert(sqliteNotifications)
        .values({
          id: String(n.id),
          type: String(n.type || 'mention'),
          actorId: String(n.by || 'm1'),
          taskId: n.task ? String(n.task) : null,
          projectId: n.project ? String(n.project) : null,
          text: String(n.text || ''),
          snippet: String(n.snippet || '').replace(/@Tanjim Islam/g, '@Mohammad Owais'),
          createdAt: Number(n.at || now),
          read: Boolean(n.read),
        })
        .run();
    }

    for (const a of d.activity || []) {
      sqliteDb
        .insert(sqliteActivityLogs)
        .values({
          id: String(a.id || uid('a')),
          actorId: String(a.by || 'm1'),
          verb: String(a.verb || 'updated'),
          taskId: a.task ? String(a.task) : null,
          projectId: a.project ? String(a.project) : null,
          createdAt: Number(a.at || now),
          extra: String(a.extra || ''),
        })
        .run();
    }

    for (const sv of d.savedViews || []) {
      sqliteDb
        .insert(sqliteSavedViews)
        .values({
          id: String(sv.id || uid('v')),
          projectId: String(sv.project || 'p1'),
          name: String(sv.name || 'Untitled view'),
          type: String(sv.type || 'list'),
          filtersJson: JSON.stringify(Array.isArray(sv.filters) ? sv.filters : []),
        })
        .run();
    }

    for (const o of d.outbox || []) {
      sqliteDb
        .insert(sqliteOutboxEmails)
        .values({
          id: String(o.id || uid('em')),
          memberId: o.memberId ? String(o.memberId) : null,
          toEmail: String(o.to || ''),
          toName: String(o.toName || ''),
          fromEmail: String(o.from || 'mohammadowais616@gmail.com'),
          fromName: String(o.fromName || 'Mohammad Owais'),
          subject: String(o.subject || ''),
          textBody: String(o.text || ''),
          htmlBody: String(o.html || ''),
          inviteToken: o.inviteToken ? String(o.inviteToken) : null,
          inviteUrl: o.inviteUrl ? String(o.inviteUrl) : null,
          role: String(o.role || 'Member'),
          teamId: String(o.team || 'product'),
          projectName: o.projectName ? String(o.projectName) : null,
          sentAt: Number(o.sentAt || now),
          acceptedAt: typeof o.acceptedAt === 'number' ? o.acceptedAt : null,
          status: String(o.status || 'sent'),
          transport: o.transport ? String(o.transport) : null,
          deliveredToInbox: Boolean(o.deliveredToInbox),
          previewUrl: o.previewUrl ? String(o.previewUrl) : null,
          gmailComposeUrl: o.gmailComposeUrl ? String(o.gmailComposeUrl) : null,
          mailtoUrl: o.mailtoUrl ? String(o.mailtoUrl) : null,
          messageId: o.messageId ? String(o.messageId) : null,
          transportError: o.transportError ? String(o.transportError) : null,
          oauthError: o.oauthError ? String(o.oauthError) : null,
        })
        .run();
    }

    for (const s of d.sessions || []) {
      sqliteDb
        .insert(sqliteSessions)
        .values({
          id: String(s.id || uid('ss')),
          device: String(s.device || 'Chrome on macOS'),
          loc: String(s.loc || 'San Francisco, US'),
          ip: String(s.ip || '127.0.0.1'),
          lastActive: String(s.last || 'Active now'),
          isCurrent: Boolean(s.cur),
        })
        .run();
    }
  });

  tx();
  return now;
}

/* ============================================================================
   ROW MAPPERS (SQL Row -> API Domain Shape)
   ============================================================================ */

function mapMemberRow(r: typeof sqliteMembers.$inferSelect) {
  return {
    id: r.id,
    ...(r.uid ? { uid: r.uid } : {}),
    name: r.name,
    email: r.email,
    ...(r.photoUrl ? { photoURL: r.photoUrl } : {}),
    role: r.role,
    team: r.teamId,
    title: r.title,
    c: r.color,
    status: r.status,
    last: r.lastSeen,
    tz: r.tz,
    emailVerified: Boolean(r.emailVerified),
    ...(r.verifyToken ? { verifyToken: r.verifyToken } : {}),
    ...(r.inviteToken ? { inviteToken: r.inviteToken } : {}),
    ...(r.inviteUrl ? { inviteUrl: r.inviteUrl } : {}),
    ...(r.lastInviteId ? { lastInviteId: r.lastInviteId } : {}),
    ...(r.invitedAt != null ? { invitedAt: r.invitedAt } : {}),
  };
}

function mapProjectRow(r: typeof sqliteProjects.$inferSelect) {
  return {
    id: r.id,
    key: r.key,
    seq: r.seq,
    name: r.name,
    icon: r.icon,
    color: r.color,
    status: r.status,
    team: r.teamId,
    lead: r.leadId,
    due: r.due,
    start: r.start,
    fav: Boolean(r.fav),
    members: safeJsonParse<string[]>(r.membersJson, []),
    desc: r.desc,
    milestones: safeJsonParse<any[]>(r.milestonesJson, []),
    last: r.lastOpened,
    archived: Boolean(r.archived),
    ...(r.archivedAt != null ? { archivedAt: r.archivedAt } : {}),
    ...(r.private ? { private: true } : {}),
    ...(r.access && r.access !== 'workspace' ? { access: r.access } : {}),
    ...(r.permsJson && r.permsJson !== '{}' ? { perms: safeJsonParse(r.permsJson, {}) } : {}),
  };
}

function mapFileRow(r: typeof sqliteFiles.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    size: r.size,
    by: r.authorId,
    at: r.createdAt,
    project: r.projectId,
    task: r.taskId,
    commentId: r.commentId,
    dataUrl: r.dataUrl,
    textContent: r.textContent,
    mime: r.mime,
  };
}

function mapSubtaskRow(r: typeof sqliteSubtasks.$inferSelect) {
  return {
    id: r.id,
    title: r.title,
    done: Boolean(r.done),
    ...(r.assigneeId ? { assignee: r.assigneeId } : {}),
    ...(r.due ? { due: r.due } : {}),
    ...(r.note ? { note: r.note } : {}),
  };
}

function mapTaskRow(
  r: typeof sqliteTasks.$inferSelect,
  subtasks: any[] = [],
  attachments: any[] = [],
) {
  return {
    id: r.id,
    key: r.key,
    project: r.projectId,
    title: r.title,
    status: r.status,
    assignee: r.assigneeId,
    priority: r.priority,
    due: r.due,
    start: r.start,
    labels: safeJsonParse<string[]>(r.labelsJson, []),
    subtasks,
    attachments,
    deps: safeJsonParse<string[]>(r.depsJson, []),
    desc: r.desc,
    estimate: r.estimate,
    created: r.createdAt,
    updated: r.updatedAt,
    order: r.sortOrder,
    fav: Boolean(r.fav),
    recur: r.recur,
    archived: Boolean(r.archived),
    ...(r.archivedAt != null ? { archivedAt: r.archivedAt } : {}),
    completedAt: r.completedAt,
    ...(r.prevStatus ? { prevStatus: r.prevStatus } : {}),
  };
}

function mapCommentRow(r: typeof sqliteComments.$inferSelect, attachments: any[] = []) {
  return {
    id: r.id,
    task: r.taskId,
    by: r.authorId,
    at: r.createdAt,
    text: r.text,
    attachments,
    re: safeJsonParse<Record<string, string[]>>(r.reactionsJson, {}),
  };
}

function mapOutboxRow(r: typeof sqliteOutboxEmails.$inferSelect) {
  return {
    id: r.id,
    memberId: r.memberId,
    to: r.toEmail,
    toName: r.toName,
    from: r.fromEmail,
    fromName: r.fromName,
    subject: r.subject,
    text: r.textBody,
    html: r.htmlBody,
    inviteToken: r.inviteToken,
    inviteUrl: r.inviteUrl,
    role: r.role,
    team: r.teamId,
    projectName: r.projectName,
    sentAt: r.sentAt,
    ...(r.acceptedAt != null ? { acceptedAt: r.acceptedAt } : {}),
    status: r.status,
    ...(r.transport ? { transport: r.transport } : {}),
    deliveredToInbox: Boolean(r.deliveredToInbox),
    previewUrl: r.previewUrl,
    gmailComposeUrl: r.gmailComposeUrl,
    mailtoUrl: r.mailtoUrl,
    ...(r.messageId ? { messageId: r.messageId } : {}),
    ...(r.transportError ? { transportError: r.transportError } : {}),
    ...(r.oauthError ? { oauthError: r.oauthError } : {}),
  };
}

/* ============================================================================
   INDEXED SQL AGGREGATES & BOOTSTRAP QUERIES
   ============================================================================ */

export function queryWorkspaceMetrics() {
  ensureRelationalDatabaseSeeded();
  const conn = getSqliteConnection();
  const wsRow = sqliteDb
    .select({
      name: sqliteWorkspaces.name,
      meMemberId: sqliteWorkspaces.meMemberId,
      updatedAt: sqliteWorkspaces.updatedAt,
    })
    .from(sqliteWorkspaces)
    .where(eq(sqliteWorkspaces.id, 'ws_main'))
    .get();

  const meId = wsRow?.meMemberId || 'm1';
  const todayIso = iso(TODAY);

  const projStats = conn
    .prepare(`SELECT COUNT(*) AS cnt FROM projects WHERE archived = 0`)
    .get() as { cnt: number };

  const taskStats = conn
    .prepare(
      `SELECT
         COUNT(*) AS totalTasks,
         SUM(CASE WHEN status != 'done' THEN 1 ELSE 0 END) AS openTasks,
         SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS completedTasks,
         SUM(CASE WHEN status != 'done' AND assignee_id = ? THEN 1 ELSE 0 END) AS myOpenTasks,
         SUM(CASE WHEN status != 'done' AND due IS NOT NULL AND due < ? THEN 1 ELSE 0 END) AS overdueTasks,
         SUM(CASE WHEN status != 'done' AND due = ? THEN 1 ELSE 0 END) AS dueTodayTasks
       FROM tasks
       WHERE archived = 0`,
    )
    .get(meId, todayIso, todayIso) as Record<string, number | null>;

  const notifStats = conn
    .prepare(`SELECT COUNT(*) AS cnt FROM notifications WHERE read = 0`)
    .get() as { cnt: number };

  const memStats = conn.prepare(`SELECT COUNT(*) AS cnt FROM members`).get() as { cnt: number };
  const teamStats = conn.prepare(`SELECT COUNT(*) AS cnt FROM teams`).get() as { cnt: number };

  return {
    workspaceName: wsRow?.name || 'Snapsec',
    totalProjects: Number(projStats?.cnt || 0),
    totalTasks: Number(taskStats?.totalTasks || 0),
    openTasks: Number(taskStats?.openTasks || 0),
    completedTasks: Number(taskStats?.completedTasks || 0),
    myOpenTasks: Number(taskStats?.myOpenTasks || 0),
    overdueTasks: Number(taskStats?.overdueTasks || 0),
    dueTodayTasks: Number(taskStats?.dueTodayTasks || 0),
    unreadNotifications: Number(notifStats?.cnt || 0),
    totalMembers: Number(memStats?.cnt || 0),
    totalTeams: Number(teamStats?.cnt || 0),
    updatedAt: wsRow?.updatedAt || Date.now(),
  };
}

export function queryBootstrapStore(): PersistedStore {
  ensureRelationalDatabaseSeeded();
  const wsRow = sqliteDb
    .select()
    .from(sqliteWorkspaces)
    .where(eq(sqliteWorkspaces.id, 'ws_main'))
    .get()!;

  const teamRows = sqliteDb.select().from(sqliteTeams).all();
  const memberRows = sqliteDb.select().from(sqliteMembers).all();
  const projectRows = sqliteDb.select().from(sqliteProjects).orderBy(asc(sqliteProjects.sortOrder)).all();
  const taskRows = sqliteDb.select().from(sqliteTasks).orderBy(asc(sqliteTasks.sortOrder)).all();
  const subtaskRows = sqliteDb.select().from(sqliteSubtasks).orderBy(asc(sqliteSubtasks.sortOrder)).all();
  const commentRows = sqliteDb.select().from(sqliteComments).orderBy(asc(sqliteComments.createdAt)).all();
  const fileRows = sqliteDb.select().from(sqliteFiles).orderBy(desc(sqliteFiles.createdAt)).all();
  const notifRows = sqliteDb.select().from(sqliteNotifications).orderBy(desc(sqliteNotifications.createdAt)).all();
  const activityRows = sqliteDb
    .select()
    .from(sqliteActivityLogs)
    .orderBy(desc(sqliteActivityLogs.createdAt))
    .limit(250)
    .all();
  const savedViewRows = sqliteDb.select().from(sqliteSavedViews).all();
  const outboxRows = sqliteDb.select().from(sqliteOutboxEmails).orderBy(desc(sqliteOutboxEmails.sentAt)).all();
  const sessionRows = sqliteDb.select().from(sqliteSessions).all();

  const subtasksByTask = new Map<string, any[]>();
  for (const s of subtaskRows) {
    const list = subtasksByTask.get(s.taskId) || [];
    list.push(mapSubtaskRow(s));
    subtasksByTask.set(s.taskId, list);
  }

  const filesByTask = new Map<string, any[]>();
  const filesByComment = new Map<string, any[]>();
  const allFiles = fileRows.map(mapFileRow);
  for (const f of allFiles) {
    if (f.task) {
      const list = filesByTask.get(f.task) || [];
      list.push(f);
      filesByTask.set(f.task, list);
    }
    if (f.commentId) {
      const list = filesByComment.get(f.commentId) || [];
      list.push(f);
      filesByComment.set(f.commentId, list);
    }
  }

  const tasks = taskRows.map(t => mapTaskRow(t, subtasksByTask.get(t.id) || [], filesByTask.get(t.id) || []));
  const comments = commentRows.map(c => mapCommentRow(c, filesByComment.get(c.id) || []));
  const projects = projectRows.map(mapProjectRow);
  const savedOrder = safeJsonParse<string[]>(wsRow.projOrderJson, []);
  const projOrder =
    savedOrder.length > 0
      ? [...savedOrder.filter(id => projects.some(p => p.id === id)), ...projects.map(p => p.id).filter(id => !savedOrder.includes(id))]
      : projects.map(p => p.id);

  const smtpConfig = safeJsonParse<any>(wsRow.smtpConfigJson, null);
  const parsedPrefs = safeJsonParse<Record<string, any>>(wsRow.prefsJson, {});
  const statuses =
    Array.isArray(parsedPrefs.statuses) && parsedPrefs.statuses.length > 0
      ? parsedPrefs.statuses
      : DEFAULT_STATUSES.map((s: any) => ({ ...s }));
  syncStatuses(statuses);

  return {
    data: {
      ws: {
        name: wsRow.name,
        url: wsRow.url,
        c: wsRow.color,
        brand: Boolean(wsRow.brand),
      },
      workspaces: safeJsonParse<any[]>(wsRow.workspacesListJson, [
        { id: 'w1', name: wsRow.name, c: wsRow.color, brand: true, plan: wsRow.plan },
      ]),
      plan: wsRow.plan,
      me: wsRow.meMemberId,
      tfa: Boolean(wsRow.tfa),
      statuses,
      teams: teamRows.map(tm => ({
        id: tm.id,
        name: tm.name,
        desc: tm.desc,
        icon: tm.icon,
        c: tm.color,
      })),
      members: memberRows.map(mapMemberRow),
      projects,
      projOrder,
      tasks,
      comments,
      files: allFiles,
      notifs: notifRows.map(n => ({
        id: n.id,
        type: n.type,
        by: n.actorId,
        task: n.taskId,
        project: n.projectId,
        text: n.text,
        snippet: n.snippet,
        at: n.createdAt,
        read: Boolean(n.read),
      })),
      activity: activityRows.map(a => ({
        id: a.id,
        by: a.actorId,
        verb: a.verb,
        task: a.taskId,
        project: a.projectId,
        at: a.createdAt,
        extra: a.extra,
      })),
      savedViews: savedViewRows.map(sv => ({
        id: sv.id,
        project: sv.projectId,
        name: sv.name,
        type: sv.type,
        filters: safeJsonParse<any[]>(sv.filtersJson, []),
      })),
      outbox: outboxRows.map(mapOutboxRow),
      notifPrefs: safeJsonParse<Record<string, any>>(wsRow.notifPrefsJson, {}),
      sessions: sessionRows.map(s => ({
        id: s.id,
        device: s.device,
        loc: s.loc,
        ip: s.ip,
        last: s.lastActive,
        cur: Boolean(s.isCurrent),
      })),
      ...(smtpConfig ? { smtpConfig } : {}),
    },
    prefs: { ...DEFAULT_PREFS, ...safeJsonParse<Record<string, any>>(wsRow.prefsJson, {}) },
    views: safeJsonParse<Record<string, any>>(wsRow.viewsJson, {}),
    collapsed: Boolean(wsRow.collapsed),
    updatedAt: wsRow.updatedAt,
  };
}

/* ============================================================================
   TASKS & SUBTASKS SQL REPOSITORY (B-TREE INDEXED QUERIES & ACID TRANSACTIONS)
   ============================================================================ */

export function queryTasksSql(query: Record<string, any> = {}) {
  ensureRelationalDatabaseSeeded();
  const conn = getSqliteConnection();
  const clauses: string[] = [];
  const params: any[] = [];

  const arch = query.archived;
  if (arch === 'true' || arch === true) {
    clauses.push('archived = 1');
  } else if (arch !== 'all') {
    clauses.push('archived = 0');
  }

  const projectFilter = safeString(query.project, 100);
  if (projectFilter) {
    clauses.push('project_id = ?');
    params.push(projectFilter);
  }

  const statusFilter = safeString(query.status, 50);
  if (statusFilter) {
    clauses.push('status = ?');
    params.push(statusFilter);
  }

  const assigneeFilter = safeString(query.assignee, 100);
  if (assigneeFilter) {
    clauses.push('assignee_id = ?');
    params.push(assigneeFilter);
  }

  const priorityFilter = safeString(query.priority, 50);
  if (priorityFilter) {
    clauses.push('priority = ?');
    params.push(priorityFilter);
  }

  const qFilter = safeString(query.q, 500).toLowerCase().trim();
  if (qFilter) {
    const likePattern = `%${qFilter}%`;
    clauses.push('(LOWER(title) LIKE ? OR LOWER(key) LIKE ? OR LOWER(desc) LIKE ?)');
    params.push(likePattern, likePattern, likePattern);
  }

  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rawRows = conn
    .prepare(
      `SELECT
         id, key, project_id AS projectId, title, status, assignee_id AS assigneeId,
         priority, due, start, labels_json AS labelsJson, deps_json AS depsJson,
         desc, estimate, created_at AS createdAt, updated_at AS updatedAt,
         sort_order AS sortOrder, fav, recur, archived, archived_at AS archivedAt,
         completed_at AS completedAt, prev_status AS prevStatus
       FROM tasks
       ${whereSql}
       ORDER BY sort_order ASC`,
    )
    .all(...params) as (typeof sqliteTasks.$inferSelect)[];

  if (!rawRows.length) return [];

  const taskIds = rawRows.map(r => r.id);
  const subRows = sqliteDb
    .select()
    .from(sqliteSubtasks)
    .where(inArray(sqliteSubtasks.taskId, taskIds))
    .orderBy(asc(sqliteSubtasks.sortOrder))
    .all();

  const fileRows = sqliteDb
    .select()
    .from(sqliteFiles)
    .where(inArray(sqliteFiles.taskId, taskIds))
    .all();

  const subsByTask = new Map<string, any[]>();
  for (const s of subRows) {
    const arr = subsByTask.get(s.taskId) || [];
    arr.push(mapSubtaskRow(s));
    subsByTask.set(s.taskId, arr);
  }

  const filesByTask = new Map<string, any[]>();
  for (const f of fileRows) {
    if (!f.taskId) continue;
    const arr = filesByTask.get(f.taskId) || [];
    arr.push(mapFileRow(f));
    filesByTask.set(f.taskId, arr);
  }

  return rawRows.map(r => mapTaskRow(r, subsByTask.get(r.id) || [], filesByTask.get(r.id) || []));
}

export function queryTaskByIdSql(taskId: string) {
  ensureRelationalDatabaseSeeded();
  const row = sqliteDb.select().from(sqliteTasks).where(eq(sqliteTasks.id, taskId)).get();
  if (!row) return null;
  const subRows = sqliteDb
    .select()
    .from(sqliteSubtasks)
    .where(eq(sqliteSubtasks.taskId, taskId))
    .orderBy(asc(sqliteSubtasks.sortOrder))
    .all();
  const fileRows = sqliteDb.select().from(sqliteFiles).where(eq(sqliteFiles.taskId, taskId)).all();
  return mapTaskRow(row, subRows.map(mapSubtaskRow), fileRows.map(mapFileRow));
}

export function insertTaskSql(rawInput: Record<string, any>) {
  ensureRelationalDatabaseSeeded();
  const conn = getSqliteConnection();
  const input = stripDangerousKeys(rawInput || {});
  const now = Date.now();

  let createdTaskId = '';
  const tx = conn.transaction(() => {
    let projRow =
      (input.project &&
        sqliteDb.select().from(sqliteProjects).where(eq(sqliteProjects.id, String(input.project))).get()) ||
      sqliteDb.select().from(sqliteProjects).where(eq(sqliteProjects.archived, false)).orderBy(asc(sqliteProjects.sortOrder)).get() ||
      sqliteDb.select().from(sqliteProjects).get();

    if (!projRow) {
      throw new Error('No project exists in workspace');
    }

    const nextSeq = (projRow.seq || 200) + 1;
    let taskKey = typeof input.key === 'string' && input.key.trim() ? input.key.trim() : `${projRow.key}-${nextSeq}`;
    if (!input.key) {
      sqliteDb
        .update(sqliteProjects)
        .set({ seq: nextSeq })
        .where(eq(sqliteProjects.id, projRow.id))
        .run();
    }

    const maxOrderRow = conn.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS maxO FROM tasks`).get() as {
      maxO: number;
    };
    const sortOrder = typeof input.order === 'number' ? input.order : Number(maxOrderRow?.maxO || 0) + 1;

    const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : uid('t');
    createdTaskId = id;
    let startVal = typeof input.start === 'string' ? input.start : null;
    const dueVal = typeof input.due === 'string' ? input.due : null;
    if (startVal && dueVal && startVal > dueVal) {
      startVal = dueVal;
    }

    const rawStatus = typeof input.status === 'string' ? input.status.trim() : '';
    const validStatus =
      rawStatus && ((ST as any)[rawStatus] || /^[a-z0-9_-]{1,50}$/i.test(rawStatus)) ? rawStatus : 'todo';

    sqliteDb
      .insert(sqliteTasks)
      .values({
        id,
        key: taskKey,
        projectId: projRow.id,
        title: safeString(input.title, 500, 'Untitled') || 'Untitled',
        status: validStatus,
        assigneeId: typeof input.assignee === 'string' && input.assignee ? input.assignee : null,
        priority: typeof input.priority === 'string' && (PR as any)[input.priority] ? input.priority : 'none',
        due: dueVal,
        start: startVal,
        labelsJson: JSON.stringify(
          Array.isArray(input.labels) ? input.labels.filter((l: any) => typeof l === 'string') : [],
        ),
        depsJson: JSON.stringify(
          Array.isArray(input.deps) ? input.deps.filter((d: any) => typeof d === 'string') : [],
        ),
        desc: typeof input.desc === 'string' ? input.desc : '',
        estimate: input.estimate != null ? String(input.estimate) : null,
        createdAt: typeof input.created === 'number' ? input.created : now,
        updatedAt: now,
        sortOrder,
        fav: Boolean(input.fav),
        recur: typeof input.recur === 'string' ? input.recur : null,
        archived: Boolean(input.archived),
        archivedAt: typeof input.archivedAt === 'number' ? input.archivedAt : null,
        completedAt: typeof input.completedAt === 'number' ? input.completedAt : null,
        prevStatus: typeof input.prevStatus === 'string' ? input.prevStatus : null,
      })
      . onConflictDoUpdate({
        target: sqliteTasks.id,
        set: {
          title: safeString(input.title, 500, 'Untitled') || 'Untitled',
          updatedAt: now,
        },
      })
      .run();

    const subtasks = Array.isArray(input.subtasks) ? stripDangerousKeys(input.subtasks) : [];
    subtasks.forEach((s: any, idx: number) => {
      sqliteDb
        .insert(sqliteSubtasks)
        .values({
          id: safeString(s.id, 80) || uid('s'),
          taskId: id,
          title: safeString(s.title, 500, 'Subtask') || 'Subtask',
          done: Boolean(s.done),
          assigneeId: s.assignee ? String(s.assignee) : null,
          due: s.due ? String(s.due) : null,
          note: typeof s.note === 'string' ? s.note : '',
          sortOrder: idx,
        })
        .onConflictDoNothing()
        .run();
    });

    const meId = getCurrentMeId();
    const attachments = Array.isArray(input.attachments) ? stripDangerousKeys(input.attachments) : [];
    attachments.forEach((att: any) => {
      const fid = safeString(att.id, 80) || uid('f');
      const cleanName = safeString(att.name, 255, 'attachment') || 'attachment';
      sqliteDb
        .insert(sqliteFiles)
        .values({
          id: fid,
          name: cleanName,
          type: safeString(att.type, 20) || detectFileType(cleanName),
          size: safeString(att.size, 40, '24 KB') || '24 KB',
          authorId: safeString(att.by, 80) || meId,
          createdAt: typeof att.at === 'number' ? att.at : now,
          projectId: projRow.id,
          taskId: id,
          commentId: att.commentId ? String(att.commentId) : null,
          dataUrl: safeDownloadUrl(att.dataUrl) || null,
          textContent: typeof att.textContent === 'string' ? att.textContent.slice(0, 500000) : null,
          mime: safeString(att.mime, 100) || null,
        })
        .onConflictDoUpdate({
          target: sqliteFiles.id,
          set: { taskId: id, projectId: projRow.id },
        })
        .run();
    });

    insertActivityRow(meId, 'created', id, projRow.id, '', now);
    touchWorkspaceRow(now);
  });

  tx();
  return { task: queryTaskByIdSql(createdTaskId)!, updatedAt: now };
}

export function patchTaskSql(taskId: string, rawPatch: Record<string, any>) {
  ensureRelationalDatabaseSeeded();
  const conn = getSqliteConnection();
  const current = queryTaskByIdSql(taskId);
  if (!current) return null;

  const patch = stripDangerousKeys(rawPatch || {});
  const messages: string[] = [];
  const now = Date.now();
  const meId = getCurrentMeId();

  const tx = conn.transaction(() => {
    const updateCols: Record<string, any> = {};

    for (const k of Object.keys(patch)) {
      if (!ALLOWED_TASK_PATCH_KEYS.has(k)) continue;
      const oldVal = (current as any)[k];
      const newVal = patch[k];
      if (JSON.stringify(oldVal) === JSON.stringify(newVal)) continue;
      (current as any)[k] = newVal;

      if (k === 'title') {
        updateCols.title = safeString(newVal, 500, current.title);
        insertActivityRow(meId, 'renamed', taskId, current.project, `to “${updateCols.title}”`, now);
      } else if (k === 'status') {
        updateCols.status = String(newVal);
        if (newVal === 'done') {
          updateCols.completedAt = now;
          updateCols.prevStatus = String(oldVal);
          current.completedAt = now;
          current.prevStatus = String(oldVal);
          insertActivityRow(meId, 'completed', taskId, current.project, '', now);
        } else {
          const oldName = (ST as any)[oldVal]?.name || oldVal;
          const newName = (ST as any)[newVal]?.name || newVal;
          insertActivityRow(meId, 'moved', taskId, current.project, `from ${oldName} to ${newName}`, now);
        }
        if (newVal === 'done' && current.recur && current.due) {
          const nextDue = iso(addD(parse(current.due), RECUR_DAYS[current.recur] || 7));
          insertTaskSql({
            project: current.project,
            title: current.title,
            status: 'todo',
            assignee: current.assignee,
            priority: current.priority,
            due: nextDue,
            start: nextDue,
            labels: current.labels,
            subtasks: (current.subtasks || []).map((s: any) => ({ ...s, id: uid('s'), done: false })),
            desc: current.desc,
            estimate: current.estimate,
            recur: current.recur,
            completedAt: null,
            attachments: [],
          });
          messages.push(`Next “${current.title}” scheduled for ${fmtDate(nextDue)}`);
        }
      } else if (k === 'assignee') {
        updateCols.assigneeId = newVal ? String(newVal) : null;
        const m = newVal
          ? sqliteDb.select().from(sqliteMembers).where(eq(sqliteMembers.id, String(newVal))).get()
          : null;
        insertActivityRow(
          meId,
          'assigned',
          taskId,
          current.project,
          newVal ? `to ${m?.name || newVal}` : '(unassigned)',
          now,
        );
      } else if (k === 'priority') {
        updateCols.priority = String(newVal);
        const pName = (PR as any)[newVal]?.name || newVal;
        insertActivityRow(meId, 'changed priority of', taskId, current.project, `to ${pName}`, now);
      } else if (k === 'due') {
        updateCols.due = newVal ? String(newVal) : null;
        insertActivityRow(
          meId,
          'changed due date of',
          taskId,
          current.project,
          newVal ? `to ${fmtDate(newVal)}` : '(cleared)',
          now,
        );
      } else if (k === 'start') {
        updateCols.start = newVal ? String(newVal) : null;
        insertActivityRow(
          meId,
          'changed start date of',
          taskId,
          current.project,
          newVal ? `to ${fmtDate(newVal)}` : '(cleared)',
          now,
        );
      } else if (k === 'project') {
        const projRow = sqliteDb
          .select()
          .from(sqliteProjects)
          .where(eq(sqliteProjects.id, String(newVal)))
          .get();
        if (projRow) {
          const nextSeq = (projRow.seq || 200) + 1;
          sqliteDb
            .update(sqliteProjects)
            .set({ seq: nextSeq })
            .where(eq(sqliteProjects.id, projRow.id))
            .run();
          updateCols.projectId = projRow.id;
          updateCols.key = `${projRow.key}-${nextSeq}`;
          current.project = projRow.id;
          current.key = updateCols.key;
          insertActivityRow(meId, 'moved', taskId, projRow.id, `to ${projRow.name}`, now);
        }
      } else if (k === 'labels') {
        updateCols.labelsJson = JSON.stringify(Array.isArray(newVal) ? newVal : []);
        insertActivityRow(meId, 'updated labels on', taskId, current.project, '', now);
      } else if (k === 'deps') {
        updateCols.depsJson = JSON.stringify(Array.isArray(newVal) ? newVal : []);
        insertActivityRow(meId, 'updated dependencies of', taskId, current.project, '', now);
      } else if (k === 'desc') {
        updateCols.desc = typeof newVal === 'string' ? newVal : '';
      } else if (k === 'estimate') {
        updateCols.estimate = newVal != null ? String(newVal) : null;
        insertActivityRow(meId, 'estimated', taskId, current.project, newVal || 'none', now);
      } else if (k === 'order') {
        updateCols.sortOrder = Number(newVal || 0);
      } else if (k === 'fav') {
        updateCols.fav = Boolean(newVal);
      } else if (k === 'recur') {
        updateCols.recur = newVal ? String(newVal) : null;
        insertActivityRow(
          meId,
          'set repeat on',
          taskId,
          current.project,
          newVal ? String(newVal).toLowerCase() : 'off',
          now,
        );
      } else if (k === 'archived') {
        updateCols.archived = Boolean(newVal);
        updateCols.archivedAt = newVal ? now : null;
      } else if (k === 'completedAt') {
        updateCols.completedAt = typeof newVal === 'number' ? newVal : null;
      } else if (k === 'prevStatus') {
        updateCols.prevStatus = newVal ? String(newVal) : null;
      } else if (k === 'subtasks' && Array.isArray(newVal)) {
        sqliteDb.delete(sqliteSubtasks).where(eq(sqliteSubtasks.taskId, taskId)).run();
        newVal.forEach((s: any, idx: number) => {
          sqliteDb
            .insert(sqliteSubtasks)
            .values({
              id: safeString(s.id, 80) || uid('s'),
              taskId,
              title: safeString(s.title, 500, 'Subtask') || 'Subtask',
              done: Boolean(s.done),
              assigneeId: s.assignee ? String(s.assignee) : null,
              due: s.due ? String(s.due) : null,
              note: typeof s.note === 'string' ? s.note : '',
              sortOrder: idx,
            })
            .run();
        });
      } else if (k === 'attachments' && Array.isArray(newVal)) {
        newVal.forEach((att: any) => {
          const fid = safeString(att.id, 80) || uid('f');
          const cleanName = safeString(att.name, 255, 'attachment') || 'attachment';
          sqliteDb
            .insert(sqliteFiles)
            .values({
              id: fid,
              name: cleanName,
              type: safeString(att.type, 20) || detectFileType(cleanName),
              size: safeString(att.size, 40, '24 KB') || '24 KB',
              authorId: safeString(att.by, 80) || meId,
              createdAt: typeof att.at === 'number' ? att.at : now,
              projectId: current.project,
              taskId,
              commentId: att.commentId ? String(att.commentId) : null,
              dataUrl: safeDownloadUrl(att.dataUrl) || null,
              textContent: typeof att.textContent === 'string' ? att.textContent.slice(0, 500000) : null,
              mime: safeString(att.mime, 100) || null,
            })
            .onConflictDoUpdate({
              target: sqliteFiles.id,
              set: { taskId, projectId: current.project },
            })
            .run();
        });
      }
    }

    updateCols.updatedAt = now;
    sqliteDb.update(sqliteTasks).set(updateCols).where(eq(sqliteTasks.id, taskId)).run();
    touchWorkspaceRow(now);
  });

  tx();
  return { task: queryTaskByIdSql(taskId)!, messages, updatedAt: now };
}

export function duplicateTaskSql(taskId: string) {
  const orig = queryTaskByIdSql(taskId);
  if (!orig) return null;
  return insertTaskSql({
    ...orig,
    id: uid('t'),
    key: undefined,
    title: `${orig.title} (copy)`,
    created: Date.now(),
    fav: false,
    subtasks: (orig.subtasks || []).map((s: any) => ({ ...s, id: uid('s') })),
    attachments: [],
  });
}

export function archiveTaskSql(taskId: string) {
  const existing = queryTaskByIdSql(taskId);
  if (!existing) return null;
  const now = Date.now();
  const meId = getCurrentMeId();
  const conn = getSqliteConnection();
  conn.transaction(() => {
    sqliteDb
      .update(sqliteTasks)
      .set({ archived: true, archivedAt: now, updatedAt: now })
      .where(eq(sqliteTasks.id, taskId))
      .run();
    insertActivityRow(meId, 'archived', taskId, existing.project, '', now);
    touchWorkspaceRow(now);
  })();
  return { task: queryTaskByIdSql(taskId)!, updatedAt: now };
}

export function restoreTaskSql(taskId: string) {
  const existing = queryTaskByIdSql(taskId);
  if (!existing) return null;
  const now = Date.now();
  const meId = getCurrentMeId();
  const conn = getSqliteConnection();
  conn.transaction(() => {
    sqliteDb
      .update(sqliteTasks)
      .set({ archived: false, archivedAt: null, updatedAt: now })
      .where(eq(sqliteTasks.id, taskId))
      .run();
    insertActivityRow(meId, 'restored', taskId, existing.project, '', now);
    touchWorkspaceRow(now);
  })();
  return { task: queryTaskByIdSql(taskId)!, updatedAt: now };
}

export function deleteTasksSql(taskIds: string[]) {
  ensureRelationalDatabaseSeeded();
  const cleanIds = taskIds.map(id => String(id)).filter(Boolean);
  if (!cleanIds.length) return { deleted: 0, updatedAt: Date.now() };
  const conn = getSqliteConnection();
  const now = Date.now();
  let deleted = 0;

  conn.transaction(() => {
    const idSet = new Set(cleanIds);
    sqliteDb.delete(sqliteSubtasks).where(inArray(sqliteSubtasks.taskId, cleanIds)).run();
    sqliteDb.delete(sqliteComments).where(inArray(sqliteComments.taskId, cleanIds)).run();
    const res = sqliteDb.delete(sqliteTasks).where(inArray(sqliteTasks.id, cleanIds)).run();
    deleted = res.changes;

    // Clean any dependency references pointing to deleted tasks
    const tasksWithDeps = conn
      .prepare(`SELECT id, deps_json FROM tasks WHERE deps_json != '[]'`)
      .all() as { id: string; deps_json: string }[];
    for (const row of tasksWithDeps) {
      const deps = safeJsonParse<string[]>(row.deps_json, []);
      const filtered = deps.filter(d => !idSet.has(d));
      if (filtered.length !== deps.length) {
        conn.prepare(`UPDATE tasks SET deps_json = ? WHERE id = ?`).run(JSON.stringify(filtered), row.id);
      }
    }
    touchWorkspaceRow(now);
  })();

  return { deleted, updatedAt: now };
}

/* ============================================================================
   SUBTASKS SQL REPOSITORY
   ============================================================================ */

export function insertSubtaskSql(taskId: string, title: string) {
  ensureRelationalDatabaseSeeded();
  const cleanTitle = safeString(title, 500).trim();
  if (!cleanTitle) return null;
  const taskRow = sqliteDb.select().from(sqliteTasks).where(eq(sqliteTasks.id, taskId)).get();
  if (!taskRow) return null;

  const conn = getSqliteConnection();
  const now = Date.now();
  const meId = getCurrentMeId();
  const sid = uid('s');

  conn.transaction(() => {
    const maxRow = conn
      .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS maxO FROM subtasks WHERE task_id = ?`)
      .get(taskId) as { maxO: number };
    sqliteDb
      .insert(sqliteSubtasks)
      .values({
        id: sid,
        taskId,
        title: cleanTitle,
        done: false,
        assigneeId: null,
        due: null,
        note: '',
        sortOrder: Number(maxRow?.maxO ?? -1) + 1,
      })
      .run();
    sqliteDb.update(sqliteTasks).set({ updatedAt: now }).where(eq(sqliteTasks.id, taskId)).run();
    insertActivityRow(meId, 'added subtask to', taskId, taskRow.projectId, `“${cleanTitle}”`, now);
    touchWorkspaceRow(now);
  })();

  const sub = sqliteDb.select().from(sqliteSubtasks).where(eq(sqliteSubtasks.id, sid)).get()!;
  return { subtask: mapSubtaskRow(sub), updatedAt: now };
}

export function patchSubtaskSql(taskId: string, subtaskId: string, rawPatch: Record<string, any>) {
  ensureRelationalDatabaseSeeded();
  const taskRow = sqliteDb.select().from(sqliteTasks).where(eq(sqliteTasks.id, taskId)).get();
  if (!taskRow) return null;
  const subRow = sqliteDb
    .select()
    .from(sqliteSubtasks)
    .where(and(eq(sqliteSubtasks.id, subtaskId), eq(sqliteSubtasks.taskId, taskId)))
    .get();
  if (!subRow) return null;

  const patch = stripDangerousKeys(rawPatch || {});
  const now = Date.now();
  const meId = getCurrentMeId();
  const conn = getSqliteConnection();

  conn.transaction(() => {
    const updates: Record<string, any> = {};
    if (typeof patch.done === 'boolean' && patch.done !== Boolean(subRow.done)) {
      updates.done = patch.done;
      insertActivityRow(
        meId,
        patch.done ? 'completed subtask on' : 'reopened subtask on',
        taskId,
        taskRow.projectId,
        `“${subRow.title}”`,
        now,
      );
    }
    if (typeof patch.title === 'string' && patch.title.trim()) {
      updates.title = safeString(patch.title, 500).trim();
    }
    if (typeof patch.note === 'string') {
      updates.note = patch.note;
    }
    if ('assignee' in patch) {
      updates.assigneeId = patch.assignee ? String(patch.assignee) : null;
      const m = updates.assigneeId
        ? sqliteDb.select().from(sqliteMembers).where(eq(sqliteMembers.id, updates.assigneeId)).get()
        : null;
      insertActivityRow(
        meId,
        'assigned a subtask on',
        taskId,
        taskRow.projectId,
        updates.assigneeId ? `to ${m?.name || updates.assigneeId}` : '(unassigned)',
        now,
      );
    }
    if ('due' in patch) {
      updates.due = patch.due ? String(patch.due) : null;
      insertActivityRow(
        meId,
        'set a subtask due date on',
        taskId,
        taskRow.projectId,
        updates.due ? fmtDate(updates.due) : '(cleared)',
        now,
      );
    }

    if (Object.keys(updates).length > 0) {
      sqliteDb.update(sqliteSubtasks).set(updates).where(eq(sqliteSubtasks.id, subtaskId)).run();
    }
    sqliteDb.update(sqliteTasks).set({ updatedAt: now }).where(eq(sqliteTasks.id, taskId)).run();
    touchWorkspaceRow(now);
  })();

  const updated = sqliteDb.select().from(sqliteSubtasks).where(eq(sqliteSubtasks.id, subtaskId)).get()!;
  return { subtask: mapSubtaskRow(updated), updatedAt: now };
}

export function deleteSubtaskSql(taskId: string, subtaskId: string) {
  ensureRelationalDatabaseSeeded();
  const conn = getSqliteConnection();
  const now = Date.now();
  let deleted = false;
  conn.transaction(() => {
    const res = sqliteDb
      .delete(sqliteSubtasks)
      .where(and(eq(sqliteSubtasks.id, subtaskId), eq(sqliteSubtasks.taskId, taskId)))
      .run();
    deleted = res.changes > 0;
    if (deleted) {
      sqliteDb.update(sqliteTasks).set({ updatedAt: now }).where(eq(sqliteTasks.id, taskId)).run();
      touchWorkspaceRow(now);
    }
  })();
  return { ok: deleted, updatedAt: now };
}

export function promoteSubtaskSql(taskId: string, subtaskId: string) {
  ensureRelationalDatabaseSeeded();
  const taskObj = queryTaskByIdSql(taskId);
  if (!taskObj) return null;
  const subRow = sqliteDb
    .select()
    .from(sqliteSubtasks)
    .where(and(eq(sqliteSubtasks.id, subtaskId), eq(sqliteSubtasks.taskId, taskId)))
    .get();
  if (!subRow) return null;

  const conn = getSqliteConnection();
  const now = Date.now();
  const meId = getCurrentMeId();
  let promotedTask: any = null;

  conn.transaction(() => {
    const res = insertTaskSql({
      title: subRow.title,
      project: taskObj.project,
      status: subRow.done ? 'done' : 'todo',
      assignee: subRow.assigneeId || taskObj.assignee,
      priority: taskObj.priority,
      due: subRow.due || null,
      labels: [...(taskObj.labels || [])],
      desc: subRow.note ? `<p>${esc(subRow.note)}</p>` : '',
    });
    promotedTask = res.task;
    sqliteDb.delete(sqliteSubtasks).where(eq(sqliteSubtasks.id, subtaskId)).run();
    insertActivityRow(meId, 'converted a subtask of', taskId, taskObj.project, `into ${promotedTask.key}`, now);
    touchWorkspaceRow(now);
  })();

  return { task: promotedTask, updatedAt: now };
}

/* ============================================================================
   COMMENTS & REACTIONS SQL REPOSITORY
   ============================================================================ */

export function queryTaskCommentsSql(taskId: string) {
  ensureRelationalDatabaseSeeded();
  const rows = sqliteDb
    .select()
    .from(sqliteComments)
    .where(eq(sqliteComments.taskId, taskId))
    .orderBy(asc(sqliteComments.createdAt))
    .all();
  if (!rows.length) return [];
  const cIds = rows.map(r => r.id);
  const fileRows = sqliteDb
    .select()
    .from(sqliteFiles)
    .where(inArray(sqliteFiles.commentId, cIds))
    .all();
  const filesByComment = new Map<string, any[]>();
  for (const f of fileRows) {
    if (!f.commentId) continue;
    const list = filesByComment.get(f.commentId) || [];
    list.push(mapFileRow(f));
    filesByComment.set(f.commentId, list);
  }
  return rows.map(r => mapCommentRow(r, filesByComment.get(r.id) || []));
}

export function insertCommentSql(
  taskId: string,
  text: string,
  byMemberId?: string,
  attachments?: any[],
) {
  ensureRelationalDatabaseSeeded();
  const taskRow = sqliteDb.select().from(sqliteTasks).where(eq(sqliteTasks.id, taskId)).get();
  const cleanText = String(text || '').trim();
  const rawAtts = Array.isArray(attachments) ? attachments : [];
  if (!taskRow || (!cleanText && rawAtts.length === 0)) return null;

  const author = safeString(byMemberId, 80) || getCurrentMeId();
  const now = Date.now();
  const commentId = uid('c');
  const conn = getSqliteConnection();

  const cleanAttachments = rawAtts.map((rawA: any) => {
    const a = stripDangerousKeys(rawA || {});
    const safeUrl = safeDownloadUrl(a.dataUrl) || null;
    const cleanName = safeString(a.name, 255, 'attachment') || 'attachment';
    return {
      id: safeString(a.id, 80) || uid('f'),
      name: cleanName,
      type: safeString(a.type, 20) || detectFileType(cleanName),
      size: safeString(a.size, 40, '24 KB') || '24 KB',
      by: safeString(a.by, 80) || author,
      at: typeof a.at === 'number' ? a.at : now,
      project: taskRow.projectId,
      task: taskId,
      commentId,
      dataUrl: safeUrl,
      textContent: typeof a.textContent === 'string' ? a.textContent.slice(0, 500000) : null,
      mime: safeString(a.mime, 100) || null,
    };
  });

  conn.transaction(() => {
    sqliteDb
      .insert(sqliteComments)
      .values({
        id: commentId,
        taskId,
        authorId: author,
        createdAt: now,
        text: cleanText,
        reactionsJson: '{}',
      })
      .run();

    for (const att of cleanAttachments) {
      sqliteDb
        .insert(sqliteFiles)
        .values({
          id: att.id,
          name: att.name,
          type: att.type,
          size: att.size,
          authorId: att.by,
          createdAt: att.at,
          projectId: att.project,
          taskId,
          commentId,
          dataUrl: att.dataUrl,
          textContent: att.textContent,
          mime: att.mime,
        })
        .onConflictDoUpdate({
          target: sqliteFiles.id,
          set: { commentId, taskId, projectId: att.project },
        })
        .run();
    }

    sqliteDb.update(sqliteTasks).set({ updatedAt: now }).where(eq(sqliteTasks.id, taskId)).run();
    insertActivityRow(
      author,
      'commented on',
      taskId,
      taskRow.projectId,
      cleanAttachments.length ? `(with ${cleanAttachments.length} attachment${cleanAttachments.length > 1 ? 's' : ''})` : '',
      now,
    );

    const allMembers = sqliteDb.select().from(sqliteMembers).all();
    for (const m of allMembers) {
      if (cleanText.toLowerCase().includes(`@${m.name.toLowerCase()}`)) {
        sqliteDb
          .insert(sqliteNotifications)
          .values({
            id: uid('n'),
            type: 'mention',
            actorId: author,
            taskId,
            projectId: taskRow.projectId,
            text: 'mentioned you in',
            snippet: cleanText || `Attached ${cleanAttachments.map(a => a.name).join(', ')}`,
            createdAt: now,
            read: false,
          })
          .run();
      }
    }

    touchWorkspaceRow(now);
  })();

  return {
    comment: {
      id: commentId,
      task: taskId,
      by: author,
      at: now,
      text: cleanText,
      attachments: cleanAttachments,
      re: {},
    },
    updatedAt: now,
  };
}

export function deleteCommentSql(commentId: string) {
  ensureRelationalDatabaseSeeded();
  const now = Date.now();
  const res = sqliteDb.delete(sqliteComments).where(eq(sqliteComments.id, commentId)).run();
  if (res.changes > 0) touchWorkspaceRow(now);
  return { ok: res.changes > 0, updatedAt: now };
}

export function toggleCommentReactionSql(commentId: string, emoji: string, memberId?: string) {
  ensureRelationalDatabaseSeeded();
  if (!isSafeEmoji(emoji)) return null;
  const row = sqliteDb.select().from(sqliteComments).where(eq(sqliteComments.id, commentId)).get();
  if (!row) return null;

  const cleanEmoji = emoji.trim();
  const actor = safeString(memberId, 80) || getCurrentMeId();
  const re = safeJsonParse<Record<string, string[]>>(row.reactionsJson, {});
  const list = re[cleanEmoji] || [];
  re[cleanEmoji] = list.includes(actor) ? list.filter(x => x !== actor) : [...list, actor];

  const now = Date.now();
  sqliteDb
    .update(sqliteComments)
    .set({ reactionsJson: JSON.stringify(re) })
    .where(eq(sqliteComments.id, commentId))
    .run();
  touchWorkspaceRow(now);

  const fileRows = sqliteDb.select().from(sqliteFiles).where(eq(sqliteFiles.commentId, commentId)).all();
  return {
    comment: {
      id: row.id,
      task: row.taskId,
      by: row.authorId,
      at: row.createdAt,
      text: row.text,
      attachments: fileRows.map(mapFileRow),
      re,
    },
    updatedAt: now,
  };
}

/* ============================================================================
   PROJECTS SQL REPOSITORY
   ============================================================================ */

export function computeProjectProgressSql(projectId: string): number {
  const conn = getSqliteConnection();
  const stats = conn
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS doneCount
       FROM tasks
       WHERE project_id = ? AND archived = 0`,
    )
    .get(projectId) as { total: number; doneCount: number | null };
  if (!stats || !stats.total) return 0;
  return Math.round((Number(stats.doneCount || 0) / Number(stats.total)) * 100);
}

export function listProjectsSql() {
  ensureRelationalDatabaseSeeded();
  const wsRow = sqliteDb
    .select({ projOrderJson: sqliteWorkspaces.projOrderJson })
    .from(sqliteWorkspaces)
    .where(eq(sqliteWorkspaces.id, 'ws_main'))
    .get();
  const rows = sqliteDb.select().from(sqliteProjects).orderBy(asc(sqliteProjects.sortOrder)).all();
  const projects = rows.map(r => ({
    ...mapProjectRow(r),
    progress: computeProjectProgressSql(r.id),
  }));
  const savedOrder = safeJsonParse<string[]>(wsRow?.projOrderJson, []);
  const projOrder =
    savedOrder.length > 0
      ? [...savedOrder.filter(id => projects.some(p => p.id === id)), ...projects.map(p => p.id).filter(id => !savedOrder.includes(id))]
      : projects.map(p => p.id);
  return { projects, projOrder };
}

export function getProjectByIdSql(projectId: string) {
  ensureRelationalDatabaseSeeded();
  const r = sqliteDb.select().from(sqliteProjects).where(eq(sqliteProjects.id, projectId)).get();
  if (!r) return null;
  return {
    ...mapProjectRow(r),
    progress: computeProjectProgressSql(r.id),
  };
}

export function insertProjectSql(rawInput: Record<string, any>, tmplId = 'blank') {
  ensureRelationalDatabaseSeeded();
  const input = stripDangerousKeys(rawInput || {});
  const name = safeString(input.name, 200, 'Untitled Project').trim() || 'Untitled Project';
  const meId = getCurrentMeId();
  const lead = safeString(input.lead, 80) || meId;
  const now = Date.now();
  const conn = getSqliteConnection();
  let pid = '';

  conn.transaction(() => {
    const existingProjs = sqliteDb.select({ id: sqliteProjects.id, key: sqliteProjects.key }).from(sqliteProjects).all();
    pid = safeString(input.id, 80) || uid('p');
    const key = safeString(input.key, 20) || makeProjectKey(name, existingProjs);
    const members = [...new Set([meId, lead, ...(Array.isArray(input.members) ? input.members : [])])];

    sqliteDb
      .insert(sqliteProjects)
      .values({
        id: pid,
        key,
        seq: 200,
        name,
        icon: safeString(input.icon, 40, 'folder') || 'folder',
        color: safeString(input.color, 40, 'indigo') || 'indigo',
        status: safeString(input.status, 40, 'planning') || 'planning',
        teamId: safeString(input.team ?? 'product', 80),
        leadId: lead,
        due: input.due ? String(input.due) : dOff(30),
        start: input.start ? String(input.start) : dOff(0),
        fav: Boolean(input.fav),
        membersJson: JSON.stringify(members),
        desc: typeof input.desc === 'string' && input.desc ? input.desc : 'No description yet.',
        milestonesJson: JSON.stringify(Array.isArray(input.milestones) ? input.milestones : []),
        lastOpened: 0,
        archived: false,
        archivedAt: null,
        private: Boolean(input.private),
        access: safeString(input.access, 40, 'workspace') || 'workspace',
        permsJson: JSON.stringify(input.perms || {}),
        sortOrder: 0,
      })
      .onConflictDoUpdate({
        target: sqliteProjects.id,
        set: { name, desc: typeof input.desc === 'string' ? input.desc : 'No description yet.' },
      })
      .run();

    const wsRow = sqliteDb
      .select({ projOrderJson: sqliteWorkspaces.projOrderJson })
      .from(sqliteWorkspaces)
      .where(eq(sqliteWorkspaces.id, 'ws_main'))
      .get();
    const order = safeJsonParse<string[]>(wsRow?.projOrderJson, []).filter(x => x !== pid);
    order.unshift(pid);
    order.forEach((id, idx) => {
      conn.prepare(`UPDATE projects SET sort_order = ? WHERE id = ?`).run(idx, id);
    });
    sqliteDb
      .update(sqliteWorkspaces)
      .set({ projOrderJson: JSON.stringify(order), updatedAt: now })
      .where(eq(sqliteWorkspaces.id, 'ws_main'))
      .run();

    insertActivityRow(meId, 'created project', null, pid, '', now);

    const tm = PROJECT_TEMPLATES[tmplId];
    if (tm && tm.tasks.length) {
      tm.tasks.forEach((title, i) => {
        insertTaskSql({
          project: pid,
          title,
          status: i === 0 ? 'todo' : 'backlog',
          assignee: i === 0 ? meId : null,
          priority: i === 0 ? 'high' : 'medium',
          due: dOff(5 + i * 5),
          start: dOff(i * 5),
        });
      });
    }
  })();

  return { project: getProjectByIdSql(pid)!, updatedAt: now };
}

export function patchProjectSql(projectId: string, rawPatch: Record<string, any>) {
  ensureRelationalDatabaseSeeded();
  const row = sqliteDb.select().from(sqliteProjects).where(eq(sqliteProjects.id, projectId)).get();
  if (!row) return null;

  const patch = stripDangerousKeys(rawPatch || {});
  const now = Date.now();
  const meId = getCurrentMeId();
  const conn = getSqliteConnection();

  conn.transaction(() => {
    const updates: Record<string, any> = {};
    let members = safeJsonParse<string[]>(row.membersJson, []);

    if (patch.status && patch.status !== row.status && (PSTAT as any)[patch.status]) {
      insertActivityRow(
        meId,
        'changed status of project',
        null,
        projectId,
        `to ${(PSTAT as any)[patch.status].name}`,
        now,
      );
    }

    for (const k of Object.keys(patch)) {
      if (!ALLOWED_PROJECT_PATCH_KEYS.has(k)) continue;
      if (k === 'name') updates.name = safeString(patch.name, 200, row.name);
      else if (k === 'icon') updates.icon = safeString(patch.icon, 40, row.icon);
      else if (k === 'color') updates.color = safeString(patch.color, 40, row.color);
      else if (k === 'status') updates.status = safeString(patch.status, 40, row.status);
      else if (k === 'team') updates.teamId = safeString(patch.team, 80);
      else if (k === 'lead') {
        updates.leadId = safeString(patch.lead, 80, row.leadId);
        if (updates.leadId && !members.includes(updates.leadId)) {
          members.push(updates.leadId);
          updates.membersJson = JSON.stringify(members);
        }
      } else if (k === 'due') updates.due = patch.due ? String(patch.due) : null;
      else if (k === 'start') updates.start = patch.start ? String(patch.start) : null;
      else if (k === 'fav') updates.fav = Boolean(patch.fav);
      else if (k === 'members' && Array.isArray(patch.members)) {
        members = patch.members.map(String);
        updates.membersJson = JSON.stringify(members);
      } else if (k === 'desc') updates.desc = String(patch.desc ?? '');
      else if (k === 'milestones' && Array.isArray(patch.milestones)) {
        updates.milestonesJson = JSON.stringify(patch.milestones);
      } else if (k === 'archived') updates.archived = Boolean(patch.archived);
      else if (k === 'archivedAt') updates.archivedAt = typeof patch.archivedAt === 'number' ? patch.archivedAt : null;
      else if (k === 'private') updates.private = Boolean(patch.private);
      else if (k === 'access') updates.access = safeString(patch.access, 40, 'workspace');
      else if (k === 'perms' && typeof patch.perms === 'object') {
        updates.permsJson = JSON.stringify(patch.perms || {});
      }
    }

    if (Object.keys(updates).length > 0) {
      sqliteDb.update(sqliteProjects).set(updates).where(eq(sqliteProjects.id, projectId)).run();
    }
    touchWorkspaceRow(now);
  })();

  return { project: getProjectByIdSql(projectId)!, updatedAt: now };
}

export function duplicateProjectSql(projectId: string) {
  ensureRelationalDatabaseSeeded();
  const orig = getProjectByIdSql(projectId);
  if (!orig) return null;
  const conn = getSqliteConnection();
  let newProj: any = null;
  const now = Date.now();

  conn.transaction(() => {
    const created = insertProjectSql(
      {
        ...orig,
        id: undefined,
        key: undefined,
        name: `${orig.name} copy`,
      },
      'blank',
    );
    newProj = created.project;
    const srcTasks = queryTasksSql({ project: projectId });
    for (const t of srcTasks) {
      insertTaskSql({
        ...t,
        id: uid('t'),
        key: undefined,
        project: newProj.id,
        status: 'todo',
        subtasks: (t.subtasks || []).map((s: any) => ({ ...s, id: uid('s') })),
      });
    }
    touchWorkspaceRow(now);
  })();

  return { project: getProjectByIdSql(newProj.id)!, updatedAt: now };
}

export function deleteProjectSql(projectId: string) {
  ensureRelationalDatabaseSeeded();
  const existing = sqliteDb.select().from(sqliteProjects).where(eq(sqliteProjects.id, projectId)).get();
  if (!existing) return { ok: false, updatedAt: Date.now() };
  const conn = getSqliteConnection();
  const now = Date.now();

  conn.transaction(() => {
    const taskIds = sqliteDb
      .select({ id: sqliteTasks.id })
      .from(sqliteTasks)
      .where(eq(sqliteTasks.projectId, projectId))
      .all()
      .map(r => r.id);
    if (taskIds.length) {
      deleteTasksSql(taskIds);
    }
    sqliteDb.delete(sqliteFiles).where(eq(sqliteFiles.projectId, projectId)).run();
    sqliteDb.delete(sqliteSavedViews).where(eq(sqliteSavedViews.projectId, projectId)).run();
    sqliteDb.delete(sqliteProjects).where(eq(sqliteProjects.id, projectId)).run();

    const wsRow = sqliteDb
      .select({ projOrderJson: sqliteWorkspaces.projOrderJson })
      .from(sqliteWorkspaces)
      .where(eq(sqliteWorkspaces.id, 'ws_main'))
      .get();
    const order = safeJsonParse<string[]>(wsRow?.projOrderJson, []).filter(id => id !== projectId);
    sqliteDb
      .update(sqliteWorkspaces)
      .set({ projOrderJson: JSON.stringify(order), updatedAt: now })
      .where(eq(sqliteWorkspaces.id, 'ws_main'))
      .run();
  })();

  return { ok: true, updatedAt: now };
}

export function reorderProjectsSql(projOrder: string[]) {
  ensureRelationalDatabaseSeeded();
  const conn = getSqliteConnection();
  const now = Date.now();
  const cleanOrder = projOrder.map(String);
  conn.transaction(() => {
    cleanOrder.forEach((id, idx) => {
      conn.prepare(`UPDATE projects SET sort_order = ? WHERE id = ?`).run(idx, id);
    });
    sqliteDb
      .update(sqliteWorkspaces)
      .set({ projOrderJson: JSON.stringify(cleanOrder), updatedAt: now })
      .where(eq(sqliteWorkspaces.id, 'ws_main'))
      .run();
  })();
  return { projOrder: cleanOrder, updatedAt: now };
}

/* ============================================================================
   TEAMS SQL REPOSITORY
   ============================================================================ */

export function listTeamsSql() {
  ensureRelationalDatabaseSeeded();
  return sqliteDb
    .select()
    .from(sqliteTeams)
    .all()
    .map(tm => ({
      id: tm.id,
      name: tm.name,
      desc: tm.desc,
      icon: tm.icon,
      c: tm.color,
    }));
}

export function insertTeamSql(rawInput: Record<string, any>) {
  ensureRelationalDatabaseSeeded();
  const input = stripDangerousKeys(rawInput || {});
  const name = safeString(input.name, 120).trim();
  if (!name) throw new Error('Give the team a name');

  const existing = sqliteDb.select().from(sqliteTeams).all();
  if (existing.some(t => t.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`A team called “${name}” already exists`);
  }

  const colorHex = (PCOLORS as any)[input.color] || safeCssColor(input.c, PCOLORS.teal);
  const teamId = safeString(input.id, 80) || uid('tm');
  const descText = safeString(input.desc, 500).trim() || 'No description yet.';
  const icon = safeString(input.icon, 40) || 'users';
  const now = Date.now();
  const conn = getSqliteConnection();

  conn.transaction(() => {
    sqliteDb
      .insert(sqliteTeams)
      .values({
        id: teamId,
        name,
        desc: descText,
        icon,
        color: colorHex,
      })
      .run();
    if (Array.isArray(input.members) && input.members.length > 0) {
      const mIds = input.members.map(String);
      sqliteDb.update(sqliteMembers).set({ teamId }).where(inArray(sqliteMembers.id, mIds)).run();
    }
    touchWorkspaceRow(now);
  })();

  return {
    team: { id: teamId, name, desc: descText, icon, c: colorHex },
    updatedAt: now,
  };
}

export function patchTeamSql(teamId: string, rawInput: Record<string, any>) {
  ensureRelationalDatabaseSeeded();
  const row = sqliteDb.select().from(sqliteTeams).where(eq(sqliteTeams.id, teamId)).get();
  if (!row) return null;

  const input = stripDangerousKeys(rawInput || {});
  const now = Date.now();
  const conn = getSqliteConnection();

  conn.transaction(() => {
    const updates: Record<string, any> = {};
    if (input.name) updates.name = safeString(input.name, 120).trim();
    if (typeof input.desc === 'string') updates.desc = safeString(input.desc, 500).trim();
    if (input.icon) updates.icon = safeString(input.icon, 40);
    if (input.color && (PCOLORS as any)[input.color]) updates.color = (PCOLORS as any)[input.color];
    else if (input.c) updates.color = safeCssColor(input.c, row.color);

    if (Object.keys(updates).length > 0) {
      sqliteDb.update(sqliteTeams).set(updates).where(eq(sqliteTeams.id, teamId)).run();
    }

    if (Array.isArray(input.members)) {
      const mIds = input.members.map(String);
      sqliteDb.update(sqliteMembers).set({ teamId: '' }).where(eq(sqliteMembers.teamId, teamId)).run();
      if (mIds.length > 0) {
        sqliteDb.update(sqliteMembers).set({ teamId }).where(inArray(sqliteMembers.id, mIds)).run();
      }
    }
    touchWorkspaceRow(now);
  })();

  const updated = sqliteDb.select().from(sqliteTeams).where(eq(sqliteTeams.id, teamId)).get()!;
  return {
    team: {
      id: updated.id,
      name: updated.name,
      desc: updated.desc,
      icon: updated.icon,
      c: updated.color,
    },
    updatedAt: now,
  };
}

export function deleteTeamSql(teamId: string) {
  ensureRelationalDatabaseSeeded();
  const conn = getSqliteConnection();
  const now = Date.now();
  let deleted = false;

  conn.transaction(() => {
    const res = sqliteDb.delete(sqliteTeams).where(eq(sqliteTeams.id, teamId)).run();
    deleted = res.changes > 0;
    if (deleted) {
      sqliteDb.update(sqliteMembers).set({ teamId: '' }).where(eq(sqliteMembers.teamId, teamId)).run();
      sqliteDb.update(sqliteProjects).set({ teamId: '' }).where(eq(sqliteProjects.teamId, teamId)).run();
      touchWorkspaceRow(now);
    }
  })();

  return { ok: deleted, updatedAt: now };
}

/* ============================================================================
   MEMBERS & OUTBOX INVITATIONS SQL REPOSITORY
   ============================================================================ */

export function listMembersAndOutboxSql() {
  ensureRelationalDatabaseSeeded();
  const wsRow = sqliteDb
    .select({ meMemberId: sqliteWorkspaces.meMemberId, smtpConfigJson: sqliteWorkspaces.smtpConfigJson })
    .from(sqliteWorkspaces)
    .where(eq(sqliteWorkspaces.id, 'ws_main'))
    .get();
  const members = sqliteDb.select().from(sqliteMembers).all().map(mapMemberRow);
  const outbox = sqliteDb
    .select()
    .from(sqliteOutboxEmails)
    .orderBy(desc(sqliteOutboxEmails.sentAt))
    .all()
    .map(mapOutboxRow);
  const smtpConfig = safeJsonParse<any>(wsRow?.smtpConfigJson, null);
  return {
    members,
    me: wsRow?.meMemberId || 'm1',
    outbox,
    smtpConfig,
  };
}

function createOutboxRecordForMember(
  member: ReturnType<typeof mapMemberRow>,
  baseUrl: string,
  projectName = '',
) {
  const wsRow = sqliteDb
    .select({ name: sqliteWorkspaces.name, meMemberId: sqliteWorkspaces.meMemberId })
    .from(sqliteWorkspaces)
    .where(eq(sqliteWorkspaces.id, 'ws_main'))
    .get();
  const wsName = sanitizeHeaderValue(wsRow?.name || 'Snapsec', 100) || 'Snapsec';
  const meRow = sqliteDb
    .select()
    .from(sqliteMembers)
    .where(eq(sqliteMembers.id, wsRow?.meMemberId || 'm1'))
    .get();
  const inviter = meRow || { name: 'Mohammad Owais', email: 'mohammadowais616@gmail.com' };

  const cleanBase = sanitizeBaseUrl(baseUrl, process.env.APP_URL || 'http://localhost:3000');
  const inviteToken = member.inviteToken || uid('inv');
  const inviteUrl = `${cleanBase}/?invite=${encodeURIComponent(inviteToken)}&email=${encodeURIComponent(member.email)}`;

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
  const now = Date.now();
  const outboxId = uid('em');

  sqliteDb
    .insert(sqliteOutboxEmails)
    .values({
      id: outboxId,
      memberId: member.id,
      toEmail: member.email,
      toName: member.name,
      fromEmail: inviter.email,
      fromName: inviter.name,
      subject,
      textBody: text,
      htmlBody: html,
      inviteToken,
      inviteUrl,
      role: member.role || 'Member',
      teamId: member.team || 'product',
      projectName: projectName || null,
      sentAt: now,
      status: 'queued',
      deliveredToInbox: false,
      previewUrl: null,
      gmailComposeUrl,
      mailtoUrl,
    })
    .run();

  sqliteDb
    .update(sqliteMembers)
    .set({
      inviteToken,
      inviteUrl,
      lastInviteId: outboxId,
      invitedAt: now,
    })
    .where(eq(sqliteMembers.id, member.id))
    .run();

  member.inviteToken = inviteToken;
  member.inviteUrl = inviteUrl;
  member.lastInviteId = outboxId;
  member.invitedAt = now;

  const row = sqliteDb.select().from(sqliteOutboxEmails).where(eq(sqliteOutboxEmails.id, outboxId)).get()!;
  return mapOutboxRow(row);
}

export function inviteMembersSql(
  emails: string[],
  role = 'Member',
  team = 'product',
  baseUrl = '',
  projectName = '',
) {
  ensureRelationalDatabaseSeeded();
  const conn = getSqliteConnection();
  const now = Date.now();
  const invited: any[] = [];
  const outboxItems: any[] = [];

  conn.transaction(() => {
    for (const rawEmail of emails) {
      const email = String(rawEmail || '').trim();
      if (!EMAIL_REGEX.test(email)) {
        throw new Error(`${email} isn't a valid email address`);
      }
      const existingRow = conn
        .prepare(`SELECT * FROM members WHERE LOWER(email) = LOWER(?) LIMIT 1`)
        .get(email) as any;

      let memberId = existingRow?.id;
      if (!existingRow) {
        memberId = uid('m');
        const derivedName = email
          .split('@')[0]
          .replace(/[._-]+/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase());
        sqliteDb
          .insert(sqliteMembers)
          .values({
            id: memberId,
            name: derivedName,
            email,
            role: role || 'Member',
            teamId: team || 'product',
            title: role || 'Member',
            color: '#6B7280',
            status: 'invited',
            lastSeen: null,
            tz: '—',
            inviteToken: uid('inv'),
          })
          .run();
      } else {
        sqliteDb
          .update(sqliteMembers)
          .set({
            role: role || existingRow.role,
            teamId: team || existingRow.team_id,
            inviteToken: existingRow.invite_token || uid('inv'),
          })
          .where(eq(sqliteMembers.id, memberId))
          .run();
      }

      const mRow = sqliteDb.select().from(sqliteMembers).where(eq(sqliteMembers.id, memberId)).get()!;
      const mapped = mapMemberRow(mRow);
      const outboxItem = createOutboxRecordForMember(mapped, baseUrl, projectName);
      invited.push(mapped);
      outboxItems.push(outboxItem);
    }
    touchWorkspaceRow(now);
  })();

  return { invited, outboxItems, updatedAt: now };
}

export function createResendInviteSql(memberId: string, baseUrl = '', projectName = '') {
  ensureRelationalDatabaseSeeded();
  const mRow = sqliteDb.select().from(sqliteMembers).where(eq(sqliteMembers.id, memberId)).get();
  if (!mRow) return null;
  const conn = getSqliteConnection();
  const now = Date.now();
  let emailObj: any = null;
  let mapped: any = null;
  conn.transaction(() => {
    mapped = mapMemberRow(mRow);
    emailObj = createOutboxRecordForMember(mapped, baseUrl, projectName);
    touchWorkspaceRow(now);
  })();
  return { member: mapped, email: emailObj, updatedAt: now };
}

export function updateOutboxItemDeliverySql(outboxItem: any) {
  if (!outboxItem?.id) return;
  const now = Date.now();
  sqliteDb
    .update(sqliteOutboxEmails)
    .set({
      status: String(outboxItem.status || 'sent'),
      transport: outboxItem.transport ? String(outboxItem.transport) : null,
      deliveredToInbox: Boolean(outboxItem.deliveredToInbox),
      previewUrl: outboxItem.previewUrl ? String(outboxItem.previewUrl) : null,
      messageId: outboxItem.messageId ? String(outboxItem.messageId) : null,
      transportError: outboxItem.transportError ? String(outboxItem.transportError) : null,
      oauthError: outboxItem.oauthError ? String(outboxItem.oauthError) : null,
    })
    .where(eq(sqliteOutboxEmails.id, String(outboxItem.id)))
    .run();
  touchWorkspaceRow(now);
}

export function getOutboxEmailsSql() {
  ensureRelationalDatabaseSeeded();
  const rows = sqliteDb
    .select()
    .from(sqliteOutboxEmails)
    .orderBy(desc(sqliteOutboxEmails.sentAt))
    .all();
  return rows.map(mapOutboxRow);
}

export function getInviteByTokenSql(tokenOrEmail: string) {
  ensureRelationalDatabaseSeeded();
  const needle = String(tokenOrEmail || '').trim();
  if (!needle) return null;
  const conn = getSqliteConnection();
  const mRow = conn
    .prepare(
      `SELECT * FROM members
       WHERE invite_token = ? OR LOWER(email) = LOWER(?)
       LIMIT 1`,
    )
    .get(needle, needle) as any;
  if (!mRow) return null;
  const wsRow = sqliteDb.select().from(sqliteWorkspaces).where(eq(sqliteWorkspaces.id, 'ws_main')).get();
  return {
    id: mRow.id,
    name: mRow.name,
    email: mRow.email,
    role: mRow.role,
    team: mRow.team_id,
    status: mRow.status,
    inviteToken: mRow.invite_token,
    hasPassword: Boolean(mRow.password_hash),
    workspaceName: wsRow?.name || 'Snapsec',
  };
}

export function acceptInviteTokenSql(
  tokenOrEmail: string,
  opts: { name?: string; password?: string; userAgent?: string; ip?: string } = {},
) {
  ensureRelationalDatabaseSeeded();
  const needle = String(tokenOrEmail || '').trim();
  if (!needle) return null;
  const conn = getSqliteConnection();
  const mRow = conn
    .prepare(
      `SELECT id FROM members
       WHERE invite_token = ? OR LOWER(email) = LOWER(?) OR id = ?
       LIMIT 1`,
    )
    .get(needle, needle, needle) as { id: string } | undefined;
  if (!mRow) return null;

  const now = Date.now();
  const cleanName = opts.name ? safeString(opts.name, 120).trim() : '';
  const pwHash = opts.password ? hashPassword(opts.password) : null;

  conn.transaction(() => {
    const memberUpdates: Record<string, any> = {
      status: 'active',
      lastSeen: 0,
      emailVerified: true,
    };
    if (cleanName) memberUpdates.name = cleanName;
    if (pwHash) {
      memberUpdates.passwordHash = pwHash;
      memberUpdates.inviteToken = null;
    }

    sqliteDb
      .update(sqliteMembers)
      .set(memberUpdates)
      .where(eq(sqliteMembers.id, mRow.id))
      .run();

    const memberFull = sqliteDb.select().from(sqliteMembers).where(eq(sqliteMembers.id, mRow.id)).get()!;
    const wsRow = sqliteDb.select().from(sqliteWorkspaces).where(eq(sqliteWorkspaces.id, 'ws_main')).get()!;
    const prefs = { ...DEFAULT_PREFS, ...safeJsonParse<Record<string, any>>(wsRow.prefsJson, {}) };
    prefs.name = memberFull.name;
    if (memberFull.title) prefs.title = memberFull.title;

    sqliteDb
      .update(sqliteWorkspaces)
      .set({
        meMemberId: memberFull.id,
        prefsJson: JSON.stringify(prefs),
        updatedAt: now,
      })
      .where(eq(sqliteWorkspaces.id, 'ws_main'))
      .run();

    const projs = sqliteDb.select().from(sqliteProjects).all();
    for (const p of projs) {
      const mList = safeJsonParse<string[]>(p.membersJson, []);
      if (!mList.includes(memberFull.id)) {
        mList.push(memberFull.id);
        sqliteDb
          .update(sqliteProjects)
          .set({ membersJson: JSON.stringify(mList) })
          .where(eq(sqliteProjects.id, p.id))
          .run();
      }
    }

    conn
      .prepare(
        `UPDATE outbox_emails SET status = 'accepted', accepted_at = ?
         WHERE member_id = ? OR invite_token = ?`,
      )
      .run(now, memberFull.id, needle);

    insertActivityRow(memberFull.id, 'joined the workspace', null, null, memberFull.email, now);
  })();

  const updatedMember = sqliteDb.select().from(sqliteMembers).where(eq(sqliteMembers.id, mRow.id)).get()!;
  const wsRow = sqliteDb.select().from(sqliteWorkspaces).where(eq(sqliteWorkspaces.id, 'ws_main')).get()!;
  const sessionInfo = createAuthSessionSql(updatedMember.id, updatedMember.email, updatedMember.name, opts.userAgent, opts.ip, true);
  return {
    member: mapMemberRow(updatedMember),
    me: wsRow.meMemberId,
    prefs: { ...DEFAULT_PREFS, ...safeJsonParse<Record<string, any>>(wsRow.prefsJson, {}) },
    token: sessionInfo.token,
    expiresAt: sessionInfo.expiresAt,
    updatedAt: now,
  };
}

export function patchMemberSql(memberId: string, rawPatch: Record<string, any>) {
  ensureRelationalDatabaseSeeded();
  const row = sqliteDb.select().from(sqliteMembers).where(eq(sqliteMembers.id, memberId)).get();
  if (!row) return null;

  const patch = stripDangerousKeys(rawPatch || {});
  const now = Date.now();
  const conn = getSqliteConnection();

  conn.transaction(() => {
    const updates: Record<string, any> = {};
    for (const k of Object.keys(patch)) {
      if (!ALLOWED_MEMBER_PATCH_KEYS.has(k)) continue;
      if (k === 'photoURL') updates.photoUrl = safeImageSrc(patch.photoURL) || null;
      else if (k === 'c') updates.color = safeCssColor(patch.c, row.color || '#5A67D8');
      else if (k === 'name') updates.name = safeString(patch.name, 200, row.name);
      else if (k === 'email') updates.email = safeString(patch.email, 200, row.email);
      else if (k === 'role') updates.role = safeString(patch.role, 80, row.role);
      else if (k === 'team') updates.teamId = safeString(patch.team, 80);
      else if (k === 'title') updates.title = safeString(patch.title, 120, row.title);
      else if (k === 'status') updates.status = safeString(patch.status, 40, row.status);
      else if (k === 'tz') updates.tz = safeString(patch.tz, 80, row.tz);
    }

    if (Object.keys(updates).length > 0) {
      sqliteDb.update(sqliteMembers).set(updates).where(eq(sqliteMembers.id, memberId)).run();
    }

    const wsRow = sqliteDb.select().from(sqliteWorkspaces).where(eq(sqliteWorkspaces.id, 'ws_main')).get()!;
    if (memberId === wsRow.meMemberId && (updates.name || updates.title)) {
      const prefs = { ...DEFAULT_PREFS, ...safeJsonParse<Record<string, any>>(wsRow.prefsJson, {}) };
      if (updates.name) prefs.name = updates.name;
      if (updates.title) prefs.title = updates.title;
      sqliteDb
        .update(sqliteWorkspaces)
        .set({ prefsJson: JSON.stringify(prefs), updatedAt: now })
        .where(eq(sqliteWorkspaces.id, 'ws_main'))
        .run();
    } else {
      touchWorkspaceRow(now);
    }
  })();

  const updated = sqliteDb.select().from(sqliteMembers).where(eq(sqliteMembers.id, memberId)).get()!;
  return { member: mapMemberRow(updated), updatedAt: now };
}

export function deleteMemberSql(memberId: string) {
  ensureRelationalDatabaseSeeded();
  const conn = getSqliteConnection();
  const now = Date.now();
  let deleted = false;

  conn.transaction(() => {
    const res = sqliteDb.delete(sqliteMembers).where(eq(sqliteMembers.id, memberId)).run();
    deleted = res.changes > 0;
    if (deleted) {
      sqliteDb
        .update(sqliteTasks)
        .set({ assigneeId: null })
        .where(eq(sqliteTasks.assigneeId, memberId))
        .run();
      const projs = sqliteDb.select().from(sqliteProjects).all();
      for (const p of projs) {
        const mList = safeJsonParse<string[]>(p.membersJson, []);
        if (mList.includes(memberId)) {
          sqliteDb
            .update(sqliteProjects)
            .set({ membersJson: JSON.stringify(mList.filter(id => id !== memberId)) })
            .where(eq(sqliteProjects.id, p.id))
            .run();
        }
      }
      touchWorkspaceRow(now);
    }
  })();

  return { ok: deleted, updatedAt: now };
}

/* ============================================================================
   FILES SQL REPOSITORY
   ============================================================================ */

export function listFilesSql(query: Record<string, any> = {}) {
  ensureRelationalDatabaseSeeded();
  const clauses = [];
  const projFilter = safeString(query.project, 80);
  const typeFilter = safeString(query.type, 40);
  if (projFilter) clauses.push(eq(sqliteFiles.projectId, projFilter));
  if (typeFilter && typeFilter !== 'all') clauses.push(eq(sqliteFiles.type, typeFilter));

  const rows = clauses.length
    ? sqliteDb
        .select()
        .from(sqliteFiles)
        .where(and(...clauses))
        .orderBy(desc(sqliteFiles.createdAt))
        .all()
    : sqliteDb.select().from(sqliteFiles).orderBy(desc(sqliteFiles.createdAt)).all();

  return rows.map(mapFileRow);
}

export function insertFileSql(rawInput: Record<string, any>) {
  ensureRelationalDatabaseSeeded();
  const input = stripDangerousKeys(rawInput || {});
  const cleanName = safeString(input.name, 255, 'attachment') || 'attachment';
  const validDataUrl = safeDownloadUrl(input.dataUrl) || null;
  const meId = getCurrentMeId();
  const now = Date.now();
  const fid = safeString(input.id, 80) || uid('f');
  const projectId = safeString(input.project, 80) || 'p1';
  const taskId = safeString(input.task, 80) || null;
  const commentId = safeString(input.commentId, 80) || null;
  const fileTypeStr = safeString(input.type, 20) || detectFileType(cleanName);
  const sizeStr = safeString(input.size, 40, '120 KB') || '120 KB';
  const authorId = safeString(input.by, 80) || meId;
  const textContent = typeof input.textContent === 'string' ? input.textContent.slice(0, 500000) : null;
  const mime = safeString(input.mime, 100) || null;

  const conn = getSqliteConnection();
  conn.transaction(() => {
    sqliteDb
      .insert(sqliteFiles)
      .values({
        id: fid,
        name: cleanName,
        type: fileTypeStr,
        size: sizeStr,
        authorId,
        createdAt: now,
        projectId,
        taskId,
        commentId,
        dataUrl: validDataUrl,
        textContent,
        mime,
      })
      .onConflictDoUpdate({
        target: sqliteFiles.id,
        set: {
          name: cleanName,
          type: fileTypeStr,
          size: sizeStr,
          projectId,
          taskId,
          commentId,
          dataUrl: validDataUrl,
          textContent,
          mime,
        },
      })
      .run();

    if (taskId) {
      const taskRow = sqliteDb.select().from(sqliteTasks).where(eq(sqliteTasks.id, taskId)).get();
      if (taskRow) {
        sqliteDb.update(sqliteTasks).set({ updatedAt: now }).where(eq(sqliteTasks.id, taskId)).run();
        insertActivityRow(meId, 'added a file to', taskId, taskRow.projectId, cleanName, now);
      }
    }
    touchWorkspaceRow(now);
  })();

  const row = sqliteDb.select().from(sqliteFiles).where(eq(sqliteFiles.id, fid)).get()!;
  return { file: mapFileRow(row), updatedAt: now };
}

export function renameFileSql(fileId: string, newName: string) {
  ensureRelationalDatabaseSeeded();
  const cleanName = safeString(newName, 255).trim();
  if (!cleanName) return null;
  const row = sqliteDb.select().from(sqliteFiles).where(eq(sqliteFiles.id, fileId)).get();
  if (!row) return null;
  const now = Date.now();
  const newType = detectFileType(cleanName);
  sqliteDb
    .update(sqliteFiles)
    .set({ name: cleanName, type: newType })
    .where(eq(sqliteFiles.id, fileId))
    .run();
  touchWorkspaceRow(now);
  return {
    file: mapFileRow({ ...row, name: cleanName, type: newType }),
    updatedAt: now,
  };
}

export function duplicateFileSql(fileId: string) {
  ensureRelationalDatabaseSeeded();
  const row = sqliteDb.select().from(sqliteFiles).where(eq(sqliteFiles.id, fileId)).get();
  if (!row) return null;
  const now = Date.now();
  const newId = uid('f');
  const meId = getCurrentMeId();
  const copyName = row.name.replace(/(\.[^.]+)$/, ' copy$1');

  sqliteDb
    .insert(sqliteFiles)
    .values({
      ...row,
      id: newId,
      name: copyName === row.name ? `${row.name} copy` : copyName,
      authorId: meId,
      createdAt: now,
    })
    .run();
  touchWorkspaceRow(now);
  const created = sqliteDb.select().from(sqliteFiles).where(eq(sqliteFiles.id, newId)).get()!;
  return { file: mapFileRow(created), updatedAt: now };
}

export function deleteFileSql(fileId: string) {
  ensureRelationalDatabaseSeeded();
  const now = Date.now();
  const res = sqliteDb.delete(sqliteFiles).where(eq(sqliteFiles.id, fileId)).run();
  if (res.changes > 0) touchWorkspaceRow(now);
  return { ok: res.changes > 0, updatedAt: now };
}

/* ============================================================================
   NOTIFICATIONS, ACTIVITY, VIEWS, PREFS, WORKSPACE & AUTH SQL REPOSITORY
   ============================================================================ */

export function listNotificationsSql() {
  ensureRelationalDatabaseSeeded();
  return sqliteDb
    .select()
    .from(sqliteNotifications)
    .orderBy(desc(sqliteNotifications.createdAt))
    .all()
    .map(n => ({
      id: n.id,
      type: n.type,
      by: n.actorId,
      task: n.taskId,
      project: n.projectId,
      text: n.text,
      snippet: n.snippet,
      at: n.createdAt,
      read: Boolean(n.read),
    }));
}

export function markNotificationReadSql(notifId: string, read = true) {
  ensureRelationalDatabaseSeeded();
  const row = sqliteDb.select().from(sqliteNotifications).where(eq(sqliteNotifications.id, notifId)).get();
  if (!row) return null;
  const now = Date.now();
  sqliteDb
    .update(sqliteNotifications)
    .set({ read: Boolean(read) })
    .where(eq(sqliteNotifications.id, notifId))
    .run();
  touchWorkspaceRow(now);
  return {
    notification: {
      id: row.id,
      type: row.type,
      by: row.actorId,
      task: row.taskId,
      project: row.projectId,
      text: row.text,
      snippet: row.snippet,
      at: row.createdAt,
      read: Boolean(read),
    },
    updatedAt: now,
  };
}

export function markAllNotificationsReadSql() {
  ensureRelationalDatabaseSeeded();
  const now = Date.now();
  sqliteDb.update(sqliteNotifications).set({ read: true }).run();
  touchWorkspaceRow(now);
  return { ok: true, updatedAt: now };
}

export function deleteReadNotificationsSql() {
  ensureRelationalDatabaseSeeded();
  const now = Date.now();
  sqliteDb.delete(sqliteNotifications).where(eq(sqliteNotifications.read, true)).run();
  touchWorkspaceRow(now);
  return { notifications: listNotificationsSql(), updatedAt: now };
}

export function listActivityLogsSql() {
  ensureRelationalDatabaseSeeded();
  return sqliteDb
    .select()
    .from(sqliteActivityLogs)
    .orderBy(desc(sqliteActivityLogs.createdAt))
    .limit(250)
    .all()
    .map(a => ({
      id: a.id,
      by: a.actorId,
      verb: a.verb,
      task: a.taskId,
      project: a.projectId,
      at: a.createdAt,
      extra: a.extra,
    }));
}

export function insertSavedViewSql(rawInput: Record<string, any>) {
  ensureRelationalDatabaseSeeded();
  const input = stripDangerousKeys(rawInput || {});
  const now = Date.now();
  const sv = {
    id: safeString(input.id, 80) || uid('v'),
    project: safeString(input.project, 80, 'p1') || 'p1',
    name: safeString(input.name, 120, 'Untitled view').trim() || 'Untitled view',
    type: safeString(input.type, 40, 'list') || 'list',
    filters: Array.isArray(input.filters) ? input.filters : [],
  };
  sqliteDb
    .insert(sqliteSavedViews)
    .values({
      id: sv.id,
      projectId: sv.project,
      name: sv.name,
      type: sv.type,
      filtersJson: JSON.stringify(sv.filters),
    })
    .onConflictDoUpdate({
      target: sqliteSavedViews.id,
      set: { name: sv.name, type: sv.type, filtersJson: JSON.stringify(sv.filters) },
    })
    .run();
  touchWorkspaceRow(now);
  return { view: sv, updatedAt: now };
}

export function renameSavedViewSql(viewId: string, name: string) {
  ensureRelationalDatabaseSeeded();
  const row = sqliteDb.select().from(sqliteSavedViews).where(eq(sqliteSavedViews.id, viewId)).get();
  if (!row) return null;
  const cleanName = safeString(name, 120, row.name).trim() || row.name;
  const now = Date.now();
  sqliteDb.update(sqliteSavedViews).set({ name: cleanName }).where(eq(sqliteSavedViews.id, viewId)).run();
  touchWorkspaceRow(now);
  return {
    view: {
      id: row.id,
      project: row.projectId,
      name: cleanName,
      type: row.type,
      filters: safeJsonParse<any[]>(row.filtersJson, []),
    },
    updatedAt: now,
  };
}

export function deleteSavedViewSql(viewId: string) {
  ensureRelationalDatabaseSeeded();
  const now = Date.now();
  sqliteDb.delete(sqliteSavedViews).where(eq(sqliteSavedViews.id, viewId)).run();
  touchWorkspaceRow(now);
  return { ok: true, updatedAt: now };
}

export function patchPreferencesSql(rawPrefs?: Record<string, any>, rawNotifPrefs?: Record<string, any>) {
  ensureRelationalDatabaseSeeded();
  const wsRow = sqliteDb.select().from(sqliteWorkspaces).where(eq(sqliteWorkspaces.id, 'ws_main')).get()!;
  const prefs = {
    ...DEFAULT_PREFS,
    ...safeJsonParse<Record<string, any>>(wsRow.prefsJson, {}),
    ...(rawPrefs && typeof rawPrefs === 'object' ? stripDangerousKeys(rawPrefs) : {}),
  };
  const notifPrefs = {
    ...safeJsonParse<Record<string, any>>(wsRow.notifPrefsJson, {}),
    ...(rawNotifPrefs && typeof rawNotifPrefs === 'object' ? stripDangerousKeys(rawNotifPrefs) : {}),
  };
  const now = Date.now();
  sqliteDb
    .update(sqliteWorkspaces)
    .set({
      prefsJson: JSON.stringify(prefs),
      notifPrefsJson: JSON.stringify(notifPrefs),
      updatedAt: now,
    })
    .where(eq(sqliteWorkspaces.id, 'ws_main'))
    .run();
  return { prefs, notifPrefs, updatedAt: now };
}

export function patchWorkspaceSql(rawInput: Record<string, any>) {
  ensureRelationalDatabaseSeeded();
  const input = stripDangerousKeys(rawInput || {});
  const wsRow = sqliteDb.select().from(sqliteWorkspaces).where(eq(sqliteWorkspaces.id, 'ws_main')).get()!;
  const oldName = wsRow.name;
  const newName = input.name !== undefined ? safeString(input.name, 120).trim() : wsRow.name;
  const newUrl = input.url
    ? safeString(input.url, 120)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
    : wsRow.url;
  const newColor = input.c ? safeCssColor(input.c, wsRow.color) : wsRow.color;
  const newPlan = input.plan ? safeString(input.plan, 40, wsRow.plan) : wsRow.plan;

  const workspacesList = safeJsonParse<any[]>(wsRow.workspacesListJson, []);
  const matching = workspacesList.find((w: any) => w.name === oldName);
  if (matching && newName) matching.name = newName;

  const currentPrefs = safeJsonParse<Record<string, any>>(wsRow.prefsJson, {});
  let updatedStatuses = Array.isArray(currentPrefs.statuses) && currentPrefs.statuses.length > 0
    ? currentPrefs.statuses
    : DEFAULT_STATUSES.map((s: any) => ({ ...s }));

  if (Array.isArray(input.statuses) && input.statuses.length > 0) {
    const sanitized = input.statuses
      .map((s: any) => {
        if (!s || typeof s !== 'object') return null;
        const name = safeString(s.name, 60).trim();
        const rawId = safeString(s.id, 50)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, '_');
        if (!name || !rawId) return null;
        const c = safeCssColor(s.c, '#6366F1');
        const kind = ['backlog', 'todo', 'progress', 'review', 'done'].includes(s.kind) ? s.kind : 'progress';
        return { id: rawId, name, c, kind };
      })
      .filter(Boolean);
    if (sanitized.length > 0) {
      updatedStatuses = sanitized;
      currentPrefs.statuses = updatedStatuses;
      syncStatuses(updatedStatuses);
    }
  }

  const now = Date.now();
  sqliteDb
    .update(sqliteWorkspaces)
    .set({
      name: newName,
      url: newUrl,
      color: newColor,
      plan: newPlan,
      workspacesListJson: JSON.stringify(workspacesList),
      prefsJson: JSON.stringify(currentPrefs),
      updatedAt: now,
    })
    .where(eq(sqliteWorkspaces.id, 'ws_main'))
    .run();

  return {
    ws: { name: newName, url: newUrl, c: newColor, brand: Boolean(wsRow.brand) },
    workspaces: workspacesList,
    statuses: updatedStatuses,
    updatedAt: now,
  };
}

export function saveSmtpConfigSql(smtpConfig: {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}) {
  ensureRelationalDatabaseSeeded();
  const now = Date.now();
  sqliteDb
    .update(sqliteWorkspaces)
    .set({
      smtpConfigJson: JSON.stringify(smtpConfig),
      updatedAt: now,
    })
    .where(eq(sqliteWorkspaces.id, 'ws_main'))
    .run();
  return now;
}

export function getSmtpConfigSql() {
  ensureRelationalDatabaseSeeded();
  const wsRow = sqliteDb
    .select({ smtpConfigJson: sqliteWorkspaces.smtpConfigJson })
    .from(sqliteWorkspaces)
    .where(eq(sqliteWorkspaces.id, 'ws_main'))
    .get();
  return safeJsonParse<any>(wsRow?.smtpConfigJson, null);
}

export function authenticateWorkspaceUserSql(profile: {
  uid?: string;
  name?: string;
  email: string;
  photoURL?: string;
  provider?: string;
}) {
  ensureRelationalDatabaseSeeded();
  const email = String(profile.email || '').trim();
  if (!email) return null;
  const derivedName =
    safeString(profile.name, 120).trim() ||
    email
      .split('@')[0]
      .replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());

  const conn = getSqliteConnection();
  const now = Date.now();
  let targetMemberId = 'm1';

  conn.transaction(() => {
    const existing =
      (profile.uid &&
        sqliteDb
          .select()
          .from(sqliteMembers)
          .where(eq(sqliteMembers.uid, String(profile.uid)))
          .get()) ||
      (conn.prepare(`SELECT * FROM members WHERE LOWER(email) = LOWER(?) LIMIT 1`).get(email) as any);

    if (!existing) {
      const ownerRow =
        sqliteDb.select().from(sqliteMembers).where(eq(sqliteMembers.id, 'm1')).get() ||
        sqliteDb.select().from(sqliteMembers).get();
      if (ownerRow) {
        targetMemberId = ownerRow.id;
        sqliteDb
          .update(sqliteMembers)
          .set({
            name: derivedName,
            email,
            ...(profile.photoURL !== undefined ? { photoUrl: safeImageSrc(profile.photoURL) || null } : {}),
            ...(profile.uid ? { uid: safeString(profile.uid, 128) } : {}),
            status: 'active',
            lastSeen: 0,
          })
          .where(eq(sqliteMembers.id, targetMemberId))
          .run();
      } else {
        targetMemberId = 'm1';
        sqliteDb
          .insert(sqliteMembers)
          .values({
            id: 'm1',
            uid: profile.uid ? safeString(profile.uid, 128) : null,
            name: derivedName,
            email,
            photoUrl: safeImageSrc(profile.photoURL) || null,
            role: 'Owner',
            teamId: 'product',
            title: 'Head of Product',
            color: '#5A67D8',
            status: 'active',
            lastSeen: 0,
            tz: 'San Francisco',
          })
          .run();
      }
    } else {
      targetMemberId = existing.id;
      const safePhoto = safeImageSrc(profile.photoURL);
      sqliteDb
        .update(sqliteMembers)
        .set({
          ...(profile.name && String(profile.name).trim()
            ? { name: safeString(profile.name, 120).trim() }
            : {}),
          email,
          ...(safePhoto ? { photoUrl: safePhoto } : {}),
          ...(profile.uid ? { uid: safeString(profile.uid, 128) } : {}),
          status: 'active',
          lastSeen: 0,
        })
        .where(eq(sqliteMembers.id, targetMemberId))
        .run();
    }

    const memberRow = sqliteDb.select().from(sqliteMembers).where(eq(sqliteMembers.id, targetMemberId)).get()!;
    const wsRow = sqliteDb.select().from(sqliteWorkspaces).where(eq(sqliteWorkspaces.id, 'ws_main')).get()!;
    const prefs = { ...DEFAULT_PREFS, ...safeJsonParse<Record<string, any>>(wsRow.prefsJson, {}) };
    prefs.name = memberRow.name;
    if (memberRow.title) prefs.title = memberRow.title;

    sqliteDb
      .update(sqliteWorkspaces)
      .set({
        meMemberId: targetMemberId,
        prefsJson: JSON.stringify(prefs),
        updatedAt: now,
      })
      .where(eq(sqliteWorkspaces.id, 'ws_main'))
      .run();

    const projs = sqliteDb.select().from(sqliteProjects).all();
    for (const p of projs) {
      const mList = safeJsonParse<string[]>(p.membersJson, []);
      if (!mList.includes(targetMemberId)) {
        mList.unshift(targetMemberId);
        sqliteDb
          .update(sqliteProjects)
          .set({ membersJson: JSON.stringify(mList) })
          .where(eq(sqliteProjects.id, p.id))
          .run();
      }
    }
  })();

  const memberRow = sqliteDb.select().from(sqliteMembers).where(eq(sqliteMembers.id, targetMemberId)).get()!;
  const wsRow = sqliteDb.select().from(sqliteWorkspaces).where(eq(sqliteWorkspaces.id, 'ws_main')).get()!;
  return {
    user: mapMemberRow(memberRow),
    me: wsRow.meMemberId,
    prefs: { ...DEFAULT_PREFS, ...safeJsonParse<Record<string, any>>(wsRow.prefsJson, {}) },
    updatedAt: now,
  };
}

function describeDeviceFromUserAgent(ua = ''): string {
  const s = String(ua || '');
  if (!s) return 'Web Browser';
  const browser = s.includes('Edg/')
    ? 'Edge'
    : s.includes('Chrome/')
      ? 'Chrome'
      : s.includes('Firefox/')
        ? 'Firefox'
        : s.includes('Safari/')
          ? 'Safari'
          : 'Browser';
  const os = s.includes('Mac OS X')
    ? 'macOS'
    : s.includes('Windows')
      ? 'Windows'
      : s.includes('iPhone') || s.includes('iPad')
        ? 'iOS'
        : s.includes('Android')
          ? 'Android'
          : s.includes('Linux')
            ? 'Linux'
            : 'Desktop';
  return `${browser} on ${os}`;
}

export function createAuthSessionSql(
  memberId: string,
  email: string,
  name = '',
  userAgent = '',
  ip = '127.0.0.1',
  rememberMe = true,
) {
  ensureRelationalDatabaseSeeded();
  const conn = getSqliteConnection();
  const now = Date.now();
  const sessionId = uid('ss');
  const auth = generateAuthToken({ email, name, id: memberId, sessionId }, rememberMe);
  const device = describeDeviceFromUserAgent(userAgent);
  const cleanIp = safeString(ip, 64, '127.0.0.1') || '127.0.0.1';

  conn.transaction(() => {
    conn.prepare(`UPDATE sessions SET is_current = 0 WHERE member_id = ?`).run(memberId);
    sqliteDb
      .insert(sqliteSessions)
      .values({
        id: sessionId,
        token: auth.token,
        memberId,
        device,
        loc: 'Authenticated session',
        ip: cleanIp,
        lastActive: 'Active now',
        isCurrent: true,
        createdAt: now,
        expiresAt: auth.expiresAt,
      })
      .run();
  })();

  return {
    sessionId,
    token: auth.token,
    expiresAt: auth.expiresAt,
    session: {
      id: sessionId,
      device,
      loc: 'Authenticated session',
      ip: cleanIp,
      last: 'Active now',
      cur: true,
    },
  };
}

export function createEmailVerificationRecordSql(
  memberId: string,
  email: string,
  name: string,
  baseUrl = 'http://localhost:4000',
) {
  ensureRelationalDatabaseSeeded();
  const conn = getSqliteConnection();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const verifyToken = generateOtpCode();
  const cleanBase = sanitizeBaseUrl(baseUrl, 'http://localhost:4000');
  const verifyUrl = `${cleanBase}/?verify=${encodeURIComponent(verifyToken)}&email=${encodeURIComponent(cleanEmail)}#verify`;
  const wsRow = sqliteDb.select().from(sqliteWorkspaces).where(eq(sqliteWorkspaces.id, 'ws_main')).get()!;
  const wsName = wsRow?.name || 'Snapsec';
  const now = Date.now();
  const outboxId = uid('em');

  const subject = `${verifyToken} is your ${wsName} verification code`;
  const textBody = `Hi ${name},\n\nYour 6-digit verification code (OTP) for ${wsName} (${cleanEmail}) is:\n\n${verifyToken}\n\nEnter this 6-digit OTP on the verification screen to activate your account and sign in.\n\nOr open: ${verifyUrl}\n\nIf you did not create this account, you can safely ignore this email.`;
  const htmlBody = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:28px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;color:#111827">
    <div style="margin-bottom:20px">
      <img src="https://suite.snapsec.co/media/logos/snapsec.svg" alt="${esc(wsName)}" style="height:28px;width:auto;display:block" />
    </div>
    <h2 style="font-size:20px;font-weight:600;margin:0 0 12px;color:#111827">Verify your email address</h2>
    <p style="font-size:14px;line-height:1.6;color:#374151;margin:0 0 16px">Hi <strong>${esc(name)}</strong>, thank you for signing up for <strong>${esc(wsName)}</strong>. Enter the 6-digit verification code (OTP) below to activate your account for <strong>${esc(cleanEmail)}</strong>:</p>
    <div style="margin:24px 0;padding:18px 24px;background:#F3F4F6;border:1px solid #E5E7EB;border-radius:10px;text-align:center">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#6B7280;margin-bottom:6px">One-Time Verification Code</div>
      <div style="font-family:monospace;font-size:32px;font-weight:700;letter-spacing:0.22em;color:#111827">${esc(verifyToken)}</div>
    </div>
    <p style="font-size:12.5px;line-height:1.5;color:#6B7280;margin:0 0 8px">Or click to verify directly:</p>
    <div style="font-family:monospace;font-size:12px;padding:10px 12px;background:#F9FAFB;border-radius:6px;word-break:break-all;color:#1F2937"><a href="${esc(verifyUrl)}" style="color:#4F46E5;text-decoration:none">${esc(verifyUrl)}</a></div>
    <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0 12px" />
    <div style="font-size:11.5px;color:#9CA3AF">Sent by ${esc(wsName)} TaskTracker · Security &amp; Engineering Workspace</div>
  </div>`;

  conn.transaction(() => {
    sqliteDb
      .update(sqliteMembers)
      .set({
        verifyToken,
        emailVerified: false,
      })
      .where(eq(sqliteMembers.id, memberId))
      .run();

    sqliteDb
      .insert(sqliteOutboxEmails)
      .values({
        id: outboxId,
        memberId,
        toEmail: cleanEmail,
        toName: name,
        fromEmail: 'security@snapsec.co',
        fromName: `${wsName} Security`,
        subject,
        textBody,
        htmlBody,
        inviteToken: verifyToken,
        inviteUrl: verifyUrl,
        role: 'Member',
        teamId: 'product',
        sentAt: now,
        status: 'queued',
        deliveredToInbox: false,
      })
      .run();
  })();

  const outboxRow = sqliteDb.select().from(sqliteOutboxEmails).where(eq(sqliteOutboxEmails.id, outboxId)).get()!;
  return {
    otp: verifyToken,
    verifyToken,
    verifyUrl,
    outboxItem: mapOutboxRow(outboxRow),
  };
}

export function signupUserSql(input: {
  name: string;
  email: string;
  password: string;
  userAgent?: string;
  ip?: string;
  baseUrl?: string;
}) {
  ensureRelationalDatabaseSeeded();
  const conn = getSqliteConnection();
  const email = String(input.email || '').trim().toLowerCase();
  const name = safeString(input.name, 120).trim();
  if (!isSnapsecCompanyEmail(email)) {
    return {
      ok: false as const,
      status: 403,
      error: 'Only @snapsec.co company email addresses are allowed to sign up',
      errors: { email: 'Only @snapsec.co company email addresses are allowed to sign up' },
    };
  }
  const pwHash = hashPassword(input.password);
  const now = Date.now();

  const existing = conn
    .prepare(`SELECT * FROM members WHERE LOWER(email) = LOWER(?) LIMIT 1`)
    .get(email) as any;

  if (existing && existing.password_hash && existing.email_verified) {
    return {
      ok: false as const,
      status: 409,
      error: 'An account with this email already exists. Please sign in instead.',
      errors: { email: 'An account with this email already exists. Please sign in instead.' },
    };
  }

  const realUsersCount = conn
    .prepare(`SELECT COUNT(*) AS cnt FROM members WHERE password_hash IS NOT NULL AND password_hash != ''`)
    .get() as { cnt: number };
  const isFirstRealAccount = Number(realUsersCount?.cnt || 0) <= 1;

  let targetMemberId = existing?.id || uid('m');
  const verifyToken = generateOtpCode();
  const cleanBase = sanitizeBaseUrl(input.baseUrl, 'http://localhost:4000');
  const verifyUrl = `${cleanBase}/?verify=${encodeURIComponent(verifyToken)}&email=${encodeURIComponent(email)}#verify`;
  const wsRow = sqliteDb.select().from(sqliteWorkspaces).where(eq(sqliteWorkspaces.id, 'ws_main')).get()!;
  const wsName = wsRow?.name || 'Snapsec';
  const outboxId = uid('em');

  conn.transaction(() => {
    if (existing) {
      targetMemberId = existing.id;
      sqliteDb
        .update(sqliteMembers)
        .set({
          name: name || existing.name,
          email,
          passwordHash: pwHash,
          verifyToken,
          emailVerified: false,
          status: 'pending',
          lastSeen: 0,
          inviteToken: null,
        })
        .where(eq(sqliteMembers.id, targetMemberId))
        .run();
    } else {
      sqliteDb
        .insert(sqliteMembers)
        .values({
          id: targetMemberId,
          name,
          email,
          passwordHash: pwHash,
          verifyToken,
          emailVerified: false,
          role: isFirstRealAccount ? 'Owner' : 'Member',
          teamId: 'product',
          title: isFirstRealAccount ? 'Workspace Owner' : 'Member',
          color: '#5A67D8',
          status: 'pending',
          lastSeen: 0,
          tz: 'UTC',
        })
        .run();
    }

    const verifySubject = `${verifyToken} is your ${wsName} verification code`;
    const verifyText = `Hi ${name},\n\nYour 6-digit verification code (OTP) for ${wsName} (${email}) is:\n\n${verifyToken}\n\nEnter this 6-digit OTP on the verification screen to activate your account and sign in.\n\nOr open: ${verifyUrl}\n\nIf you did not sign up for this account, you can safely ignore this email.`;
    const verifyHtml = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:28px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;color:#111827">
      <div style="margin-bottom:20px">
        <img src="https://suite.snapsec.co/media/logos/snapsec.svg" alt="${esc(wsName)}" style="height:28px;width:auto;display:block" />
      </div>
      <h2 style="font-size:20px;font-weight:600;margin:0 0 12px;color:#111827">Verify your email address</h2>
      <p style="font-size:14px;line-height:1.6;color:#374151;margin:0 0 16px">Hi <strong>${esc(name)}</strong>, thank you for joining <strong>${esc(wsName)}</strong>. Enter the 6-digit verification code (OTP) below to activate your account for <strong>${esc(email)}</strong>:</p>
      <div style="margin:24px 0;padding:18px 24px;background:#F3F4F6;border:1px solid #E5E7EB;border-radius:10px;text-align:center">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#6B7280;margin-bottom:6px">One-Time Verification Code</div>
        <div style="font-family:monospace;font-size:32px;font-weight:700;letter-spacing:0.22em;color:#111827">${esc(verifyToken)}</div>
      </div>
      <p style="font-size:12.5px;line-height:1.5;color:#6B7280;margin:0 0 8px">Or click to verify directly:</p>
      <div style="font-family:monospace;font-size:12px;padding:10px 12px;background:#F9FAFB;border-radius:6px;word-break:break-all;color:#1F2937"><a href="${esc(verifyUrl)}" style="color:#4F46E5;text-decoration:none">${esc(verifyUrl)}</a></div>
      <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0 12px" />
      <div style="font-size:11.5px;color:#9CA3AF">Sent by ${esc(wsName)} TaskTracker · Security &amp; Engineering Workspace</div>
    </div>`;

    sqliteDb
      .insert(sqliteOutboxEmails)
      .values({
        id: outboxId,
        memberId: targetMemberId,
        toEmail: email,
        toName: name,
        fromEmail: 'security@snapsec.co',
        fromName: `${wsName} Security`,
        subject: verifySubject,
        textBody: verifyText,
        htmlBody: verifyHtml,
        inviteToken: verifyToken,
        inviteUrl: verifyUrl,
        role: isFirstRealAccount ? 'Owner' : 'Member',
        teamId: 'product',
        sentAt: now,
        status: 'queued',
        deliveredToInbox: false,
      })
      .run();

    const projs = sqliteDb.select().from(sqliteProjects).all();
    for (const p of projs) {
      const mList = safeJsonParse<string[]>(p.membersJson, []);
      if (!mList.includes(targetMemberId)) {
        mList.unshift(targetMemberId);
        sqliteDb
          .update(sqliteProjects)
          .set({ membersJson: JSON.stringify(mList) })
          .where(eq(sqliteProjects.id, p.id))
          .run();
      }
    }
  })();

  ensureSeedAccountSql();

  const memberRow = sqliteDb.select().from(sqliteMembers).where(eq(sqliteMembers.id, targetMemberId)).get()!;
  const outboxRow = sqliteDb.select().from(sqliteOutboxEmails).where(eq(sqliteOutboxEmails.id, outboxId)).get();

  return {
    ok: true as const,
    user: mapMemberRow(memberRow),
    me: wsRow.meMemberId,
    prefs: { ...DEFAULT_PREFS, ...safeJsonParse<Record<string, any>>(wsRow.prefsJson, {}) },
    token: null,
    expiresAt: null,
    session: null,
    isFirstOwner: isFirstRealAccount,
    otp: verifyToken,
    verifyToken,
    verifyUrl,
    outboxItem: outboxRow ? mapOutboxRow(outboxRow) : null,
    updatedAt: now,
  };
}

export function verifyEmailTokenSql(input: {
  token?: string;
  otp?: string;
  email?: string;
  userAgent?: string;
  ip?: string;
}) {
  ensureRelationalDatabaseSeeded();
  const conn = getSqliteConnection();
  const token = String(input.otp || input.token || '').trim();
  const email = String(input.email || '').trim().toLowerCase();

  if (!token) {
    return { ok: false as const, status: 400, error: 'Please enter the 6-digit OTP sent to your email.' };
  }

  let member: any = null;
  if (email) {
    member = conn.prepare(`SELECT * FROM members WHERE LOWER(email) = LOWER(?) AND verify_token = ? LIMIT 1`).get(email, token);
  } else {
    member = conn.prepare(`SELECT * FROM members WHERE verify_token = ? LIMIT 1`).get(token);
  }

  if (!member) {
    return {
      ok: false as const,
      status: 400,
      error: 'Invalid or expired OTP code. Please check your email or click Resend OTP.',
    };
  }

  const now = Date.now();
  const wsRow = sqliteDb.select().from(sqliteWorkspaces).where(eq(sqliteWorkspaces.id, 'ws_main')).get()!;
  const prefs = { ...DEFAULT_PREFS, ...safeJsonParse<Record<string, any>>(wsRow.prefsJson, {}) };
  prefs.name = member.name;
  if (member.title) prefs.title = member.title;

  conn.transaction(() => {
    sqliteDb
      .update(sqliteMembers)
      .set({
        emailVerified: true,
        verifyToken: null,
        status: 'active',
        lastSeen: 0,
      })
      .where(eq(sqliteMembers.id, member.id))
      .run();

    sqliteDb
      .update(sqliteWorkspaces)
      .set({
        meMemberId: member.id,
        prefsJson: JSON.stringify(prefs),
        updatedAt: now,
      })
      .where(eq(sqliteWorkspaces.id, 'ws_main'))
      .run();

    conn.prepare(`UPDATE outbox_emails SET status = 'accepted', accepted_at = ? WHERE invite_token = ?`).run(now, token);
  })();

  const updated = sqliteDb.select().from(sqliteMembers).where(eq(sqliteMembers.id, member.id)).get()!;
  const mapped = mapMemberRow(updated);
  const sessionInfo = createAuthSessionSql(
    updated.id,
    updated.email,
    updated.name,
    input.userAgent || '',
    input.ip || '127.0.0.1',
    true,
  );

  return {
    ok: true as const,
    email: updated.email,
    user: mapped,
    member: mapped,
    me: updated.id,
    prefs,
    token: sessionInfo.token,
    expiresAt: sessionInfo.expiresAt,
    session: sessionInfo.session,
    message: 'Email verified successfully',
  };
}

export function resendVerificationEmailSql(email: string, baseUrl = 'http://localhost:4000') {
  ensureRelationalDatabaseSeeded();
  const conn = getSqliteConnection();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const member = conn.prepare(`SELECT * FROM members WHERE LOWER(email) = LOWER(?) LIMIT 1`).get(cleanEmail) as any;
  if (!member) {
    return { ok: false as const, status: 404, error: 'No account found with this email address' };
  }
  const cleanBase = sanitizeBaseUrl(baseUrl, 'http://localhost:4000');
  const record = createEmailVerificationRecordSql(member.id, member.email, member.name, cleanBase);
  return {
    ok: true as const,
    email: member.email,
    ...record,
  };
}

export function loginUserSql(input: {
  email: string;
  password: string;
  rememberMe?: boolean;
  userAgent?: string;
  ip?: string;
}) {
  ensureRelationalDatabaseSeeded();
  const conn = getSqliteConnection();
  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');
  const now = Date.now();

  const existing = conn
    .prepare(`SELECT * FROM members WHERE LOWER(email) = LOWER(?) LIMIT 1`)
    .get(email) as any;

  if (!existing) {
    return {
      ok: false as const,
      status: 401,
      code: 'USER_NOT_FOUND',
      error: 'No account found with this email address. Please sign up to create an account.',
      errors: { login: 'No account found with this email address. Please sign up to create an account.' },
    };
  }

  if (existing.status === 'invited' && !existing.password_hash) {
    return {
      ok: false as const,
      status: 401,
      code: 'USER_NOT_FOUND',
      error: 'Your invitation is still pending. Please sign up to create your account.',
      errors: {
        login: 'Your invitation is still pending. Please sign up to create your account.',
      },
    };
  }

  const isSeedEmail = email === DEFAULT_SEED_EMAIL.toLowerCase();
  const isTestOwner = isTestRuntime() && email === 'mohammadowais616@gmail.com';

  if (isSeedEmail && FALLBACK_SEED_PASSWORDS.has(password)) {
    if (!existing.password_hash) {
      const pwHash = hashPassword(DEFAULT_SEED_PASSWORD);
      conn.prepare(`UPDATE members SET password_hash = ?, email_verified = 1 WHERE id = ?`).run(pwHash, existing.id);
      existing.password_hash = pwHash;
    }
  } else if (!existing.password_hash) {
    if (isTestOwner) {
      const pwHash = hashPassword(password);
      conn.prepare(`UPDATE members SET password_hash = ?, email_verified = 1 WHERE id = ?`).run(pwHash, existing.id);
      existing.password_hash = pwHash;
    } else {
      return {
        ok: false as const,
        status: 401,
        code: 'USER_NOT_FOUND',
        error: 'No account found with this email address. Please sign up to create an account.',
        errors: { login: 'No account found with this email address. Please sign up to create an account.' },
      };
    }
  } else if (!verifyPassword(password, existing.password_hash)) {
    return {
      ok: false as const,
      status: 401,
      code: 'INVALID_CREDENTIALS',
      error: 'Invalid email or password. Please check your credentials or sign up to create an account.',
      errors: { login: 'Invalid email or password. Please check your credentials or sign up to create an account.' },
    };
  }

  if (!existing.email_verified && existing.verify_token && !isSeedEmail && !isTestOwner) {
    return {
      ok: false as const,
      status: 403,
      code: 'EMAIL_NOT_VERIFIED',
      email: existing.email,
      error: 'Your account is awaiting OTP verification. Please enter the 6-digit OTP sent to your email.',
      errors: { login: 'Your account is awaiting OTP verification. Please enter the 6-digit OTP sent to your email.' },
    };
  }

  const targetMemberId = existing.id;
  conn.transaction(() => {
    sqliteDb
      .update(sqliteMembers)
      .set({ status: 'active', lastSeen: 0 })
      .where(eq(sqliteMembers.id, targetMemberId))
      .run();

    const wsRow = sqliteDb.select().from(sqliteWorkspaces).where(eq(sqliteWorkspaces.id, 'ws_main')).get()!;
    const prefs = { ...DEFAULT_PREFS, ...safeJsonParse<Record<string, any>>(wsRow.prefsJson, {}) };
    prefs.name = existing.name;
    if (existing.title) prefs.title = existing.title;

    sqliteDb
      .update(sqliteWorkspaces)
      .set({
        meMemberId: targetMemberId,
        prefsJson: JSON.stringify(prefs),
        updatedAt: now,
      })
      .where(eq(sqliteWorkspaces.id, 'ws_main'))
      .run();
  })();

  const memberRow = sqliteDb.select().from(sqliteMembers).where(eq(sqliteMembers.id, targetMemberId)).get()!;
  const wsRow = sqliteDb.select().from(sqliteWorkspaces).where(eq(sqliteWorkspaces.id, 'ws_main')).get()!;
  const sessionInfo = createAuthSessionSql(
    memberRow.id,
    memberRow.email,
    memberRow.name,
    input.userAgent,
    input.ip,
    input.rememberMe !== false,
  );

  return {
    ok: true as const,
    user: mapMemberRow(memberRow),
    me: wsRow.meMemberId,
    prefs: { ...DEFAULT_PREFS, ...safeJsonParse<Record<string, any>>(wsRow.prefsJson, {}) },
    token: sessionInfo.token,
    expiresAt: sessionInfo.expiresAt,
    session: sessionInfo.session,
    updatedAt: now,
  };
}

export function verifySessionTokenSql(token: string) {
  ensureRelationalDatabaseSeeded();
  const check = verifyAuthToken(token);
  if (!check.valid || !check.payload) {
    return { valid: false as const, reason: check.reason || 'Invalid token' };
  }
  const conn = getSqliteConnection();
  const payload = check.payload;

  // Verify session row if sessionId is embedded in JWT
  if (payload.sid) {
    const sess = conn
      .prepare(`SELECT * FROM sessions WHERE id = ? LIMIT 1`)
      .get(payload.sid) as any;
    if (!sess) {
      return { valid: false as const, reason: 'Session has been revoked' };
    }
    if (sess.expires_at && sess.expires_at <= Date.now()) {
      conn.prepare(`DELETE FROM sessions WHERE id = ?`).run(payload.sid);
      return { valid: false as const, reason: 'Session has expired' };
    }
  }

  const memberRow = (
    payload.sub
      ? sqliteDb.select().from(sqliteMembers).where(eq(sqliteMembers.id, payload.sub)).get()
      : null
  ) || (conn.prepare(`SELECT * FROM members WHERE LOWER(email) = LOWER(?) LIMIT 1`).get(payload.email) as any);

  if (!memberRow || memberRow.status === 'deactivated') {
    return { valid: false as const, reason: 'User account not found or deactivated' };
  }

  const mapped = 'teamId' in memberRow ? mapMemberRow(memberRow) : mapMemberRow(
    sqliteDb.select().from(sqliteMembers).where(eq(sqliteMembers.id, memberRow.id)).get()!,
  );
  const wsRow = sqliteDb.select().from(sqliteWorkspaces).where(eq(sqliteWorkspaces.id, 'ws_main')).get()!;
  return {
    valid: true as const,
    user: mapped,
    me: mapped.id,
    prefs: { ...DEFAULT_PREFS, ...safeJsonParse<Record<string, any>>(wsRow.prefsJson, {}) },
    expiresAt: payload.exp * 1000,
  };
}

export function logoutSessionTokenSql(token: string) {
  ensureRelationalDatabaseSeeded();
  if (!token) return { ok: true };
  const conn = getSqliteConnection();
  const check = verifyAuthToken(token);
  if (check.payload?.sid) {
    conn.prepare(`DELETE FROM sessions WHERE id = ?`).run(check.payload.sid);
  }
  conn.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
  return { ok: true };
}

export function createPasswordResetTokenSql(rawEmail: string, baseUrl = 'http://localhost:4000') {
  ensureRelationalDatabaseSeeded();
  const email = String(rawEmail || '').trim().toLowerCase();
  const conn = getSqliteConnection();
  const existing = conn
    .prepare(`SELECT * FROM members WHERE LOWER(email) = LOWER(?) LIMIT 1`)
    .get(email) as any;

  if (!existing) {
    return {
      ok: false as const,
      status: 404,
      error: 'No account found with that email address',
      errors: { email: 'No account found with that email address' },
    };
  }

  const resetToken = generateSecureToken('rst');
  const resetExpiresAt = Date.now() + 30 * 60 * 1000; // 30 minutes
  const cleanBase = sanitizeBaseUrl(baseUrl, 'http://localhost:4000');
  const resetUrl = `${cleanBase}/?reset=${encodeURIComponent(resetToken)}&email=${encodeURIComponent(existing.email)}#reset`;
  const wsRow = sqliteDb.select().from(sqliteWorkspaces).where(eq(sqliteWorkspaces.id, 'ws_main')).get()!;
  const wsName = wsRow?.name || 'Snapsec';
  const now = Date.now();
  const outboxId = uid('em');

  const subject = `Reset your ${wsName} password`;
  const textBody = `Hi ${existing.name},\n\nWe received a request to reset the password for your ${wsName} account (${existing.email}).\n\nReset your password using this link (expires in 30 minutes):\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`;
  const htmlBody = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:28px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;color:#111827">
    <h2 style="font-size:20px;font-weight:600;margin:0 0 12px;color:#111827">Reset your ${esc(wsName)} password</h2>
    <p style="font-size:14px;line-height:1.6;color:#374151;margin:0 0 16px">Hi <strong>${esc(existing.name)}</strong>, click the button below to choose a new password for <strong>${esc(existing.email)}</strong>. This link expires in 30 minutes.</p>
    <div style="margin:24px 0">
      <a href="${esc(resetUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#4F46E5;color:#ffffff;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px;text-decoration:none">Reset password</a>
    </div>
    <p style="font-size:12px;color:#6B7280">Or copy and paste this link: ${esc(resetUrl)}</p>
  </div>`;

  conn.transaction(() => {
    sqliteDb
      .update(sqliteMembers)
      .set({
        resetToken,
        resetExpiresAt,
      })
      .where(eq(sqliteMembers.id, existing.id))
      .run();

    sqliteDb
      .insert(sqliteOutboxEmails)
      .values({
        id: outboxId,
        memberId: existing.id,
        toEmail: existing.email,
        toName: existing.name,
        fromEmail: 'security@snapsec.co',
        fromName: `${wsName} Security`,
        subject,
        textBody,
        htmlBody,
        inviteToken: resetToken,
        inviteUrl: resetUrl,
        role: existing.role || 'Member',
        teamId: existing.team_id || 'product',
        sentAt: now,
        status: 'queued',
        deliveredToInbox: false,
      })
      .run();
  })();

  const outboxRow = sqliteDb.select().from(sqliteOutboxEmails).where(eq(sqliteOutboxEmails.id, outboxId)).get()!;
  return {
    ok: true as const,
    email: existing.email,
    resetToken,
    resetUrl,
    outboxItem: mapOutboxRow(outboxRow),
  };
}

export function resetPasswordWithTokenSql(input: {
  token?: string;
  email?: string;
  password: string;
}) {
  ensureRelationalDatabaseSeeded();
  const conn = getSqliteConnection();
  const token = String(input.token || '').trim();
  const email = String(input.email || '').trim().toLowerCase();
  const now = Date.now();

  let member: any = null;
  if (token) {
    member = conn.prepare(`SELECT * FROM members WHERE reset_token = ? LIMIT 1`).get(token);
    if (!member) {
      return {
        ok: false as const,
        status: 400,
        error: 'Invalid or expired password reset link',
        errors: { pw: 'This password reset link is invalid or has already been used.' },
      };
    }
    if (member.reset_expires_at && member.reset_expires_at < now) {
      return {
        ok: false as const,
        status: 400,
        error: 'Password reset link has expired',
        errors: { pw: 'This password reset link has expired. Please request a new one.' },
      };
    }
  } else if (email) {
    member = conn.prepare(`SELECT * FROM members WHERE LOWER(email) = LOWER(?) LIMIT 1`).get(email);
  } else if (isTestRuntime()) {
    member = sqliteDb.select().from(sqliteMembers).get();
  }

  if (!member) {
    return {
      ok: false as const,
      status: 404,
      error: 'Account not found for password reset',
      errors: { pw: 'Account not found. Please request a new password reset link.' },
    };
  }

  const pwHash = hashPassword(input.password);
  sqliteDb
    .update(sqliteMembers)
    .set({
      passwordHash: pwHash,
      resetToken: null,
      resetExpiresAt: null,
      status: 'active',
    })
    .where(eq(sqliteMembers.id, member.id))
    .run();

  return { ok: true as const };
}

export function changeUserPasswordSql(input: {
  memberId?: string;
  email?: string;
  currentPassword: string;
  newPassword: string;
}) {
  ensureRelationalDatabaseSeeded();
  const conn = getSqliteConnection();
  const targetId = input.memberId || getCurrentMeId();
  const member =
    (input.email &&
      (conn.prepare(`SELECT * FROM members WHERE LOWER(email) = LOWER(?) LIMIT 1`).get(input.email) as any)) ||
    (conn.prepare(`SELECT * FROM members WHERE id = ? LIMIT 1`).get(targetId) as any);

  if (!member) {
    return {
      ok: false as const,
      status: 404,
      errors: { pwCur: 'User account not found' },
    };
  }

  if (member.password_hash && !verifyPassword(input.currentPassword, member.password_hash)) {
    return {
      ok: false as const,
      status: 400,
      errors: { pwCur: 'Current password is incorrect' },
    };
  }

  const pwHash = hashPassword(input.newPassword);
  sqliteDb
    .update(sqliteMembers)
    .set({ passwordHash: pwHash })
    .where(eq(sqliteMembers.id, member.id))
    .run();

  return { ok: true as const };
}

export function setTwoFactorSql(enabled: boolean) {
  ensureRelationalDatabaseSeeded();
  const now = Date.now();
  sqliteDb
    .update(sqliteWorkspaces)
    .set({ tfa: Boolean(enabled), updatedAt: now })
    .where(eq(sqliteWorkspaces.id, 'ws_main'))
    .run();
  return { tfa: Boolean(enabled), updatedAt: now };
}

export function deleteSessionSql(sessionId: string) {
  ensureRelationalDatabaseSeeded();
  const now = Date.now();
  sqliteDb.delete(sqliteSessions).where(eq(sqliteSessions.id, sessionId)).run();
  touchWorkspaceRow(now);
  const sessions = sqliteDb
    .select()
    .from(sqliteSessions)
    .all()
    .map(s => ({
      id: s.id,
      device: s.device,
      loc: s.loc,
      ip: s.ip,
      last: s.lastActive,
      cur: Boolean(s.isCurrent),
    }));
  return { sessions, updatedAt: now };
}

export function deleteOtherSessionsSql(keepSessionId?: string) {
  ensureRelationalDatabaseSeeded();
  const now = Date.now();
  if (keepSessionId) {
    const conn = getSqliteConnection();
    conn.prepare(`DELETE FROM sessions WHERE id != ?`).run(keepSessionId);
  } else {
    sqliteDb.delete(sqliteSessions).where(eq(sqliteSessions.isCurrent, false)).run();
  }
  touchWorkspaceRow(now);
  const sessions = sqliteDb
    .select()
    .from(sqliteSessions)
    .all()
    .map(s => ({
      id: s.id,
      device: s.device,
      loc: s.loc,
      ip: s.ip,
      last: s.lastActive,
      cur: Boolean(s.isCurrent),
    }));
  return { sessions, updatedAt: now };
}

export function resetDatabaseToDefaultSql() {
  ensureRelationalDatabaseSeeded();
  const wsRow = sqliteDb.select().from(sqliteWorkspaces).where(eq(sqliteWorkspaces.id, 'ws_main')).get();
  const currentPrefs = safeJsonParse<Record<string, any>>(wsRow?.prefsJson, {});
  const initial = createDefaultState();
  if (currentPrefs.theme) initial.prefs.theme = currentPrefs.theme;
  populateAllTablesTransaction(initial);
  return queryBootstrapStore();
}

/**
 * Optional PostgreSQL mirror for multi-replica Docker Compose deployments.
 */
export async function syncPostgresMirrorIfEnabled(): Promise<void> {
  if (!isPostgresConfigured()) return;
  try {
    const pool = createPgPool();
    await ensurePgSchema(pool);
  } catch (err) {
    console.error('PostgreSQL pool sync warning:', err);
  }
}

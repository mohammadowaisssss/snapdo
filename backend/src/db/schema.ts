import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';

/* ============================================================================
   POSTGRESQL DRIZZLE SCHEMA (Primary Relational Database Storage)
   All workspace state, users, sessions, projects, tasks, subtasks, comments,
   files (with MinIO object keys), notifications, activity, views, and emails.
   ============================================================================ */

export const pgWorkspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  color: text('color').notNull().default('#2F2E2A'),
  brand: boolean('brand').notNull().default(true),
  plan: text('plan').notNull().default('Business'),
  meMemberId: text('me_member_id').notNull().default('m1'),
  tfa: boolean('tfa').notNull().default(false),
  projOrderJson: text('proj_order_json').notNull().default('[]'),
  workspacesListJson: text('workspaces_list_json').notNull().default('[]'),
  prefsJson: text('prefs_json').notNull().default('{}'),
  notifPrefsJson: text('notif_prefs_json').notNull().default('{}'),
  viewsJson: text('views_json').notNull().default('{}'),
  collapsed: boolean('collapsed').notNull().default(false),
  smtpConfigJson: text('smtp_config_json').notNull().default('null'),
  updatedAt: doublePrecision('updated_at').notNull(),
});

export const pgTeams = pgTable('teams', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  desc: text('desc').notNull().default(''),
  icon: text('icon').notNull().default('users'),
  color: text('color').notNull().default('#23918A'),
});

export const pgMembers = pgTable(
  'members',
  {
    id: text('id').primaryKey(),
    uid: text('uid'),
    name: text('name').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash'),
    resetToken: text('reset_token'),
    resetExpiresAt: doublePrecision('reset_expires_at'),
    verifyToken: text('verify_token'),
    emailVerified: boolean('email_verified').notNull().default(false),
    photoUrl: text('photo_url'),
    role: text('role').notNull().default('Member'),
    teamId: text('team_id').notNull().default('product'),
    title: text('title').notNull().default('Member'),
    color: text('color').notNull().default('#5A67D8'),
    status: text('status').notNull().default('active'),
    lastSeen: doublePrecision('last_seen'),
    tz: text('tz').notNull().default('—'),
    inviteToken: text('invite_token'),
    inviteUrl: text('invite_url'),
    lastInviteId: text('last_invite_id'),
    invitedAt: doublePrecision('invited_at'),
  },
  table => [
    index('idx_pg_members_email').on(table.email),
    index('idx_pg_members_uid').on(table.uid),
    index('idx_pg_members_team').on(table.teamId),
    index('idx_pg_members_invite_token').on(table.inviteToken),
    index('idx_pg_members_reset_token').on(table.resetToken),
  ],
);

export const pgProjects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    seq: integer('seq').notNull().default(200),
    name: text('name').notNull(),
    icon: text('icon').notNull().default('folder'),
    color: text('color').notNull().default('indigo'),
    status: text('status').notNull().default('planning'),
    teamId: text('team_id').notNull().default('product'),
    leadId: text('lead_id').notNull().default('m1'),
    due: text('due'),
    start: text('start'),
    fav: boolean('fav').notNull().default(false),
    membersJson: text('members_json').notNull().default('[]'),
    desc: text('desc').notNull().default(''),
    milestonesJson: text('milestones_json').notNull().default('[]'),
    lastOpened: doublePrecision('last_opened').notNull().default(0),
    archived: boolean('archived').notNull().default(false),
    archivedAt: doublePrecision('archived_at'),
    private: boolean('private').notNull().default(false),
    access: text('access').notNull().default('workspace'),
    permsJson: text('perms_json').notNull().default('{}'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  table => [
    index('idx_pg_projects_archived').on(table.archived, table.sortOrder),
    index('idx_pg_projects_team').on(table.teamId),
    index('idx_pg_projects_status').on(table.status),
  ],
);

export const pgTasks = pgTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    projectId: text('project_id').notNull(),
    title: text('title').notNull(),
    status: text('status').notNull().default('todo'),
    assigneeId: text('assignee_id'),
    priority: text('priority').notNull().default('none'),
    due: text('due'),
    start: text('start'),
    labelsJson: text('labels_json').notNull().default('[]'),
    depsJson: text('deps_json').notNull().default('[]'),
    desc: text('desc').notNull().default(''),
    estimate: text('estimate'),
    createdAt: doublePrecision('created_at').notNull(),
    updatedAt: doublePrecision('updated_at').notNull(),
    sortOrder: doublePrecision('sort_order').notNull().default(0),
    fav: boolean('fav').notNull().default(false),
    recur: text('recur'),
    archived: boolean('archived').notNull().default(false),
    archivedAt: doublePrecision('archived_at'),
    completedAt: doublePrecision('completed_at'),
    prevStatus: text('prev_status'),
  },
  table => [
    index('idx_pg_tasks_proj_arch_order').on(table.projectId, table.archived, table.sortOrder),
    index('idx_pg_tasks_status').on(table.status),
    index('idx_pg_tasks_assignee').on(table.assigneeId),
    index('idx_pg_tasks_priority').on(table.priority),
    index('idx_pg_tasks_due').on(table.due),
    index('idx_pg_tasks_key').on(table.key),
  ],
);

export const pgSubtasks = pgTable(
  'subtasks',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull(),
    title: text('title').notNull(),
    done: boolean('done').notNull().default(false),
    assigneeId: text('assignee_id'),
    due: text('due'),
    note: text('note').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  table => [index('idx_pg_subtasks_task').on(table.taskId, table.sortOrder)],
);

export const pgComments = pgTable(
  'comments',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull(),
    authorId: text('author_id').notNull(),
    createdAt: doublePrecision('created_at').notNull(),
    text: text('text').notNull().default(''),
    reactionsJson: text('reactions_json').notNull().default('{}'),
  },
  table => [index('idx_pg_comments_task').on(table.taskId, table.createdAt)],
);

export const pgFiles = pgTable(
  'files',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    type: text('type').notNull().default('doc'),
    size: text('size').notNull().default('24 KB'),
    authorId: text('author_id').notNull().default('m1'),
    createdAt: doublePrecision('created_at').notNull(),
    projectId: text('project_id').notNull().default('p1'),
    taskId: text('task_id'),
    commentId: text('comment_id'),
    dataUrl: text('data_url'),
    textContent: text('text_content'),
    mime: text('mime'),
    storageKey: text('storage_key'),
    bucket: text('bucket'),
  },
  table => [
    index('idx_pg_files_project_type').on(table.projectId, table.type),
    index('idx_pg_files_task').on(table.taskId),
    index('idx_pg_files_comment').on(table.commentId),
  ],
);

export const pgNotifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull().default('mention'),
    actorId: text('actor_id').notNull().default('m1'),
    taskId: text('task_id'),
    projectId: text('project_id'),
    text: text('text').notNull().default(''),
    snippet: text('snippet').notNull().default(''),
    createdAt: doublePrecision('created_at').notNull(),
    read: boolean('read').notNull().default(false),
  },
  table => [index('idx_pg_notifs_read_at').on(table.read, table.createdAt)],
);

export const pgActivityLogs = pgTable(
  'activity_logs',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id').notNull().default('m1'),
    verb: text('verb').notNull(),
    taskId: text('task_id'),
    projectId: text('project_id'),
    createdAt: doublePrecision('created_at').notNull(),
    extra: text('extra').notNull().default(''),
  },
  table => [
    index('idx_pg_activity_created').on(table.createdAt),
    index('idx_pg_activity_project').on(table.projectId),
    index('idx_pg_activity_task').on(table.taskId),
  ],
);

export const pgSavedViews = pgTable(
  'saved_views',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull().default('list'),
    filtersJson: text('filters_json').notNull().default('[]'),
  },
  table => [index('idx_pg_saved_views_project').on(table.projectId)],
);

export const pgOutboxEmails = pgTable(
  'outbox_emails',
  {
    id: text('id').primaryKey(),
    memberId: text('member_id'),
    toEmail: text('to_email').notNull(),
    toName: text('to_name').notNull(),
    fromEmail: text('from_email').notNull(),
    fromName: text('from_name').notNull(),
    subject: text('subject').notNull(),
    textBody: text('text_body').notNull(),
    htmlBody: text('html_body').notNull(),
    inviteToken: text('invite_token'),
    inviteUrl: text('invite_url'),
    role: text('role').notNull().default('Member'),
    teamId: text('team_id').notNull().default('product'),
    projectName: text('project_name'),
    sentAt: doublePrecision('sent_at').notNull(),
    acceptedAt: doublePrecision('accepted_at'),
    status: text('status').notNull().default('queued'),
    transport: text('transport'),
    deliveredToInbox: boolean('delivered_to_inbox').notNull().default(false),
    previewUrl: text('preview_url'),
    gmailComposeUrl: text('gmail_compose_url'),
    mailtoUrl: text('mailto_url'),
    messageId: text('message_id'),
    transportError: text('transport_error'),
    oauthError: text('oauth_error'),
  },
  table => [
    index('idx_pg_outbox_sent_at').on(table.sentAt),
    index('idx_pg_outbox_member').on(table.memberId),
    index('idx_pg_outbox_token').on(table.inviteToken),
  ],
);

export const pgSessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  token: text('token'),
  memberId: text('member_id'),
  device: text('device').notNull(),
  loc: text('loc').notNull(),
  ip: text('ip').notNull().default(''),
  lastActive: text('last_active').notNull().default('Active now'),
  isCurrent: boolean('is_current').notNull().default(false),
  createdAt: doublePrecision('created_at'),
  expiresAt: doublePrecision('expires_at'),
});

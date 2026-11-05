import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';
import {
  index as sqliteIndex,
  integer as sqliteInteger,
  real as sqliteReal,
  sqliteTable,
  text as sqliteText,
} from 'drizzle-orm/sqlite-core';

/* ============================================================================
   1. POSTGRESQL DRIZZLE SCHEMA (Horizontal Scale / Multi-Replica Production)
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
  device: text('device').notNull(),
  loc: text('loc').notNull(),
  ip: text('ip').notNull().default(''),
  lastActive: text('last_active').notNull().default('Active now'),
  isCurrent: boolean('is_current').notNull().default(false),
});

/* ============================================================================
   2. SQLITE WAL DRIZZLE SCHEMA (Embedded Production / Local / Preview)
   ============================================================================ */

export const sqliteWorkspaces = sqliteTable('workspaces', {
  id: sqliteText('id').primaryKey(),
  name: sqliteText('name').notNull(),
  url: sqliteText('url').notNull(),
  color: sqliteText('color').notNull().default('#2F2E2A'),
  brand: sqliteInteger('brand', { mode: 'boolean' }).notNull().default(true),
  plan: sqliteText('plan').notNull().default('Business'),
  meMemberId: sqliteText('me_member_id').notNull().default('m1'),
  tfa: sqliteInteger('tfa', { mode: 'boolean' }).notNull().default(false),
  projOrderJson: sqliteText('proj_order_json').notNull().default('[]'),
  workspacesListJson: sqliteText('workspaces_list_json').notNull().default('[]'),
  prefsJson: sqliteText('prefs_json').notNull().default('{}'),
  notifPrefsJson: sqliteText('notif_prefs_json').notNull().default('{}'),
  viewsJson: sqliteText('views_json').notNull().default('{}'),
  collapsed: sqliteInteger('collapsed', { mode: 'boolean' }).notNull().default(false),
  smtpConfigJson: sqliteText('smtp_config_json').notNull().default('null'),
  updatedAt: sqliteReal('updated_at').notNull(),
});

export const sqliteTeams = sqliteTable('teams', {
  id: sqliteText('id').primaryKey(),
  name: sqliteText('name').notNull(),
  desc: sqliteText('desc').notNull().default(''),
  icon: sqliteText('icon').notNull().default('users'),
  color: sqliteText('color').notNull().default('#23918A'),
});

export const sqliteMembers = sqliteTable(
  'members',
  {
    id: sqliteText('id').primaryKey(),
    uid: sqliteText('uid'),
    name: sqliteText('name').notNull(),
    email: sqliteText('email').notNull(),
    photoUrl: sqliteText('photo_url'),
    role: sqliteText('role').notNull().default('Member'),
    teamId: sqliteText('team_id').notNull().default('product'),
    title: sqliteText('title').notNull().default('Member'),
    color: sqliteText('color').notNull().default('#5A67D8'),
    status: sqliteText('status').notNull().default('active'),
    lastSeen: sqliteReal('last_seen'),
    tz: sqliteText('tz').notNull().default('—'),
    inviteToken: sqliteText('invite_token'),
    inviteUrl: sqliteText('invite_url'),
    lastInviteId: sqliteText('last_invite_id'),
    invitedAt: sqliteReal('invited_at'),
  },
  table => [
    sqliteIndex('idx_members_email').on(table.email),
    sqliteIndex('idx_members_uid').on(table.uid),
    sqliteIndex('idx_members_team').on(table.teamId),
    sqliteIndex('idx_members_invite_token').on(table.inviteToken),
  ],
);

export const sqliteProjects = sqliteTable(
  'projects',
  {
    id: sqliteText('id').primaryKey(),
    key: sqliteText('key').notNull(),
    seq: sqliteInteger('seq').notNull().default(200),
    name: sqliteText('name').notNull(),
    icon: sqliteText('icon').notNull().default('folder'),
    color: sqliteText('color').notNull().default('indigo'),
    status: sqliteText('status').notNull().default('planning'),
    teamId: sqliteText('team_id').notNull().default('product'),
    leadId: sqliteText('lead_id').notNull().default('m1'),
    due: sqliteText('due'),
    start: sqliteText('start'),
    fav: sqliteInteger('fav', { mode: 'boolean' }).notNull().default(false),
    membersJson: sqliteText('members_json').notNull().default('[]'),
    desc: sqliteText('desc').notNull().default(''),
    milestonesJson: sqliteText('milestones_json').notNull().default('[]'),
    lastOpened: sqliteReal('last_opened').notNull().default(0),
    archived: sqliteInteger('archived', { mode: 'boolean' }).notNull().default(false),
    archivedAt: sqliteReal('archived_at'),
    private: sqliteInteger('private', { mode: 'boolean' }).notNull().default(false),
    access: sqliteText('access').notNull().default('workspace'),
    permsJson: sqliteText('perms_json').notNull().default('{}'),
    sortOrder: sqliteInteger('sort_order').notNull().default(0),
  },
  table => [
    sqliteIndex('idx_projects_archived').on(table.archived, table.sortOrder),
    sqliteIndex('idx_projects_team').on(table.teamId),
    sqliteIndex('idx_projects_status').on(table.status),
  ],
);

export const sqliteTasks = sqliteTable(
  'tasks',
  {
    id: sqliteText('id').primaryKey(),
    key: sqliteText('key').notNull(),
    projectId: sqliteText('project_id').notNull(),
    title: sqliteText('title').notNull(),
    status: sqliteText('status').notNull().default('todo'),
    assigneeId: sqliteText('assignee_id'),
    priority: sqliteText('priority').notNull().default('none'),
    due: sqliteText('due'),
    start: sqliteText('start'),
    labelsJson: sqliteText('labels_json').notNull().default('[]'),
    depsJson: sqliteText('deps_json').notNull().default('[]'),
    desc: sqliteText('desc').notNull().default(''),
    estimate: sqliteText('estimate'),
    createdAt: sqliteReal('created_at').notNull(),
    updatedAt: sqliteReal('updated_at').notNull(),
    sortOrder: sqliteReal('sort_order').notNull().default(0),
    fav: sqliteInteger('fav', { mode: 'boolean' }).notNull().default(false),
    recur: sqliteText('recur'),
    archived: sqliteInteger('archived', { mode: 'boolean' }).notNull().default(false),
    archivedAt: sqliteReal('archived_at'),
    completedAt: sqliteReal('completed_at'),
    prevStatus: sqliteText('prev_status'),
  },
  table => [
    sqliteIndex('idx_tasks_proj_arch_order').on(table.projectId, table.archived, table.sortOrder),
    sqliteIndex('idx_tasks_status').on(table.status),
    sqliteIndex('idx_tasks_assignee').on(table.assigneeId),
    sqliteIndex('idx_tasks_priority').on(table.priority),
    sqliteIndex('idx_tasks_due').on(table.due),
    sqliteIndex('idx_tasks_key').on(table.key),
  ],
);

export const sqliteSubtasks = sqliteTable(
  'subtasks',
  {
    id: sqliteText('id').primaryKey(),
    taskId: sqliteText('task_id').notNull(),
    title: sqliteText('title').notNull(),
    done: sqliteInteger('done', { mode: 'boolean' }).notNull().default(false),
    assigneeId: sqliteText('assignee_id'),
    due: sqliteText('due'),
    note: sqliteText('note').notNull().default(''),
    sortOrder: sqliteInteger('sort_order').notNull().default(0),
  },
  table => [sqliteIndex('idx_subtasks_task').on(table.taskId, table.sortOrder)],
);

export const sqliteComments = sqliteTable(
  'comments',
  {
    id: sqliteText('id').primaryKey(),
    taskId: sqliteText('task_id').notNull(),
    authorId: sqliteText('author_id').notNull(),
    createdAt: sqliteReal('created_at').notNull(),
    text: sqliteText('text').notNull().default(''),
    reactionsJson: sqliteText('reactions_json').notNull().default('{}'),
  },
  table => [sqliteIndex('idx_comments_task').on(table.taskId, table.createdAt)],
);

export const sqliteFiles = sqliteTable(
  'files',
  {
    id: sqliteText('id').primaryKey(),
    name: sqliteText('name').notNull(),
    type: sqliteText('type').notNull().default('doc'),
    size: sqliteText('size').notNull().default('24 KB'),
    authorId: sqliteText('author_id').notNull().default('m1'),
    createdAt: sqliteReal('created_at').notNull(),
    projectId: sqliteText('project_id').notNull().default('p1'),
    taskId: sqliteText('task_id'),
    commentId: sqliteText('comment_id'),
    dataUrl: sqliteText('data_url'),
    textContent: sqliteText('text_content'),
    mime: sqliteText('mime'),
  },
  table => [
    sqliteIndex('idx_files_project_type').on(table.projectId, table.type),
    sqliteIndex('idx_files_task').on(table.taskId),
    sqliteIndex('idx_files_comment').on(table.commentId),
  ],
);

export const sqliteNotifications = sqliteTable(
  'notifications',
  {
    id: sqliteText('id').primaryKey(),
    type: sqliteText('type').notNull().default('mention'),
    actorId: sqliteText('actor_id').notNull().default('m1'),
    taskId: sqliteText('task_id'),
    projectId: sqliteText('project_id'),
    text: sqliteText('text').notNull().default(''),
    snippet: sqliteText('snippet').notNull().default(''),
    createdAt: sqliteReal('created_at').notNull(),
    read: sqliteInteger('read', { mode: 'boolean' }).notNull().default(false),
  },
  table => [sqliteIndex('idx_notifs_read_at').on(table.read, table.createdAt)],
);

export const sqliteActivityLogs = sqliteTable(
  'activity_logs',
  {
    id: sqliteText('id').primaryKey(),
    actorId: sqliteText('actor_id').notNull().default('m1'),
    verb: sqliteText('verb').notNull(),
    taskId: sqliteText('task_id'),
    projectId: sqliteText('project_id'),
    createdAt: sqliteReal('created_at').notNull(),
    extra: sqliteText('extra').notNull().default(''),
  },
  table => [
    sqliteIndex('idx_activity_created').on(table.createdAt),
    sqliteIndex('idx_activity_project').on(table.projectId),
    sqliteIndex('idx_activity_task').on(table.taskId),
  ],
);

export const sqliteSavedViews = sqliteTable(
  'saved_views',
  {
    id: sqliteText('id').primaryKey(),
    projectId: sqliteText('project_id').notNull(),
    name: sqliteText('name').notNull(),
    type: sqliteText('type').notNull().default('list'),
    filtersJson: sqliteText('filters_json').notNull().default('[]'),
  },
  table => [sqliteIndex('idx_saved_views_project').on(table.projectId)],
);

export const sqliteOutboxEmails = sqliteTable(
  'outbox_emails',
  {
    id: sqliteText('id').primaryKey(),
    memberId: sqliteText('member_id'),
    toEmail: sqliteText('to_email').notNull(),
    toName: sqliteText('to_name').notNull(),
    fromEmail: sqliteText('from_email').notNull(),
    fromName: sqliteText('from_name').notNull(),
    subject: sqliteText('subject').notNull(),
    textBody: sqliteText('text_body').notNull(),
    htmlBody: sqliteText('html_body').notNull(),
    inviteToken: sqliteText('invite_token'),
    inviteUrl: sqliteText('invite_url'),
    role: sqliteText('role').notNull().default('Member'),
    teamId: sqliteText('team_id').notNull().default('product'),
    projectName: sqliteText('project_name'),
    sentAt: sqliteReal('sent_at').notNull(),
    acceptedAt: sqliteReal('accepted_at'),
    status: sqliteText('status').notNull().default('queued'),
    transport: sqliteText('transport'),
    deliveredToInbox: sqliteInteger('delivered_to_inbox', { mode: 'boolean' }).notNull().default(false),
    previewUrl: sqliteText('preview_url'),
    gmailComposeUrl: sqliteText('gmail_compose_url'),
    mailtoUrl: sqliteText('mailto_url'),
    messageId: sqliteText('message_id'),
    transportError: sqliteText('transport_error'),
    oauthError: sqliteText('oauth_error'),
  },
  table => [
    sqliteIndex('idx_outbox_sent_at').on(table.sentAt),
    sqliteIndex('idx_outbox_member').on(table.memberId),
    sqliteIndex('idx_outbox_token').on(table.inviteToken),
  ],
);

export const sqliteSessions = sqliteTable('sessions', {
  id: sqliteText('id').primaryKey(),
  device: sqliteText('device').notNull(),
  loc: sqliteText('loc').notNull(),
  ip: sqliteText('ip').notNull().default(''),
  lastActive: sqliteText('last_active').notNull().default('Active now'),
  isCurrent: sqliteInteger('is_current', { mode: 'boolean' }).notNull().default(false),
});

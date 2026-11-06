import Database from 'better-sqlite3';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
  var _sqliteInstance: Database.Database | undefined;
}

import os from 'node:os';

function resolveWritableDataDir(): string {
  const preferred = path.resolve(process.cwd(), 'data');
  try {
    if (!fs.existsSync(preferred)) {
      fs.mkdirSync(preferred, { recursive: true });
    }
    // Verify directory is genuinely writable
    fs.accessSync(preferred, fs.constants.W_OK);
    return preferred;
  } catch {
    const fallback = path.join(os.tmpdir(), 'snapsec-data');
    try {
      if (!fs.existsSync(fallback)) {
        fs.mkdirSync(fallback, { recursive: true });
      }
      return fallback;
    } catch {
      return os.tmpdir();
    }
  }
}

export const DATA_DIR = resolveWritableDataDir();
export const SQLITE_DB_FILE =
  process.env.NODE_ENV === 'test'
    ? path.join(DATA_DIR, `snapsec-test-${process.pid}.sqlite`)
    : path.join(DATA_DIR, 'snapsec.sqlite');

export function isPostgresConfigured(): boolean {
  return Boolean(process.env.SQL_HOST || process.env.PGHOST);
}

/**
 * Creates or retrieves the PostgreSQL connection pool using the Object Method.
 * Used when deployed with PostgreSQL (e.g., Docker Compose multi-replica production or Cloud SQL).
 */
export function createPgPool(): Pool {
  if (!global._postgresPool) {
    global._postgresPool = new Pool({
      host: process.env.SQL_HOST || process.env.PGHOST,
      port: Number(process.env.PGPORT || 5432),
      user: process.env.SQL_USER || process.env.PGUSER || 'snapsec',
      password: process.env.SQL_PASSWORD || process.env.PGPASSWORD || 'snapsec_prod_secret',
      database: process.env.SQL_DB_NAME || process.env.PGDATABASE || 'snapsec_tasktracker',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
    });

    global._postgresPool.on('error', err => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return global._postgresPool;
}

const COMMON_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#2F2E2A',
  brand INTEGER NOT NULL DEFAULT 1,
  plan TEXT NOT NULL DEFAULT 'Business',
  me_member_id TEXT NOT NULL DEFAULT 'm1',
  tfa INTEGER NOT NULL DEFAULT 0,
  proj_order_json TEXT NOT NULL DEFAULT '[]',
  workspaces_list_json TEXT NOT NULL DEFAULT '[]',
  prefs_json TEXT NOT NULL DEFAULT '{}',
  notif_prefs_json TEXT NOT NULL DEFAULT '{}',
  views_json TEXT NOT NULL DEFAULT '{}',
  collapsed INTEGER NOT NULL DEFAULT 0,
  smtp_config_json TEXT NOT NULL DEFAULT 'null',
  updated_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  desc TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT 'users',
  color TEXT NOT NULL DEFAULT '#23918A'
);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  uid TEXT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT,
  reset_token TEXT,
  reset_expires_at REAL,
  verify_token TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  photo_url TEXT,
  role TEXT NOT NULL DEFAULT 'Member',
  team_id TEXT NOT NULL DEFAULT 'product',
  title TEXT NOT NULL DEFAULT 'Member',
  color TEXT NOT NULL DEFAULT '#5A67D8',
  status TEXT NOT NULL DEFAULT 'active',
  last_seen REAL,
  tz TEXT NOT NULL DEFAULT '—',
  invite_token TEXT,
  invite_url TEXT,
  last_invite_id TEXT,
  invited_at REAL
);
CREATE INDEX IF NOT EXISTS idx_members_email ON members(email);
CREATE INDEX IF NOT EXISTS idx_members_uid ON members(uid);
CREATE INDEX IF NOT EXISTS idx_members_team ON members(team_id);
CREATE INDEX IF NOT EXISTS idx_members_invite_token ON members(invite_token);
CREATE INDEX IF NOT EXISTS idx_members_reset_token ON members(reset_token);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 200,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'folder',
  color TEXT NOT NULL DEFAULT 'indigo',
  status TEXT NOT NULL DEFAULT 'planning',
  team_id TEXT NOT NULL DEFAULT 'product',
  lead_id TEXT NOT NULL DEFAULT 'm1',
  due TEXT,
  start TEXT,
  fav INTEGER NOT NULL DEFAULT 0,
  members_json TEXT NOT NULL DEFAULT '[]',
  desc TEXT NOT NULL DEFAULT '',
  milestones_json TEXT NOT NULL DEFAULT '[]',
  last_opened REAL NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  archived_at REAL,
  private INTEGER NOT NULL DEFAULT 0,
  access TEXT NOT NULL DEFAULT 'workspace',
  perms_json TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_projects_archived ON projects(archived, sort_order);
CREATE INDEX IF NOT EXISTS idx_projects_team ON projects(team_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  assignee_id TEXT,
  priority TEXT NOT NULL DEFAULT 'none',
  due TEXT,
  start TEXT,
  labels_json TEXT NOT NULL DEFAULT '[]',
  deps_json TEXT NOT NULL DEFAULT '[]',
  desc TEXT NOT NULL DEFAULT '',
  estimate TEXT,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  sort_order REAL NOT NULL DEFAULT 0,
  fav INTEGER NOT NULL DEFAULT 0,
  recur TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  archived_at REAL,
  completed_at REAL,
  prev_status TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tasks_proj_arch_order ON tasks(project_id, archived, sort_order);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due);
CREATE INDEX IF NOT EXISTS idx_tasks_key ON tasks(key);

CREATE TABLE IF NOT EXISTS subtasks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  assignee_id TEXT,
  due TEXT,
  note TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id, sort_order);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  created_at REAL NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  reactions_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id, created_at);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'doc',
  size TEXT NOT NULL DEFAULT '24 KB',
  author_id TEXT NOT NULL DEFAULT 'm1',
  created_at REAL NOT NULL,
  project_id TEXT NOT NULL DEFAULT 'p1',
  task_id TEXT,
  comment_id TEXT,
  data_url TEXT,
  text_content TEXT,
  mime TEXT
);
CREATE INDEX IF NOT EXISTS idx_files_project_type ON files(project_id, type);
CREATE INDEX IF NOT EXISTS idx_files_task ON files(task_id);
CREATE INDEX IF NOT EXISTS idx_files_comment ON files(comment_id);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'mention',
  actor_id TEXT NOT NULL DEFAULT 'm1',
  task_id TEXT,
  project_id TEXT,
  text TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  created_at REAL NOT NULL,
  read INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notifs_read_at ON notifications(read, created_at DESC);

CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL DEFAULT 'm1',
  verb TEXT NOT NULL,
  task_id TEXT,
  project_id TEXT,
  created_at REAL NOT NULL,
  extra TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_project ON activity_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_activity_task ON activity_logs(task_id);

CREATE TABLE IF NOT EXISTS saved_views (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'list',
  filters_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_saved_views_project ON saved_views(project_id);

CREATE TABLE IF NOT EXISTS outbox_emails (
  id TEXT PRIMARY KEY,
  member_id TEXT,
  to_email TEXT NOT NULL,
  to_name TEXT NOT NULL,
  from_email TEXT NOT NULL,
  from_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  text_body TEXT NOT NULL,
  html_body TEXT NOT NULL,
  invite_token TEXT,
  invite_url TEXT,
  role TEXT NOT NULL DEFAULT 'Member',
  team_id TEXT NOT NULL DEFAULT 'product',
  project_name TEXT,
  sent_at REAL NOT NULL,
  accepted_at REAL,
  status TEXT NOT NULL DEFAULT 'queued',
  transport TEXT,
  delivered_to_inbox INTEGER NOT NULL DEFAULT 0,
  preview_url TEXT,
  gmail_compose_url TEXT,
  mailto_url TEXT,
  message_id TEXT,
  transport_error TEXT,
  oauth_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_sent_at ON outbox_emails(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbox_member ON outbox_emails(member_id);
CREATE INDEX IF NOT EXISTS idx_outbox_token ON outbox_emails(invite_token);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token TEXT,
  member_id TEXT,
  device TEXT NOT NULL,
  loc TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  last_active TEXT NOT NULL DEFAULT 'Active now',
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at REAL,
  expires_at REAL
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_member ON sessions(member_id);
`;

const MIGRATION_COLUMNS = [
  `ALTER TABLE members ADD COLUMN password_hash TEXT`,
  `ALTER TABLE members ADD COLUMN reset_token TEXT`,
  `ALTER TABLE members ADD COLUMN reset_expires_at REAL`,
  `ALTER TABLE members ADD COLUMN verify_token TEXT`,
  `ALTER TABLE members ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE sessions ADD COLUMN token TEXT`,
  `ALTER TABLE sessions ADD COLUMN member_id TEXT`,
  `ALTER TABLE sessions ADD COLUMN created_at REAL`,
  `ALTER TABLE sessions ADD COLUMN expires_at REAL`,
];

/**
 * Initializes the SQLite connection with Write-Ahead Logging (WAL),
 * foreign keys, B-Tree indexes, and non-blocking normal synchronous mode.
 */
export function getSqliteConnection(): Database.Database {
  if (!global._sqliteInstance || !global._sqliteInstance.open) {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
    } catch {
      // directory creation handled by fallback
    }
    let sqlite: Database.Database;
    try {
      sqlite = new Database(SQLITE_DB_FILE);
    } catch {
      // In-memory fallback if filesystem access is completely prohibited
      sqlite = new Database(':memory:');
    }
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('synchronous = NORMAL');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 5000');
    sqlite.pragma('temp_store = MEMORY');
    sqlite.pragma('cache_size = -64000');

    // Run table creation and migration columns safely
    for (const stmt of MIGRATION_COLUMNS) {
      try {
        sqlite.exec(stmt);
      } catch {
        /* table may not exist yet or column already exists */
      }
    }
    const statements = COMMON_SCHEMA_DDL.split(';')
      .map(s => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      try {
        sqlite.exec(stmt);
      } catch {
        /* ignore benign duplicate index/table errors */
      }
    }
    for (const stmt of MIGRATION_COLUMNS) {
      try {
        sqlite.exec(stmt);
      } catch {
        /* column already exists */
      }
    }
    global._sqliteInstance = sqlite;
  }
  return global._sqliteInstance;
}

let pgSchemaEnsured = false;
export async function ensurePgSchema(pool: Pool): Promise<void> {
  if (pgSchemaEnsured) return;
  const statements = COMMON_SCHEMA_DDL.split(';')
    .map(s => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    try {
      await pool.query(stmt);
    } catch {
      /* ignore benign duplicate errors */
    }
  }
  for (const stmt of MIGRATION_COLUMNS) {
    try {
      await pool.query(stmt);
    } catch {
      /* column already exists */
    }
  }
  pgSchemaEnsured = true;
}

export const sqliteDb = drizzleSqlite(getSqliteConnection(), { schema });
export const pgDb = isPostgresConfigured() ? drizzlePg(createPgPool(), { schema }) : null;

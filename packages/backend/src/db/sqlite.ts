import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function createSQLiteDB(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  // Auto-create tables on startup
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      developer_email TEXT NOT NULL,
      developer_name TEXT NOT NULL,
      repo TEXT NOT NULL,
      project_path TEXT NOT NULL,
      started_at TEXT NOT NULL,
      last_activity TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      intent TEXT,
      files_touched TEXT NOT NULL DEFAULT '[]',
      areas TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS signals (
      signal_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(session_id),
      timestamp TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      file_path TEXT,
      semantic_area TEXT,
      weight REAL NOT NULL DEFAULT 1.0
    );
    CREATE TABLE IF NOT EXISTS collisions (
      collision_id TEXT PRIMARY KEY,
      session_ids TEXT NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      details TEXT NOT NULL,
      detected_at TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      resolved_by TEXT
    );
    CREATE TABLE IF NOT EXISTS tracked_repos (
      repo_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      remote_url TEXT,
      discovered_at TEXT NOT NULL,
      last_activity TEXT
    );
    CREATE TABLE IF NOT EXISTS agent_mail (
      mail_id TEXT PRIMARY KEY,
      from_session_id TEXT,
      to_session_id TEXT,
      to_developer_email TEXT,
      to_context_id TEXT,
      type TEXT NOT NULL,
      subject TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      read_at TEXT,
      weight REAL NOT NULL DEFAULT 1.0
    );
    CREATE TABLE IF NOT EXISTS nerves (
      nerve_id TEXT PRIMARY KEY,
      agent_id TEXT UNIQUE NOT NULL,
      nerve_type TEXT NOT NULL,
      agent_card TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
    CREATE INDEX IF NOT EXISTS idx_sessions_repo ON sessions(repo);
    CREATE INDEX IF NOT EXISTS idx_signals_session ON signals(session_id);
    CREATE INDEX IF NOT EXISTS idx_signals_file ON signals(file_path);
    CREATE INDEX IF NOT EXISTS idx_collisions_resolved ON collisions(resolved);
    CREATE INDEX IF NOT EXISTS idx_mail_to_session ON agent_mail(to_session_id);
    CREATE INDEX IF NOT EXISTS idx_mail_to_developer ON agent_mail(to_developer_email);
    CREATE INDEX IF NOT EXISTS idx_mail_to_context ON agent_mail(to_context_id);
    CREATE INDEX IF NOT EXISTS idx_mail_read ON agent_mail(read_at);
    CREATE INDEX IF NOT EXISTS idx_nerves_type ON nerves(nerve_type);
    CREATE INDEX IF NOT EXISTS idx_nerves_status ON nerves(status);
    CREATE INDEX IF NOT EXISTS idx_nerves_agent_id ON nerves(agent_id);
  `);

  return db;
}

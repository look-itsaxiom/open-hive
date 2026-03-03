import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const sessions = sqliteTable('sessions', {
  session_id: text('session_id').primaryKey(),
  developer_email: text('developer_email').notNull(),
  developer_name: text('developer_name').notNull(),
  repo: text('repo').notNull(),
  project_path: text('project_path').notNull(),
  started_at: text('started_at').notNull(),
  last_activity: text('last_activity').notNull(),
  status: text('status', { enum: ['active', 'idle', 'ended'] }).notNull().default('active'),
  intent: text('intent'),
  files_touched: text('files_touched').notNull().default('[]'),
  areas: text('areas').notNull().default('[]'),
});

export const signals = sqliteTable('signals', {
  signal_id: text('signal_id').primaryKey(),
  session_id: text('session_id').notNull().references(() => sessions.session_id),
  timestamp: text('timestamp').notNull(),
  type: text('type', { enum: ['prompt', 'file_modify', 'file_read', 'search', 'explicit'] }).notNull(),
  content: text('content').notNull(),
  file_path: text('file_path'),
  semantic_area: text('semantic_area'),
});

export const collisions = sqliteTable('collisions', {
  collision_id: text('collision_id').primaryKey(),
  session_ids: text('session_ids').notNull(),
  type: text('type', { enum: ['file', 'directory', 'semantic'] }).notNull(),
  severity: text('severity', { enum: ['critical', 'warning', 'info'] }).notNull(),
  details: text('details').notNull(),
  detected_at: text('detected_at').notNull(),
  resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false),
  resolved_by: text('resolved_by'),
});

export const tracked_repos = sqliteTable('tracked_repos', {
  repo_id: text('repo_id').primaryKey(),
  name: text('name').notNull(),
  provider: text('provider', { enum: ['github', 'azure-devops', 'gitlab', 'self-registered'] }).notNull(),
  remote_url: text('remote_url'),
  discovered_at: text('discovered_at').notNull(),
  last_activity: text('last_activity'),
});

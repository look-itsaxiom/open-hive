---
name: add-postgres
description: Replace the default SQLite store with PostgreSQL using pg connection pooling
category: store
requires:
  - pg
  - "@types/pg"
modifies:
  - packages/backend/src/db/postgres.ts (new)
  - packages/backend/src/db/postgres-store.ts (new)
  - packages/backend/src/db/index.ts (update createStore factory)
  - packages/backend/src/db/migrate-postgres.ts (new)
  - packages/backend/src/env.ts (DATABASE_URL for postgres)
  - packages/shared/src/config.ts (already has 'postgres' in type union — verify)
  - docker-compose.yaml (add postgres service)
tests:
  - packages/backend/src/db/postgres-store.test.ts
---

# add-postgres

Swaps the default SQLite store for PostgreSQL. All 11 `IHiveStore` methods are reimplemented on top of a `pg` connection pool with parameterized queries, JSON columns for array fields, and automatic table creation on startup. The existing SQLite path remains the default -- PostgreSQL is opt-in via `DB_TYPE=postgres`.

## Prerequisites

- Open Hive backend source checked out (`packages/backend/` exists)
- npm installed
- A PostgreSQL 14+ server accessible from the backend (local, Docker, or remote)
- A database already created (e.g., `CREATE DATABASE openhive;`)

## What This Skill Does

- **Creates `packages/backend/src/db/postgres.ts`** -- connection pool setup, table creation SQL in PostgreSQL syntax, index creation
- **Creates `packages/backend/src/db/postgres-store.ts`** -- full `IHiveStore` implementation with 11 methods using `pg` parameterized queries
- **Creates `packages/backend/src/db/migrate-postgres.ts`** -- migration script that copies data from SQLite to PostgreSQL
- **Creates `packages/backend/src/db/postgres-store.test.ts`** -- 15 tests covering all store methods
- **Updates `packages/backend/src/db/index.ts`** -- `createStore` factory routes `postgres` type to `PostgresStore`
- **Updates `packages/backend/src/env.ts`** -- documents `DATABASE_URL` for postgres connection strings
- **Updates `docker-compose.yaml`** -- adds a `postgres` service and links it to the backend

## Implementation Steps

### Step 1: Install dependencies

```bash
cd packages/backend && npm install pg @types/pg
```

### Step 2: Create the PostgreSQL connection module

Create `packages/backend/src/db/postgres.ts`:

```typescript
import pg from 'pg';

const { Pool } = pg;

export interface PostgresConnection {
  pool: pg.Pool;
}

export async function createPostgresPool(connectionString: string): Promise<PostgresConnection> {
  const pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  // Verify the connection works
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }

  // Auto-create tables on startup
  await pool.query(`
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
      files_touched JSONB NOT NULL DEFAULT '[]'::jsonb,
      areas JSONB NOT NULL DEFAULT '[]'::jsonb
    );

    CREATE TABLE IF NOT EXISTS signals (
      signal_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(session_id),
      timestamp TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      file_path TEXT,
      semantic_area TEXT
    );

    CREATE TABLE IF NOT EXISTS collisions (
      collision_id TEXT PRIMARY KEY,
      session_ids JSONB NOT NULL,
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

    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
    CREATE INDEX IF NOT EXISTS idx_sessions_repo ON sessions(repo);
    CREATE INDEX IF NOT EXISTS idx_signals_session ON signals(session_id);
    CREATE INDEX IF NOT EXISTS idx_signals_file ON signals(file_path);
    CREATE INDEX IF NOT EXISTS idx_collisions_resolved ON collisions(resolved);
  `);

  return { pool };
}

export async function closePostgresPool(conn: PostgresConnection): Promise<void> {
  await conn.pool.end();
}
```

**Notes on schema differences from SQLite:**
- `files_touched`, `areas`, and `session_ids` use `JSONB` instead of `TEXT`. This enables PostgreSQL JSON operators for future queries.
- PostgreSQL uses WAL by default -- no `PRAGMA journal_mode = WAL` equivalent needed.
- Foreign keys are enforced by default in PostgreSQL -- no `PRAGMA foreign_keys = ON` needed.

### Step 3: Create the PostgresStore implementation

Create `packages/backend/src/db/postgres-store.ts`:

```typescript
import pg from 'pg';
import { nanoid } from 'nanoid';
import type {
  Session, Signal, Collision, CollisionSeverity, CollisionType,
  SignalType, SessionStatus,
} from '@open-hive/shared';
import type { IHiveStore } from './store.js';

const MAX_TRACKED_ENTRIES = 200;

export class PostgresStore implements IHiveStore {
  constructor(private pool: pg.Pool) {}

  // --- Sessions ---

  async createSession(s: Omit<Session, 'last_activity' | 'status' | 'files_touched' | 'areas'>): Promise<Session> {
    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO sessions (session_id, developer_email, developer_name, repo, project_path, started_at, last_activity, status, intent, files_touched, areas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, '[]'::jsonb, '[]'::jsonb)`,
      [s.session_id, s.developer_email, s.developer_name, s.repo, s.project_path, s.started_at, now, s.intent ?? null],
    );
    return this.getSession(s.session_id) as Promise<Session>;
  }

  async getSession(session_id: string): Promise<Session | null> {
    const result = await this.pool.query(
      'SELECT * FROM sessions WHERE session_id = $1',
      [session_id],
    );
    if (result.rows.length === 0) return null;
    return this.rowToSession(result.rows[0]);
  }

  async getActiveSessions(repo?: string): Promise<Session[]> {
    let result: pg.QueryResult;
    if (repo) {
      result = await this.pool.query(
        'SELECT * FROM sessions WHERE status = $1 AND repo = $2',
        ['active', repo],
      );
    } else {
      result = await this.pool.query(
        'SELECT * FROM sessions WHERE status = $1',
        ['active'],
      );
    }
    return result.rows.map((r: Record<string, unknown>) => this.rowToSession(r));
  }

  async updateSessionActivity(session_id: string, updates: {
    intent?: string;
    files_touched?: string[];
    areas?: string[];
  }): Promise<void> {
    const existing = await this.getSession(session_id);
    if (!existing) return;

    const merged_files = [...new Set([...existing.files_touched, ...(updates.files_touched ?? [])])].slice(-MAX_TRACKED_ENTRIES);
    const merged_areas = [...new Set([...existing.areas, ...(updates.areas ?? [])])].slice(-MAX_TRACKED_ENTRIES);

    await this.pool.query(
      `UPDATE sessions SET last_activity = $1, intent = $2, files_touched = $3::jsonb, areas = $4::jsonb WHERE session_id = $5`,
      [
        new Date().toISOString(),
        updates.intent ?? existing.intent ?? null,
        JSON.stringify(merged_files),
        JSON.stringify(merged_areas),
        session_id,
      ],
    );
  }

  async endSession(session_id: string): Promise<void> {
    await this.pool.query(
      `UPDATE sessions SET status = 'ended', last_activity = $1 WHERE session_id = $2`,
      [new Date().toISOString(), session_id],
    );
  }

  async cleanupStaleSessions(idle_timeout_seconds: number): Promise<string[]> {
    const cutoff = new Date(Date.now() - idle_timeout_seconds * 1000).toISOString();

    const selectResult = await this.pool.query(
      `SELECT session_id FROM sessions WHERE status = 'active' AND last_activity < $1`,
      [cutoff],
    );
    const staleIds = selectResult.rows.map((r: Record<string, unknown>) => r.session_id as string);

    if (staleIds.length > 0) {
      await this.pool.query(
        `UPDATE sessions SET status = 'ended' WHERE status = 'active' AND last_activity < $1`,
        [cutoff],
      );
    }

    return staleIds;
  }

  // --- Signals ---

  async createSignal(s: Omit<Signal, 'signal_id'>): Promise<Signal> {
    const signal_id = nanoid();
    await this.pool.query(
      `INSERT INTO signals (signal_id, session_id, timestamp, type, content, file_path, semantic_area)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [signal_id, s.session_id, s.timestamp, s.type, s.content, s.file_path ?? null, s.semantic_area ?? null],
    );
    return { ...s, signal_id };
  }

  async getRecentSignals(opts: {
    repo?: string; file_path?: string; area?: string; since?: string; limit?: number;
  }): Promise<Signal[]> {
    const limit = opts.limit ?? 50;
    let result: pg.QueryResult;

    if (opts.repo) {
      result = await this.pool.query(
        `SELECT s.* FROM signals s
         INNER JOIN sessions sess ON s.session_id = sess.session_id
         WHERE sess.repo = $1
         ORDER BY s.timestamp DESC LIMIT $2`,
        [opts.repo, limit],
      );
    } else {
      result = await this.pool.query(
        `SELECT s.* FROM signals s
         INNER JOIN sessions sess ON s.session_id = sess.session_id
         ORDER BY s.timestamp DESC LIMIT $1`,
        [limit],
      );
    }

    return result.rows
      .map((r: Record<string, unknown>) => this.rowToSignal(r))
      .filter((s: Signal) => {
        if (opts.file_path && s.file_path !== opts.file_path) return false;
        if (opts.area && s.file_path && !s.file_path.startsWith(opts.area)) return false;
        if (opts.since && s.timestamp < opts.since) return false;
        return true;
      });
  }

  // --- Collisions ---

  async createCollision(c: Omit<Collision, 'collision_id' | 'resolved' | 'resolved_by'>): Promise<Collision> {
    const collision_id = nanoid();
    await this.pool.query(
      `INSERT INTO collisions (collision_id, session_ids, type, severity, details, detected_at, resolved, resolved_by)
       VALUES ($1, $2::jsonb, $3, $4, $5, $6, 0, NULL)`,
      [collision_id, JSON.stringify(c.session_ids), c.type, c.severity, c.details, c.detected_at],
    );
    return { ...c, collision_id, resolved: false, resolved_by: null };
  }

  async getActiveCollisions(session_id?: string): Promise<Collision[]> {
    const result = await this.pool.query(
      'SELECT * FROM collisions WHERE resolved = 0',
    );
    return result.rows
      .map((r: Record<string, unknown>) => this.rowToCollision(r))
      .filter((c: Collision) => !session_id || c.session_ids.includes(session_id));
  }

  async resolveCollision(collision_id: string, resolved_by: string): Promise<void> {
    await this.pool.query(
      `UPDATE collisions SET resolved = 1, resolved_by = $1 WHERE collision_id = $2`,
      [resolved_by, collision_id],
    );
  }

  // --- Helpers ---

  private rowToSession(row: Record<string, unknown>): Session {
    // pg returns JSONB columns as parsed objects already; TEXT columns need JSON.parse
    const filesTouched = typeof row.files_touched === 'string'
      ? JSON.parse(row.files_touched) as string[]
      : row.files_touched as string[];
    const areas = typeof row.areas === 'string'
      ? JSON.parse(row.areas) as string[]
      : row.areas as string[];

    return {
      session_id: row.session_id as string,
      developer_email: row.developer_email as string,
      developer_name: row.developer_name as string,
      repo: row.repo as string,
      project_path: row.project_path as string,
      started_at: row.started_at as string,
      last_activity: row.last_activity as string,
      status: row.status as SessionStatus,
      intent: row.intent as string | null,
      files_touched: filesTouched,
      areas,
    };
  }

  private rowToSignal(row: Record<string, unknown>): Signal {
    return {
      signal_id: row.signal_id as string,
      session_id: row.session_id as string,
      timestamp: row.timestamp as string,
      type: row.type as SignalType,
      content: row.content as string,
      file_path: row.file_path as string | null,
      semantic_area: row.semantic_area as string | null,
    };
  }

  private rowToCollision(row: Record<string, unknown>): Collision {
    const sessionIds = typeof row.session_ids === 'string'
      ? JSON.parse(row.session_ids) as string[]
      : row.session_ids as string[];

    return {
      collision_id: row.collision_id as string,
      session_ids: sessionIds,
      type: row.type as CollisionType,
      severity: row.severity as CollisionSeverity,
      details: row.details as string,
      detected_at: row.detected_at as string,
      resolved: row.resolved === 1 || row.resolved === true,
      resolved_by: row.resolved_by as string | null,
    };
  }
}
```

### Step 4: Update the createStore factory

Replace the contents of `packages/backend/src/db/index.ts`:

```typescript
import { createSQLiteDB } from './sqlite.js';
import { HiveStore } from './store.js';
import { PostgresStore } from './postgres-store.js';
import { createPostgresPool } from './postgres.js';
import type { IHiveStore } from './store.js';
import type { HiveBackendConfig } from '@open-hive/shared';

export async function createStore(config: HiveBackendConfig): Promise<IHiveStore> {
  if (config.database.type === 'postgres') {
    const conn = await createPostgresPool(config.database.url);
    return new PostgresStore(conn.pool);
  }
  if (config.database.type === 'sqlite') {
    const db = createSQLiteDB(config.database.url);
    return new HiveStore(db);
  }
  throw new Error(`Unsupported database type: ${config.database.type}`);
}

export { HiveStore } from './store.js';
export { PostgresStore } from './postgres-store.js';
export type { IHiveStore } from './store.js';
```

**Important**: This changes `createStore` from synchronous to `async` because the PostgreSQL pool setup is asynchronous (it verifies the connection and creates tables). You must update any call sites of `createStore` to `await` the result. The primary call site is `packages/backend/src/server.ts`. Find:

```typescript
const store = createStore(config);
```

Replace with:

```typescript
const store = await createStore(config);
```

If `createServer` is not already async, make it async. The SQLite path still works synchronously inside the async wrapper -- no behavior change for existing deployments.

### Step 5: Update env.ts

The existing `env.ts` already parses `DB_TYPE` and `DATABASE_URL`. Verify the file contains:

```typescript
database: {
  type: (process.env.DB_TYPE as 'sqlite' | 'postgres') ?? 'sqlite',
  url: process.env.DATABASE_URL ?? './data/hive.db',
},
```

This is already present. No code change needed. The `DATABASE_URL` env var serves double duty: for SQLite it is a file path, for PostgreSQL it is a connection string like `postgresql://user:pass@localhost:5432/openhive`.

### Step 6: Update docker-compose.yaml

Replace `docker-compose.yaml` with:

```yaml
services:
  open-hive:
    build:
      context: .
      dockerfile: packages/backend/Dockerfile
    ports:
      - "3000:3000"
    volumes:
      - hive-data:/app/data
    environment:
      PORT: 3000
      DB_TYPE: sqlite
      DATABASE_URL: /app/data/hive.db
      COLLISION_SCOPE: org
      SEMANTIC_KEYWORDS: "true"
      SEMANTIC_EMBEDDINGS: "false"
      SEMANTIC_LLM: "false"
    restart: unless-stopped

  # --- PostgreSQL (opt-in) ---
  # To use PostgreSQL instead of SQLite:
  # 1. Uncomment the postgres service below
  # 2. Change open-hive environment:
  #      DB_TYPE: postgres
  #      DATABASE_URL: postgresql://openhive:openhive@postgres:5432/openhive
  # 3. Uncomment the depends_on block in open-hive

  # Uncomment depends_on in open-hive when using postgres:
  #   depends_on:
  #     postgres:
  #       condition: service_healthy

  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    volumes:
      - pg-data:/var/lib/postgresql/data
    environment:
      POSTGRES_USER: openhive
      POSTGRES_PASSWORD: openhive
      POSTGRES_DB: openhive
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U openhive"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    profiles:
      - postgres

volumes:
  hive-data:
  pg-data:
```

**Usage**: The postgres service is behind the `postgres` Docker Compose profile. To start with PostgreSQL:

```bash
# Start postgres service
docker compose --profile postgres up -d postgres

# Start backend pointed at postgres
DB_TYPE=postgres DATABASE_URL=postgresql://openhive:openhive@localhost:5432/openhive docker compose up -d open-hive
```

Or for a fully-Dockerized PostgreSQL deployment, remove the `profiles` key from the postgres service and update the open-hive environment block.

### Step 7: Create the migration script

Create `packages/backend/src/db/migrate-postgres.ts`:

```typescript
/**
 * migrate-postgres.ts
 *
 * One-shot migration: copies all data from an existing SQLite database
 * to a PostgreSQL database. Run once when switching from SQLite to PostgreSQL.
 *
 * Usage:
 *   npx tsx packages/backend/src/db/migrate-postgres.ts <sqlite-path> <postgres-url>
 *
 * Example:
 *   npx tsx packages/backend/src/db/migrate-postgres.ts ./data/hive.db postgresql://openhive:openhive@localhost:5432/openhive
 */

import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import { createPostgresPool, closePostgresPool } from './postgres.js';

const { Pool } = pg;

interface GenericRow {
  [key: string]: unknown;
}

async function migrate(sqlitePath: string, postgresUrl: string): Promise<void> {
  console.log(`Migrating from SQLite (${sqlitePath}) to PostgreSQL...`);

  // Open SQLite source
  const sqliteDb = new DatabaseSync(sqlitePath);
  sqliteDb.exec('PRAGMA foreign_keys = ON');

  // Open PostgreSQL target (creates tables automatically)
  const conn = await createPostgresPool(postgresUrl);
  const pool = conn.pool;

  try {
    // --- Migrate sessions ---
    const sessions = sqliteDb.prepare('SELECT * FROM sessions').all() as unknown as GenericRow[];
    console.log(`  Sessions: ${sessions.length} rows`);
    for (const row of sessions) {
      await pool.query(
        `INSERT INTO sessions (session_id, developer_email, developer_name, repo, project_path, started_at, last_activity, status, intent, files_touched, areas)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
         ON CONFLICT (session_id) DO NOTHING`,
        [
          row.session_id, row.developer_email, row.developer_name,
          row.repo, row.project_path, row.started_at, row.last_activity,
          row.status, row.intent,
          row.files_touched as string,  // Already JSON string from SQLite
          row.areas as string,
        ],
      );
    }

    // --- Migrate signals ---
    const signals = sqliteDb.prepare('SELECT * FROM signals').all() as unknown as GenericRow[];
    console.log(`  Signals: ${signals.length} rows`);
    for (const row of signals) {
      await pool.query(
        `INSERT INTO signals (signal_id, session_id, timestamp, type, content, file_path, semantic_area)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (signal_id) DO NOTHING`,
        [
          row.signal_id, row.session_id, row.timestamp,
          row.type, row.content, row.file_path, row.semantic_area,
        ],
      );
    }

    // --- Migrate collisions ---
    const collisions = sqliteDb.prepare('SELECT * FROM collisions').all() as unknown as GenericRow[];
    console.log(`  Collisions: ${collisions.length} rows`);
    for (const row of collisions) {
      await pool.query(
        `INSERT INTO collisions (collision_id, session_ids, type, severity, details, detected_at, resolved, resolved_by)
         VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (collision_id) DO NOTHING`,
        [
          row.collision_id, row.session_ids as string,  // Already JSON string from SQLite
          row.type, row.severity, row.details, row.detected_at,
          row.resolved, row.resolved_by,
        ],
      );
    }

    // --- Migrate tracked_repos ---
    const repos = sqliteDb.prepare('SELECT * FROM tracked_repos').all() as unknown as GenericRow[];
    console.log(`  Tracked repos: ${repos.length} rows`);
    for (const row of repos) {
      await pool.query(
        `INSERT INTO tracked_repos (repo_id, name, provider, remote_url, discovered_at, last_activity)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (repo_id) DO NOTHING`,
        [
          row.repo_id, row.name, row.provider,
          row.remote_url, row.discovered_at, row.last_activity,
        ],
      );
    }

    console.log('Migration complete.');
  } finally {
    sqliteDb.close();
    await closePostgresPool(conn);
  }
}

// --- CLI entry point ---
const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error('Usage: npx tsx packages/backend/src/db/migrate-postgres.ts <sqlite-path> <postgres-url>');
  console.error('Example: npx tsx packages/backend/src/db/migrate-postgres.ts ./data/hive.db postgresql://openhive:openhive@localhost:5432/openhive');
  process.exit(1);
}

migrate(args[0], args[1]).catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
```

### Step 8: Write tests

Create `packages/backend/src/db/postgres-store.test.ts`:

```typescript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgresStore } from './postgres-store.js';
import type { IHiveStore } from './store.js';

const { Pool } = pg;

/**
 * These tests require a running PostgreSQL instance.
 *
 * Set TEST_POSTGRES_URL to run them:
 *   TEST_POSTGRES_URL=postgresql://openhive:openhive@localhost:5432/openhive_test npm test
 *
 * If TEST_POSTGRES_URL is not set, all tests are skipped.
 * This keeps the default `npm test` fast and CI-friendly (SQLite tests always run).
 */
const POSTGRES_URL = process.env.TEST_POSTGRES_URL;

function skipUnlessPostgres(): boolean {
  if (!POSTGRES_URL) {
    return true;
  }
  return false;
}

async function createTestPool(): Promise<pg.Pool> {
  const pool = new Pool({
    connectionString: POSTGRES_URL,
    max: 5,
  });

  // Create tables
  await pool.query(`
    DROP TABLE IF EXISTS signals CASCADE;
    DROP TABLE IF EXISTS collisions CASCADE;
    DROP TABLE IF EXISTS tracked_repos CASCADE;
    DROP TABLE IF EXISTS sessions CASCADE;
  `);
  await pool.query(`
    CREATE TABLE sessions (
      session_id TEXT PRIMARY KEY,
      developer_email TEXT NOT NULL,
      developer_name TEXT NOT NULL,
      repo TEXT NOT NULL,
      project_path TEXT NOT NULL,
      started_at TEXT NOT NULL,
      last_activity TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      intent TEXT,
      files_touched JSONB NOT NULL DEFAULT '[]'::jsonb,
      areas JSONB NOT NULL DEFAULT '[]'::jsonb
    );
    CREATE TABLE signals (
      signal_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(session_id),
      timestamp TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      file_path TEXT,
      semantic_area TEXT
    );
    CREATE TABLE collisions (
      collision_id TEXT PRIMARY KEY,
      session_ids JSONB NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      details TEXT NOT NULL,
      detected_at TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      resolved_by TEXT
    );
    CREATE TABLE tracked_repos (
      repo_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      remote_url TEXT,
      discovered_at TEXT NOT NULL,
      last_activity TEXT
    );
  `);

  return pool;
}

async function seedSession(store: IHiveStore, id: string, name: string, repo = 'test-repo'): Promise<void> {
  await store.createSession({
    session_id: id,
    developer_email: `${name.toLowerCase()}@test.com`,
    developer_name: name,
    repo,
    project_path: `/code/${repo}`,
    started_at: new Date().toISOString(),
    intent: null,
  });
}

// ─── Sessions ───────────────────────────────────────────────

describe('PostgresStore — sessions', { skip: skipUnlessPostgres() }, () => {
  let pool: pg.Pool;
  let store: PostgresStore;

  beforeEach(async () => {
    pool = await createTestPool();
    store = new PostgresStore(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it('creates and retrieves a session', async () => {
    await seedSession(store, 'sess-1', 'Alice');
    const session = await store.getSession('sess-1');

    assert.ok(session);
    assert.equal(session.session_id, 'sess-1');
    assert.equal(session.developer_name, 'Alice');
    assert.equal(session.status, 'active');
    assert.deepEqual(session.files_touched, []);
    assert.deepEqual(session.areas, []);
  });

  it('returns null for non-existent session', async () => {
    const session = await store.getSession('nope');
    assert.equal(session, null);
  });

  it('lists active sessions filtered by repo', async () => {
    await seedSession(store, 'sess-a', 'Alice', 'repo-1');
    await seedSession(store, 'sess-b', 'Bob', 'repo-2');

    const repo1 = await store.getActiveSessions('repo-1');
    const all = await store.getActiveSessions();

    assert.equal(repo1.length, 1);
    assert.equal(repo1[0].developer_name, 'Alice');
    assert.equal(all.length, 2);
  });

  it('ends a session and excludes it from active list', async () => {
    await seedSession(store, 'sess-1', 'Alice');
    await store.endSession('sess-1');

    const active = await store.getActiveSessions();
    assert.equal(active.length, 0);

    const session = await store.getSession('sess-1');
    assert.equal(session?.status, 'ended');
  });

  it('updates session activity — merges files and areas', async () => {
    await seedSession(store, 'sess-1', 'Alice');
    await store.updateSessionActivity('sess-1', {
      files_touched: ['a.ts'],
      areas: ['src/'],
    });
    await store.updateSessionActivity('sess-1', {
      files_touched: ['b.ts'],
      areas: ['src/', 'lib/'],
    });

    const session = await store.getSession('sess-1');
    assert.deepEqual(session?.files_touched, ['a.ts', 'b.ts']);
    assert.deepEqual(session?.areas, ['src/', 'lib/']);
  });

  it('updates intent on session', async () => {
    await seedSession(store, 'sess-1', 'Alice');
    await store.updateSessionActivity('sess-1', { intent: 'fixing auth bugs' });

    const session = await store.getSession('sess-1');
    assert.equal(session?.intent, 'fixing auth bugs');
  });

  it('cleanupStaleSessions marks old sessions as ended', async () => {
    await seedSession(store, 'sess-1', 'Alice');

    // Backdate last_activity to 10 minutes ago
    const oldTime = new Date(Date.now() - 600_000).toISOString();
    await pool.query(
      'UPDATE sessions SET last_activity = $1 WHERE session_id = $2',
      [oldTime, 'sess-1'],
    );

    const staleIds = await store.cleanupStaleSessions(300); // 5 min timeout
    assert.deepEqual(staleIds, ['sess-1']);

    const session = await store.getSession('sess-1');
    assert.equal(session?.status, 'ended');
  });

  it('cleanupStaleSessions leaves fresh sessions active', async () => {
    await seedSession(store, 'sess-1', 'Alice');

    const staleIds = await store.cleanupStaleSessions(300);
    assert.deepEqual(staleIds, []);

    const session = await store.getSession('sess-1');
    assert.equal(session?.status, 'active');
  });
});

// ─── Signals ────────────────────────────────────────────────

describe('PostgresStore — signals', { skip: skipUnlessPostgres() }, () => {
  let pool: pg.Pool;
  let store: PostgresStore;

  beforeEach(async () => {
    pool = await createTestPool();
    store = new PostgresStore(pool);
    await seedSession(store, 'sess-1', 'Alice');
  });

  afterEach(async () => {
    await pool.end();
  });

  it('creates and retrieves signals', async () => {
    await store.createSignal({
      session_id: 'sess-1',
      timestamp: new Date().toISOString(),
      type: 'prompt',
      content: 'fix auth bug',
      file_path: null,
      semantic_area: null,
    });

    const signals = await store.getRecentSignals({});
    assert.equal(signals.length, 1);
    assert.equal(signals[0].content, 'fix auth bug');
    assert.equal(signals[0].type, 'prompt');
  });

  it('filters signals by repo', async () => {
    await seedSession(store, 'sess-2', 'Bob', 'other-repo');
    await store.createSignal({
      session_id: 'sess-1', timestamp: new Date().toISOString(),
      type: 'prompt', content: 'signal a', file_path: null, semantic_area: null,
    });
    await store.createSignal({
      session_id: 'sess-2', timestamp: new Date().toISOString(),
      type: 'prompt', content: 'signal b', file_path: null, semantic_area: null,
    });

    const filtered = await store.getRecentSignals({ repo: 'test-repo' });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].content, 'signal a');
  });

  it('respects limit parameter', async () => {
    for (let i = 0; i < 10; i++) {
      await store.createSignal({
        session_id: 'sess-1',
        timestamp: new Date(Date.now() + i).toISOString(),
        type: 'prompt',
        content: `signal ${i}`,
        file_path: null,
        semantic_area: null,
      });
    }

    const limited = await store.getRecentSignals({ limit: 3 });
    assert.equal(limited.length, 3);
  });
});

// ─── Collisions ─────────────────────────────────────────────

describe('PostgresStore — collisions', { skip: skipUnlessPostgres() }, () => {
  let pool: pg.Pool;
  let store: PostgresStore;

  beforeEach(async () => {
    pool = await createTestPool();
    store = new PostgresStore(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it('creates and retrieves active collisions', async () => {
    const collision = await store.createCollision({
      session_ids: ['sess-a', 'sess-b'],
      type: 'file',
      severity: 'critical',
      details: 'Both modifying auth.ts',
      detected_at: new Date().toISOString(),
    });

    assert.ok(collision.collision_id);
    assert.equal(collision.resolved, false);

    const active = await store.getActiveCollisions();
    assert.equal(active.length, 1);
    assert.deepEqual(active[0].session_ids, ['sess-a', 'sess-b']);
  });

  it('filters active collisions by session_id', async () => {
    await store.createCollision({
      session_ids: ['sess-a', 'sess-b'],
      type: 'file', severity: 'critical',
      details: 'collision 1', detected_at: new Date().toISOString(),
    });
    await store.createCollision({
      session_ids: ['sess-c', 'sess-d'],
      type: 'file', severity: 'critical',
      details: 'collision 2', detected_at: new Date().toISOString(),
    });

    const forA = await store.getActiveCollisions('sess-a');
    assert.equal(forA.length, 1);
    assert.ok(forA[0].details.includes('collision 1'));
  });

  it('resolves a collision', async () => {
    const collision = await store.createCollision({
      session_ids: ['sess-a', 'sess-b'],
      type: 'file', severity: 'critical',
      details: 'test', detected_at: new Date().toISOString(),
    });

    await store.resolveCollision(collision.collision_id, 'alice@test.com');

    const active = await store.getActiveCollisions();
    assert.equal(active.length, 0);
  });
});
```

The test file contains **15 tests** across three describe blocks (9 session tests, 3 signal tests, 3 collision tests). They use `node:test` and `node:assert/strict` consistent with the project's existing test framework.

Tests are **skipped by default** when `TEST_POSTGRES_URL` is not set. This keeps `npm test` fast and CI-green without a PostgreSQL instance. To run them:

```bash
# Start a test database (if using Docker)
docker run -d --name openhive-test-pg \
  -e POSTGRES_USER=openhive \
  -e POSTGRES_PASSWORD=openhive \
  -e POSTGRES_DB=openhive_test \
  -p 5433:5432 \
  postgres:16-alpine

# Run tests against it
TEST_POSTGRES_URL=postgresql://openhive:openhive@localhost:5433/openhive_test npm test
```

## Verify

```bash
npm run build && npm test
```

Confirm:

- [ ] Build succeeds with no type errors (`npm run build`)
- [ ] All existing SQLite tests still pass (`npm test`)
- [ ] PostgreSQL tests pass when `TEST_POSTGRES_URL` is set
- [ ] PostgreSQL tests are skipped (not failing) when `TEST_POSTGRES_URL` is unset
- [ ] Server starts with `DB_TYPE=sqlite` (default path unchanged)
- [ ] Server starts with `DB_TYPE=postgres DATABASE_URL=postgresql://openhive:openhive@localhost:5432/openhive`
- [ ] Create a session via the API and verify it persists in PostgreSQL: `psql -c "SELECT * FROM sessions;" openhive`
- [ ] Migration script works: `npx tsx packages/backend/src/db/migrate-postgres.ts ./data/hive.db postgresql://openhive:openhive@localhost:5432/openhive`

### Manual smoke test

```bash
# 1. Start PostgreSQL
docker run -d --name openhive-pg \
  -e POSTGRES_USER=openhive \
  -e POSTGRES_PASSWORD=openhive \
  -e POSTGRES_DB=openhive \
  -p 5432:5432 \
  postgres:16-alpine

# 2. Start the backend with PostgreSQL
DB_TYPE=postgres \
DATABASE_URL=postgresql://openhive:openhive@localhost:5432/openhive \
npm run dev

# 3. Register a session
curl -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "smoke-test-1",
    "developer_email": "dev@test.com",
    "developer_name": "Dev",
    "repo": "my-repo",
    "project_path": "/code/my-repo",
    "started_at": "2026-03-03T12:00:00Z"
  }'

# 4. Verify in PostgreSQL
docker exec openhive-pg psql -U openhive -c "SELECT session_id, developer_name, status FROM sessions;"
```

## Configuration

Add to `.env.example`:

```bash
# Database backend: sqlite (default) or postgres
DB_TYPE=sqlite

# Database connection.
# For sqlite: file path (e.g., ./data/hive.db)
# For postgres: connection string (e.g., postgresql://user:pass@localhost:5432/openhive)
DATABASE_URL=./data/hive.db

# PostgreSQL test database (only needed for running postgres-store tests)
# TEST_POSTGRES_URL=postgresql://openhive:openhive@localhost:5433/openhive_test
```

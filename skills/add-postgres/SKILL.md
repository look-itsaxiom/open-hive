---
name: add-postgres
description: Replace the default SQLite store with PostgreSQL using pg connection pooling
category: store
port: IHiveStore + INerveRegistry
requires:
  - pg
  - "@types/pg"
modifies:
  - packages/backend/src/db/postgres.ts (new)
  - packages/backend/src/db/postgres-store.ts (new)
  - packages/backend/src/db/index.ts (update createStore factory)
  - packages/backend/src/db/migrate-postgres.ts (new)
  - packages/backend/src/env.ts (DATABASE_URL for postgres)
  - packages/backend/src/server.ts (pass store to PortRegistry)
  - docker-compose.yaml (add postgres service)
tests:
  - packages/backend/src/db/postgres-store.test.ts
---

# add-postgres

Swaps the default SQLite store for PostgreSQL. All `IHiveStore` and `INerveRegistry` methods are reimplemented on top of a `pg` connection pool with parameterized queries, JSON columns for array fields, and automatic table creation on startup. The existing SQLite path remains the default -- PostgreSQL is opt-in via `DB_TYPE=postgres`.

## Prerequisites

- Open Hive backend source checked out (`packages/backend/` exists)
- npm installed
- A PostgreSQL 14+ server accessible from the backend (local, Docker, or remote)
- A database already created (e.g., `CREATE DATABASE openhive;`)

## What This Skill Does

- **Creates `packages/backend/src/db/postgres-store.ts`** -- full `IHiveStore` + `INerveRegistry` implementation with 21 methods using `pg` parameterized queries
- **Creates `packages/backend/src/db/postgres.ts`** -- connection pool setup, table creation SQL (6 tables), index creation
- **Creates `packages/backend/src/db/migrate-postgres.ts`** -- migration script that copies data from SQLite to PostgreSQL
- **Creates `packages/backend/src/db/postgres-store.test.ts`** -- 25 tests covering sessions, signals, collisions, agent mail, and nerves
- **Updates `packages/backend/src/db/index.ts`** -- `createStore` factory routes `postgres` type to `PostgresStore`
- **Updates `docker-compose.yaml`** -- adds a `postgres` service and links it to the backend

## Implementation Steps

### Step 1: Install dependencies

```bash
cd packages/backend && npm install pg @types/pg
```

### Step 2: Create the PostgreSQL connection module

Create `packages/backend/src/db/postgres.ts` with connection pool setup and automatic table creation.

**Tables** (must match the SQLite schema in `packages/backend/src/db/sqlite.ts`):

```sql
-- Sessions, signals, collisions, tracked_repos (Phase 2)
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
  files_touched JSONB NOT NULL DEFAULT '[]',
  areas JSONB NOT NULL DEFAULT '[]'
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
  session_ids JSONB NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  details TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT false,
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

-- Phase 3: Agent Mail
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

-- Phase 3: Nerve Registry
CREATE TABLE IF NOT EXISTS nerves (
  nerve_id TEXT PRIMARY KEY,
  agent_id TEXT UNIQUE NOT NULL,
  nerve_type TEXT NOT NULL,
  agent_card JSONB NOT NULL,
  created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);
```

**Indexes** (must match SQLite):

```sql
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
```

**Note:** PostgreSQL uses `JSONB` for array columns (`files_touched`, `areas`, `session_ids`, `agent_card`) and native `BOOLEAN` for `resolved`. SQLite uses `TEXT` with `JSON.parse/stringify` and `INTEGER` for booleans.

### Step 3: Create the PostgresStore implementation

Create `packages/backend/src/db/postgres-store.ts`:

```typescript
import type {
  Session, Signal, Collision, CollisionSeverity, CollisionType,
  SignalType, SessionStatus, AgentMail, AgentMailType, AgentCard, Nerve,
} from '@open-hive/shared';
import type { IHiveStore, INerveRegistry, HistoricalIntent } from '@open-hive/shared';
import type pg from 'pg';
import { nanoid } from 'nanoid';

export class PostgresStore implements IHiveStore, INerveRegistry {
  readonly name = 'postgresql';

  constructor(private pool: pg.Pool) {}

  // ─── Sessions (6 methods) ─────────────────────────────────────

  async createSession(s: Omit<Session, 'last_activity' | 'status' | 'files_touched' | 'areas'>): Promise<Session> {
    const now = new Date().toISOString();
    const session: Session = {
      ...s,
      last_activity: now,
      status: 'active',
      files_touched: [],
      areas: [],
    };
    await this.pool.query(
      `INSERT INTO sessions (session_id, developer_email, developer_name, repo, project_path, started_at, last_activity, status, intent, files_touched, areas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [s.session_id, s.developer_email, s.developer_name, s.repo, s.project_path, s.started_at, now, 'active', s.intent ?? null, '[]', '[]'],
    );
    return session;
  }

  async getSession(session_id: string): Promise<Session | null> {
    const { rows } = await this.pool.query('SELECT * FROM sessions WHERE session_id = $1', [session_id]);
    return rows[0] ? this.rowToSession(rows[0]) : null;
  }

  async getActiveSessions(repo?: string): Promise<Session[]> {
    const query = repo
      ? { text: `SELECT * FROM sessions WHERE status = 'active' AND repo = $1`, values: [repo] }
      : { text: `SELECT * FROM sessions WHERE status = 'active'`, values: [] };
    const { rows } = await this.pool.query(query);
    return rows.map(r => this.rowToSession(r));
  }

  async updateSessionActivity(session_id: string, updates: { intent?: string; files_touched?: string[]; areas?: string[] }): Promise<void> {
    const sets: string[] = ['last_activity = $1'];
    const values: unknown[] = [new Date().toISOString()];
    let idx = 2;
    if (updates.intent !== undefined) { sets.push(`intent = $${idx++}`); values.push(updates.intent); }
    if (updates.files_touched !== undefined) { sets.push(`files_touched = $${idx++}`); values.push(JSON.stringify(updates.files_touched)); }
    if (updates.areas !== undefined) { sets.push(`areas = $${idx++}`); values.push(JSON.stringify(updates.areas)); }
    values.push(session_id);
    await this.pool.query(`UPDATE sessions SET ${sets.join(', ')} WHERE session_id = $${idx}`, values);
  }

  async endSession(session_id: string): Promise<void> {
    await this.pool.query(`UPDATE sessions SET status = 'ended', last_activity = $1 WHERE session_id = $2`, [new Date().toISOString(), session_id]);
  }

  async cleanupStaleSessions(idle_timeout_seconds: number): Promise<string[]> {
    const cutoff = new Date(Date.now() - idle_timeout_seconds * 1000).toISOString();
    const { rows } = await this.pool.query(
      `UPDATE sessions SET status = 'ended' WHERE status = 'active' AND last_activity < $1 RETURNING session_id`, [cutoff],
    );
    return rows.map(r => r.session_id);
  }

  // ─── Signals (3 methods) ──────────────────────────────────────

  async createSignal(s: Omit<Signal, 'signal_id'>): Promise<Signal> {
    const signal_id = nanoid();
    await this.pool.query(
      `INSERT INTO signals (signal_id, session_id, timestamp, type, content, file_path, semantic_area, weight)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [signal_id, s.session_id, s.timestamp, s.type, s.content, s.file_path, s.semantic_area, s.weight],
    );
    return { signal_id, ...s };
  }

  async getRecentSignals(opts: { repo?: string; file_path?: string; area?: string; since?: string; limit?: number }): Promise<Signal[]> {
    // Build dynamic WHERE using session join for repo filtering
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    let join = '';
    if (opts.repo) { join = 'JOIN sessions s ON sig.session_id = s.session_id'; conditions.push(`s.repo = $${idx++}`); values.push(opts.repo); }
    if (opts.file_path) { conditions.push(`sig.file_path = $${idx++}`); values.push(opts.file_path); }
    if (opts.area) { conditions.push(`sig.semantic_area = $${idx++}`); values.push(opts.area); }
    if (opts.since) { conditions.push(`sig.timestamp >= $${idx++}`); values.push(opts.since); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = opts.limit ?? 50;
    const { rows } = await this.pool.query(`SELECT sig.* FROM signals sig ${join} ${where} ORDER BY sig.timestamp DESC LIMIT $${idx}`, [...values, limit]);
    return rows.map(r => this.rowToSignal(r));
  }

  async getRecentIntents(opts: { repo?: string; exclude_session_id?: string; since?: string; limit?: number }): Promise<HistoricalIntent[]> {
    const conditions: string[] = [`sig.type IN ('prompt','intent_declared')`];
    const values: unknown[] = [];
    let idx = 1;
    if (opts.repo) { conditions.push(`s.repo = $${idx++}`); values.push(opts.repo); }
    if (opts.exclude_session_id) { conditions.push(`sig.session_id != $${idx++}`); values.push(opts.exclude_session_id); }
    if (opts.since) { conditions.push(`sig.timestamp >= $${idx++}`); values.push(opts.since); }
    const limit = opts.limit ?? 20;
    const { rows } = await this.pool.query(
      `SELECT sig.session_id, s.developer_name, s.developer_email, s.repo, sig.content AS intent, sig.timestamp
       FROM signals sig JOIN sessions s ON sig.session_id = s.session_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY sig.timestamp DESC LIMIT $${idx}`, [...values, limit],
    );
    return rows;
  }

  // ─── Collisions (3 methods) ───────────────────────────────────

  async createCollision(c: Omit<Collision, 'collision_id' | 'resolved' | 'resolved_by'>): Promise<Collision> {
    const collision_id = nanoid();
    const collision: Collision = { collision_id, ...c, resolved: false, resolved_by: null };
    await this.pool.query(
      `INSERT INTO collisions (collision_id, session_ids, type, severity, details, detected_at, resolved, resolved_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [collision_id, JSON.stringify(c.session_ids), c.type, c.severity, c.details, c.detected_at, false, null],
    );
    return collision;
  }

  async getActiveCollisions(session_id?: string): Promise<Collision[]> {
    const query = session_id
      ? { text: `SELECT * FROM collisions WHERE resolved = false AND session_ids::text LIKE $1`, values: [`%${session_id}%`] }
      : { text: `SELECT * FROM collisions WHERE resolved = false`, values: [] };
    const { rows } = await this.pool.query(query);
    return rows.map(r => this.rowToCollision(r));
  }

  async resolveCollision(collision_id: string, resolved_by: string): Promise<void> {
    await this.pool.query(`UPDATE collisions SET resolved = true, resolved_by = $1 WHERE collision_id = $2`, [resolved_by, collision_id]);
  }

  // ─── Agent Mail (4 methods) ───────────────────────────────────

  async createMail(m: Omit<AgentMail, 'mail_id' | 'read_at' | 'weight'>): Promise<AgentMail> {
    const mail_id = nanoid();
    // Resolve to_developer_email from to_session_id if not provided
    let to_developer_email: string | null = null;
    if (m.to_session_id) {
      const session = await this.getSession(m.to_session_id);
      to_developer_email = session?.developer_email ?? null;
    }
    const mail: AgentMail = { mail_id, ...m, read_at: null, weight: 1.0 };
    await this.pool.query(
      `INSERT INTO agent_mail (mail_id, from_session_id, to_session_id, to_developer_email, to_context_id, type, subject, content, created_at, read_at, weight)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [mail_id, m.from_session_id, m.to_session_id, to_developer_email, m.to_context_id, m.type, m.subject, m.content, m.created_at, null, 1.0],
    );
    return mail;
  }

  async getUnreadMail(sessionIdOrOpts: string | { session_id?: string; developer_email?: string }): Promise<AgentMail[]> {
    const conditions: string[] = ['read_at IS NULL'];
    const values: unknown[] = [];
    let idx = 1;
    if (typeof sessionIdOrOpts === 'string') {
      conditions.push(`to_session_id = $${idx++}`);
      values.push(sessionIdOrOpts);
    } else {
      const orParts: string[] = [];
      if (sessionIdOrOpts.session_id) { orParts.push(`to_session_id = $${idx++}`); values.push(sessionIdOrOpts.session_id); }
      if (sessionIdOrOpts.developer_email) { orParts.push(`to_developer_email = $${idx++}`); values.push(sessionIdOrOpts.developer_email); }
      if (orParts.length > 0) conditions.push(`(${orParts.join(' OR ')})`);
    }
    const { rows } = await this.pool.query(
      `SELECT DISTINCT ON (mail_id) * FROM agent_mail WHERE ${conditions.join(' AND ')} ORDER BY mail_id, created_at DESC`,
      values,
    );
    return rows.map(r => this.rowToMail(r));
  }

  async getMailByContext(context_id: string): Promise<AgentMail[]> {
    const { rows } = await this.pool.query('SELECT * FROM agent_mail WHERE to_context_id = $1 ORDER BY created_at DESC', [context_id]);
    return rows.map(r => this.rowToMail(r));
  }

  async markMailRead(mail_id: string): Promise<void> {
    await this.pool.query(`UPDATE agent_mail SET read_at = $1 WHERE mail_id = $2`, [new Date().toISOString(), mail_id]);
  }

  // ─── INerveRegistry (5 methods) ───────────────────────────────

  async registerNerve(card: AgentCard, nerve_type: string): Promise<Nerve> {
    const nerve_id = nanoid();
    const now = new Date().toISOString();
    // Upsert — if agent_id already registered, update
    await this.pool.query(
      `INSERT INTO nerves (nerve_id, agent_id, nerve_type, agent_card, created_at, last_seen, status)
       VALUES ($1,$2,$3,$4,$5,$6,'active')
       ON CONFLICT (agent_id) DO UPDATE SET agent_card = $4, last_seen = $6, status = 'active'`,
      [nerve_id, card.agent_id, nerve_type, JSON.stringify(card), now, now],
    );
    return { nerve_id, agent_card: card, nerve_type, created_at: now };
  }

  async getNerve(agent_id: string): Promise<Nerve | null> {
    const { rows } = await this.pool.query('SELECT * FROM nerves WHERE agent_id = $1', [agent_id]);
    return rows[0] ? this.rowToNerve(rows[0]) : null;
  }

  async getActiveNerves(nerve_type?: string): Promise<Nerve[]> {
    const query = nerve_type
      ? { text: `SELECT * FROM nerves WHERE status = 'active' AND nerve_type = $1`, values: [nerve_type] }
      : { text: `SELECT * FROM nerves WHERE status = 'active'`, values: [] };
    const { rows } = await this.pool.query(query);
    return rows.map(r => this.rowToNerve(r));
  }

  async updateLastSeen(agent_id: string): Promise<void> {
    await this.pool.query(`UPDATE nerves SET last_seen = $1 WHERE agent_id = $2`, [new Date().toISOString(), agent_id]);
  }

  async deregisterNerve(agent_id: string): Promise<void> {
    await this.pool.query(`UPDATE nerves SET status = 'disconnected' WHERE agent_id = $1`, [agent_id]);
  }

  // ─── Row Mappers ──────────────────────────────────────────────

  private rowToSession(r: any): Session {
    return {
      ...r,
      files_touched: typeof r.files_touched === 'string' ? JSON.parse(r.files_touched) : r.files_touched,
      areas: typeof r.areas === 'string' ? JSON.parse(r.areas) : r.areas,
    };
  }

  private rowToSignal(r: any): Signal {
    return { ...r, weight: Number(r.weight) };
  }

  private rowToCollision(r: any): Collision {
    return {
      ...r,
      session_ids: typeof r.session_ids === 'string' ? JSON.parse(r.session_ids) : r.session_ids,
      resolved: Boolean(r.resolved),
    };
  }

  private rowToMail(r: any): AgentMail {
    return { ...r, weight: Number(r.weight) };
  }

  private rowToNerve(r: any): Nerve {
    return {
      nerve_id: r.nerve_id,
      agent_card: typeof r.agent_card === 'string' ? JSON.parse(r.agent_card) : r.agent_card,
      nerve_type: r.nerve_type,
      created_at: r.created_at,
    };
  }
}
```

**Important**: The `IHiveStore` and `INerveRegistry` interfaces are imported from `@open-hive/shared`, not from `../db/store.js`. This ensures the PostgresStore conforms to the canonical port definitions.

### Step 4: Update the createStore factory

Replace the contents of `packages/backend/src/db/index.ts`:

```typescript
import type { IHiveStore, INerveRegistry } from '@open-hive/shared';
import type { HiveBackendConfig } from '@open-hive/shared';

export async function createStore(config: HiveBackendConfig): Promise<IHiveStore & INerveRegistry> {
  if (config.database.type === 'postgres') {
    const { createPostgresPool } = await import('./postgres.js');
    const { PostgresStore } = await import('./postgres-store.js');
    const conn = await createPostgresPool(config.database.url);
    return new PostgresStore(conn.pool);
  }
  const { createSQLiteDB } = await import('./sqlite.js');
  const { HiveStore } = await import('./store.js');
  const db = createSQLiteDB(config.database.url);
  return new HiveStore(db);
}
```

**Note:** `HiveStore` already implements both `IHiveStore` and `INerveRegistry` (it serves as both store and nerve registry in the SQLite path).

### Step 5: Register store via PortRegistry

In `packages/backend/src/server.ts`, the store is passed to the `PortRegistry`:

```typescript
const store = await createStore(config);

const registry: PortRegistry = {
  store,
  identity,
  analyzers,
  alerts,
  decay,
  nerves: store,  // HiveStore/PostgresStore implements both IHiveStore and INerveRegistry
};
```

The `PortRegistry` holds all port instances:

```typescript
interface PortRegistry {
  store: IHiveStore;
  identity: IIdentityProvider;
  analyzers: ISemanticAnalyzer[];
  alerts: AlertDispatcher;
  decay: DecayService;
  nerves: INerveRegistry;
}
```

Whether the store is SQLite or PostgreSQL is transparent to the rest of the system.

### Step 6: Write tests

Create `packages/backend/src/db/postgres-store.test.ts` with 25 tests across sessions, signals, collisions, agent mail, and nerves. Tests are skipped when `TEST_POSTGRES_URL` is not set.

```typescript
import type { IHiveStore, INerveRegistry } from '@open-hive/shared';

// Tests use the IHiveStore and INerveRegistry interfaces from @open-hive/shared
// to verify conformance

// Test groups:
// 1. Sessions (6 tests): create, get, list active, update activity, end, cleanup stale
// 2. Signals (3 tests): create, get recent, get recent intents
// 3. Collisions (3 tests): create, get active, resolve
// 4. Agent Mail (5 tests): create, get unread by session, get unread by email, get by context, mark read
// 5. Nerves (5 tests): register, get by agent_id, list active, heartbeat, deregister
// 6. Cross-session mail (3 tests): mail survives session changes via to_developer_email
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
- [ ] Agent mail delivery works across session restarts (to_developer_email resolution)
- [ ] Nerve registration and heartbeat work

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

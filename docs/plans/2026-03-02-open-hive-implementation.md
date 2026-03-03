# Open Hive Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a developer collision detection system — Claude Code plugin + self-hosted backend — that passively captures developer intent and alerts teams to work overlaps.

**Architecture:** TypeScript monorepo with 4 packages: `shared` (types), `backend` (Fastify + SQLite API server), `plugin` (Claude Code hooks + MCP + commands), `dashboard` (web UI). Backend runs in Docker. Plugin communicates via HTTPS.

**Tech Stack:** TypeScript, Node.js 22, Fastify, better-sqlite3, Drizzle ORM, @mizunashi_mana/claude-code-hook-sdk, tsx, turbo, Docker

**Design doc:** `docs/plans/2026-03-02-open-hive-design.md`

---

## Phase 1: Monorepo Scaffold

### Task 1: Initialize workspace root

**Files:**
- Create: `package.json`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`

**Step 1: Create root package.json**

```json
{
  "name": "open-hive",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "clean": "turbo run clean"
  },
  "devDependencies": {
    "turbo": "^2",
    "typescript": "^5.7"
  }
}
```

**Step 2: Create turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["build"]
    },
    "lint": {},
    "clean": {
      "cache": false
    }
  }
}
```

**Step 3: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
```

**Step 4: Create .gitignore**

```
node_modules/
dist/
.turbo/
*.db
*.sqlite
.env
.env.local
```

**Step 5: Install dependencies**

Run: `npm install`
Expected: lock file created, turbo + typescript installed

**Step 6: Commit**

```bash
git add package.json turbo.json tsconfig.base.json .gitignore package-lock.json
git commit -m "chore: scaffold monorepo root with turbo + typescript"
```

---

### Task 2: Create shared package

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/models.ts`
- Create: `packages/shared/src/api.ts`
- Create: `packages/shared/src/config.ts`

**Step 1: Create package.json**

```json
{
  "name": "@open-hive/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

**Step 3: Write models.ts — core domain types**

```typescript
// Session represents a developer's active Claude Code session
export interface Session {
  session_id: string;
  developer_email: string;
  developer_name: string;
  repo: string;
  project_path: string;
  started_at: string;       // ISO 8601
  last_activity: string;    // ISO 8601
  status: SessionStatus;
  intent: string | null;
  files_touched: string[];
  areas: string[];          // directories being worked in
}

export type SessionStatus = 'active' | 'idle' | 'ended';

// Signal represents a single captured developer action
export interface Signal {
  signal_id: string;
  session_id: string;
  timestamp: string;
  type: SignalType;
  content: string;
  file_path: string | null;
  semantic_area: string | null;
}

export type SignalType = 'prompt' | 'file_modify' | 'file_read' | 'search' | 'explicit';

// Collision represents detected overlap between sessions
export interface Collision {
  collision_id: string;
  session_ids: string[];
  type: CollisionType;
  severity: CollisionSeverity;
  details: string;
  detected_at: string;
  resolved: boolean;
  resolved_by: string | null;
}

export type CollisionType = 'file' | 'directory' | 'semantic';
export type CollisionSeverity = 'critical' | 'warning' | 'info';

// Repo tracked by the backend
export interface TrackedRepo {
  repo_id: string;
  name: string;
  provider: GitProvider;
  remote_url: string | null;
  discovered_at: string;
  last_activity: string | null;
}

export type GitProvider = 'github' | 'azure-devops' | 'gitlab' | 'self-registered';
```

**Step 4: Write api.ts — API request/response types**

```typescript
import type {
  Session, Signal, Collision, CollisionSeverity, SignalType,
} from './models.js';

// --- Requests ---

export interface RegisterSessionRequest {
  session_id: string;
  developer_email: string;
  developer_name: string;
  repo: string;
  project_path: string;
}

export interface RegisterSessionResponse {
  ok: boolean;
  active_collisions: Collision[];
  active_sessions_in_repo: Pick<Session, 'session_id' | 'developer_name' | 'intent' | 'areas'>[];
}

export interface HeartbeatRequest {
  session_id: string;
}

export interface EndSessionRequest {
  session_id: string;
}

export interface IntentSignalRequest {
  session_id: string;
  content: string;         // the user's prompt or explicit intent
  type: SignalType;
}

export interface IntentSignalResponse {
  ok: boolean;
  collisions: Collision[];
}

export interface ActivitySignalRequest {
  session_id: string;
  file_path: string;
  type: 'file_modify' | 'file_read';
}

export interface ActivitySignalResponse {
  ok: boolean;
  collisions: Collision[];
}

export interface CheckConflictsRequest {
  session_id: string;
  file_path: string;
  repo?: string;
}

export interface CheckConflictsResponse {
  has_conflicts: boolean;
  collisions: Collision[];
  nearby_sessions: Pick<Session, 'session_id' | 'developer_name' | 'intent' | 'files_touched'>[];
}

export interface ListActiveRequest {
  repo?: string;
  team?: string;
}

export interface ListActiveResponse {
  sessions: Session[];
}

export interface ResolveCollisionRequest {
  collision_id: string;
  resolved_by: string;
}

export interface HistoryRequest {
  file_path?: string;
  area?: string;
  repo?: string;
  since?: string;          // ISO 8601
  limit?: number;
}

export interface HistoryResponse {
  signals: Signal[];
  sessions: Pick<Session, 'session_id' | 'developer_name' | 'repo' | 'intent' | 'started_at'>[];
}

// --- Webhook ---

export interface WebhookPayload {
  type: 'collision_detected' | 'collision_resolved';
  severity: CollisionSeverity;
  collision: Collision;
  sessions: Pick<Session, 'developer_name' | 'developer_email' | 'repo' | 'intent'>[];
  dashboard_url: string;
}
```

**Step 5: Write config.ts — shared config types**

```typescript
export interface HiveClientConfig {
  backend_url: string;
  identity: {
    email: string;
    display_name: string;
  };
  team?: string;
  notifications: {
    inline: boolean;
    webhook_url?: string;
  };
}

export interface HiveBackendConfig {
  port: number;
  database: {
    type: 'sqlite' | 'postgres';
    url: string;               // file path for sqlite, connection string for postgres
  };
  collision: {
    scope: 'repo' | 'team' | 'org';
    semantic: {
      keywords_enabled: boolean;
      embeddings_enabled: boolean;
      embeddings_provider?: string;
      embeddings_api_key?: string;
      llm_enabled: boolean;
      llm_provider?: string;
      llm_api_key?: string;
    };
  };
  git_provider?: {
    type: 'github' | 'azure-devops' | 'gitlab';
    auth: 'oauth' | 'pat';
    token?: string;
    org?: string;
  };
  webhooks: {
    urls: string[];
  };
  session: {
    heartbeat_interval_seconds: number;
    idle_timeout_seconds: number;
  };
}
```

**Step 6: Write index.ts — re-export everything**

```typescript
export * from './models.js';
export * from './api.js';
export * from './config.js';
```

**Step 7: Build and verify**

Run: `cd packages/shared && npx tsc --noEmit`
Expected: no errors

**Step 8: Commit**

```bash
git add packages/shared/
git commit -m "feat: add shared types package — models, API contracts, config"
```

---

## Phase 2: Backend Core

### Task 3: Scaffold backend package

**Files:**
- Create: `packages/backend/package.json`
- Create: `packages/backend/tsconfig.json`
- Create: `packages/backend/src/server.ts`
- Create: `packages/backend/src/env.ts`

**Step 1: Create package.json**

```json
{
  "name": "@open-hive/backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/server.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/server.ts",
    "start": "node dist/server.js",
    "test": "node --import tsx --test src/**/*.test.ts",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@open-hive/shared": "workspace:*",
    "fastify": "^5",
    "better-sqlite3": "^11",
    "drizzle-orm": "^0.38",
    "nanoid": "^5",
    "@fastify/cors": "^10",
    "@fastify/static": "^8"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7",
    "tsx": "^4",
    "drizzle-kit": "^0.30"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"],
  "references": [
    { "path": "../shared" }
  ]
}
```

**Step 3: Write env.ts — environment config loader**

```typescript
import type { HiveBackendConfig } from '@open-hive/shared';

export function loadConfig(): HiveBackendConfig {
  return {
    port: parseInt(process.env.PORT ?? '3000', 10),
    database: {
      type: (process.env.DB_TYPE as 'sqlite' | 'postgres') ?? 'sqlite',
      url: process.env.DATABASE_URL ?? './data/hive.db',
    },
    collision: {
      scope: (process.env.COLLISION_SCOPE as 'repo' | 'team' | 'org') ?? 'org',
      semantic: {
        keywords_enabled: process.env.SEMANTIC_KEYWORDS !== 'false',
        embeddings_enabled: process.env.SEMANTIC_EMBEDDINGS === 'true',
        embeddings_provider: process.env.EMBEDDINGS_PROVIDER,
        embeddings_api_key: process.env.EMBEDDINGS_API_KEY,
        llm_enabled: process.env.SEMANTIC_LLM === 'true',
        llm_provider: process.env.LLM_PROVIDER,
        llm_api_key: process.env.LLM_API_KEY,
      },
    },
    webhooks: {
      urls: process.env.WEBHOOK_URLS?.split(',').filter(Boolean) ?? [],
    },
    session: {
      heartbeat_interval_seconds: parseInt(process.env.HEARTBEAT_INTERVAL ?? '30', 10),
      idle_timeout_seconds: parseInt(process.env.IDLE_TIMEOUT ?? '300', 10),
    },
  };
}
```

**Step 4: Write server.ts — minimal Fastify server**

```typescript
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadConfig } from './env.js';

const config = loadConfig();

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

app.get('/api/health', async () => ({ status: 'ok', version: '0.1.0' }));

await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`Open Hive backend listening on port ${config.port}`);
```

**Step 5: Install dependencies**

Run: `npm install` (from root — workspaces will resolve)

**Step 6: Test the server starts**

Run: `cd packages/backend && npx tsx src/server.ts &`
Then: `curl http://localhost:3000/api/health`
Expected: `{"status":"ok","version":"0.1.0"}`
Then: kill the background process

**Step 7: Commit**

```bash
git add packages/backend/
git commit -m "feat: scaffold backend package with Fastify server"
```

---

### Task 4: Database schema and data layer

**Files:**
- Create: `packages/backend/src/db/schema.ts`
- Create: `packages/backend/src/db/sqlite.ts`
- Create: `packages/backend/src/db/store.ts`
- Create: `packages/backend/src/db/index.ts`

**Step 1: Write schema.ts — Drizzle SQLite schema**

```typescript
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
  files_touched: text('files_touched').notNull().default('[]'),  // JSON array
  areas: text('areas').notNull().default('[]'),                  // JSON array
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
  session_ids: text('session_ids').notNull(),  // JSON array
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
```

**Step 2: Write sqlite.ts — SQLite connection**

```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function createSQLiteDB(dbPath: string) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  return db;
}
```

**Step 3: Write store.ts — repository interface + SQLite implementation**

```typescript
import { eq, and, ne, like, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import type {
  Session, Signal, Collision, CollisionSeverity, CollisionType,
  SignalType, SessionStatus,
} from '@open-hive/shared';

type DB = BetterSQLite3Database<typeof schema>;

export class HiveStore {
  constructor(private db: DB) {}

  // --- Sessions ---

  async createSession(s: Omit<Session, 'last_activity' | 'status' | 'files_touched' | 'areas'>): Promise<Session> {
    const now = new Date().toISOString();
    const session: typeof schema.sessions.$inferInsert = {
      ...s,
      last_activity: now,
      status: 'active',
      files_touched: '[]',
      areas: '[]',
    };
    this.db.insert(schema.sessions).values(session).run();
    return this.getSession(s.session_id) as Promise<Session>;
  }

  async getSession(session_id: string): Promise<Session | null> {
    const row = this.db.select().from(schema.sessions)
      .where(eq(schema.sessions.session_id, session_id))
      .get();
    return row ? this.rowToSession(row) : null;
  }

  async getActiveSessions(repo?: string): Promise<Session[]> {
    const conditions = [eq(schema.sessions.status, 'active')];
    if (repo) conditions.push(eq(schema.sessions.repo, repo));
    const rows = this.db.select().from(schema.sessions)
      .where(and(...conditions))
      .all();
    return rows.map(r => this.rowToSession(r));
  }

  async updateSessionActivity(session_id: string, updates: {
    intent?: string;
    files_touched?: string[];
    areas?: string[];
  }): Promise<void> {
    const existing = await this.getSession(session_id);
    if (!existing) return;

    const merged_files = [...new Set([...existing.files_touched, ...(updates.files_touched ?? [])])];
    const merged_areas = [...new Set([...existing.areas, ...(updates.areas ?? [])])];

    this.db.update(schema.sessions)
      .set({
        last_activity: new Date().toISOString(),
        intent: updates.intent ?? existing.intent,
        files_touched: JSON.stringify(merged_files),
        areas: JSON.stringify(merged_areas),
      })
      .where(eq(schema.sessions.session_id, session_id))
      .run();
  }

  async endSession(session_id: string): Promise<void> {
    this.db.update(schema.sessions)
      .set({ status: 'ended', last_activity: new Date().toISOString() })
      .where(eq(schema.sessions.session_id, session_id))
      .run();
  }

  // --- Signals ---

  async createSignal(s: Omit<Signal, 'signal_id'>): Promise<Signal> {
    const signal_id = nanoid();
    this.db.insert(schema.signals).values({ ...s, signal_id }).run();
    return { ...s, signal_id };
  }

  async getRecentSignals(opts: {
    repo?: string; file_path?: string; area?: string; since?: string; limit?: number;
  }): Promise<Signal[]> {
    // Join with sessions to filter by repo
    let query = this.db.select({
      signal: schema.signals,
    }).from(schema.signals)
      .innerJoin(schema.sessions, eq(schema.signals.session_id, schema.sessions.session_id))
      .orderBy(desc(schema.signals.timestamp))
      .limit(opts.limit ?? 50);

    // Note: complex filtering done in application layer for SQLite compatibility
    const rows = query.all();
    return rows
      .map(r => r.signal)
      .filter(s => {
        if (opts.file_path && s.file_path !== opts.file_path) return false;
        if (opts.area && s.file_path && !s.file_path.startsWith(opts.area)) return false;
        if (opts.since && s.timestamp < opts.since) return false;
        return true;
      });
  }

  // --- Collisions ---

  async createCollision(c: Omit<Collision, 'collision_id' | 'resolved' | 'resolved_by'>): Promise<Collision> {
    const collision_id = nanoid();
    this.db.insert(schema.collisions).values({
      collision_id,
      session_ids: JSON.stringify(c.session_ids),
      type: c.type,
      severity: c.severity,
      details: c.details,
      detected_at: c.detected_at,
      resolved: false,
      resolved_by: null,
    }).run();
    return { ...c, collision_id, resolved: false, resolved_by: null };
  }

  async getActiveCollisions(session_id?: string): Promise<Collision[]> {
    const rows = this.db.select().from(schema.collisions)
      .where(eq(schema.collisions.resolved, false))
      .all();
    return rows
      .map(r => this.rowToCollision(r))
      .filter(c => !session_id || c.session_ids.includes(session_id));
  }

  async resolveCollision(collision_id: string, resolved_by: string): Promise<void> {
    this.db.update(schema.collisions)
      .set({ resolved: true, resolved_by })
      .where(eq(schema.collisions.collision_id, collision_id))
      .run();
  }

  // --- Helpers ---

  private rowToSession(row: typeof schema.sessions.$inferSelect): Session {
    return {
      ...row,
      status: row.status as SessionStatus,
      files_touched: JSON.parse(row.files_touched),
      areas: JSON.parse(row.areas),
    };
  }

  private rowToCollision(row: typeof schema.collisions.$inferSelect): Collision {
    return {
      ...row,
      session_ids: JSON.parse(row.session_ids),
      type: row.type as CollisionType,
      severity: row.severity as CollisionSeverity,
    };
  }
}
```

**Step 4: Write index.ts — DB factory**

```typescript
import { createSQLiteDB } from './sqlite.js';
import { HiveStore } from './store.js';
import type { HiveBackendConfig } from '@open-hive/shared';

export function createStore(config: HiveBackendConfig): HiveStore {
  if (config.database.type === 'sqlite') {
    const db = createSQLiteDB(config.database.url);
    return new HiveStore(db);
  }
  // Postgres support: future implementation
  throw new Error(`Unsupported database type: ${config.database.type}`);
}

export { HiveStore } from './store.js';
```

**Step 5: Verify it compiles**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: no errors

**Step 6: Commit**

```bash
git add packages/backend/src/db/
git commit -m "feat: add database schema and store — sessions, signals, collisions"
```

---

### Task 5: Collision detection engine

**Files:**
- Create: `packages/backend/src/services/collision-engine.ts`

**Step 1: Write collision-engine.ts**

```typescript
import { dirname } from 'node:path';
import type { HiveStore } from '../db/store.js';
import type { Collision, Session, HiveBackendConfig } from '@open-hive/shared';

export class CollisionEngine {
  constructor(
    private store: HiveStore,
    private config: HiveBackendConfig,
  ) {}

  /**
   * Check for collisions when a file is about to be modified.
   * Returns any detected collisions.
   */
  async checkFileCollision(session_id: string, file_path: string, repo: string): Promise<Collision[]> {
    const activeSessions = await this.store.getActiveSessions(
      this.config.collision.scope === 'repo' ? repo : undefined
    );
    const others = activeSessions.filter(s => s.session_id !== session_id);
    const collisions: Collision[] = [];

    for (const other of others) {
      // L1: Exact file match
      if (other.files_touched.includes(file_path)) {
        const collision = await this.store.createCollision({
          session_ids: [session_id, other.session_id],
          type: 'file',
          severity: 'critical',
          details: `Both sessions modifying ${file_path} in ${repo}`,
          detected_at: new Date().toISOString(),
        });
        collisions.push(collision);
        continue; // Don't also flag directory if we already flagged file
      }

      // L2: Same directory
      const dir = dirname(file_path);
      const otherDirs = other.files_touched.map(f => dirname(f));
      if (otherDirs.includes(dir)) {
        const collision = await this.store.createCollision({
          session_ids: [session_id, other.session_id],
          type: 'directory',
          severity: 'warning',
          details: `Both sessions working in ${dir}/ in ${repo}`,
          detected_at: new Date().toISOString(),
        });
        collisions.push(collision);
      }
    }

    return collisions;
  }

  /**
   * Check for semantic collisions when intent is captured.
   * Uses tiered approach: keywords → embeddings → LLM.
   */
  async checkIntentCollision(session_id: string, intent: string, repo: string): Promise<Collision[]> {
    if (!this.config.collision.semantic.keywords_enabled) return [];

    const activeSessions = await this.store.getActiveSessions(
      this.config.collision.scope === 'repo' ? repo : undefined
    );
    const others = activeSessions.filter(s => s.session_id !== session_id && s.intent);
    const collisions: Collision[] = [];

    for (const other of others) {
      // Tier 3a: Keyword overlap
      const score = keywordOverlap(intent, other.intent!);
      if (score < 0.3) continue; // No meaningful overlap

      // TODO: Tier 3b — embedding similarity (when enabled)
      // TODO: Tier 3c — LLM comparison (when enabled)

      if (score >= 0.3) {
        const collision = await this.store.createCollision({
          session_ids: [session_id, other.session_id],
          type: 'semantic',
          severity: 'info',
          details: `Possible overlap: "${truncate(intent, 60)}" vs "${truncate(other.intent!, 60)}" (score: ${score.toFixed(2)})`,
          detected_at: new Date().toISOString(),
        });
        collisions.push(collision);
      }
    }

    return collisions;
  }
}

// --- Keyword extraction and overlap (Tier 3a) ---

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either',
  'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than',
  'too', 'very', 'just', 'because', 'if', 'when', 'while', 'this',
  'that', 'these', 'those', 'i', 'me', 'my', 'we', 'our', 'you',
  'your', 'he', 'him', 'his', 'she', 'her', 'it', 'its', 'they',
  'them', 'their', 'what', 'which', 'who', 'whom', 'how', 'where',
  'fix', 'add', 'update', 'change', 'make', 'get', 'set', 'use',
  'implement', 'create', 'remove', 'delete', 'refactor', 'improve',
]);

function extractKeywords(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s-_]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
  );
}

function keywordOverlap(a: string, b: string): number {
  const ka = extractKeywords(a);
  const kb = extractKeywords(b);
  if (ka.size === 0 || kb.size === 0) return 0;
  const intersection = new Set([...ka].filter(k => kb.has(k)));
  // Jaccard similarity
  const union = new Set([...ka, ...kb]);
  return intersection.size / union.size;
}

function truncate(s: string, len: number): string {
  return s.length > len ? s.slice(0, len) + '...' : s;
}
```

**Step 2: Verify compilation**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add packages/backend/src/services/
git commit -m "feat: add collision detection engine — L1 file, L2 directory, L3a keywords"
```

---

### Task 6: API routes

**Files:**
- Create: `packages/backend/src/routes/sessions.ts`
- Create: `packages/backend/src/routes/signals.ts`
- Create: `packages/backend/src/routes/conflicts.ts`
- Create: `packages/backend/src/routes/history.ts`
- Modify: `packages/backend/src/server.ts` — wire routes + DB

**Step 1: Write sessions.ts**

```typescript
import type { FastifyInstance } from 'fastify';
import type { HiveStore } from '../db/store.js';
import type { CollisionEngine } from '../services/collision-engine.js';
import type {
  RegisterSessionRequest, RegisterSessionResponse,
  EndSessionRequest,
} from '@open-hive/shared';

export function sessionRoutes(app: FastifyInstance, store: HiveStore, engine: CollisionEngine) {
  app.post<{ Body: RegisterSessionRequest }>('/api/sessions/register', async (req) => {
    const { session_id, developer_email, developer_name, repo, project_path } = req.body;

    await store.createSession({
      session_id,
      developer_email,
      developer_name,
      repo,
      project_path,
      started_at: new Date().toISOString(),
      intent: null,
    });

    const active_collisions = await store.getActiveCollisions(session_id);
    const active_sessions_in_repo = (await store.getActiveSessions(repo))
      .filter(s => s.session_id !== session_id)
      .map(s => ({
        session_id: s.session_id,
        developer_name: s.developer_name,
        intent: s.intent,
        areas: s.areas,
      }));

    return {
      ok: true,
      active_collisions,
      active_sessions_in_repo,
    } satisfies RegisterSessionResponse;
  });

  app.post<{ Body: { session_id: string } }>('/api/sessions/heartbeat', async (req) => {
    await store.updateSessionActivity(req.body.session_id, {});
    return { ok: true };
  });

  app.post<{ Body: EndSessionRequest }>('/api/sessions/end', async (req) => {
    await store.endSession(req.body.session_id);
    return { ok: true };
  });

  app.get<{ Querystring: { repo?: string; team?: string } }>('/api/sessions/active', async (req) => {
    const sessions = await store.getActiveSessions(req.query.repo);
    return { sessions };
  });
}
```

**Step 2: Write signals.ts**

```typescript
import type { FastifyInstance } from 'fastify';
import { dirname } from 'node:path';
import type { HiveStore } from '../db/store.js';
import type { CollisionEngine } from '../services/collision-engine.js';
import type {
  IntentSignalRequest, IntentSignalResponse,
  ActivitySignalRequest, ActivitySignalResponse,
} from '@open-hive/shared';

export function signalRoutes(app: FastifyInstance, store: HiveStore, engine: CollisionEngine) {
  app.post<{ Body: IntentSignalRequest }>('/api/signals/intent', async (req) => {
    const { session_id, content, type } = req.body;
    const session = await store.getSession(session_id);
    if (!session) return { ok: false, collisions: [] };

    await store.createSignal({
      session_id,
      timestamp: new Date().toISOString(),
      type,
      content,
      file_path: null,
      semantic_area: null,
    });

    await store.updateSessionActivity(session_id, { intent: content });

    const collisions = await engine.checkIntentCollision(session_id, content, session.repo);
    return { ok: true, collisions } satisfies IntentSignalResponse;
  });

  app.post<{ Body: ActivitySignalRequest }>('/api/signals/activity', async (req) => {
    const { session_id, file_path, type } = req.body;
    const session = await store.getSession(session_id);
    if (!session) return { ok: false, collisions: [] };

    await store.createSignal({
      session_id,
      timestamp: new Date().toISOString(),
      type,
      content: file_path,
      file_path,
      semantic_area: dirname(file_path),
    });

    const updates: { files_touched?: string[]; areas?: string[] } = {
      areas: [dirname(file_path)],
    };
    if (type === 'file_modify') {
      updates.files_touched = [file_path];
    }
    await store.updateSessionActivity(session_id, updates);

    let collisions: typeof engine extends CollisionEngine ? Awaited<ReturnType<typeof engine.checkFileCollision>> : never = [];
    if (type === 'file_modify') {
      collisions = await engine.checkFileCollision(session_id, file_path, session.repo);
    }

    return { ok: true, collisions } satisfies ActivitySignalResponse;
  });
}
```

**Step 3: Write conflicts.ts**

```typescript
import type { FastifyInstance } from 'fastify';
import type { HiveStore } from '../db/store.js';
import type { CollisionEngine } from '../services/collision-engine.js';
import type { CheckConflictsRequest, ResolveCollisionRequest } from '@open-hive/shared';

export function conflictRoutes(app: FastifyInstance, store: HiveStore, engine: CollisionEngine) {
  app.get<{ Querystring: CheckConflictsRequest }>('/api/conflicts/check', async (req) => {
    const { session_id, file_path, repo } = req.query;
    const collisions = await engine.checkFileCollision(session_id, file_path, repo ?? '');
    const nearby = (await store.getActiveSessions(repo))
      .filter(s => s.session_id !== session_id)
      .map(s => ({
        session_id: s.session_id,
        developer_name: s.developer_name,
        intent: s.intent,
        files_touched: s.files_touched,
      }));
    return { has_conflicts: collisions.length > 0, collisions, nearby_sessions: nearby };
  });

  app.post<{ Body: ResolveCollisionRequest }>('/api/conflicts/resolve', async (req) => {
    await store.resolveCollision(req.body.collision_id, req.body.resolved_by);
    return { ok: true };
  });
}
```

**Step 4: Write history.ts**

```typescript
import type { FastifyInstance } from 'fastify';
import type { HiveStore } from '../db/store.js';
import type { HistoryRequest } from '@open-hive/shared';

export function historyRoutes(app: FastifyInstance, store: HiveStore) {
  app.get<{ Querystring: HistoryRequest }>('/api/history', async (req) => {
    const signals = await store.getRecentSignals({
      file_path: req.query.file_path,
      area: req.query.area,
      since: req.query.since,
      limit: req.query.limit,
    });
    return { signals };
  });
}
```

**Step 5: Update server.ts to wire everything together**

Replace the existing `packages/backend/src/server.ts` with:

```typescript
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadConfig } from './env.js';
import { createStore } from './db/index.js';
import { CollisionEngine } from './services/collision-engine.js';
import { sessionRoutes } from './routes/sessions.js';
import { signalRoutes } from './routes/signals.js';
import { conflictRoutes } from './routes/conflicts.js';
import { historyRoutes } from './routes/history.js';

const config = loadConfig();
const store = createStore(config);
const engine = new CollisionEngine(store, config);

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

app.get('/api/health', async () => ({ status: 'ok', version: '0.1.0' }));

sessionRoutes(app, store, engine);
signalRoutes(app, store, engine);
conflictRoutes(app, store, engine);
historyRoutes(app, store);

await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`Open Hive backend listening on port ${config.port}`);
```

**Step 6: Verify compilation**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: no errors

**Step 7: Commit**

```bash
git add packages/backend/src/
git commit -m "feat: add API routes — sessions, signals, conflicts, history"
```

---

### Task 7: Docker setup

**Files:**
- Create: `packages/backend/Dockerfile`
- Create: `docker-compose.yaml`

**Step 1: Write Dockerfile**

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/
RUN npm ci
COPY packages/shared/ packages/shared/
COPY packages/backend/ packages/backend/
RUN npx turbo run build --filter=@open-hive/backend

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/packages/backend/dist ./dist
COPY --from=build /app/packages/backend/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist ./node_modules/@open-hive/shared/dist
COPY --from=build /app/packages/shared/package.json ./node_modules/@open-hive/shared/
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "dist/server.js"]
```

**Step 2: Write docker-compose.yaml**

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

volumes:
  hive-data:
```

**Step 3: Commit**

```bash
git add packages/backend/Dockerfile docker-compose.yaml
git commit -m "feat: add Docker setup for backend"
```

---

## Phase 3: Claude Code Plugin

### Task 8: Scaffold plugin package

**Files:**
- Create: `packages/plugin/.claude-plugin/plugin.json`
- Create: `packages/plugin/package.json`
- Create: `packages/plugin/tsconfig.json`
- Create: `packages/plugin/src/client/hive-client.ts`
- Create: `packages/plugin/src/config/config.ts`

**Step 1: Create plugin.json**

```json
{
  "name": "open-hive",
  "version": "0.1.0",
  "description": "Developer collision detection — know what your team is working on before you collide",
  "author": {
    "name": "Chase Skibeness",
    "url": "https://github.com/cskibeness"
  },
  "repository": "https://github.com/cskibeness/open-hive",
  "license": "MIT",
  "keywords": ["coordination", "team", "collision-detection", "awareness"]
}
```

**Step 2: Create package.json**

```json
{
  "name": "@open-hive/plugin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@open-hive/shared": "workspace:*",
    "@mizunashi_mana/claude-code-hook-sdk": "^0"
  },
  "devDependencies": {
    "tsx": "^4"
  }
}
```

**Step 3: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"],
  "references": [
    { "path": "../shared" }
  ]
}
```

**Step 4: Write hive-client.ts — backend API client**

```typescript
import type {
  RegisterSessionRequest, RegisterSessionResponse,
  IntentSignalRequest, IntentSignalResponse,
  ActivitySignalRequest, ActivitySignalResponse,
  CheckConflictsResponse,
  EndSessionRequest,
  ListActiveResponse,
} from '@open-hive/shared';

export class HiveClient {
  constructor(private baseUrl: string) {}

  async registerSession(req: RegisterSessionRequest): Promise<RegisterSessionResponse | null> {
    return this.post('/api/sessions/register', req);
  }

  async endSession(req: EndSessionRequest): Promise<void> {
    await this.post('/api/sessions/end', req);
  }

  async sendIntent(req: IntentSignalRequest): Promise<IntentSignalResponse | null> {
    return this.post('/api/signals/intent', req);
  }

  async sendActivity(req: ActivitySignalRequest): Promise<ActivitySignalResponse | null> {
    return this.post('/api/signals/activity', req);
  }

  async checkConflicts(session_id: string, file_path: string, repo?: string): Promise<CheckConflictsResponse | null> {
    const params = new URLSearchParams({ session_id, file_path });
    if (repo) params.set('repo', repo);
    return this.get(`/api/conflicts/check?${params}`);
  }

  async listActive(repo?: string): Promise<ListActiveResponse | null> {
    const params = repo ? `?repo=${encodeURIComponent(repo)}` : '';
    return this.get(`/api/sessions/active${params}`);
  }

  async heartbeat(session_id: string): Promise<void> {
    await this.post('/api/sessions/heartbeat', { session_id });
  }

  private async post<T>(path: string, body: unknown): Promise<T | null> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return null;
      return res.json() as Promise<T>;
    } catch {
      return null; // Backend unreachable — never block the developer
    }
  }

  private async get<T>(path: string): Promise<T | null> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return null;
      return res.json() as Promise<T>;
    } catch {
      return null;
    }
  }
}
```

**Step 5: Write config.ts — read ~/.open-hive.yaml**

```typescript
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import type { HiveClientConfig } from '@open-hive/shared';

export function loadClientConfig(): HiveClientConfig | null {
  const configPath = join(process.env.HOME ?? process.env.USERPROFILE ?? '', '.open-hive.yaml');
  if (!existsSync(configPath)) return null;

  const raw = readFileSync(configPath, 'utf-8');
  // Simple YAML parsing for flat config (avoid adding a YAML dep)
  const lines = raw.split('\n');
  const config: Record<string, string> = {};
  let currentSection = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed) continue;
    if (!line.startsWith(' ') && trimmed.endsWith(':')) {
      currentSection = trimmed.slice(0, -1);
      continue;
    }
    const match = trimmed.match(/^(\w+):\s*(.+)$/);
    if (match) {
      const key = currentSection ? `${currentSection}.${match[1]}` : match[1];
      config[key] = match[2].replace(/^["']|["']$/g, '');
    }
  }

  return {
    backend_url: config['backend_url'] ?? '',
    identity: {
      email: config['identity.email'] ?? getGitEmail(),
      display_name: config['identity.display_name'] ?? config['identity.email'] ?? 'Unknown',
    },
    team: config['team'],
    notifications: {
      inline: config['notifications.inline'] !== 'false',
      webhook_url: config['notifications.webhook_url'] || undefined,
    },
  };
}

function getGitEmail(): string {
  try {
    return execSync('git config user.email', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown@localhost';
  }
}
```

**Step 6: Install dependencies and verify**

Run: `npm install && cd packages/plugin && npx tsc --noEmit`
Expected: no errors

**Step 7: Commit**

```bash
git add packages/plugin/
git commit -m "feat: scaffold plugin package with API client and config loader"
```

---

### Task 9: Plugin hooks

**Files:**
- Create: `packages/plugin/hooks/hooks.json`
- Create: `packages/plugin/src/hooks/handler.ts`

**Step 1: Write handler.ts — the main hook handler**

```typescript
import { runHook } from '@mizunashi_mana/claude-code-hook-sdk';
import { HiveClient } from '../client/hive-client.js';
import { loadClientConfig } from '../config/config.js';
import { dirname, basename } from 'node:path';
import type { Collision } from '@open-hive/shared';

const config = loadClientConfig();
const client = config ? new HiveClient(config.backend_url) : null;

// Derive session_id from Claude's session
function getSessionId(input: { session_id?: string }): string {
  return input.session_id ?? 'unknown';
}

// Derive repo name from cwd
function getRepo(input: { cwd?: string }): string {
  return basename(input.cwd ?? process.cwd());
}

function formatCollisions(collisions: Collision[]): string {
  if (collisions.length === 0) return '';
  const lines = collisions.map(c => {
    const icon = c.severity === 'critical' ? '!!!' : c.severity === 'warning' ? '!!' : '!';
    return `[Open Hive ${icon}] ${c.details}`;
  });
  return lines.join('\n');
}

void runHook({
  // SessionStart: register with backend
  async sessionStartHandler(input: any) {
    if (!client || !config) return {};
    const session_id = getSessionId(input);
    const repo = getRepo(input);

    const result = await client.registerSession({
      session_id,
      developer_email: config.identity.email,
      developer_name: config.identity.display_name,
      repo,
      project_path: input.cwd ?? process.cwd(),
    });

    if (!result) return {};

    const messages: string[] = [];
    if (result.active_sessions_in_repo.length > 0) {
      messages.push('Open Hive: Active sessions in this repo:');
      for (const s of result.active_sessions_in_repo) {
        messages.push(`  - ${s.developer_name}: ${s.intent ?? 'no intent declared'} (areas: ${s.areas.join(', ') || 'none yet'})`);
      }
    }
    if (result.active_collisions.length > 0) {
      messages.push(formatCollisions(result.active_collisions));
    }

    return messages.length > 0
      ? { systemMessage: messages.join('\n') }
      : {};
  },

  // UserPromptSubmit: capture intent
  async userPromptSubmitHandler(input: any) {
    if (!client) return {};
    const session_id = getSessionId(input);
    const prompt = input.prompt ?? input.user_prompt ?? '';
    if (!prompt) return {};

    const result = await client.sendIntent({
      session_id,
      content: prompt,
      type: 'prompt',
    });

    if (!result || result.collisions.length === 0) return {};
    return { systemMessage: formatCollisions(result.collisions) };
  },

  // PreToolUse: check for file conflicts before writes
  async preToolUseHandler(input: any) {
    if (!client) return {};
    const toolName = input.tool_name ?? '';
    if (!['Write', 'Edit'].includes(toolName)) return {};

    const filePath = input.tool_input?.file_path;
    if (!filePath) return {};

    const session_id = getSessionId(input);
    const repo = getRepo(input);

    const result = await client.checkConflicts(session_id, filePath, repo);
    if (!result || !result.has_conflicts) return {};

    return {
      systemMessage: formatCollisions(result.collisions),
      // Don't block — just warn
    };
  },

  // PostToolUse: record file activity
  async postToolUseHandler(input: any) {
    if (!client) return {};
    const toolName = input.tool_name ?? '';
    if (!['Write', 'Edit'].includes(toolName)) return {};

    const filePath = input.tool_input?.file_path;
    if (!filePath) return {};

    const session_id = getSessionId(input);
    await client.sendActivity({
      session_id,
      file_path: filePath,
      type: 'file_modify',
    });

    return {};
  },

  // Stop: no-op for now (could broadcast "session pausing")
  async stopHandler() {
    return {};
  },

  // PreCompact: inject collision state for preservation
  async preCompactHandler(input: any) {
    if (!client) return {};
    const session_id = getSessionId(input);
    const collisions = await client.checkConflicts(session_id, '', getRepo(input));
    if (!collisions || !collisions.has_conflicts) return {};
    return {
      systemMessage: `Open Hive collision state (preserve across compaction):\n${formatCollisions(collisions.collisions)}`,
    };
  },
});
```

**Step 2: Write hooks.json**

```json
{
  "description": "Open Hive — developer collision detection hooks",
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "npx tsx ${CLAUDE_PLUGIN_ROOT}/src/hooks/handler.ts",
            "timeout": 5
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "npx tsx ${CLAUDE_PLUGIN_ROOT}/src/hooks/handler.ts",
            "timeout": 5
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "npx tsx ${CLAUDE_PLUGIN_ROOT}/src/hooks/handler.ts",
            "timeout": 3
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "npx tsx ${CLAUDE_PLUGIN_ROOT}/src/hooks/handler.ts",
            "timeout": 3
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "npx tsx ${CLAUDE_PLUGIN_ROOT}/src/hooks/handler.ts",
            "timeout": 3
          }
        ]
      }
    ]
  }
}
```

**Step 3: Verify**

Run: `cd packages/plugin && npx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add packages/plugin/hooks/ packages/plugin/src/hooks/
git commit -m "feat: add plugin hooks — session tracking, intent capture, collision check"
```

---

### Task 10: Plugin commands

**Files:**
- Create: `packages/plugin/commands/setup.md`
- Create: `packages/plugin/commands/status.md`
- Create: `packages/plugin/commands/who.md`
- Create: `packages/plugin/commands/history.md`

**Step 1: Write setup.md**

```markdown
---
name: setup
description: Configure Open Hive for this developer — set backend URL, identity, and team
allowed-tools: ["Write", "Bash", "AskUserQuestion"]
---

Set up Open Hive for the current developer.

1. Ask the user for the Open Hive backend URL (e.g., https://hive.internal.company.com)
2. Auto-detect git email via `git config user.email`
3. Ask for display name (default to git name via `git config user.name`)
4. Optionally ask for team name
5. Write the config to `~/.open-hive.yaml`:

```yaml
backend_url: <url>
identity:
  email: <git-email>
  display_name: <name>
team: <team-or-empty>
notifications:
  inline: true
  webhook_url:
```

6. Test the connection by calling `<backend_url>/api/health`
7. Confirm setup is complete
```

**Step 2: Write status.md**

```markdown
---
name: status
description: Show Open Hive status — active sessions, collisions, your current activity
allowed-tools: ["Bash"]
---

Show the current Open Hive status by querying the backend.

1. Read `~/.open-hive.yaml` to get the backend URL
2. Call `GET <backend_url>/api/sessions/active` to get all active sessions
3. Call `GET <backend_url>/api/conflicts/check?session_id=<current>` for active collisions
4. Present a summary:
   - How many developers are active
   - What each is working on (intent + areas)
   - Any active collisions with severity
   - Your own session state
```

**Step 3: Write who.md**

```markdown
---
name: who
description: Show who is working on what right now across the organization
allowed-tools: ["Bash"]
---

Query Open Hive to show who is actively working and what they're doing.

1. Read `~/.open-hive.yaml` to get the backend URL
2. Call `GET <backend_url>/api/sessions/active` to get all active sessions
3. Present each active session:
   - Developer name
   - Repository
   - Intent (what they said they're working on)
   - Areas (directories they've touched)
   - Duration (time since session started)
4. Highlight any collisions between active sessions
```

**Step 4: Write history.md**

```markdown
---
name: history
description: Show recent Open Hive activity for a file, directory, or repo
allowed-tools: ["Bash"]
---

Query Open Hive for recent activity history.

If the user specifies a file or directory, filter to that path.
Otherwise, show recent activity for the current repo.

1. Read `~/.open-hive.yaml` to get the backend URL
2. Call `GET <backend_url>/api/history?repo=<current>&limit=20`
3. Present recent signals grouped by developer:
   - What they worked on
   - Which files they modified
   - When (relative time)
```

**Step 5: Commit**

```bash
git add packages/plugin/commands/
git commit -m "feat: add plugin commands — /hive setup, status, who, history"
```

---

### Task 11: Plugin skill — collision-awareness

**Files:**
- Create: `packages/plugin/skills/collision-awareness/SKILL.md`

**Step 1: Write SKILL.md**

```markdown
---
name: collision-awareness
description: >
  Use when Open Hive injects collision warnings via systemMessage,
  when you detect that another developer may be working in the same area,
  or when the user asks about team activity or potential conflicts.
---

# Collision Awareness

You have Open Hive collision detection data available. Here's how to use it:

## Interpreting Severity

- **[Open Hive !!!]** — CRITICAL: Same file being edited by another developer. Mention this immediately and prominently. Suggest the user coordinate before continuing.
- **[Open Hive !!]** — WARNING: Same directory/area being worked in. Mention it naturally but don't alarm. Suggest awareness.
- **[Open Hive !]** — INFO: Semantic overlap detected. Mention briefly — "FYI, Sarah is working on something similar in another repo."

## When to Proactively Check

Before making significant changes (editing multiple files, refactoring, creating new modules), use the `hive_check_conflicts` MCP tool if available to verify no one else is working in the same area.

## How to Present Collisions

Be natural and helpful, not alarming:
- CRITICAL: "Heads up — [name] is also editing this file right now. You might want to sync with them before continuing."
- WARNING: "I see [name] is also working in the auth/ directory. Their intent: '[intent]'. Worth being aware of."
- INFO: "Interesting — [name] in [repo] is working on something related: '[intent]'."

## Resolving Collisions

If the user says they've talked to the other developer and it's fine, use `hive_resolve_collision` to clear the alert.

## If Backend Is Unavailable

If Open Hive hooks return no data or errors, don't mention it. The system is designed to be silent when the backend is down.
```

**Step 2: Commit**

```bash
git add packages/plugin/skills/
git commit -m "feat: add collision-awareness skill"
```

---

### Task 12: Backend schema migration on startup

**Files:**
- Modify: `packages/backend/src/db/sqlite.ts` — add auto-migration

**Step 1: Update sqlite.ts to auto-create tables**

Add table creation SQL that runs on startup. Drizzle can push schema changes:

```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './schema.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function createSQLiteDB(dbPath: string) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });

  // Auto-create tables on startup
  sqlite.exec(`
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
      semantic_area TEXT
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
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
    CREATE INDEX IF NOT EXISTS idx_sessions_repo ON sessions(repo);
    CREATE INDEX IF NOT EXISTS idx_signals_session ON signals(session_id);
    CREATE INDEX IF NOT EXISTS idx_signals_file ON signals(file_path);
    CREATE INDEX IF NOT EXISTS idx_collisions_resolved ON collisions(resolved);
  `);

  return db;
}
```

**Step 2: Commit**

```bash
git add packages/backend/src/db/sqlite.ts
git commit -m "feat: add auto-migration for SQLite tables on startup"
```

---

### Task 13: End-to-end smoke test

**Files:**
- Create: `scripts/smoke-test.sh`

**Step 1: Write smoke test script**

```bash
#!/bin/bash
set -e

BACKEND_URL="http://localhost:3000"

echo "=== Open Hive Smoke Test ==="

# Health check
echo "1. Health check..."
curl -sf "$BACKEND_URL/api/health" | grep -q '"ok"' || curl -sf "$BACKEND_URL/api/health" | grep -q '"status"'
echo "   PASS"

# Register two sessions
echo "2. Register session A (Chase)..."
curl -sf -X POST "$BACKEND_URL/api/sessions/register" \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"sess-a","developer_email":"chase@test.com","developer_name":"Chase","repo":"tapcheck-hr","project_path":"/code/tapcheck-hr"}'
echo "   PASS"

echo "3. Register session B (Sarah)..."
curl -sf -X POST "$BACKEND_URL/api/sessions/register" \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"sess-b","developer_email":"sarah@test.com","developer_name":"Sarah","repo":"tapcheck-hr","project_path":"/code/tapcheck-hr"}'
echo "   PASS"

# Send intent
echo "4. Chase declares intent..."
curl -sf -X POST "$BACKEND_URL/api/signals/intent" \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"sess-a","content":"fix auth token refresh bug","type":"prompt"}'
echo "   PASS"

# Chase modifies a file
echo "5. Chase modifies auth/token-service.ts..."
ACTIVITY_RESULT=$(curl -sf -X POST "$BACKEND_URL/api/signals/activity" \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"sess-a","file_path":"auth/token-service.ts","type":"file_modify"}')
echo "   PASS"

# Sarah tries to modify the same file -> should get collision
echo "6. Sarah modifies auth/token-service.ts (should detect collision)..."
COLLISION_RESULT=$(curl -sf -X POST "$BACKEND_URL/api/signals/activity" \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"sess-b","file_path":"auth/token-service.ts","type":"file_modify"}')
echo "$COLLISION_RESULT" | grep -q '"critical"'
echo "   PASS — COLLISION DETECTED"

# List active sessions
echo "7. List active sessions..."
curl -sf "$BACKEND_URL/api/sessions/active" | grep -q '"Chase"'
echo "   PASS"

# End sessions
echo "8. Cleanup..."
curl -sf -X POST "$BACKEND_URL/api/sessions/end" -H 'Content-Type: application/json' -d '{"session_id":"sess-a"}'
curl -sf -X POST "$BACKEND_URL/api/sessions/end" -H 'Content-Type: application/json' -d '{"session_id":"sess-b"}'
echo "   PASS"

echo ""
echo "=== ALL TESTS PASSED ==="
```

**Step 2: Make executable and commit**

```bash
chmod +x scripts/smoke-test.sh
git add scripts/
git commit -m "test: add end-to-end smoke test script"
```

**Step 3: Run the smoke test**

Start the backend: `cd packages/backend && npx tsx src/server.ts &`
Run: `bash scripts/smoke-test.sh`
Expected: ALL TESTS PASSED
Kill the backend process.

---

## Phase 4: Polish (deferred)

The following are captured for future tasks but NOT part of the MVP build:

- **Task 14:** Web dashboard (basic HTML showing active sessions + collisions)
- **Task 15:** MCP server implementation (expose hive_* tools to Claude)
- **Task 16:** Webhook notification dispatcher (Slack/Teams integration)
- **Task 17:** Semantic tier 3b — embedding similarity
- **Task 18:** Semantic tier 3c — LLM comparison
- **Task 19:** Git provider OAuth integration
- **Task 20:** Plugin `/hive setup` interactive wizard implementation
- **Task 21:** Session heartbeat + idle timeout logic
- **Task 22:** Postgres adapter implementation

---

## Summary

| Phase | Tasks | What it builds |
|-------|-------|---------------|
| 1: Scaffold | 1-2 | Monorepo + shared types |
| 2: Backend | 3-7 | API server, DB, collision engine, Docker |
| 3: Plugin | 8-12 | Hooks, commands, skill, config |
| Smoke test | 13 | End-to-end validation |
| 4: Polish | 14-22 | Dashboard, MCP, webhooks, semantic tiers |

**MVP = Phases 1-3 + smoke test.** This gives a working system: backend detects collisions, plugin hooks capture activity and display warnings inline in Claude Code.

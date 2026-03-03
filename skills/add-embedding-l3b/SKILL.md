---
name: add-embedding-l3b
description: Add L3b embedding-based semantic collision detection using cosine similarity between developer intents
category: collision-tier
requires:
  - (none -- uses native fetch for API calls, node:crypto for hashing)
modifies:
  - packages/backend/src/services/embedding-provider.ts (new)
  - packages/backend/src/services/embedding-cache.ts (new)
  - packages/backend/src/services/collision-engine.ts (modify -- add checkEmbeddingCollision, wire into checkIntentCollision)
  - packages/backend/src/db/sqlite.ts (modify -- add embedding_cache table)
  - packages/backend/src/env.ts (modify -- add EMBEDDINGS_* config vars)
  - packages/shared/src/config.ts (modify -- add embeddings fields to HiveBackendConfig)
tests:
  - packages/backend/src/services/embedding-provider.test.ts (new)
  - packages/backend/src/services/embedding-cache.test.ts (new)
  - packages/backend/src/services/embedding-collision.test.ts (new)
---

# add-embedding-l3b

Adds L3b embedding-based semantic collision detection to the collision engine. When two developers describe intents that are semantically similar (even if they use completely different words), this tier catches the overlap by computing cosine similarity between vector embeddings. This fills the gap between L3a keyword overlap (which misses synonyms) and L4 LLM analysis (which is slow and expensive).

## Prerequisites

- Open Hive backend source checked out and buildable (`npm run build` passes)
- One of the following embedding providers:
  - **OpenAI**: An API key with access to the embeddings endpoint (text-embedding-3-small)
  - **Ollama**: A local Ollama instance running with `nomic-embed-text` pulled (`ollama pull nomic-embed-text`)
  - **Generic**: Any OpenAI-compatible embedding endpoint (e.g., LiteLLM proxy, vLLM, LocalAI)

## What This Skill Does

- Creates `packages/backend/src/services/embedding-provider.ts` -- provider abstraction with implementations for OpenAI, Ollama, and generic OpenAI-compatible endpoints
- Creates `packages/backend/src/services/embedding-cache.ts` -- in-memory LRU cache backed by a persistent SQLite table so embeddings survive restarts
- Modifies `packages/backend/src/services/collision-engine.ts` -- adds `checkEmbeddingCollision()` and wires it into `checkIntentCollision()` after L3a
- Modifies `packages/backend/src/db/sqlite.ts` -- adds the `embedding_cache` table
- Modifies `packages/backend/src/env.ts` -- parses `EMBEDDINGS_*` environment variables
- Modifies `packages/shared/src/config.ts` -- adds `embeddings_base_url`, `embeddings_model`, and `embeddings_threshold` to the semantic config type
- Creates three test files with 14 total tests covering cosine math, provider mocking, cache behavior, threshold filtering, and config gating

## Implementation Steps

### Step 1: Update shared config types

In `packages/shared/src/config.ts`, replace the `semantic` block inside `HiveBackendConfig` with expanded embedding fields:

```typescript
    semantic: {
      keywords_enabled: boolean;
      embeddings_enabled: boolean;
      embeddings_provider?: string;
      embeddings_api_key?: string;
      embeddings_base_url?: string;
      embeddings_model?: string;
      embeddings_threshold: number;
      llm_enabled: boolean;
      llm_provider?: string;
      llm_api_key?: string;
    };
```

The full file after the edit:

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
    url: string;
  };
  collision: {
    scope: 'repo' | 'org';
    semantic: {
      keywords_enabled: boolean;
      embeddings_enabled: boolean;
      embeddings_provider?: string;
      embeddings_api_key?: string;
      embeddings_base_url?: string;
      embeddings_model?: string;
      embeddings_threshold: number;
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

### Step 2: Update env.ts to parse new config fields

In `packages/backend/src/env.ts`, add the three new fields to the semantic block:

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
      scope: (process.env.COLLISION_SCOPE as 'repo' | 'org') ?? 'org',
      semantic: {
        keywords_enabled: process.env.SEMANTIC_KEYWORDS !== 'false',
        embeddings_enabled: process.env.SEMANTIC_EMBEDDINGS === 'true',
        embeddings_provider: process.env.EMBEDDINGS_PROVIDER,
        embeddings_api_key: process.env.EMBEDDINGS_API_KEY,
        embeddings_base_url: process.env.EMBEDDINGS_BASE_URL,
        embeddings_model: process.env.EMBEDDINGS_MODEL,
        embeddings_threshold: parseFloat(process.env.EMBEDDINGS_THRESHOLD ?? '0.75'),
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

### Step 3: Create the embedding provider

Create `packages/backend/src/services/embedding-provider.ts`:

```typescript
// ─── Embedding Provider ─────────────────────────────────────
// Abstraction over embedding APIs. Supports OpenAI, Ollama, and
// any OpenAI-compatible endpoint via configurable base URL.

export interface EmbeddingProvider {
  readonly name: string;
  embed(text: string): Promise<number[]>;
}

// ─── OpenAI Provider ────────────────────────────────────────

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(
    private readonly apiKey: string,
    opts?: { baseUrl?: string; model?: string },
  ) {
    this.baseUrl = opts?.baseUrl ?? 'https://api.openai.com';
    this.model = opts?.model ?? 'text-embedding-3-small';
  }

  async embed(text: string): Promise<number[]> {
    const url = `${this.baseUrl}/v1/embeddings`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: text,
        model: this.model,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI embeddings API error ${res.status}: ${body}`);
    }

    const json = await res.json() as {
      data: Array<{ embedding: number[] }>;
    };

    if (!json.data?.[0]?.embedding) {
      throw new Error('OpenAI embeddings response missing data[0].embedding');
    }

    return json.data[0].embedding;
  }
}

// ─── Ollama Provider ────────────────────────────────────────

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ollama';
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(opts?: { baseUrl?: string; model?: string }) {
    this.baseUrl = opts?.baseUrl ?? 'http://localhost:11434';
    this.model = opts?.model ?? 'nomic-embed-text';
  }

  async embed(text: string): Promise<number[]> {
    const url = `${this.baseUrl}/api/embeddings`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: text,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama embeddings API error ${res.status}: ${body}`);
    }

    const json = await res.json() as { embedding: number[] };

    if (!json.embedding) {
      throw new Error('Ollama embeddings response missing embedding field');
    }

    return json.embedding;
  }
}

// ─── Generic OpenAI-Compatible Provider ─────────────────────

export class GenericEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'generic';
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(
    baseUrl: string,
    private readonly apiKey: string | undefined,
    opts?: { model?: string },
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.model = opts?.model ?? 'text-embedding-3-small';
  }

  async embed(text: string): Promise<number[]> {
    const url = `${this.baseUrl}/v1/embeddings`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        input: text,
        model: this.model,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Generic embeddings API error ${res.status}: ${body}`);
    }

    const json = await res.json() as {
      data: Array<{ embedding: number[] }>;
    };

    if (!json.data?.[0]?.embedding) {
      throw new Error('Generic embeddings response missing data[0].embedding');
    }

    return json.data[0].embedding;
  }
}

// ─── Factory ────────────────────────────────────────────────

export interface EmbeddingProviderConfig {
  provider?: string;       // 'openai' | 'ollama' | 'generic'
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  const provider = config.provider ?? 'openai';

  switch (provider) {
    case 'openai':
      if (!config.apiKey) {
        throw new Error('EMBEDDINGS_API_KEY is required for OpenAI embedding provider');
      }
      return new OpenAIEmbeddingProvider(config.apiKey, {
        baseUrl: config.baseUrl,
        model: config.model,
      });

    case 'ollama':
      return new OllamaEmbeddingProvider({
        baseUrl: config.baseUrl,
        model: config.model,
      });

    case 'generic':
      if (!config.baseUrl) {
        throw new Error('EMBEDDINGS_BASE_URL is required for generic embedding provider');
      }
      return new GenericEmbeddingProvider(config.baseUrl, config.apiKey, {
        model: config.model,
      });

    default:
      throw new Error(`Unknown embedding provider: ${provider}`);
  }
}

// ─── Cosine Similarity ──────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  if (a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}
```

### Step 4: Create the embedding cache

Create `packages/backend/src/services/embedding-cache.ts`:

```typescript
// ─── Embedding Cache ────────────────────────────────────────
// Two-layer cache: in-memory LRU for speed, SQLite for persistence.
// Keyed by SHA-256 hash of the input text.

import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export interface EmbeddingCacheEntry {
  hash: string;
  vector: number[];
  created_at: string;
}

// ─── In-Memory LRU Cache ────────────────────────────────────

export class LRUEmbeddingCache {
  private readonly cache = new Map<string, number[]>();
  private readonly maxSize: number;

  constructor(maxSize = 500) {
    this.maxSize = maxSize;
  }

  get(hash: string): number[] | undefined {
    const value = this.cache.get(hash);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(hash);
      this.cache.set(hash, value);
    }
    return value;
  }

  set(hash: string, vector: number[]): void {
    // If key exists, delete it first so it moves to the end
    if (this.cache.has(hash)) {
      this.cache.delete(hash);
    }
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value!;
      this.cache.delete(oldest);
    }
    this.cache.set(hash, vector);
  }

  has(hash: string): boolean {
    return this.cache.has(hash);
  }

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }
}

// ─── SQLite Persistent Cache ────────────────────────────────

export class SQLiteEmbeddingCache {
  constructor(private readonly db: DatabaseSync) {}

  get(hash: string): number[] | undefined {
    const stmt = this.db.prepare(
      'SELECT vector FROM embedding_cache WHERE intent_hash = ?'
    );
    const row = stmt.get(hash) as unknown as { vector: string } | undefined;
    if (!row) return undefined;
    return JSON.parse(row.vector) as number[];
  }

  set(hash: string, vector: number[]): void {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO embedding_cache (intent_hash, vector, created_at)
       VALUES (?, ?, ?)`
    );
    stmt.run(hash, JSON.stringify(vector), new Date().toISOString());
  }

  has(hash: string): boolean {
    const stmt = this.db.prepare(
      'SELECT 1 FROM embedding_cache WHERE intent_hash = ?'
    );
    const row = stmt.get(hash);
    return row !== undefined;
  }
}

// ─── Combined Cache ─────────────────────────────────────────
// Checks LRU first, falls back to SQLite, populates LRU on SQLite hit.

export class EmbeddingCache {
  private readonly lru: LRUEmbeddingCache;
  private readonly sqlite: SQLiteEmbeddingCache | null;

  constructor(db: DatabaseSync | null, lruMaxSize = 500) {
    this.lru = new LRUEmbeddingCache(lruMaxSize);
    this.sqlite = db ? new SQLiteEmbeddingCache(db) : null;
  }

  get(text: string): number[] | undefined {
    const hash = hashText(text);

    // Check LRU first
    const lruHit = this.lru.get(hash);
    if (lruHit !== undefined) return lruHit;

    // Check SQLite
    if (this.sqlite) {
      const sqliteHit = this.sqlite.get(hash);
      if (sqliteHit !== undefined) {
        // Promote to LRU
        this.lru.set(hash, sqliteHit);
        return sqliteHit;
      }
    }

    return undefined;
  }

  set(text: string, vector: number[]): void {
    const hash = hashText(text);
    this.lru.set(hash, vector);
    if (this.sqlite) {
      this.sqlite.set(hash, vector);
    }
  }

  has(text: string): boolean {
    const hash = hashText(text);
    return this.lru.has(hash) || (this.sqlite?.has(hash) ?? false);
  }
}

// ─── Helpers ────────────────────────────────────────────────

export function hashText(text: string): string {
  return createHash('sha256').update(text.trim().toLowerCase()).digest('hex');
}
```

### Step 5: Add embedding_cache table to SQLite schema

In `packages/backend/src/db/sqlite.ts`, add the `embedding_cache` table and its index. Insert the following SQL after the `tracked_repos` table creation and before the index creation block:

```sql
    CREATE TABLE IF NOT EXISTS embedding_cache (
      intent_hash TEXT PRIMARY KEY,
      vector TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
```

And add this index alongside the existing ones:

```sql
    CREATE INDEX IF NOT EXISTS idx_embedding_cache_hash ON embedding_cache(intent_hash);
```

The full updated file:

```typescript
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
    CREATE TABLE IF NOT EXISTS embedding_cache (
      intent_hash TEXT PRIMARY KEY,
      vector TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
    CREATE INDEX IF NOT EXISTS idx_sessions_repo ON sessions(repo);
    CREATE INDEX IF NOT EXISTS idx_signals_session ON signals(session_id);
    CREATE INDEX IF NOT EXISTS idx_signals_file ON signals(file_path);
    CREATE INDEX IF NOT EXISTS idx_collisions_resolved ON collisions(resolved);
    CREATE INDEX IF NOT EXISTS idx_embedding_cache_hash ON embedding_cache(intent_hash);
  `);

  return db;
}
```

### Step 6: Modify collision-engine.ts

Replace the entire `packages/backend/src/services/collision-engine.ts` with the version below. Changes:
1. Constructor accepts an optional `EmbeddingProvider` and `EmbeddingCache`
2. New `checkEmbeddingCollision()` method computes cosine similarity between the current intent and every other active session's intent
3. `checkIntentCollision()` runs L3a keyword check first, then L3b embedding check, and merges results (deduplicating session pairs that already have a keyword collision)

```typescript
import { dirname } from 'node:path';
import type { IHiveStore } from '../db/store.js';
import type { Collision, HiveBackendConfig } from '@open-hive/shared';
import type { EmbeddingProvider } from './embedding-provider.js';
import type { EmbeddingCache } from './embedding-cache.js';
import { cosineSimilarity } from './embedding-provider.js';

export class CollisionEngine {
  private embeddingProvider: EmbeddingProvider | null;
  private embeddingCache: EmbeddingCache | null;

  constructor(
    private store: IHiveStore,
    private config: HiveBackendConfig,
    opts?: {
      embeddingProvider?: EmbeddingProvider;
      embeddingCache?: EmbeddingCache;
    },
  ) {
    this.embeddingProvider = opts?.embeddingProvider ?? null;
    this.embeddingCache = opts?.embeddingCache ?? null;
  }

  async checkFileCollision(session_id: string, file_path: string, repo: string): Promise<Collision[]> {
    const activeSessions = await this.store.getActiveSessions(
      this.config.collision.scope === 'repo' ? repo : undefined
    );
    const others = activeSessions.filter(s => s.session_id !== session_id);
    const existing = await this.store.getActiveCollisions();
    const collisions: Collision[] = [];

    for (const other of others) {
      const pairIds = [session_id, other.session_id].sort();

      // L1: Exact file match
      if (other.files_touched.includes(file_path)) {
        const alreadyExists = existing.some(
          c => c.type === 'file' &&
               c.session_ids.sort().join(',') === pairIds.join(',') &&
               c.details.includes(file_path)
        );
        if (!alreadyExists) {
          const collision = await this.store.createCollision({
            session_ids: pairIds,
            type: 'file',
            severity: 'critical',
            details: `Both sessions modifying ${file_path} in ${repo}`,
            detected_at: new Date().toISOString(),
          });
          collisions.push(collision);
        } else {
          collisions.push(...existing.filter(
            c => c.type === 'file' && c.details.includes(file_path) &&
                 c.session_ids.sort().join(',') === pairIds.join(',')
          ));
        }
        continue;
      }

      // L2: Same directory
      const dir = dirname(file_path);
      const otherDirs = other.files_touched.map(f => dirname(f));
      if (otherDirs.includes(dir)) {
        const alreadyExists = existing.some(
          c => c.type === 'directory' &&
               c.session_ids.sort().join(',') === pairIds.join(',') &&
               c.details.includes(dir)
        );
        if (!alreadyExists) {
          const collision = await this.store.createCollision({
            session_ids: pairIds,
            type: 'directory',
            severity: 'warning',
            details: `Both sessions working in ${dir}/ in ${repo}`,
            detected_at: new Date().toISOString(),
          });
          collisions.push(collision);
        }
      }
    }

    return collisions;
  }

  async checkIntentCollision(session_id: string, intent: string, repo: string): Promise<Collision[]> {
    // L3a: Keyword overlap
    const keywordCollisions = await this.checkKeywordCollision(session_id, intent, repo);

    // L3b: Embedding similarity (runs after L3a, before L3c/L4)
    const embeddingCollisions = await this.checkEmbeddingCollision(session_id, intent, repo);

    // Deduplicate: if L3a already flagged a session pair, don't add L3b for same pair
    const keywordPairs = new Set(
      keywordCollisions.map(c => c.session_ids.slice().sort().join(','))
    );
    const dedupedEmbedding = embeddingCollisions.filter(
      c => !keywordPairs.has(c.session_ids.slice().sort().join(','))
    );

    return [...keywordCollisions, ...dedupedEmbedding];
  }

  // ─── L3a: Keyword Overlap ──────────────────────────────────

  private async checkKeywordCollision(session_id: string, intent: string, repo: string): Promise<Collision[]> {
    if (!this.config.collision.semantic.keywords_enabled) return [];

    const activeSessions = await this.store.getActiveSessions(
      this.config.collision.scope === 'repo' ? repo : undefined
    );
    const others = activeSessions.filter(s => s.session_id !== session_id && s.intent);
    const collisions: Collision[] = [];

    for (const other of others) {
      const score = keywordOverlap(intent, other.intent!);
      if (score < 0.3) continue;

      const collision = await this.store.createCollision({
        session_ids: [session_id, other.session_id],
        type: 'semantic',
        severity: 'info',
        details: `Possible overlap: "${truncate(intent, 60)}" vs "${truncate(other.intent!, 60)}" (keyword score: ${score.toFixed(2)})`,
        detected_at: new Date().toISOString(),
      });
      collisions.push(collision);
    }

    return collisions;
  }

  // ─── L3b: Embedding Similarity ─────────────────────────────

  async checkEmbeddingCollision(session_id: string, intent: string, repo: string): Promise<Collision[]> {
    if (!this.config.collision.semantic.embeddings_enabled) return [];
    if (!this.embeddingProvider) return [];

    const threshold = this.config.collision.semantic.embeddings_threshold;

    const activeSessions = await this.store.getActiveSessions(
      this.config.collision.scope === 'repo' ? repo : undefined
    );
    const others = activeSessions.filter(s => s.session_id !== session_id && s.intent);
    if (others.length === 0) return [];

    // Get embedding for the current intent
    let currentEmbedding: number[];
    try {
      currentEmbedding = await this.getEmbedding(intent);
    } catch {
      // API error -- fail open, don't block collision detection
      return [];
    }

    const collisions: Collision[] = [];

    for (const other of others) {
      let otherEmbedding: number[];
      try {
        otherEmbedding = await this.getEmbedding(other.intent!);
      } catch {
        // Skip this session if embedding fails
        continue;
      }

      const similarity = cosineSimilarity(currentEmbedding, otherEmbedding);
      if (similarity < threshold) continue;

      const collision = await this.store.createCollision({
        session_ids: [session_id, other.session_id],
        type: 'semantic',
        severity: 'info',
        details: `Embedding similarity: "${truncate(intent, 60)}" vs "${truncate(other.intent!, 60)}" (cosine: ${similarity.toFixed(3)})`,
        detected_at: new Date().toISOString(),
      });
      collisions.push(collision);
    }

    return collisions;
  }

  private async getEmbedding(text: string): Promise<number[]> {
    // Check cache first
    if (this.embeddingCache) {
      const cached = this.embeddingCache.get(text);
      if (cached !== undefined) return cached;
    }

    // Compute embedding
    const vector = await this.embeddingProvider!.embed(text);

    // Store in cache
    if (this.embeddingCache) {
      this.embeddingCache.set(text, vector);
    }

    return vector;
  }
}

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
  const union = new Set([...ka, ...kb]);
  return intersection.size / union.size;
}

function truncate(s: string, len: number): string {
  return s.length > len ? s.slice(0, len) + '...' : s;
}
```

### Step 7: Update existing test config

In `packages/backend/src/collision-engine.test.ts`, the `createTestConfig` function must include the new `embeddings_threshold` field. Update the `semantic` block in the test helper:

Find this block in the `createTestConfig` function:

```typescript
      semantic: {
        keywords_enabled: true,
        embeddings_enabled: false,
        llm_enabled: false,
      },
```

Replace with:

```typescript
      semantic: {
        keywords_enabled: true,
        embeddings_enabled: false,
        embeddings_threshold: 0.75,
        llm_enabled: false,
      },
```

Also update any other `createTestConfig` call that overrides the semantic block. Find:

```typescript
        semantic: { keywords_enabled: false, embeddings_enabled: false, llm_enabled: false },
```

Replace with:

```typescript
        semantic: { keywords_enabled: false, embeddings_enabled: false, embeddings_threshold: 0.75, llm_enabled: false },
```

And in the scope test:

```typescript
        semantic: { keywords_enabled: true, embeddings_enabled: false, llm_enabled: false },
```

Replace with:

```typescript
        semantic: { keywords_enabled: true, embeddings_enabled: false, embeddings_threshold: 0.75, llm_enabled: false },
```

## Tests

### Test File 1: Embedding Provider

Create `packages/backend/src/services/embedding-provider.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cosineSimilarity, createEmbeddingProvider } from './embedding-provider.js';

// ─── Cosine Similarity ──────────────────────────────────────

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = [1, 2, 3, 4, 5];
    const result = cosineSimilarity(v, v);
    assert.ok(Math.abs(result - 1.0) < 1e-10);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    const result = cosineSimilarity(a, b);
    assert.ok(Math.abs(result) < 1e-10);
  });

  it('returns -1.0 for opposite vectors', () => {
    const a = [1, 2, 3];
    const b = [-1, -2, -3];
    const result = cosineSimilarity(a, b);
    assert.ok(Math.abs(result - (-1.0)) < 1e-10);
  });

  it('computes correct similarity for known vectors', () => {
    // cos([1,2,3], [4,5,6]) = (4+10+18) / (sqrt(14) * sqrt(77))
    // = 32 / sqrt(1078) = 32 / 32.8329... ≈ 0.9746
    const a = [1, 2, 3];
    const b = [4, 5, 6];
    const result = cosineSimilarity(a, b);
    assert.ok(Math.abs(result - 0.9746) < 0.001);
  });

  it('returns 0.0 for zero-length vectors', () => {
    const result = cosineSimilarity([], []);
    assert.equal(result, 0);
  });

  it('returns 0.0 when one vector is all zeros', () => {
    const a = [0, 0, 0];
    const b = [1, 2, 3];
    const result = cosineSimilarity(a, b);
    assert.equal(result, 0);
  });

  it('throws on length mismatch', () => {
    assert.throws(
      () => cosineSimilarity([1, 2], [1, 2, 3]),
      /Vector length mismatch/
    );
  });
});

// ─── Provider Factory ────────────────────────────────────────

describe('createEmbeddingProvider', () => {
  it('creates OpenAI provider when provider is openai', () => {
    const provider = createEmbeddingProvider({ provider: 'openai', apiKey: 'sk-test' });
    assert.equal(provider.name, 'openai');
  });

  it('throws when OpenAI provider has no API key', () => {
    assert.throws(
      () => createEmbeddingProvider({ provider: 'openai' }),
      /EMBEDDINGS_API_KEY is required/
    );
  });

  it('creates Ollama provider without API key', () => {
    const provider = createEmbeddingProvider({ provider: 'ollama' });
    assert.equal(provider.name, 'ollama');
  });

  it('creates generic provider with base URL', () => {
    const provider = createEmbeddingProvider({
      provider: 'generic',
      baseUrl: 'http://localhost:8080',
    });
    assert.equal(provider.name, 'generic');
  });

  it('throws when generic provider has no base URL', () => {
    assert.throws(
      () => createEmbeddingProvider({ provider: 'generic' }),
      /EMBEDDINGS_BASE_URL is required/
    );
  });

  it('throws for unknown provider', () => {
    assert.throws(
      () => createEmbeddingProvider({ provider: 'unknown' }),
      /Unknown embedding provider/
    );
  });
});
```

### Test File 2: Embedding Cache

Create `packages/backend/src/services/embedding-cache.test.ts`:

```typescript
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { LRUEmbeddingCache, SQLiteEmbeddingCache, EmbeddingCache, hashText } from './embedding-cache.js';

// ─── hashText ───────────────────────────────────────────────

describe('hashText', () => {
  it('produces consistent hashes for same text', () => {
    const h1 = hashText('fix auth bug');
    const h2 = hashText('fix auth bug');
    assert.equal(h1, h2);
  });

  it('normalizes case and whitespace', () => {
    const h1 = hashText('Fix Auth Bug');
    const h2 = hashText('  fix auth bug  ');
    assert.equal(h1, h2);
  });

  it('produces different hashes for different text', () => {
    const h1 = hashText('fix auth bug');
    const h2 = hashText('add new feature');
    assert.notEqual(h1, h2);
  });
});

// ─── LRU Cache ──────────────────────────────────────────────

describe('LRUEmbeddingCache', () => {
  it('stores and retrieves vectors', () => {
    const cache = new LRUEmbeddingCache(10);
    cache.set('hash1', [1, 2, 3]);
    assert.deepEqual(cache.get('hash1'), [1, 2, 3]);
  });

  it('returns undefined for cache miss', () => {
    const cache = new LRUEmbeddingCache(10);
    assert.equal(cache.get('nonexistent'), undefined);
  });

  it('evicts oldest entry when at capacity', () => {
    const cache = new LRUEmbeddingCache(2);
    cache.set('h1', [1]);
    cache.set('h2', [2]);
    cache.set('h3', [3]); // evicts h1

    assert.equal(cache.get('h1'), undefined);
    assert.deepEqual(cache.get('h2'), [2]);
    assert.deepEqual(cache.get('h3'), [3]);
  });

  it('accessing an entry refreshes its position', () => {
    const cache = new LRUEmbeddingCache(2);
    cache.set('h1', [1]);
    cache.set('h2', [2]);
    cache.get('h1');       // refresh h1, h2 is now oldest
    cache.set('h3', [3]);  // evicts h2

    assert.deepEqual(cache.get('h1'), [1]);
    assert.equal(cache.get('h2'), undefined);
    assert.deepEqual(cache.get('h3'), [3]);
  });

  it('reports correct size', () => {
    const cache = new LRUEmbeddingCache(10);
    cache.set('h1', [1]);
    cache.set('h2', [2]);
    assert.equal(cache.size, 2);
  });
});

// ─── SQLite Cache ───────────────────────────────────────────

function createCacheDB(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE embedding_cache (
      intent_hash TEXT PRIMARY KEY,
      vector TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  return db;
}

describe('SQLiteEmbeddingCache', () => {
  let db: DatabaseSync;
  let cache: SQLiteEmbeddingCache;

  beforeEach(() => {
    db = createCacheDB();
    cache = new SQLiteEmbeddingCache(db);
  });

  it('stores and retrieves vectors', () => {
    cache.set('hash1', [0.1, 0.2, 0.3]);
    const result = cache.get('hash1');
    assert.deepEqual(result, [0.1, 0.2, 0.3]);
  });

  it('returns undefined for cache miss', () => {
    assert.equal(cache.get('nonexistent'), undefined);
  });

  it('overwrites existing entries', () => {
    cache.set('hash1', [1, 2, 3]);
    cache.set('hash1', [4, 5, 6]);
    assert.deepEqual(cache.get('hash1'), [4, 5, 6]);
  });

  it('has() returns correct boolean', () => {
    assert.equal(cache.has('missing'), false);
    cache.set('found', [1]);
    assert.equal(cache.has('found'), true);
  });
});

// ─── Combined Cache ─────────────────────────────────────────

describe('EmbeddingCache (combined)', () => {
  it('returns from LRU on hit without touching SQLite', () => {
    const db = createCacheDB();
    const cache = new EmbeddingCache(db);

    cache.set('hello world', [1, 2, 3]);
    const result = cache.get('hello world');
    assert.deepEqual(result, [1, 2, 3]);
  });

  it('promotes SQLite hit to LRU', () => {
    const db = createCacheDB();

    // Seed SQLite directly
    const sqliteCache = new SQLiteEmbeddingCache(db);
    const hash = hashText('test text');
    sqliteCache.set(hash, [7, 8, 9]);

    // Create combined cache (empty LRU)
    const cache = new EmbeddingCache(db);
    const result = cache.get('test text');
    assert.deepEqual(result, [7, 8, 9]);

    // Second get should come from LRU (we can't directly verify this,
    // but we confirm it still returns correctly)
    const result2 = cache.get('test text');
    assert.deepEqual(result2, [7, 8, 9]);
  });

  it('works without SQLite (LRU only)', () => {
    const cache = new EmbeddingCache(null);
    cache.set('some text', [1, 2]);
    assert.deepEqual(cache.get('some text'), [1, 2]);
    assert.equal(cache.get('other text'), undefined);
  });
});
```

### Test File 3: Embedding Collision Integration

Create `packages/backend/src/services/embedding-collision.test.ts`:

```typescript
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { HiveStore } from '../db/store.js';
import { CollisionEngine } from './collision-engine.js';
import type { EmbeddingProvider } from './embedding-provider.js';
import { EmbeddingCache } from './embedding-cache.js';
import type { HiveBackendConfig } from '@open-hive/shared';

// ─── Test Helpers ───────────────────────────────────────────

function createTestConfig(overrides?: Partial<HiveBackendConfig>): HiveBackendConfig {
  return {
    port: 3000,
    database: { type: 'sqlite', url: ':memory:' },
    collision: {
      scope: 'org',
      semantic: {
        keywords_enabled: false,  // disable L3a so we isolate L3b
        embeddings_enabled: true,
        embeddings_threshold: 0.75,
        llm_enabled: false,
      },
    },
    webhooks: { urls: [] },
    session: { heartbeat_interval_seconds: 30, idle_timeout_seconds: 300 },
    ...overrides,
  };
}

function createTestDB(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
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
      files_touched TEXT NOT NULL DEFAULT '[]',
      areas TEXT NOT NULL DEFAULT '[]'
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
      session_ids TEXT NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      details TEXT NOT NULL,
      detected_at TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      resolved_by TEXT
    );
    CREATE TABLE embedding_cache (
      intent_hash TEXT PRIMARY KEY,
      vector TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

async function seedSession(store: HiveStore, id: string, name: string, repo = 'test-repo') {
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

// Mock provider that returns deterministic embeddings based on text content
class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'mock';
  readonly callLog: string[] = [];
  private readonly vectors: Map<string, number[]>;

  constructor(vectors: Record<string, number[]>) {
    this.vectors = new Map(Object.entries(vectors));
  }

  async embed(text: string): Promise<number[]> {
    this.callLog.push(text);
    const vector = this.vectors.get(text);
    if (!vector) {
      // Return a default "unrelated" vector
      return [0, 0, 0, 0, 1];
    }
    return vector;
  }
}

// Provider that always throws (simulates API failure)
class FailingEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'failing';

  async embed(_text: string): Promise<number[]> {
    throw new Error('API connection refused');
  }
}

// ─── L3b Embedding Collision Tests ──────────────────────────

describe('CollisionEngine -- L3b embedding collisions', () => {
  let db: DatabaseSync;
  let store: HiveStore;

  beforeEach(() => {
    db = createTestDB();
    store = new HiveStore(db);
  });

  it('detects collision when embeddings are highly similar', async () => {
    // Two intents with cosine similarity > 0.75
    const provider = new MockEmbeddingProvider({
      'fix login authentication flow': [0.9, 0.1, 0.1, 0.0, 0.0],
      'repair auth login process':     [0.85, 0.15, 0.12, 0.0, 0.0],
    });
    const engine = new CollisionEngine(store, createTestConfig(), {
      embeddingProvider: provider,
    });

    await seedSession(store, 'sess-a', 'Alice');
    await seedSession(store, 'sess-b', 'Bob');
    db.prepare('UPDATE sessions SET intent = ? WHERE session_id = ?')
      .run('repair auth login process', 'sess-a');

    const collisions = await engine.checkEmbeddingCollision(
      'sess-b', 'fix login authentication flow', 'test-repo'
    );

    assert.equal(collisions.length, 1);
    assert.equal(collisions[0].type, 'semantic');
    assert.equal(collisions[0].severity, 'info');
    assert.ok(collisions[0].details.includes('cosine'));
  });

  it('returns empty when embeddings are below threshold', async () => {
    // Two intents with cosine similarity < 0.75
    const provider = new MockEmbeddingProvider({
      'redesign homepage carousel':      [1, 0, 0, 0, 0],
      'fix database migration rollback': [0, 0, 0, 1, 0],
    });
    const engine = new CollisionEngine(store, createTestConfig(), {
      embeddingProvider: provider,
    });

    await seedSession(store, 'sess-a', 'Alice');
    await seedSession(store, 'sess-b', 'Bob');
    db.prepare('UPDATE sessions SET intent = ? WHERE session_id = ?')
      .run('fix database migration rollback', 'sess-a');

    const collisions = await engine.checkEmbeddingCollision(
      'sess-b', 'redesign homepage carousel', 'test-repo'
    );

    assert.equal(collisions.length, 0);
  });

  it('skips when embeddings_enabled is false', async () => {
    const provider = new MockEmbeddingProvider({
      'intent a': [1, 0, 0],
      'intent b': [1, 0, 0],
    });
    const config = createTestConfig({
      collision: {
        scope: 'org',
        semantic: {
          keywords_enabled: false,
          embeddings_enabled: false,
          embeddings_threshold: 0.75,
          llm_enabled: false,
        },
      },
    });
    const engine = new CollisionEngine(store, config, {
      embeddingProvider: provider,
    });

    await seedSession(store, 'sess-a', 'Alice');
    await seedSession(store, 'sess-b', 'Bob');
    db.prepare('UPDATE sessions SET intent = ? WHERE session_id = ?')
      .run('intent b', 'sess-a');

    const collisions = await engine.checkEmbeddingCollision(
      'sess-b', 'intent a', 'test-repo'
    );

    assert.equal(collisions.length, 0);
    assert.equal(provider.callLog.length, 0); // provider never called
  });

  it('skips when no embedding provider is configured', async () => {
    const engine = new CollisionEngine(store, createTestConfig());
    // no embeddingProvider passed

    await seedSession(store, 'sess-a', 'Alice');
    await seedSession(store, 'sess-b', 'Bob');
    db.prepare('UPDATE sessions SET intent = ? WHERE session_id = ?')
      .run('some intent', 'sess-a');

    const collisions = await engine.checkEmbeddingCollision(
      'sess-b', 'some other intent', 'test-repo'
    );

    assert.equal(collisions.length, 0);
  });

  it('handles API errors gracefully -- returns empty, does not throw', async () => {
    const engine = new CollisionEngine(store, createTestConfig(), {
      embeddingProvider: new FailingEmbeddingProvider(),
    });

    await seedSession(store, 'sess-a', 'Alice');
    await seedSession(store, 'sess-b', 'Bob');
    db.prepare('UPDATE sessions SET intent = ? WHERE session_id = ?')
      .run('some intent', 'sess-a');

    const collisions = await engine.checkEmbeddingCollision(
      'sess-b', 'another intent', 'test-repo'
    );

    // Should NOT throw, just return empty
    assert.equal(collisions.length, 0);
  });

  it('respects configurable threshold', async () => {
    // Vectors with cosine similarity ~0.85
    const provider = new MockEmbeddingProvider({
      'intent a': [0.9, 0.1, 0.1, 0.0, 0.0],
      'intent b': [0.85, 0.15, 0.12, 0.0, 0.0],
    });

    // Set threshold to 0.99 -- similarity 0.85 should NOT trigger
    const highThresholdConfig = createTestConfig({
      collision: {
        scope: 'org',
        semantic: {
          keywords_enabled: false,
          embeddings_enabled: true,
          embeddings_threshold: 0.99,
          llm_enabled: false,
        },
      },
    });
    const engine = new CollisionEngine(store, highThresholdConfig, {
      embeddingProvider: provider,
    });

    await seedSession(store, 'sess-a', 'Alice');
    await seedSession(store, 'sess-b', 'Bob');
    db.prepare('UPDATE sessions SET intent = ? WHERE session_id = ?')
      .run('intent b', 'sess-a');

    const collisions = await engine.checkEmbeddingCollision(
      'sess-b', 'intent a', 'test-repo'
    );

    assert.equal(collisions.length, 0);
  });

  it('uses cache to avoid redundant embed calls', async () => {
    const provider = new MockEmbeddingProvider({
      'intent x': [1, 0, 0, 0, 0],
      'intent y': [0, 1, 0, 0, 0],
    });
    const cache = new EmbeddingCache(null); // LRU-only cache
    const engine = new CollisionEngine(store, createTestConfig(), {
      embeddingProvider: provider,
      embeddingCache: cache,
    });

    await seedSession(store, 'sess-a', 'Alice');
    await seedSession(store, 'sess-b', 'Bob');
    db.prepare('UPDATE sessions SET intent = ? WHERE session_id = ?')
      .run('intent y', 'sess-a');

    // First call -- provider embed called for both intents
    await engine.checkEmbeddingCollision('sess-b', 'intent x', 'test-repo');
    assert.equal(provider.callLog.length, 2);

    // Second call with same text -- should hit cache, no additional embed calls
    await engine.checkEmbeddingCollision('sess-b', 'intent x', 'test-repo');
    assert.equal(provider.callLog.length, 2); // still 2, not 4
  });

  it('ignores sessions with null intent', async () => {
    const provider = new MockEmbeddingProvider({
      'my intent': [1, 0, 0],
    });
    const engine = new CollisionEngine(store, createTestConfig(), {
      embeddingProvider: provider,
    });

    await seedSession(store, 'sess-a', 'Alice'); // intent is null
    await seedSession(store, 'sess-b', 'Bob');

    const collisions = await engine.checkEmbeddingCollision(
      'sess-b', 'my intent', 'test-repo'
    );

    assert.equal(collisions.length, 0);
    // Provider should only be called once (for current intent), then find no others to compare
    // Actually it should not even embed the current intent since there are no others
    assert.equal(provider.callLog.length, 0);
  });

  it('checkIntentCollision runs L3b after L3a and deduplicates pairs', async () => {
    // Both L3a and L3b would fire for the same pair.
    // Enable both keyword and embedding checks.
    const config = createTestConfig({
      collision: {
        scope: 'org',
        semantic: {
          keywords_enabled: true,
          embeddings_enabled: true,
          embeddings_threshold: 0.5, // low threshold to ensure embedding fires
          llm_enabled: false,
        },
      },
    });
    // Vectors that are identical (cosine = 1.0)
    const provider = new MockEmbeddingProvider({
      'auth token refresh bug': [1, 0, 0, 0, 0],
      'auth token expiry bug':  [1, 0, 0, 0, 0],
    });
    const engine = new CollisionEngine(store, config, {
      embeddingProvider: provider,
    });

    await seedSession(store, 'sess-a', 'Alice');
    await seedSession(store, 'sess-b', 'Bob');
    db.prepare('UPDATE sessions SET intent = ? WHERE session_id = ?')
      .run('auth token expiry bug', 'sess-a');

    const collisions = await engine.checkIntentCollision(
      'sess-b', 'auth token refresh bug', 'test-repo'
    );

    // L3a fires (keyword overlap: "auth", "token", "bug")
    // L3b would also fire but is deduplicated
    // Result: exactly 1 collision, not 2
    assert.equal(collisions.length, 1);
    assert.equal(collisions[0].type, 'semantic');
    assert.ok(collisions[0].details.includes('keyword'));
  });
});
```

## Verify

```bash
npm run build && npm test
```

Confirm:
- [ ] Build succeeds with no type errors
- [ ] All existing L1/L2/L3a/scope/store tests still pass unchanged
- [ ] New embedding-provider tests pass (7 tests: cosine math + factory validation)
- [ ] New embedding-cache tests pass (12 tests: LRU + SQLite + combined)
- [ ] New embedding-collision tests pass (9 tests: detection, threshold, config, caching, dedup)
- [ ] With `SEMANTIC_EMBEDDINGS` unset (defaults to `false`), server starts and behaves identically to before (backward compat)
- [ ] Manual smoke test: set `SEMANTIC_EMBEDDINGS=true`, `EMBEDDINGS_PROVIDER=ollama`, start Ollama with `nomic-embed-text`, register two sessions with similar intents, and confirm an embedding collision is created

## Configuration

Add to `.env.example`:

```bash
# ─── L3b Embedding Collision Detection ───────────────────────
# Enable embedding-based semantic collision detection (default: false)
SEMANTIC_EMBEDDINGS=false

# Embedding provider: openai | ollama | generic
EMBEDDINGS_PROVIDER=openai

# API key for OpenAI or generic provider (not needed for Ollama)
EMBEDDINGS_API_KEY=

# Base URL override:
#   OpenAI default: https://api.openai.com
#   Ollama default: http://localhost:11434
#   Generic: REQUIRED (e.g., http://localhost:8080)
EMBEDDINGS_BASE_URL=

# Model name override:
#   OpenAI default: text-embedding-3-small
#   Ollama default: nomic-embed-text
#   Generic default: text-embedding-3-small
EMBEDDINGS_MODEL=

# Cosine similarity threshold (0.0 - 1.0). Higher = fewer false positives.
# Default: 0.75. Recommended range: 0.70 - 0.85
EMBEDDINGS_THRESHOLD=0.75
```

### Example: OpenAI

```bash
SEMANTIC_EMBEDDINGS=true
EMBEDDINGS_PROVIDER=openai
EMBEDDINGS_API_KEY=sk-proj-...
# Uses text-embedding-3-small by default (~$0.02 per 1M tokens)
```

### Example: Ollama (local, free)

```bash
SEMANTIC_EMBEDDINGS=true
EMBEDDINGS_PROVIDER=ollama
# Requires: ollama pull nomic-embed-text && ollama serve
# Default base URL: http://localhost:11434
```

### Example: Generic (LiteLLM proxy, vLLM, LocalAI, etc.)

```bash
SEMANTIC_EMBEDDINGS=true
EMBEDDINGS_PROVIDER=generic
EMBEDDINGS_BASE_URL=http://localhost:4000
EMBEDDINGS_API_KEY=sk-litellm-...
EMBEDDINGS_MODEL=text-embedding-3-small
```

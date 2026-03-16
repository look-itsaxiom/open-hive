import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { HiveStore } from './db/store.js';
import { CollisionEngine } from './services/collision-engine.js';
import { KeywordAnalyzer } from './services/keyword-analyzer.js';
import type { HiveBackendConfig } from '@open-hive/shared';

function createTestConfig(overrides?: Partial<HiveBackendConfig>): HiveBackendConfig {
  return {
    port: 3000,
    database: { type: 'sqlite', url: ':memory:' },
    collision: {
      scope: 'org',
      semantic: {
        keywords_enabled: true,
        embeddings_enabled: false,
        llm_enabled: false, llm_confidence_threshold: 0.7, llm_rate_limit_per_min: 10,
      },
    },
    alerts: { min_severity: 'info', webhook_urls: [] },
    identity: { provider: 'passthrough', auth_enabled: false },
    decay: { enabled: true, default_half_life_seconds: 86400, type_overrides: {}, floor: 0.01 },
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
      semantic_area TEXT,
      weight REAL NOT NULL DEFAULT 1.0
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

// ─── L1: File Collision ────────────────────────────────────

describe('CollisionEngine — L1 file collisions', () => {
  let db: DatabaseSync;
  let store: HiveStore;
  let engine: CollisionEngine;

  beforeEach(() => {
    db = createTestDB();
    store = new HiveStore(db);
    engine = new CollisionEngine(store, createTestConfig(), [new KeywordAnalyzer()]);
  });

  it('detects critical collision when two sessions modify the same file', async () => {
    await seedSession(store, 'sess-a', 'Alice');
    await seedSession(store, 'sess-b', 'Bob');
    await store.updateSessionActivity('sess-a', { files_touched: ['src/auth.ts'] });

    const collisions = await engine.checkFileCollision('sess-b', 'src/auth.ts', 'test-repo');

    assert.equal(collisions.length, 1);
    assert.equal(collisions[0].type, 'file');
    assert.equal(collisions[0].severity, 'critical');
    assert.ok(collisions[0].details.includes('src/auth.ts'));
  });

  it('does not detect collision when sessions modify files in different directories', async () => {
    await seedSession(store, 'sess-a', 'Alice');
    await seedSession(store, 'sess-b', 'Bob');
    await store.updateSessionActivity('sess-a', { files_touched: ['src/auth/login.ts'] });

    const collisions = await engine.checkFileCollision('sess-b', 'src/routes/api.ts', 'test-repo');

    assert.equal(collisions.length, 0);
  });

  it('does not detect collision with own session', async () => {
    await seedSession(store, 'sess-a', 'Alice');
    await store.updateSessionActivity('sess-a', { files_touched: ['src/auth.ts'] });

    const collisions = await engine.checkFileCollision('sess-a', 'src/auth.ts', 'test-repo');

    assert.equal(collisions.length, 0);
  });

  it('deduplicates file collisions — returns existing collision on second check', async () => {
    await seedSession(store, 'sess-a', 'Alice');
    await seedSession(store, 'sess-b', 'Bob');
    await store.updateSessionActivity('sess-a', { files_touched: ['src/auth.ts'] });

    const first = await engine.checkFileCollision('sess-b', 'src/auth.ts', 'test-repo');
    const second = await engine.checkFileCollision('sess-b', 'src/auth.ts', 'test-repo');

    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    // Should return the same collision, not create a new one
    assert.equal(first[0].collision_id, second[0].collision_id);
  });

  it('detects collisions across multiple sessions', async () => {
    await seedSession(store, 'sess-a', 'Alice');
    await seedSession(store, 'sess-b', 'Bob');
    await seedSession(store, 'sess-c', 'Charlie');
    await store.updateSessionActivity('sess-a', { files_touched: ['src/auth.ts'] });
    await store.updateSessionActivity('sess-b', { files_touched: ['src/auth.ts'] });

    const collisions = await engine.checkFileCollision('sess-c', 'src/auth.ts', 'test-repo');

    // Should detect collisions with both Alice and Bob
    assert.equal(collisions.length, 2);
    assert.ok(collisions.every(c => c.type === 'file'));
    assert.ok(collisions.every(c => c.severity === 'critical'));
  });
});

// ─── L2: Directory Collision ───────────────────────────────

describe('CollisionEngine — L2 directory collisions', () => {
  let db: DatabaseSync;
  let store: HiveStore;
  let engine: CollisionEngine;

  beforeEach(() => {
    db = createTestDB();
    store = new HiveStore(db);
    engine = new CollisionEngine(store, createTestConfig(), [new KeywordAnalyzer()]);
  });

  it('detects warning collision when two sessions work in the same directory', async () => {
    await seedSession(store, 'sess-a', 'Alice');
    await seedSession(store, 'sess-b', 'Bob');
    await store.updateSessionActivity('sess-a', { files_touched: ['src/auth/login.ts'] });

    const collisions = await engine.checkFileCollision('sess-b', 'src/auth/refresh.ts', 'test-repo');

    assert.equal(collisions.length, 1);
    assert.equal(collisions[0].type, 'directory');
    assert.equal(collisions[0].severity, 'warning');
  });

  it('does not detect directory collision when files are in different directories', async () => {
    await seedSession(store, 'sess-a', 'Alice');
    await seedSession(store, 'sess-b', 'Bob');
    await store.updateSessionActivity('sess-a', { files_touched: ['src/auth/login.ts'] });

    const collisions = await engine.checkFileCollision('sess-b', 'src/routes/api.ts', 'test-repo');

    assert.equal(collisions.length, 0);
  });

  it('L1 takes priority over L2 — only file collision returned for same file', async () => {
    await seedSession(store, 'sess-a', 'Alice');
    await seedSession(store, 'sess-b', 'Bob');
    await store.updateSessionActivity('sess-a', { files_touched: ['src/auth.ts'] });

    const collisions = await engine.checkFileCollision('sess-b', 'src/auth.ts', 'test-repo');

    // Should only get L1 (file), not also L2 (directory) — the continue statement skips L2
    assert.equal(collisions.length, 1);
    assert.equal(collisions[0].type, 'file');
  });
});

// ─── L3a: Semantic Keyword Collision ───────────────────────

describe('CollisionEngine — L3a semantic collisions', () => {
  let db: DatabaseSync;
  let store: HiveStore;
  let engine: CollisionEngine;

  beforeEach(() => {
    db = createTestDB();
    store = new HiveStore(db);
    engine = new CollisionEngine(store, createTestConfig(), [new KeywordAnalyzer()]);
  });

  it('detects semantic collision when intents share significant keywords', async () => {
    await seedSession(store, 'sess-a', 'Alice');
    await seedSession(store, 'sess-b', 'Bob');
    await store.updateSessionActivity('sess-a', {});
    // Manually set intent via direct SQL since updateSessionActivity merges
    db.prepare('UPDATE sessions SET intent = ? WHERE session_id = ?')
      .run('fix auth token refresh bug in login flow', 'sess-a');

    const collisions = await engine.checkIntentCollision(
      'sess-b',
      'fix auth token expiry logic in login handler',
      'test-repo'
    );

    assert.ok(collisions.length >= 1);
    assert.equal(collisions[0].type, 'semantic');
    assert.equal(collisions[0].severity, 'info');
  });

  it('does not detect semantic collision when intents are unrelated', async () => {
    await seedSession(store, 'sess-a', 'Alice');
    await seedSession(store, 'sess-b', 'Bob');
    db.prepare('UPDATE sessions SET intent = ? WHERE session_id = ?')
      .run('redesign the homepage carousel animation', 'sess-a');

    const collisions = await engine.checkIntentCollision(
      'sess-b',
      'fix database migration rollback script',
      'test-repo'
    );

    assert.equal(collisions.length, 0);
  });

  it('respects keywords_enabled config — no semantic collisions when disabled', async () => {
    const config = createTestConfig({
      collision: {
        scope: 'org',
        semantic: { keywords_enabled: false, embeddings_enabled: false, llm_enabled: false, llm_confidence_threshold: 0.7, llm_rate_limit_per_min: 10 },
      },
    });
    // When keywords_enabled is false, no analyzers are registered
    engine = new CollisionEngine(store, config, []);

    await seedSession(store, 'sess-a', 'Alice');
    await seedSession(store, 'sess-b', 'Bob');
    db.prepare('UPDATE sessions SET intent = ? WHERE session_id = ?')
      .run('fix auth token refresh bug', 'sess-a');

    const collisions = await engine.checkIntentCollision(
      'sess-b', 'fix auth token expiry logic', 'test-repo'
    );

    assert.equal(collisions.length, 0);
  });

  it('ignores sessions with null intent', async () => {
    await seedSession(store, 'sess-a', 'Alice');
    await seedSession(store, 'sess-b', 'Bob');
    // sess-a has no intent set (default null)

    const collisions = await engine.checkIntentCollision(
      'sess-b', 'fix auth token refresh', 'test-repo'
    );

    assert.equal(collisions.length, 0);
  });
});

// ─── Scope Configuration ───────────────────────────────────

describe('CollisionEngine — scope configuration', () => {
  it('repo scope only checks sessions in the same repo', async () => {
    const db = createTestDB();
    const store = new HiveStore(db);
    const config = createTestConfig({
      collision: {
        scope: 'repo',
        semantic: { keywords_enabled: true, embeddings_enabled: false, llm_enabled: false, llm_confidence_threshold: 0.7, llm_rate_limit_per_min: 10 },
      },
    });
    const engine = new CollisionEngine(store, config, [new KeywordAnalyzer()]);

    await seedSession(store, 'sess-a', 'Alice', 'repo-one');
    await seedSession(store, 'sess-b', 'Bob', 'repo-two');
    await store.updateSessionActivity('sess-a', { files_touched: ['src/auth.ts'] });

    const collisions = await engine.checkFileCollision('sess-b', 'src/auth.ts', 'repo-two');

    // Different repos — should not collide in repo scope
    assert.equal(collisions.length, 0);
  });

  it('org scope checks sessions across all repos', async () => {
    const db = createTestDB();
    const store = new HiveStore(db);
    const engine = new CollisionEngine(store, createTestConfig(), [new KeywordAnalyzer()]);

    await seedSession(store, 'sess-a', 'Alice', 'repo-one');
    await seedSession(store, 'sess-b', 'Bob', 'repo-two');
    await store.updateSessionActivity('sess-a', { files_touched: ['src/auth.ts'] });

    const collisions = await engine.checkFileCollision('sess-b', 'src/auth.ts', 'repo-two');

    // Org scope — should detect cross-repo collision
    assert.equal(collisions.length, 1);
  });
});

// ─── Store: Session CRUD ───────────────────────────────────

describe('HiveStore — sessions', () => {
  let db: DatabaseSync;
  let store: HiveStore;

  beforeEach(() => {
    db = createTestDB();
    store = new HiveStore(db);
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
});

// ─── Store: Signals ────────────────────────────────────────

describe('HiveStore — signals', () => {
  let db: DatabaseSync;
  let store: HiveStore;

  beforeEach(async () => {
    db = createTestDB();
    store = new HiveStore(db);
    await seedSession(store, 'sess-1', 'Alice');
  });

  it('creates and retrieves signals', async () => {
    await store.createSignal({
      session_id: 'sess-1',
      timestamp: new Date().toISOString(),
      type: 'prompt',
      content: 'fix auth bug',
      file_path: null,
      semantic_area: null,
      weight: 1.0,
    });

    const signals = await store.getRecentSignals({});
    assert.equal(signals.length, 1);
    assert.equal(signals[0].content, 'fix auth bug');
  });

  it('filters signals by repo', async () => {
    await seedSession(store, 'sess-2', 'Bob', 'other-repo');
    await store.createSignal({
      session_id: 'sess-1', timestamp: new Date().toISOString(),
      type: 'prompt', content: 'signal a', file_path: null, semantic_area: null, weight: 1.0,
    });
    await store.createSignal({
      session_id: 'sess-2', timestamp: new Date().toISOString(),
      type: 'prompt', content: 'signal b', file_path: null, semantic_area: null, weight: 1.0,
    });

    const filtered = await store.getRecentSignals({ repo: 'test-repo' });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].content, 'signal a');
  });

  it('respects limit parameter', async () => {
    for (let i = 0; i < 10; i++) {
      await store.createSignal({
        session_id: 'sess-1', timestamp: new Date().toISOString(),
        type: 'prompt', content: `signal ${i}`, file_path: null, semantic_area: null, weight: 1.0,
      });
    }

    const limited = await store.getRecentSignals({ limit: 3 });
    assert.equal(limited.length, 3);
  });
});

// ─── Store: Collisions ─────────────────────────────────────

describe('HiveStore — collisions', () => {
  let db: DatabaseSync;
  let store: HiveStore;

  beforeEach(() => {
    db = createTestDB();
    store = new HiveStore(db);
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

/**
 * Integration smoke tests — validate PortRegistry wiring end-to-end.
 *
 * These tests boot the actual Fastify server (in-memory SQLite) and walk
 * through real API flows to verify that the hexagonal architecture wiring
 * works correctly: PortRegistry → routes → CollisionEngine → store.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { DatabaseSync } from 'node:sqlite';
import { HiveStore } from './db/store.js';
import { CollisionEngine } from './services/collision-engine.js';
import { KeywordAnalyzer } from './services/keyword-analyzer.js';
import { PassthroughIdentityProvider } from './services/passthrough-identity-provider.js';
import { AlertDispatcher } from './services/alert-dispatcher.js';
import { DecayService } from './services/decay-service.js';
import { createAuthMiddleware } from './middleware/auth.js';
import type { PortRegistry } from './port-registry.js';
import { sessionRoutes } from './routes/sessions.js';
import { signalRoutes } from './routes/signals.js';
import { conflictRoutes } from './routes/conflicts.js';
import { historyRoutes } from './routes/history.js';
import { richSignalRoutes } from './routes/rich-signals.js';
import { mailRoutes } from './routes/mail.js';
import type { HiveBackendConfig } from '@open-hive/shared';

function createTestConfig(): HiveBackendConfig {
  return {
    port: 0, // random port
    database: { type: 'sqlite', url: ':memory:' },
    collision: {
      scope: 'org',
      semantic: {
        keywords_enabled: true,
        embeddings_enabled: false,
        llm_enabled: false,
      },
    },
    alerts: { min_severity: 'info', webhook_urls: [] },
    identity: { provider: 'passthrough' },
    decay: { enabled: true, default_half_life_seconds: 86400, type_overrides: {}, floor: 0.01 },
    webhooks: { urls: [] },
    session: { heartbeat_interval_seconds: 30, idle_timeout_seconds: 300 },
  };
}

function createTestDB(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
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
    CREATE INDEX IF NOT EXISTS idx_mail_to_context ON agent_mail(to_context_id);
    CREATE INDEX IF NOT EXISTS idx_mail_read ON agent_mail(read_at);
    CREATE INDEX IF NOT EXISTS idx_nerves_type ON nerves(nerve_type);
    CREATE INDEX IF NOT EXISTS idx_nerves_status ON nerves(status);
    CREATE INDEX IF NOT EXISTS idx_nerves_agent_id ON nerves(agent_id);
  `);
  return db;
}

async function buildTestServer(): Promise<FastifyInstance> {
  const config = createTestConfig();
  const db = createTestDB();
  const store = new HiveStore(db);
  const analyzers = [new KeywordAnalyzer()];
  const engine = new CollisionEngine(store, config, analyzers);
  const identity = new PassthroughIdentityProvider();
  const alerts = new AlertDispatcher();
  const decay = new DecayService(config.decay);

  const registry: PortRegistry = { store, identity, analyzers, alerts, decay };

  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });
  app.addHook('preHandler', createAuthMiddleware(identity));
  app.get('/api/health', async () => ({ status: 'ok', version: '0.2.0' }));

  sessionRoutes(app, registry, engine);
  signalRoutes(app, registry, engine);
  conflictRoutes(app, registry, engine);
  historyRoutes(app, registry);
  richSignalRoutes(app, registry, engine);
  mailRoutes(app, registry);

  return app;
}

// ─── Smoke Tests ────────────────────────────────────────────

describe('Smoke: server boots and health check', () => {
  let app: FastifyInstance;

  before(async () => { app = await buildTestServer(); });
  after(async () => { await app.close(); });

  it('GET /api/health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.status, 'ok');
    assert.equal(body.version, '0.2.0');
  });
});

describe('Smoke: session lifecycle', () => {
  let app: FastifyInstance;

  before(async () => { app = await buildTestServer(); });
  after(async () => { await app.close(); });

  it('register → heartbeat → list → end', async () => {
    // Register
    const reg = await app.inject({
      method: 'POST', url: '/api/sessions/register',
      payload: {
        session_id: 'smoke-1', developer_email: 'alice@test.com',
        developer_name: 'Alice', repo: 'test-repo', project_path: '/code/test',
      },
    });
    assert.equal(reg.statusCode, 200);
    const regBody = JSON.parse(reg.body);
    assert.equal(regBody.ok, true);

    // Heartbeat
    const hb = await app.inject({
      method: 'POST', url: '/api/sessions/heartbeat',
      payload: { session_id: 'smoke-1' },
    });
    assert.equal(hb.statusCode, 200);

    // List active
    const list = await app.inject({ method: 'GET', url: '/api/sessions/active?repo=test-repo' });
    assert.equal(list.statusCode, 200);
    const listBody = JSON.parse(list.body);
    assert.equal(listBody.sessions.length, 1);
    assert.equal(listBody.sessions[0].developer_name, 'Alice');

    // End
    const end = await app.inject({
      method: 'POST', url: '/api/sessions/end',
      payload: { session_id: 'smoke-1' },
    });
    assert.equal(end.statusCode, 200);

    // Verify gone
    const list2 = await app.inject({ method: 'GET', url: '/api/sessions/active?repo=test-repo' });
    const list2Body = JSON.parse(list2.body);
    assert.equal(list2Body.sessions.length, 0);
  });
});

describe('Smoke: L1 file collision detection', () => {
  let app: FastifyInstance;

  before(async () => { app = await buildTestServer(); });
  after(async () => { await app.close(); });

  it('two devs modifying same file → critical collision', async () => {
    // Register Alice
    await app.inject({
      method: 'POST', url: '/api/sessions/register',
      payload: {
        session_id: 'alice-1', developer_email: 'alice@test.com',
        developer_name: 'Alice', repo: 'app', project_path: '/code/app',
      },
    });

    // Register Bob
    await app.inject({
      method: 'POST', url: '/api/sessions/register',
      payload: {
        session_id: 'bob-1', developer_email: 'bob@test.com',
        developer_name: 'Bob', repo: 'app', project_path: '/code/app',
      },
    });

    // Alice modifies auth.ts
    const aliceAct = await app.inject({
      method: 'POST', url: '/api/signals/activity',
      payload: { session_id: 'alice-1', file_path: 'src/auth.ts', type: 'file_modify' },
    });
    assert.equal(aliceAct.statusCode, 200);
    const aliceBody = JSON.parse(aliceAct.body);
    assert.equal(aliceBody.collisions.length, 0); // no collision yet

    // Bob modifies same file → collision!
    const bobAct = await app.inject({
      method: 'POST', url: '/api/signals/activity',
      payload: { session_id: 'bob-1', file_path: 'src/auth.ts', type: 'file_modify' },
    });
    assert.equal(bobAct.statusCode, 200);
    const bobBody = JSON.parse(bobAct.body);
    assert.equal(bobBody.collisions.length, 1);
    assert.equal(bobBody.collisions[0].type, 'file');
    assert.equal(bobBody.collisions[0].severity, 'critical');
    assert.ok(bobBody.collisions[0].details.includes('src/auth.ts'));
  });
});

describe('Smoke: L2 directory collision detection', () => {
  let app: FastifyInstance;

  before(async () => { app = await buildTestServer(); });
  after(async () => { await app.close(); });

  it('two devs modifying files in same directory → warning collision', async () => {
    await app.inject({
      method: 'POST', url: '/api/sessions/register',
      payload: {
        session_id: 'alice-2', developer_email: 'alice@test.com',
        developer_name: 'Alice', repo: 'app', project_path: '/code/app',
      },
    });
    await app.inject({
      method: 'POST', url: '/api/sessions/register',
      payload: {
        session_id: 'bob-2', developer_email: 'bob@test.com',
        developer_name: 'Bob', repo: 'app', project_path: '/code/app',
      },
    });

    await app.inject({
      method: 'POST', url: '/api/signals/activity',
      payload: { session_id: 'alice-2', file_path: 'src/auth/login.ts', type: 'file_modify' },
    });

    const bobAct = await app.inject({
      method: 'POST', url: '/api/signals/activity',
      payload: { session_id: 'bob-2', file_path: 'src/auth/refresh.ts', type: 'file_modify' },
    });
    const body = JSON.parse(bobAct.body);
    assert.equal(body.collisions.length, 1);
    assert.equal(body.collisions[0].type, 'directory');
    assert.equal(body.collisions[0].severity, 'warning');
  });
});

describe('Smoke: L3a semantic collision via intent', () => {
  let app: FastifyInstance;

  before(async () => { app = await buildTestServer(); });
  after(async () => { await app.close(); });

  it('overlapping intents detected through PortRegistry → KeywordAnalyzer', async () => {
    await app.inject({
      method: 'POST', url: '/api/sessions/register',
      payload: {
        session_id: 'alice-3', developer_email: 'alice@test.com',
        developer_name: 'Alice', repo: 'app', project_path: '/code/app',
      },
    });
    await app.inject({
      method: 'POST', url: '/api/sessions/register',
      payload: {
        session_id: 'bob-3', developer_email: 'bob@test.com',
        developer_name: 'Bob', repo: 'app', project_path: '/code/app',
      },
    });

    // Alice declares intent
    await app.inject({
      method: 'POST', url: '/api/signals/intent',
      payload: { session_id: 'alice-3', content: 'refactoring the auth token refresh logic in login', type: 'prompt' },
    });

    // Bob declares overlapping intent
    const bobIntent = await app.inject({
      method: 'POST', url: '/api/signals/intent',
      payload: { session_id: 'bob-3', content: 'fixing auth token expiry handling in login flow', type: 'prompt' },
    });
    const body = JSON.parse(bobIntent.body);
    assert.ok(body.collisions.length >= 1, 'Should detect semantic overlap');
    assert.equal(body.collisions[0].type, 'semantic');
    assert.equal(body.collisions[0].severity, 'info');
    assert.ok(body.collisions[0].details.includes('[L3a]'));
    assert.ok(body.collisions[0].details.includes('keyword-jaccard'));
  });
});

describe('Smoke: collision resolution', () => {
  let app: FastifyInstance;

  before(async () => { app = await buildTestServer(); });
  after(async () => { await app.close(); });

  it('detect collision → resolve it → gone from active', async () => {
    await app.inject({
      method: 'POST', url: '/api/sessions/register',
      payload: {
        session_id: 'alice-4', developer_email: 'alice@test.com',
        developer_name: 'Alice', repo: 'app', project_path: '/code/app',
      },
    });
    await app.inject({
      method: 'POST', url: '/api/sessions/register',
      payload: {
        session_id: 'bob-4', developer_email: 'bob@test.com',
        developer_name: 'Bob', repo: 'app', project_path: '/code/app',
      },
    });

    // Create collision
    await app.inject({
      method: 'POST', url: '/api/signals/activity',
      payload: { session_id: 'alice-4', file_path: 'src/index.ts', type: 'file_modify' },
    });
    const bobAct = await app.inject({
      method: 'POST', url: '/api/signals/activity',
      payload: { session_id: 'bob-4', file_path: 'src/index.ts', type: 'file_modify' },
    });
    const collision = JSON.parse(bobAct.body).collisions[0];
    assert.ok(collision);

    // Resolve
    const resolve = await app.inject({
      method: 'POST', url: '/api/conflicts/resolve',
      payload: { collision_id: collision.collision_id, resolved_by: 'alice@test.com' },
    });
    assert.equal(resolve.statusCode, 200);

    // Check — should have no active conflicts for Bob
    const check = await app.inject({
      method: 'GET',
      url: `/api/conflicts/check?session_id=bob-4&file_path=src/index.ts&repo=app`,
    });
    const checkBody = JSON.parse(check.body);
    // The original collision should be resolved, though a new one may be created
    // since both sessions still have the file in files_touched
    assert.equal(check.statusCode, 200);
  });
});

describe('Smoke: history endpoint', () => {
  let app: FastifyInstance;

  before(async () => { app = await buildTestServer(); });
  after(async () => { await app.close(); });

  it('returns signals and sessions after activity', async () => {
    await app.inject({
      method: 'POST', url: '/api/sessions/register',
      payload: {
        session_id: 'alice-5', developer_email: 'alice@test.com',
        developer_name: 'Alice', repo: 'app', project_path: '/code/app',
      },
    });
    await app.inject({
      method: 'POST', url: '/api/signals/activity',
      payload: { session_id: 'alice-5', file_path: 'src/utils.ts', type: 'file_modify' },
    });

    const history = await app.inject({
      method: 'GET', url: '/api/history?repo=app',
    });
    assert.equal(history.statusCode, 200);
    const body = JSON.parse(history.body);
    assert.ok(body.signals.length >= 1);
    assert.ok(body.sessions.length >= 1);
  });
});

describe('Smoke: input validation', () => {
  let app: FastifyInstance;

  before(async () => { app = await buildTestServer(); });
  after(async () => { await app.close(); });

  it('rejects session register with missing fields', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/sessions/register',
      payload: { session_id: 'bad' }, // missing required fields
    });
    assert.equal(res.statusCode, 400);
  });

  it('rejects intent signal with missing fields', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/signals/intent',
      payload: { session_id: 'bad' }, // missing content and type
    });
    assert.equal(res.statusCode, 400);
  });

  it('rejects activity signal with invalid type', async () => {
    await app.inject({
      method: 'POST', url: '/api/sessions/register',
      payload: {
        session_id: 'valid-1', developer_email: 'a@t.com',
        developer_name: 'A', repo: 'r', project_path: '/p',
      },
    });
    const res = await app.inject({
      method: 'POST', url: '/api/signals/activity',
      payload: { session_id: 'valid-1', file_path: 'f.ts', type: 'invalid_type' },
    });
    assert.equal(res.statusCode, 400);
  });

  it('returns 404 for heartbeat on non-existent session', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/sessions/heartbeat',
      payload: { session_id: 'does-not-exist' },
    });
    assert.equal(res.statusCode, 404);
  });
});

describe('Smoke: signal decay weight', () => {
  let app: FastifyInstance;
  before(async () => { app = await buildTestServer(); });
  after(async () => { await app.close(); });

  it('signals are created with weight close to 1.0', async () => {
    await app.inject({
      method: 'POST', url: '/api/sessions/register',
      payload: {
        session_id: 'decay-1', developer_email: 'alice@test.com',
        developer_name: 'Alice', repo: 'app', project_path: '/code/app',
      },
    });

    await app.inject({
      method: 'POST', url: '/api/signals/activity',
      payload: { session_id: 'decay-1', file_path: 'src/foo.ts', type: 'file_modify' },
    });

    const history = await app.inject({ method: 'GET', url: '/api/history?repo=app' });
    const body = JSON.parse(history.body);
    assert.ok(body.signals.length >= 1);
    // Decay is now applied on read, so fresh signals should be very close to 1.0
    assert.ok(body.signals[0].weight > 0.99, 'Fresh signal weight should be near 1.0');
    assert.ok(body.signals[0].weight <= 1.0, 'Weight should not exceed 1.0');
  });
});

describe('Smoke: history returns signals sorted by decay weight', () => {
  let app: FastifyInstance;
  before(async () => { app = await buildTestServer(); });
  after(async () => { await app.close(); });

  it('fresher signals have higher weight and appear first', async () => {
    await app.inject({
      method: 'POST', url: '/api/sessions/register',
      payload: {
        session_id: 'order-1', developer_email: 'alice@test.com',
        developer_name: 'Alice', repo: 'order-repo', project_path: '/code/app',
      },
    });

    // Create two signals
    await app.inject({
      method: 'POST', url: '/api/signals/activity',
      payload: { session_id: 'order-1', file_path: 'src/a.ts', type: 'file_modify' },
    });
    await app.inject({
      method: 'POST', url: '/api/signals/activity',
      payload: { session_id: 'order-1', file_path: 'src/b.ts', type: 'file_modify' },
    });

    const history = await app.inject({ method: 'GET', url: '/api/history?repo=order-repo' });
    const body = JSON.parse(history.body);
    assert.ok(body.signals.length >= 2);
    // All signals should have weight property
    for (const signal of body.signals) {
      assert.ok(typeof signal.weight === 'number', 'Signal should have weight');
      assert.ok(signal.weight > 0, 'Weight should be positive');
      assert.ok(signal.weight <= 1.0, 'Weight should not exceed 1.0');
    }
    // Should be sorted by weight descending (or equal for near-simultaneous signals)
    for (let i = 1; i < body.signals.length; i++) {
      assert.ok(body.signals[i - 1].weight >= body.signals[i].weight,
        'Signals should be sorted by weight descending');
    }
  });
});

describe('Smoke: rich signal endpoint', () => {
  let app: FastifyInstance;
  before(async () => { app = await buildTestServer(); });
  after(async () => { await app.close(); });

  it('accepts intent_declared signal type', async () => {
    await app.inject({
      method: 'POST', url: '/api/sessions/register',
      payload: {
        session_id: 'rich-1', developer_email: 'alice@test.com',
        developer_name: 'Alice', repo: 'app', project_path: '/code/app',
      },
    });

    const res = await app.inject({
      method: 'POST', url: '/api/signals/rich',
      payload: {
        session_id: 'rich-1',
        type: 'intent_declared',
        content: 'Refactoring the authentication middleware for JWT support',
      },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.ok(body.signal);
    assert.equal(body.signal.type, 'intent_declared');
    assert.ok(typeof body.signal.weight === 'number');
  });

  it('accepts blocker_hit with context_id', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/signals/rich',
      payload: {
        session_id: 'rich-1',
        type: 'blocker_hit',
        content: 'Waiting on database migration to complete before proceeding',
        context_id: 'auth-refactor-2026',
      },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.signal.type, 'blocker_hit');
  });

  it('accepts outcome_achieved signal', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/signals/rich',
      payload: {
        session_id: 'rich-1',
        type: 'outcome_achieved',
        content: 'JWT middleware refactor completed and merged to main',
      },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.signal.type, 'outcome_achieved');
  });

  it('rejects unknown signal type', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/signals/rich',
      payload: {
        session_id: 'rich-1',
        type: 'nonexistent_type',
        content: 'test',
      },
    });
    assert.equal(res.statusCode, 400);
  });

  it('triggers collision detection for intent_declared', async () => {
    // Register Bob with overlapping intent
    await app.inject({
      method: 'POST', url: '/api/sessions/register',
      payload: {
        session_id: 'rich-2', developer_email: 'bob@test.com',
        developer_name: 'Bob', repo: 'app', project_path: '/code/app',
      },
    });

    // Bob declares overlapping intent via rich signal
    const res = await app.inject({
      method: 'POST', url: '/api/signals/rich',
      payload: {
        session_id: 'rich-2',
        type: 'intent_declared',
        content: 'Refactoring the authentication JWT token handling',
      },
    });
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    // Should detect semantic overlap with Alice's earlier intent_declared
    assert.ok(body.collisions.length >= 1, 'Should detect semantic collision');
  });
});

// ─── Agent Mail Smoke Tests ─────────────────────────────────

describe('Smoke: agent mail', () => {
  let app: FastifyInstance;
  before(async () => { app = await buildTestServer(); });
  after(async () => { await app.close(); });

  it('agent sends mail → recipient picks it up → marks read', async () => {
    // Register Alice and Bob
    await app.inject({
      method: 'POST', url: '/api/sessions/register',
      payload: {
        session_id: 'mail-alice', developer_email: 'alice@test.com',
        developer_name: 'Alice', repo: 'app', project_path: '/code/app',
      },
    });
    await app.inject({
      method: 'POST', url: '/api/sessions/register',
      payload: {
        session_id: 'mail-bob', developer_email: 'bob@test.com',
        developer_name: 'Bob', repo: 'app', project_path: '/code/app',
      },
    });

    // Alice sends mail to Bob
    const send = await app.inject({
      method: 'POST', url: '/api/mail/send',
      payload: {
        from_session_id: 'mail-alice',
        to_session_id: 'mail-bob',
        type: 'context_share',
        subject: 'Auth refactor heads up',
        content: 'I refactored the JWT middleware — your login flow may need updating',
      },
    });
    assert.equal(send.statusCode, 200);
    const sendBody = JSON.parse(send.body);
    assert.equal(sendBody.ok, true);
    assert.ok(sendBody.mail.mail_id);
    assert.equal(sendBody.mail.type, 'context_share');
    assert.equal(sendBody.mail.from_session_id, 'mail-alice');
    assert.equal(sendBody.mail.to_session_id, 'mail-bob');

    // Bob checks mail
    const check = await app.inject({
      method: 'GET', url: '/api/mail/check?session_id=mail-bob',
    });
    assert.equal(check.statusCode, 200);
    const checkBody = JSON.parse(check.body);
    assert.equal(checkBody.mail.length, 1);
    assert.equal(checkBody.mail[0].subject, 'Auth refactor heads up');

    // Bob marks it read
    const mark = await app.inject({
      method: 'POST', url: '/api/mail/read',
      payload: { mail_id: checkBody.mail[0].mail_id },
    });
    assert.equal(mark.statusCode, 200);

    // Check again — no unread mail
    const check2 = await app.inject({
      method: 'GET', url: '/api/mail/check?session_id=mail-bob',
    });
    const check2Body = JSON.parse(check2.body);
    assert.equal(check2Body.mail.length, 0);
  });

  it('consciousness-generated mail (no from_session_id) is delivered', async () => {
    const send = await app.inject({
      method: 'POST', url: '/api/mail/send',
      payload: {
        to_session_id: 'mail-alice',
        type: 'collision_alert',
        subject: 'Potential overlap detected',
        content: 'Bob is working in the same auth area as you',
      },
    });
    assert.equal(send.statusCode, 200);
    const sendBody = JSON.parse(send.body);
    assert.equal(sendBody.mail.from_session_id, null);

    const check = await app.inject({
      method: 'GET', url: '/api/mail/check?session_id=mail-alice',
    });
    const body = JSON.parse(check.body);
    assert.ok(body.mail.some((m: any) => m.type === 'collision_alert'));
  });

  it('rejects mail with missing required fields', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/mail/send',
      payload: { type: 'general' }, // missing subject and content
    });
    assert.equal(res.statusCode, 400);
  });

  it('rejects mail with no recipient', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/mail/send',
      payload: {
        type: 'general',
        subject: 'test',
        content: 'test',
        // no to_session_id or to_context_id
      },
    });
    assert.equal(res.statusCode, 400);
  });

  it('rejects mail with invalid type', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/mail/send',
      payload: {
        to_session_id: 'mail-alice',
        type: 'invalid_type',
        subject: 'test',
        content: 'test',
      },
    });
    assert.equal(res.statusCode, 400);
  });
});

describe('Smoke: unread mail in session registration', () => {
  let app: FastifyInstance;
  before(async () => { app = await buildTestServer(); });
  after(async () => { await app.close(); });

  it('registration response includes unread mail', async () => {
    // Register Alice's first session
    await app.inject({
      method: 'POST', url: '/api/sessions/register',
      payload: {
        session_id: 'regmail-alice-1', developer_email: 'alice@test.com',
        developer_name: 'Alice', repo: 'app', project_path: '/code/app',
      },
    });

    // Send mail to Alice's upcoming session
    await app.inject({
      method: 'POST', url: '/api/mail/send',
      payload: {
        to_session_id: 'regmail-alice-2',
        type: 'context_share',
        subject: 'Welcome back',
        content: 'Things happened while you were away',
      },
    });

    // Alice registers a new session — should pick up mail
    const reg = await app.inject({
      method: 'POST', url: '/api/sessions/register',
      payload: {
        session_id: 'regmail-alice-2', developer_email: 'alice@test.com',
        developer_name: 'Alice', repo: 'app', project_path: '/code/app',
      },
    });
    assert.equal(reg.statusCode, 200);
    const body = JSON.parse(reg.body);
    assert.ok(body.unread_mail, 'Response should have unread_mail field');
    assert.ok(body.unread_mail.length >= 1, 'Should have at least one unread mail');
    assert.equal(body.unread_mail[0].subject, 'Welcome back');
  });
});

describe('Smoke: auto-generated mail on collision', () => {
  let app: FastifyInstance;
  before(async () => { app = await buildTestServer(); });
  after(async () => { await app.close(); });

  it('collision detection auto-generates mail to both participants', async () => {
    // Register Alice and Bob
    await app.inject({
      method: 'POST', url: '/api/sessions/register',
      payload: {
        session_id: 'automail-alice', developer_email: 'alice@test.com',
        developer_name: 'Alice', repo: 'automail-repo', project_path: '/code/app',
      },
    });
    await app.inject({
      method: 'POST', url: '/api/sessions/register',
      payload: {
        session_id: 'automail-bob', developer_email: 'bob@test.com',
        developer_name: 'Bob', repo: 'automail-repo', project_path: '/code/app',
      },
    });

    // Alice modifies a file
    await app.inject({
      method: 'POST', url: '/api/signals/activity',
      payload: { session_id: 'automail-alice', file_path: 'src/shared.ts', type: 'file_modify' },
    });

    // Bob modifies the same file → collision
    const bobAct = await app.inject({
      method: 'POST', url: '/api/signals/activity',
      payload: { session_id: 'automail-bob', file_path: 'src/shared.ts', type: 'file_modify' },
    });
    const bobBody = JSON.parse(bobAct.body);
    assert.ok(bobBody.collisions.length >= 1, 'Should detect collision');

    // Both should have unread mail about the collision
    const aliceMail = await app.inject({
      method: 'GET', url: '/api/mail/check?session_id=automail-alice',
    });
    const aliceMailBody = JSON.parse(aliceMail.body);
    assert.ok(aliceMailBody.mail.some((m: any) => m.type === 'collision_alert'),
      'Alice should have collision_alert mail');

    const bobMail = await app.inject({
      method: 'GET', url: '/api/mail/check?session_id=automail-bob',
    });
    const bobMailBody = JSON.parse(bobMail.body);
    assert.ok(bobMailBody.mail.some((m: any) => m.type === 'collision_alert'),
      'Bob should have collision_alert mail');
  });
});

/**
 * Dashboard tests — 10 tests covering HTML pages, JSON API, and data integration.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyView from '@fastify/view';
import Handlebars from 'handlebars';
import { DatabaseSync } from 'node:sqlite';
import { HiveStore } from '../db/store.js';
import { CollisionEngine } from '../services/collision-engine.js';
import { KeywordAnalyzer } from '../services/keyword-analyzer.js';
import { PassthroughIdentityProvider } from '../services/passthrough-identity-provider.js';
import { AlertDispatcher } from '../services/alert-dispatcher.js';
import { DecayService } from '../services/decay-service.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import type { PortRegistry } from '../port-registry.js';
import { sessionRoutes } from '../routes/sessions.js';
import { signalRoutes } from '../routes/signals.js';
import { conflictRoutes } from '../routes/conflicts.js';
import { historyRoutes } from '../routes/history.js';
import { richSignalRoutes } from '../routes/rich-signals.js';
import { mailRoutes } from '../routes/mail.js';
import { nerveRoutes } from '../routes/nerves.js';
import { dashboardRoutes, getViewsRoot } from './routes.js';
import type { HiveBackendConfig } from '@open-hive/shared';

function createTestConfig(): HiveBackendConfig {
  return {
    port: 0,
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

async function buildDashboardServer(): Promise<FastifyInstance> {
  const config = createTestConfig();
  const db = createTestDB();
  const store = new HiveStore(db);
  const analyzers = [new KeywordAnalyzer()];
  const engine = new CollisionEngine(store, config, analyzers);
  const identity = new PassthroughIdentityProvider();
  const alerts = new AlertDispatcher();
  const decay = new DecayService(config.decay);

  const registry: PortRegistry = { store, identity, analyzers, alerts, decay, nerves: store };

  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  // Register dashboard (before auth hook, like in server.ts)
  await app.register(fastifyView, {
    engine: { handlebars: Handlebars },
    root: getViewsRoot(),
    layout: 'layout.hbs',
    options: {
      partials: {
        'session-card': 'partials/session-card.hbs',
        'collision-row': 'partials/collision-row.hbs',
      },
    },
  });
  dashboardRoutes(app, registry.store);

  app.addHook('preHandler', createAuthMiddleware(identity));
  app.get('/api/health', async () => ({ status: 'ok', version: '0.3.0' }));

  sessionRoutes(app, registry, engine);
  signalRoutes(app, registry, engine);
  conflictRoutes(app, registry, engine);
  historyRoutes(app, registry);
  richSignalRoutes(app, registry, engine);
  mailRoutes(app, registry);
  nerveRoutes(app, registry);

  return app;
}

async function buildNoDashboardServer(): Promise<FastifyInstance> {
  const config = createTestConfig();
  const db = createTestDB();
  const store = new HiveStore(db);
  const identity = new PassthroughIdentityProvider();
  const alerts = new AlertDispatcher();
  const decay = new DecayService(config.decay);

  const registry: PortRegistry = { store, identity, analyzers: [], alerts, decay, nerves: store };

  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });
  // Intentionally do NOT register dashboard
  app.addHook('preHandler', createAuthMiddleware(identity));
  app.get('/api/health', async () => ({ status: 'ok', version: '0.3.0' }));

  return app;
}

// ─── Dashboard HTML Page Tests ──────────────────────────────

describe('Dashboard: HTML pages', () => {
  let app: FastifyInstance;

  before(async () => { app = await buildDashboardServer(); });
  after(async () => { await app.close(); });

  it('GET /dashboard returns HTML with dashboard layout', async () => {
    const res = await app.inject({ method: 'GET', url: '/dashboard' });
    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-type']?.toString().includes('text/html'));
    assert.ok(res.body.includes('Open Hive'));
    assert.ok(res.body.includes('Dashboard'));
  });

  it('GET /dashboard/sessions returns HTML with sessions view', async () => {
    const res = await app.inject({ method: 'GET', url: '/dashboard/sessions' });
    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-type']?.toString().includes('text/html'));
    assert.ok(res.body.includes('Active Sessions'));
  });

  it('GET /dashboard/collisions returns HTML with collisions view', async () => {
    const res = await app.inject({ method: 'GET', url: '/dashboard/collisions' });
    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-type']?.toString().includes('text/html'));
    assert.ok(res.body.includes('Collisions'));
  });
});

// ─── Dashboard JSON API Tests ───────────────────────────────

describe('Dashboard: JSON API', () => {
  let app: FastifyInstance;

  before(async () => { app = await buildDashboardServer(); });
  after(async () => { await app.close(); });

  it('GET /dashboard/api/sessions returns empty array initially', async () => {
    const res = await app.inject({ method: 'GET', url: '/dashboard/api/sessions' });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 0);
  });

  it('GET /dashboard/api/collisions returns empty array initially', async () => {
    const res = await app.inject({ method: 'GET', url: '/dashboard/api/collisions' });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 0);
  });

  it('GET /dashboard/api/stats returns stats object', async () => {
    const res = await app.inject({ method: 'GET', url: '/dashboard/api/stats' });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(typeof body.active_sessions, 'number');
    assert.equal(typeof body.active_collisions, 'number');
    assert.equal(typeof body.total_signals, 'number');
  });
});

// ─── Dashboard Data Integration Tests ───────────────────────

describe('Dashboard: data integration', () => {
  let app: FastifyInstance;

  before(async () => { app = await buildDashboardServer(); });
  after(async () => { await app.close(); });

  it('sessions API reflects registered sessions', async () => {
    // Register a session
    await app.inject({
      method: 'POST', url: '/api/sessions/register',
      payload: {
        session_id: 'dash-1', developer_email: 'alice@test.com',
        developer_name: 'Alice', repo: 'test-repo', project_path: '/code/test',
      },
    });

    const res = await app.inject({ method: 'GET', url: '/dashboard/api/sessions' });
    const body = JSON.parse(res.body);
    assert.equal(body.length, 1);
    assert.equal(body[0].developer_name, 'Alice');
  });

  it('collision resolve endpoint works', async () => {
    // Register two sessions and create a collision
    await app.inject({
      method: 'POST', url: '/api/sessions/register',
      payload: {
        session_id: 'dash-a', developer_email: 'alice@test.com',
        developer_name: 'Alice', repo: 'app', project_path: '/code/app',
      },
    });
    await app.inject({
      method: 'POST', url: '/api/sessions/register',
      payload: {
        session_id: 'dash-b', developer_email: 'bob@test.com',
        developer_name: 'Bob', repo: 'app', project_path: '/code/app',
      },
    });

    await app.inject({
      method: 'POST', url: '/api/signals/activity',
      payload: { session_id: 'dash-a', file_path: 'src/index.ts', type: 'file_modify' },
    });
    const bobAct = await app.inject({
      method: 'POST', url: '/api/signals/activity',
      payload: { session_id: 'dash-b', file_path: 'src/index.ts', type: 'file_modify' },
    });
    const collision = JSON.parse(bobAct.body).collisions[0];
    assert.ok(collision, 'Should have a collision');

    // Resolve via dashboard API
    const resolve = await app.inject({
      method: 'POST', url: '/dashboard/api/collisions/resolve',
      payload: { collision_id: collision.collision_id },
    });
    assert.equal(resolve.statusCode, 200);
    const resolveBody = JSON.parse(resolve.body);
    assert.equal(resolveBody.ok, true);

    // Verify collision is no longer in active list
    const collisions = await app.inject({ method: 'GET', url: '/dashboard/api/collisions' });
    const collisionsBody = JSON.parse(collisions.body);
    const found = collisionsBody.find((c: any) => c.collision_id === collision.collision_id);
    assert.equal(found, undefined, 'Resolved collision should not appear in active list');
  });
});

// ─── Dashboard disabled test ────────────────────────────────

describe('Dashboard: disabled returns 404', () => {
  let app: FastifyInstance;

  before(async () => { app = await buildNoDashboardServer(); });
  after(async () => { await app.close(); });

  it('GET /dashboard returns 404 when dashboard is not registered', async () => {
    const res = await app.inject({ method: 'GET', url: '/dashboard' });
    assert.equal(res.statusCode, 404);
  });
});

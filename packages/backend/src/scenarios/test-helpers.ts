/**
 * Shared test infrastructure for scenario tests.
 *
 * Provides buildScenarioServer() and ok() helper used by all scenarios.
 * Each scenario gets its own in-memory SQLite database — fully isolated.
 */
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
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
import type { HiveBackendConfig } from '@open-hive/shared';

export interface ScenarioServer {
  app: FastifyInstance;
  store: HiveStore;
  config: HiveBackendConfig;
}

export function buildScenarioServer(overrides?: Partial<HiveBackendConfig>): Promise<ScenarioServer> {
  const config: HiveBackendConfig = {
    port: 0,
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
    ...overrides,
  };

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

  const store = new HiveStore(db);
  const analyzers = [new KeywordAnalyzer()];
  const engine = new CollisionEngine(store, config, analyzers);
  const identity = new PassthroughIdentityProvider();
  const alerts = new AlertDispatcher();
  const decay = new DecayService(config.decay);
  const registry: PortRegistry = { store, identity, analyzers, alerts, decay, nerves: store };

  const app = Fastify({ logger: false });
  app.register(cors, { origin: true });
  app.addHook('preHandler', createAuthMiddleware(identity));
  app.get('/api/health', async () => ({
    status: 'ok',
    version: '0.3.0',
    active_nerves: (await registry.nerves.getActiveNerves()).length,
  }));

  sessionRoutes(app, registry, engine);
  signalRoutes(app, registry, engine);
  conflictRoutes(app, registry, engine);
  historyRoutes(app, registry);
  richSignalRoutes(app, registry, engine);
  mailRoutes(app, registry);
  nerveRoutes(app, registry);

  return app.ready().then(() => ({ app, store, config }));
}

/** Inject a request and assert 200, return parsed body */
export async function ok(app: FastifyInstance, method: string, url: string, payload?: unknown) {
  const res = await app.inject({ method: method as any, url, payload: payload as any });
  assert.equal(res.statusCode, 200, `${method} ${url} → ${res.statusCode}: ${res.body}`);
  return JSON.parse(res.body);
}

/** Inject a request and return the raw response (for testing non-200 cases) */
export async function inject(app: FastifyInstance, method: string, url: string, payload?: unknown) {
  return app.inject({ method: method as any, url, payload: payload as any });
}

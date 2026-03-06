import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadConfig } from './env.js';
import { createStore } from './db/index.js';
import { CollisionEngine } from './services/collision-engine.js';
import { KeywordAnalyzer } from './services/keyword-analyzer.js';
import { PassthroughIdentityProvider } from './services/passthrough-identity-provider.js';
import { AlertDispatcher } from './services/alert-dispatcher.js';
import { GenericWebhookSink } from './services/generic-webhook-sink.js';
import { createAuthMiddleware } from './middleware/auth.js';
import type { PortRegistry } from './port-registry.js';
import type { ISemanticAnalyzer } from '@open-hive/shared';
import { sessionRoutes } from './routes/sessions.js';
import { signalRoutes } from './routes/signals.js';
import { conflictRoutes } from './routes/conflicts.js';
import { historyRoutes } from './routes/history.js';

const config = loadConfig();
const store = createStore(config);

// --- Wire analyzers ---
const analyzers: ISemanticAnalyzer[] = [];
if (config.collision.semantic.keywords_enabled) {
  analyzers.push(new KeywordAnalyzer());
}

const engine = new CollisionEngine(store, config, analyzers);

// --- Wire identity provider ---
const identity = new PassthroughIdentityProvider();

// --- Wire alert dispatcher + sinks ---
const alertDispatcher = new AlertDispatcher();

// Register sinks from alerts.webhook_urls (new config)
for (const url of config.alerts.webhook_urls) {
  alertDispatcher.registerSink(new GenericWebhookSink(url, config.alerts.min_severity));
}

// Backwards compat: also register sinks from webhooks.urls (legacy config)
// Avoid duplicates if the same URL appears in both configs
const alertUrls = new Set(config.alerts.webhook_urls);
for (const url of config.webhooks.urls) {
  if (!alertUrls.has(url)) {
    alertDispatcher.registerSink(new GenericWebhookSink(url, config.alerts.min_severity));
  }
}

// --- Build registry ---
const registry: PortRegistry = {
  store,
  identity,
  analyzers,
  alerts: alertDispatcher,
};

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
app.addHook('preHandler', createAuthMiddleware(identity));

app.get('/api/health', async () => ({ status: 'ok', version: '0.2.0' }));

sessionRoutes(app, registry, engine);
signalRoutes(app, registry, engine);
conflictRoutes(app, registry, engine);
historyRoutes(app, registry);

// Periodic cleanup of stale sessions
const cleanupIntervalMs = config.session.heartbeat_interval_seconds * 1000;
setInterval(async () => {
  try {
    const cleaned = await store.cleanupStaleSessions(config.session.idle_timeout_seconds);
    if (cleaned.length > 0) {
      app.log.info({ count: cleaned.length, session_ids: cleaned }, 'Cleaned up stale sessions');
    }
  } catch (err) {
    app.log.error({ err }, 'Failed to cleanup stale sessions');
  }
}, cleanupIntervalMs);

await app.listen({ port: config.port, host: '0.0.0.0' });
app.log.info(`Open Hive backend listening on port ${config.port}`);

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadConfig } from './env.js';
import { createStore } from './db/index.js';
import { CollisionEngine } from './services/collision-engine.js';
import { KeywordAnalyzer } from './services/keyword-analyzer.js';
import { EmbeddingAnalyzer } from './services/embedding-analyzer.js';
import { LLMAnalyzer } from './services/llm-analyzer.js';
import { PassthroughIdentityProvider } from './services/passthrough-identity-provider.js';
import { AzureDevOpsOAuthProvider } from './services/azure-devops-oauth-provider.js';
import { AlertDispatcher } from './services/alert-dispatcher.js';
import { GenericWebhookSink } from './services/generic-webhook-sink.js';
import { DecayService } from './services/decay-service.js';
import { createAuthMiddleware } from './middleware/auth.js';
import type { PortRegistry } from './port-registry.js';
import type { ISemanticAnalyzer } from '@open-hive/shared';
import { sessionRoutes } from './routes/sessions.js';
import { signalRoutes } from './routes/signals.js';
import { conflictRoutes } from './routes/conflicts.js';
import { historyRoutes } from './routes/history.js';
import { richSignalRoutes } from './routes/rich-signals.js';
import { mailRoutes } from './routes/mail.js';
import { nerveRoutes } from './routes/nerves.js';
import { authAzureDevOpsRoutes } from './routes/auth-azure-devops.js';
import fastifyView from '@fastify/view';
import Handlebars from 'handlebars';
import { dashboardRoutes, getViewsRoot } from './dashboard/routes.js';

const config = loadConfig();
const store = createStore(config);

// --- Wire analyzers ---
const analyzers: ISemanticAnalyzer[] = [];
if (config.collision.semantic.keywords_enabled) {
  analyzers.push(new KeywordAnalyzer());
}
if (config.collision.semantic.embeddings_enabled) {
  analyzers.push(new EmbeddingAnalyzer({
    provider: config.collision.semantic.embeddings_provider!,
    apiKey: config.collision.semantic.embeddings_api_key,
    baseUrl: config.collision.semantic.embeddings_base_url,
    model: config.collision.semantic.embeddings_model,
    threshold: 0.75,
  }));
}
if (config.collision.semantic.llm_enabled) {
  analyzers.push(new LLMAnalyzer({
    provider: config.collision.semantic.llm_provider! as 'openai' | 'anthropic' | 'ollama' | 'generic',
    apiKey: config.collision.semantic.llm_api_key,
    baseUrl: config.collision.semantic.llm_base_url,
    model: config.collision.semantic.llm_model,
    confidenceThreshold: config.collision.semantic.llm_confidence_threshold,
    rateLimitPerMin: config.collision.semantic.llm_rate_limit_per_min,
  }));
}

const engine = new CollisionEngine(store, config, analyzers);

// --- Wire identity provider ---
const authConfig = config.identity;
const identity = authConfig.auth_enabled && authConfig.provider === 'azure-devops'
  ? new AzureDevOpsOAuthProvider({
      clientId: authConfig.azure_devops_client_id!,
      clientSecret: authConfig.azure_devops_client_secret!,
      jwtSecret: authConfig.jwt_secret!,
      azureDevOpsOrg: authConfig.azure_devops_org,
    })
  : new PassthroughIdentityProvider();

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

// --- Wire decay service ---
const decay = new DecayService(config.decay);

// --- Build registry ---
const registry: PortRegistry = {
  store,
  identity,
  analyzers,
  alerts: alertDispatcher,
  decay,
  nerves: store,
};

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

// --- Dashboard (before auth hook so dashboard pages don't require auth) ---
const dashboardEnabled = process.env.DASHBOARD_ENABLED !== 'false';
if (dashboardEnabled) {
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
}

app.addHook('preHandler', createAuthMiddleware(identity));

app.get('/api/health', async () => {
  const nerves = await registry.nerves.getActiveNerves();
  return {
    status: 'ok',
    version: '0.3.0',
    active_nerves: nerves.length,
  };
});

sessionRoutes(app, registry, engine);
signalRoutes(app, registry, engine);
conflictRoutes(app, registry, engine);
historyRoutes(app, registry);
richSignalRoutes(app, registry, engine);
mailRoutes(app, registry);
nerveRoutes(app, registry);
authAzureDevOpsRoutes(app, config);

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

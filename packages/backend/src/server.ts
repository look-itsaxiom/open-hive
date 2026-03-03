import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadConfig } from './env.js';
import { createStore } from './db/index.js';
import { CollisionEngine } from './services/collision-engine.js';
import { NotificationDispatcher } from './services/notification-dispatcher.js';
import { authenticate } from './middleware/auth.js';
import { sessionRoutes } from './routes/sessions.js';
import { signalRoutes } from './routes/signals.js';
import { conflictRoutes } from './routes/conflicts.js';
import { historyRoutes } from './routes/history.js';

const config = loadConfig();
const store = createStore(config);
const engine = new CollisionEngine(store, config);
const dispatcher = new NotificationDispatcher(config.webhooks.urls);

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
app.addHook('preHandler', authenticate);

app.get('/api/health', async () => ({ status: 'ok', version: '0.2.0' }));

sessionRoutes(app, store, engine, dispatcher);
signalRoutes(app, store, engine, dispatcher);
conflictRoutes(app, store, engine, dispatcher);
historyRoutes(app, store);

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

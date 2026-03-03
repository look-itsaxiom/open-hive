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

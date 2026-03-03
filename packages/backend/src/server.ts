import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadConfig } from './env.js';

const config = loadConfig();

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

app.get('/api/health', async () => ({ status: 'ok', version: '0.1.0' }));

await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`Open Hive backend listening on port ${config.port}`);

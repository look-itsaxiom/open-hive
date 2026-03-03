import type { FastifyInstance } from 'fastify';
import type { HiveStore } from '../db/store.js';
import type { HistoryRequest } from '@open-hive/shared';

export function historyRoutes(app: FastifyInstance, store: HiveStore) {
  app.get<{ Querystring: HistoryRequest }>('/api/history', async (req) => {
    const signals = await store.getRecentSignals({
      file_path: req.query.file_path,
      area: req.query.area,
      since: req.query.since,
      limit: req.query.limit,
    });
    return { signals };
  });
}

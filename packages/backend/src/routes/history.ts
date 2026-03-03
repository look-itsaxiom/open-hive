import type { FastifyInstance } from 'fastify';
import type { HiveStore } from '../db/store.js';
import type { HistoryRequest, HistoryResponse } from '@open-hive/shared';

export function historyRoutes(app: FastifyInstance, store: HiveStore) {
  app.get<{ Querystring: HistoryRequest }>('/api/history', async (req) => {
    const signals = await store.getRecentSignals({
      repo: req.query.repo,
      file_path: req.query.file_path,
      area: req.query.area,
      since: req.query.since,
      limit: req.query.limit,
    });

    // Collect unique session IDs from returned signals
    const sessionIds = [...new Set(signals.map(s => s.session_id))];
    const sessions = (await Promise.all(
      sessionIds.map(id => store.getSession(id))
    ))
      .filter(Boolean)
      .map(s => ({
        session_id: s!.session_id,
        developer_name: s!.developer_name,
        repo: s!.repo,
        intent: s!.intent,
        started_at: s!.started_at,
      }));

    return { signals, sessions } satisfies HistoryResponse;
  });
}

import type { FastifyInstance } from 'fastify';
import type { IHiveStore } from '../db/store.js';
import type { HistoryRequest, HistoryResponse } from '@open-hive/shared';

export function historyRoutes(app: FastifyInstance, store: IHiveStore) {
  app.get<{ Querystring: HistoryRequest }>('/api/history', async (req, reply) => {
    try {
      const { limit } = req.query;

      if (limit !== undefined && (typeof limit !== 'number' || limit < 1 || !Number.isInteger(limit))) {
        return reply.status(400).send({
          ok: false,
          error: 'Invalid limit: must be a positive integer',
        });
      }

      if (req.query.since) {
        const sinceDate = new Date(req.query.since);
        if (isNaN(sinceDate.getTime())) {
          return reply.status(400).send({
            ok: false,
            error: 'Invalid since: must be a valid ISO 8601 date string',
          });
        }
      }

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
    } catch (err) {
      req.log.error(err, 'Failed to fetch history');
      return reply.status(500).send({ ok: false, error: 'Internal server error' });
    }
  });
}

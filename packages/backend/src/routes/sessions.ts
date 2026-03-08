import type { FastifyInstance } from 'fastify';
import type { PortRegistry } from '../port-registry.js';
import type { CollisionEngine } from '../services/collision-engine.js';
import type { RegisterSessionRequest, RegisterSessionResponse, EndSessionRequest } from '@open-hive/shared';

export function sessionRoutes(app: FastifyInstance, registry: PortRegistry, _engine: CollisionEngine) {
  const { store } = registry;

  app.post<{ Body: RegisterSessionRequest }>('/api/sessions/register', async (req, reply) => {
    try {
      const { session_id, developer_email, developer_name, repo, project_path } = req.body ?? {};

      if (!session_id || !developer_email || !developer_name || !repo || !project_path) {
        return reply.status(400).send({
          ok: false,
          error: 'Missing required fields: session_id, developer_email, developer_name, repo, project_path',
        });
      }

      await store.createSession({
        session_id,
        developer_email,
        developer_name,
        repo,
        project_path,
        started_at: new Date().toISOString(),
        intent: null,
      });

      const since48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

      const [active_collisions, activeSessions, recentIntents] = await Promise.all([
        store.getActiveCollisions(session_id),
        store.getActiveSessions(repo),
        store.getRecentIntents({ repo, exclude_session_id: session_id, since: since48h, limit: 50 }),
      ]);

      const active_sessions_in_repo = activeSessions
        .filter(s => s.session_id !== session_id)
        .map(s => ({
          session_id: s.session_id,
          developer_name: s.developer_name,
          intent: s.intent,
          areas: s.areas,
        }));

      // Deduplicate historical intents by session, filter out currently active ones
      const activeIds = new Set(activeSessions.map(s => s.session_id));
      const seen = new Set<string>();
      const recent_historical_intents = recentIntents
        .filter(hi => {
          if (activeIds.has(hi.session_id)) return false;
          if (seen.has(hi.session_id)) return false;
          seen.add(hi.session_id);
          return true;
        })
        .map(hi => ({
          developer_name: hi.developer_name,
          intent: hi.intent,
          timestamp: hi.timestamp,
        }));

      const unreadMail = await store.getUnreadMail(session_id);

      return {
        ok: true,
        active_collisions,
        active_sessions_in_repo,
        recent_historical_intents,
        unread_mail: unreadMail,
      } satisfies RegisterSessionResponse;
    } catch (err) {
      req.log.error(err, 'Failed to register session');
      return reply.status(500).send({ ok: false, error: 'Internal server error' });
    }
  });

  app.post<{ Body: { session_id: string } }>('/api/sessions/heartbeat', async (req, reply) => {
    try {
      const { session_id } = req.body ?? {};

      if (!session_id) {
        return reply.status(400).send({ ok: false, error: 'Missing required field: session_id' });
      }

      const session = await store.getSession(session_id);
      if (!session) {
        return reply.status(404).send({ ok: false, error: `Session not found: ${session_id}` });
      }

      await store.updateSessionActivity(session_id, {});
      return { ok: true };
    } catch (err) {
      req.log.error(err, 'Failed to process heartbeat');
      return reply.status(500).send({ ok: false, error: 'Internal server error' });
    }
  });

  app.post<{ Body: EndSessionRequest }>('/api/sessions/end', async (req, reply) => {
    try {
      const { session_id } = req.body ?? {};

      if (!session_id) {
        return reply.status(400).send({ ok: false, error: 'Missing required field: session_id' });
      }

      const session = await store.getSession(session_id);
      if (!session) {
        return reply.status(404).send({ ok: false, error: `Session not found: ${session_id}` });
      }

      await store.endSession(session_id);
      return { ok: true };
    } catch (err) {
      req.log.error(err, 'Failed to end session');
      return reply.status(500).send({ ok: false, error: 'Internal server error' });
    }
  });

  app.get<{ Querystring: { repo?: string; team?: string } }>('/api/sessions/active', async (req, reply) => {
    try {
      const sessions = await store.getActiveSessions(req.query.repo);
      return { sessions };
    } catch (err) {
      req.log.error(err, 'Failed to list active sessions');
      return reply.status(500).send({ ok: false, error: 'Internal server error' });
    }
  });
}

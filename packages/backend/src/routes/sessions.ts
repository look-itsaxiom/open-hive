import type { FastifyInstance } from 'fastify';
import type { HiveStore } from '../db/store.js';
import type { CollisionEngine } from '../services/collision-engine.js';
import type { RegisterSessionRequest, RegisterSessionResponse, EndSessionRequest } from '@open-hive/shared';

export function sessionRoutes(app: FastifyInstance, store: HiveStore, engine: CollisionEngine) {
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

      const active_collisions = await store.getActiveCollisions(session_id);
      const active_sessions_in_repo = (await store.getActiveSessions(repo))
        .filter(s => s.session_id !== session_id)
        .map(s => ({
          session_id: s.session_id,
          developer_name: s.developer_name,
          intent: s.intent,
          areas: s.areas,
        }));

      return {
        ok: true,
        active_collisions,
        active_sessions_in_repo,
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

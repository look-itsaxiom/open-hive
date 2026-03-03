import type { FastifyInstance } from 'fastify';
import type { HiveStore } from '../db/store.js';
import type { CollisionEngine } from '../services/collision-engine.js';
import type { RegisterSessionRequest, RegisterSessionResponse, EndSessionRequest } from '@open-hive/shared';

export function sessionRoutes(app: FastifyInstance, store: HiveStore, engine: CollisionEngine) {
  app.post<{ Body: RegisterSessionRequest }>('/api/sessions/register', async (req) => {
    const { session_id, developer_email, developer_name, repo, project_path } = req.body;

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
  });

  app.post<{ Body: { session_id: string } }>('/api/sessions/heartbeat', async (req) => {
    await store.updateSessionActivity(req.body.session_id, {});
    return { ok: true };
  });

  app.post<{ Body: EndSessionRequest }>('/api/sessions/end', async (req) => {
    await store.endSession(req.body.session_id);
    return { ok: true };
  });

  app.get<{ Querystring: { repo?: string; team?: string } }>('/api/sessions/active', async (req) => {
    const sessions = await store.getActiveSessions(req.query.repo);
    return { sessions };
  });
}

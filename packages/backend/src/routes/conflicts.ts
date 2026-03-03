import type { FastifyInstance } from 'fastify';
import type { HiveStore } from '../db/store.js';
import type { CollisionEngine } from '../services/collision-engine.js';
import type { CheckConflictsRequest, ResolveCollisionRequest } from '@open-hive/shared';

export function conflictRoutes(app: FastifyInstance, store: HiveStore, engine: CollisionEngine) {
  app.get<{ Querystring: CheckConflictsRequest }>('/api/conflicts/check', async (req) => {
    const { session_id, file_path, repo } = req.query;
    const collisions = await engine.checkFileCollision(session_id, file_path, repo ?? '');
    const nearby = (await store.getActiveSessions(repo))
      .filter(s => s.session_id !== session_id)
      .map(s => ({
        session_id: s.session_id,
        developer_name: s.developer_name,
        intent: s.intent,
        files_touched: s.files_touched,
      }));
    return { has_conflicts: collisions.length > 0, collisions, nearby_sessions: nearby };
  });

  app.post<{ Body: ResolveCollisionRequest }>('/api/conflicts/resolve', async (req) => {
    await store.resolveCollision(req.body.collision_id, req.body.resolved_by);
    return { ok: true };
  });
}

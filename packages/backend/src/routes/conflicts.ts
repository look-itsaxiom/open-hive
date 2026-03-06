import type { FastifyInstance } from 'fastify';
import type { PortRegistry } from '../port-registry.js';
import type { CollisionEngine } from '../services/collision-engine.js';
import { buildAlertEvent } from '../port-registry.js';
import type { CheckConflictsRequest, ResolveCollisionRequest } from '@open-hive/shared';

export function conflictRoutes(app: FastifyInstance, registry: PortRegistry, engine: CollisionEngine) {
  const { store, alerts } = registry;

  app.get<{ Querystring: CheckConflictsRequest }>('/api/conflicts/check', async (req, reply) => {
    try {
      const { session_id, file_path, repo } = req.query;

      if (!session_id || !file_path) {
        return reply.status(400).send({
          ok: false,
          error: 'Missing required query parameters: session_id, file_path',
        });
      }

      const collisions = await engine.checkFileCollision(session_id, file_path, repo ?? '');

      for (const collision of collisions) {
        const event = await buildAlertEvent(store, 'collision_detected', collision);
        alerts.dispatch(event);
      }

      const nearby = (await store.getActiveSessions(repo))
        .filter(s => s.session_id !== session_id)
        .map(s => ({
          session_id: s.session_id,
          developer_name: s.developer_name,
          intent: s.intent,
          files_touched: s.files_touched,
        }));

      return { has_conflicts: collisions.length > 0, collisions, nearby_sessions: nearby };
    } catch (err) {
      req.log.error(err, 'Failed to check conflicts');
      return reply.status(500).send({ ok: false, error: 'Internal server error' });
    }
  });

  app.post<{ Body: ResolveCollisionRequest }>('/api/conflicts/resolve', async (req, reply) => {
    try {
      const { collision_id, resolved_by } = req.body ?? {};

      if (!collision_id || !resolved_by) {
        return reply.status(400).send({
          ok: false,
          error: 'Missing required fields: collision_id, resolved_by',
        });
      }

      // Fetch collision before resolving so we can notify
      const activeCollisions = await store.getActiveCollisions();
      const collision = activeCollisions.find(c => c.collision_id === collision_id);

      await store.resolveCollision(collision_id, resolved_by);

      if (collision) {
        const event = await buildAlertEvent(store, 'collision_resolved', collision);
        alerts.dispatch(event);
      }

      return { ok: true };
    } catch (err) {
      req.log.error(err, 'Failed to resolve collision');
      return reply.status(500).send({ ok: false, error: 'Internal server error' });
    }
  });
}

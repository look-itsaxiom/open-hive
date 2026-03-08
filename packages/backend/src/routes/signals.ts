import type { FastifyInstance } from 'fastify';
import { dirname } from 'node:path';
import type { PortRegistry } from '../port-registry.js';
import type { CollisionEngine } from '../services/collision-engine.js';
import { buildAlertEvent } from '../port-registry.js';
import type { IntentSignalRequest, IntentSignalResponse, ActivitySignalRequest, ActivitySignalResponse } from '@open-hive/shared';

export function signalRoutes(app: FastifyInstance, registry: PortRegistry, engine: CollisionEngine) {
  const { store, alerts } = registry;

  app.post<{ Body: IntentSignalRequest }>('/api/signals/intent', async (req, reply) => {
    try {
      const { session_id, content, type } = req.body ?? {};

      if (!session_id || !content || !type) {
        return reply.status(400).send({
          ok: false,
          collisions: [],
          error: 'Missing required fields: session_id, content, type',
        });
      }

      const session = await store.getSession(session_id);
      if (!session) {
        return reply.status(404).send({ ok: false, collisions: [], error: `Session not found: ${session_id}` });
      }

      await store.createSignal({
        session_id,
        timestamp: new Date().toISOString(),
        type,
        content,
        file_path: null,
        semantic_area: null,
        weight: 1.0,
      });

      await store.updateSessionActivity(session_id, { intent: content });

      const [liveCollisions, historicalCollisions] = await Promise.all([
        engine.checkIntentCollision(session_id, content, session.repo),
        engine.checkHistoricalIntentCollision(session_id, content, session.repo),
      ]);
      const collisions = [...liveCollisions, ...historicalCollisions];

      for (const collision of collisions) {
        const event = await buildAlertEvent(store, 'collision_detected', collision);
        alerts.dispatch(event);

        // Consciousness generates mail for each participant
        for (const sid of collision.session_ids) {
          await store.createMail({
            from_session_id: null,
            to_session_id: sid,
            to_context_id: null,
            type: 'collision_alert',
            subject: `Collision detected: ${collision.type} (${collision.severity})`,
            content: collision.details,
            created_at: new Date().toISOString(),
          });
        }
      }

      return { ok: true, collisions } satisfies IntentSignalResponse;
    } catch (err) {
      req.log.error(err, 'Failed to process intent signal');
      return reply.status(500).send({ ok: false, collisions: [], error: 'Internal server error' });
    }
  });

  app.post<{ Body: ActivitySignalRequest }>('/api/signals/activity', async (req, reply) => {
    try {
      const { session_id, file_path, type } = req.body ?? {};

      if (!session_id || !file_path || !type) {
        return reply.status(400).send({
          ok: false,
          collisions: [],
          error: 'Missing required fields: session_id, file_path, type',
        });
      }

      if (type !== 'file_modify' && type !== 'file_read') {
        return reply.status(400).send({
          ok: false,
          collisions: [],
          error: 'Invalid type: must be "file_modify" or "file_read"',
        });
      }

      const session = await store.getSession(session_id);
      if (!session) {
        return reply.status(404).send({ ok: false, collisions: [], error: `Session not found: ${session_id}` });
      }

      await store.createSignal({
        session_id,
        timestamp: new Date().toISOString(),
        type,
        content: file_path,
        file_path,
        semantic_area: dirname(file_path),
        weight: 1.0,
      });

      const updates: { files_touched?: string[]; areas?: string[] } = {
        areas: [dirname(file_path)],
      };
      if (type === 'file_modify') {
        updates.files_touched = [file_path];
      }
      await store.updateSessionActivity(session_id, updates);

      let collisions: Awaited<ReturnType<CollisionEngine['checkFileCollision']>> = [];
      if (type === 'file_modify') {
        collisions = await engine.checkFileCollision(session_id, file_path, session.repo);

        for (const collision of collisions) {
          const event = await buildAlertEvent(store, 'collision_detected', collision);
          alerts.dispatch(event);

          // Consciousness generates mail for each participant
          for (const sid of collision.session_ids) {
            await store.createMail({
              from_session_id: null,
              to_session_id: sid,
              to_context_id: null,
              type: 'collision_alert',
              subject: `Collision detected: ${collision.type} (${collision.severity})`,
              content: collision.details,
              created_at: new Date().toISOString(),
            });
          }
        }
      }

      return { ok: true, collisions } satisfies ActivitySignalResponse;
    } catch (err) {
      req.log.error(err, 'Failed to process activity signal');
      return reply.status(500).send({ ok: false, collisions: [], error: 'Internal server error' });
    }
  });
}

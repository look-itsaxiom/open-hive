import type { FastifyInstance } from 'fastify';
import { dirname } from 'node:path';
import type { PortRegistry } from '../port-registry.js';
import type { CollisionEngine } from '../services/collision-engine.js';
import { buildAlertEvent } from '../port-registry.js';
import type { RichSignalRequest, RichSignalResponse, SignalType } from '@open-hive/shared';

const VALID_SIGNAL_TYPES: Set<string> = new Set([
  'prompt', 'file_modify', 'file_read', 'search', 'explicit',
  'intent_declared', 'outcome_achieved', 'blocker_hit',
  'context_needed', 'dependency_discovered', 'state_report',
]);

// Signal types that represent intent and should trigger collision detection
const INTENT_TYPES: Set<string> = new Set([
  'prompt', 'intent_declared',
]);

// Signal types that represent file activity and should trigger file collision detection
const FILE_TYPES: Set<string> = new Set([
  'file_modify',
]);

export function richSignalRoutes(app: FastifyInstance, registry: PortRegistry, engine: CollisionEngine) {
  const { store, alerts } = registry;

  app.post<{ Body: RichSignalRequest }>('/api/signals/rich', async (req, reply) => {
    try {
      const { session_id, type, content, file_path, semantic_area, context_id } = req.body ?? {};

      if (!session_id || !type || !content) {
        return reply.status(400).send({
          ok: false,
          error: 'Missing required fields: session_id, type, content',
        });
      }

      if (!VALID_SIGNAL_TYPES.has(type)) {
        return reply.status(400).send({
          ok: false,
          error: `Invalid signal type: ${type}`,
        });
      }

      const session = await store.getSession(session_id);
      if (!session) {
        return reply.status(404).send({
          ok: false,
          error: `Session not found: ${session_id}`,
        });
      }

      // Create the signal
      const signal = await store.createSignal({
        session_id,
        timestamp: new Date().toISOString(),
        type: type as SignalType,
        content,
        file_path: file_path ?? null,
        semantic_area: semantic_area ?? (file_path ? dirname(file_path) : null),
        weight: 1.0,
      });

      // Update session activity based on signal type
      const updates: { intent?: string; files_touched?: string[]; areas?: string[] } = {};
      if (INTENT_TYPES.has(type)) {
        updates.intent = content;
      }
      if (file_path) {
        if (FILE_TYPES.has(type)) {
          updates.files_touched = [file_path];
        }
        updates.areas = [dirname(file_path)];
      }
      if (Object.keys(updates).length > 0) {
        await store.updateSessionActivity(session_id, updates);
      }

      // Run collision detection for relevant signal types
      let collisions: any[] = [];

      if (INTENT_TYPES.has(type)) {
        const [liveCollisions, historicalCollisions] = await Promise.all([
          engine.checkIntentCollision(session_id, content, session.repo),
          engine.checkHistoricalIntentCollision(session_id, content, session.repo),
        ]);
        collisions = [...liveCollisions, ...historicalCollisions];
      } else if (FILE_TYPES.has(type) && file_path) {
        collisions = await engine.checkFileCollision(session_id, file_path, session.repo);
      }

      // Dispatch alerts for any detected collisions
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

      return { ok: true, signal, collisions } satisfies RichSignalResponse;
    } catch (err) {
      req.log.error(err, 'Failed to process rich signal');
      return reply.status(500).send({ ok: false, error: 'Internal server error' });
    }
  });
}

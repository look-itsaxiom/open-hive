import type { FastifyInstance } from 'fastify';
import { dirname } from 'node:path';
import type { IHiveStore } from '../db/store.js';
import type { CollisionEngine } from '../services/collision-engine.js';
import type { NotificationDispatcher } from '../services/notification-dispatcher.js';
import type { IntentSignalRequest, IntentSignalResponse, ActivitySignalRequest, ActivitySignalResponse } from '@open-hive/shared';

export function signalRoutes(app: FastifyInstance, store: IHiveStore, engine: CollisionEngine, dispatcher: NotificationDispatcher) {
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
      });

      await store.updateSessionActivity(session_id, { intent: content });

      const [liveCollisions, historicalCollisions] = await Promise.all([
        engine.checkIntentCollision(session_id, content, session.repo),
        engine.checkHistoricalIntentCollision(session_id, content, session.repo),
      ]);
      const collisions = [...liveCollisions, ...historicalCollisions];

      for (const collision of collisions) {
        const sessionData = await Promise.all(
          collision.session_ids.map(id => store.getSession(id))
        );
        const sessions = sessionData.filter(Boolean).map(s => ({
          developer_name: s!.developer_name,
          developer_email: s!.developer_email,
          repo: s!.repo,
          intent: s!.intent,
        }));
        dispatcher.notify('collision_detected', collision, sessions);
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
          const sessionData = await Promise.all(
            collision.session_ids.map(id => store.getSession(id))
          );
          const sessions = sessionData.filter(Boolean).map(s => ({
            developer_name: s!.developer_name,
            developer_email: s!.developer_email,
            repo: s!.repo,
            intent: s!.intent,
          }));
          dispatcher.notify('collision_detected', collision, sessions);
        }
      }

      return { ok: true, collisions } satisfies ActivitySignalResponse;
    } catch (err) {
      req.log.error(err, 'Failed to process activity signal');
      return reply.status(500).send({ ok: false, collisions: [], error: 'Internal server error' });
    }
  });
}

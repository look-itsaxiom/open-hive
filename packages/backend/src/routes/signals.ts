import type { FastifyInstance } from 'fastify';
import { dirname } from 'node:path';
import type { HiveStore } from '../db/store.js';
import type { CollisionEngine } from '../services/collision-engine.js';
import type { IntentSignalRequest, IntentSignalResponse, ActivitySignalRequest, ActivitySignalResponse } from '@open-hive/shared';

export function signalRoutes(app: FastifyInstance, store: HiveStore, engine: CollisionEngine) {
  app.post<{ Body: IntentSignalRequest }>('/api/signals/intent', async (req) => {
    const { session_id, content, type } = req.body;
    const session = await store.getSession(session_id);
    if (!session) return { ok: false, collisions: [] };

    await store.createSignal({
      session_id,
      timestamp: new Date().toISOString(),
      type,
      content,
      file_path: null,
      semantic_area: null,
    });

    await store.updateSessionActivity(session_id, { intent: content });

    const collisions = await engine.checkIntentCollision(session_id, content, session.repo);
    return { ok: true, collisions } satisfies IntentSignalResponse;
  });

  app.post<{ Body: ActivitySignalRequest }>('/api/signals/activity', async (req) => {
    const { session_id, file_path, type } = req.body;
    const session = await store.getSession(session_id);
    if (!session) return { ok: false, collisions: [] };

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
    }

    return { ok: true, collisions } satisfies ActivitySignalResponse;
  });
}

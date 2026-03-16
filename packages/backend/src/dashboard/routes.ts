import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { IHiveStore } from '@open-hive/shared';

/**
 * Returns the absolute path to the views directory.
 * Works from both src/ (tsx) and dist/ (compiled JS).
 */
export function getViewsRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = dirname(thisFile);
  return join(thisDir, 'views');
}

export function dashboardRoutes(app: FastifyInstance, store: IHiveStore): void {
  // ─── HTML pages ──────────────────────────────────────────────

  app.get('/dashboard', async (_req, reply) => {
    const sessions = await store.getActiveSessions();
    const collisions = await store.getActiveCollisions();
    const signals = await store.getRecentSignals({ limit: 50 });
    return reply.view('index.hbs', {
      sessions,
      collisions: collisions.filter(c => !c.resolved),
      stats: {
        active_sessions: sessions.length,
        active_collisions: collisions.filter(c => !c.resolved).length,
        total_signals: signals.length,
      },
    });
  });

  app.get('/dashboard/sessions', async (_req, reply) => {
    const sessions = await store.getActiveSessions();
    return reply.view('sessions.hbs', { sessions });
  });

  app.get('/dashboard/collisions', async (_req, reply) => {
    const collisions = await store.getActiveCollisions();
    return reply.view('collisions.hbs', { collisions });
  });

  // ─── JSON API (htmx polling) ────────────────────────────────

  app.get('/dashboard/api/sessions', async () => {
    const sessions = await store.getActiveSessions();
    return sessions;
  });

  app.get('/dashboard/api/collisions', async () => {
    const collisions = await store.getActiveCollisions();
    return collisions.filter(c => !c.resolved);
  });

  app.get('/dashboard/api/stats', async () => {
    const sessions = await store.getActiveSessions();
    const collisions = await store.getActiveCollisions();
    const signals = await store.getRecentSignals({ limit: 50 });
    return {
      active_sessions: sessions.length,
      active_collisions: collisions.filter(c => !c.resolved).length,
      total_signals: signals.length,
    };
  });

  // ─── Actions ─────────────────────────────────────────────────

  app.post<{ Body: { collision_id: string; resolved_by?: string } }>(
    '/dashboard/api/collisions/resolve',
    async (req) => {
      const { collision_id, resolved_by } = req.body ?? {} as any;
      if (!collision_id) {
        return { ok: false, error: 'Missing collision_id' };
      }
      await store.resolveCollision(collision_id, resolved_by ?? 'dashboard-user');
      return { ok: true };
    },
  );
}

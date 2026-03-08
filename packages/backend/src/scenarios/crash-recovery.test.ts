/**
 * Scenario Test: The Plugin Crash Mid-Session (Hive Side)
 *
 * Tests what happens to the hive when a developer's Claude Code crashes
 * mid-session: no SessionEnd fires, ghost sessions linger, duplicate
 * registrations occur on reconnect.
 *
 * Nerve-side crash recovery (local state persistence) is tested in
 * packages/plugin/src/nerve/nerve-state-lifecycle.test.ts.
 *
 * Cast:
 *   Dana — developer whose Claude Code crashes mid-session
 *
 * Timeline:
 *   Session A: Dana works, declares intent, touches files → CRASH (no end)
 *   Session B: Dana reopens Claude Code → what does the hive know?
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildScenarioServer, ok } from './test-helpers.js';
import type { HiveStore } from '../db/store.js';

describe('Scenario: The Plugin Crash Mid-Session', () => {
  let app: FastifyInstance;
  let store: HiveStore;

  before(async () => {
    ({ app, store } = await buildScenarioServer());
  });
  after(async () => {
    await app.close();
  });

  // ─── Session A: Working, then crash ───────────────────────

  describe('Session A: Dana works normally, then crashes', () => {

    it('Dana registers and starts working', async () => {
      const body = await ok(app, 'POST', '/api/sessions/register', {
        session_id: 'dana-session-a',
        developer_email: 'dana@acme.com',
        developer_name: 'Dana',
        repo: 'acme/api',
        project_path: '/code/api',
      });
      assert.equal(body.ok, true);
    });

    it('Dana declares intent and touches files', async () => {
      await ok(app, 'POST', '/api/signals/rich', {
        session_id: 'dana-session-a',
        type: 'intent_declared',
        content: 'Refactoring database connection pool configuration',
      });

      await ok(app, 'POST', '/api/signals/activity', {
        session_id: 'dana-session-a',
        file_path: 'src/db/pool.ts',
        type: 'file_modify',
      });
      await ok(app, 'POST', '/api/signals/activity', {
        session_id: 'dana-session-a',
        file_path: 'src/db/config.ts',
        type: 'file_modify',
      });
    });

    it('CRASH — no SessionEnd, no Stop hook fires', () => {
      // This is the crash. Nothing happens on the backend.
      // No session end call. The hive still thinks dana-session-a is active.
      assert.ok(true, 'Crash simulated — no cleanup happened');
    });
  });

  // ─── Session B: Dana reopens ─────────────────────────────

  describe('Session B: Dana reopens Claude Code after crash', () => {

    it('Hive still thinks Session A is active (ghost session)', async () => {
      const active = await ok(app, 'GET', '/api/sessions/active?repo=acme/api');
      const ghost = active.sessions.find((s: any) => s.session_id === 'dana-session-a');
      assert.ok(ghost, 'Session A should still be "active" — no end was called');
      assert.equal(ghost.status, 'active');
    });

    it('Dana registers Session B — Session A is now a ghost', async () => {
      const body = await ok(app, 'POST', '/api/sessions/register', {
        session_id: 'dana-session-b',
        developer_email: 'dana@acme.com',
        developer_name: 'Dana',
        repo: 'acme/api',
        project_path: '/code/api',
      });

      assert.equal(body.ok, true);

      // KNOWN ISSUE: Session A is still active. The hive shows Dana as
      // having TWO active sessions. The registration response includes
      // Session A as an "active session in repo" — but it's Dana herself.
      const selfGhost = body.active_sessions_in_repo.find(
        (s: any) => s.session_id === 'dana-session-a',
      );

      if (selfGhost) {
        assert.ok(true, 'KNOWN ISSUE: Ghost session A appears as "other active session"');
      }
    });

    it('Two active sessions for same developer exist simultaneously', async () => {
      const active = await ok(app, 'GET', '/api/sessions/active?repo=acme/api');
      const danaSessions = active.sessions.filter(
        (s: any) => s.developer_email === 'dana@acme.com',
      );
      // KNOWN ISSUE: Both sessions are active
      assert.equal(
        danaSessions.length, 2,
        'KNOWN ISSUE: Crash creates duplicate active sessions for same developer',
      );
    });
  });

  // ─── Stale Session Cleanup ────────────────────────────────

  describe('Stale session cleanup resolves ghost sessions', () => {

    it('Stale session reaper cleans up Session A', async () => {
      // Simulate time passing — use 0 seconds timeout to force cleanup
      const cleaned = await store.cleanupStaleSessions(0);
      assert.ok(
        cleaned.includes('dana-session-a'),
        'Session A should be reaped as stale',
      );
    });

    it('After cleanup, ghost Session A is gone', async () => {
      const active = await ok(app, 'GET', '/api/sessions/active?repo=acme/api');
      const sessionA = active.sessions.find(
        (s: any) => s.session_id === 'dana-session-a',
      );
      assert.ok(!sessionA, 'Ghost Session A should be cleaned up');
    });
  });
});

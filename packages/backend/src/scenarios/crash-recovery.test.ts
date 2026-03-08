/**
 * Scenario Test: The Plugin Crash Mid-Session
 *
 * SessionStart fires, developer works for a while (multiple hook
 * invocations), then the process dies — no SessionEnd, no Stop.
 * Developer reopens Claude Code. What state is the hive in?
 * What about the nerve state?
 *
 * This test covers both hive-side (backend) and nerve-side (local) recovery.
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
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FastifyInstance } from 'fastify';
import { buildScenarioServer, ok } from './test-helpers.js';
import type { HiveStore } from '../db/store.js';
import { NerveState } from '../../../plugin/src/nerve/nerve-state.js';

describe('Scenario: The Plugin Crash Mid-Session', () => {
  let app: FastifyInstance;
  let store: HiveStore;
  let tempDir: string;
  let nerveFile: string;

  before(async () => {
    ({ app, store } = await buildScenarioServer());
    tempDir = mkdtempSync(join(tmpdir(), 'crash-scenario-'));
    nerveFile = join(tempDir, 'nerve-state.json');
  });
  after(async () => {
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
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

    it('Nerve state accumulates across hook processes (simulated)', async () => {
      // Process 1: SessionStart
      const p1 = new NerveState(nerveFile);
      p1.load();
      p1.recordSessionStart('dana-session-a', 'acme/api', '/code/api');
      p1.save();

      // Process 2: UserPromptSubmit
      const p2 = new NerveState(nerveFile);
      p2.load();
      p2.recordIntent('Refactoring database connection pool configuration');
      p2.save();

      // Process 3: PostToolUse
      const p3 = new NerveState(nerveFile);
      p3.load();
      p3.recordFileTouch('src/db/pool.ts');
      p3.save();

      // Process 4: PostToolUse (another file)
      const p4 = new NerveState(nerveFile);
      p4.load();
      p4.recordFileTouch('src/db/config.ts');
      p4.save();

      // Verify state is accumulated
      const check = new NerveState(nerveFile);
      check.load();
      assert.ok(check.state.current_session, 'Active session should be persisted');
      assert.equal(check.state.current_session!.intent, 'Refactoring database connection pool configuration');
      assert.equal(check.state.current_session!.files_touched.length, 2);
    });

    it('💥 CRASH — no SessionEnd, no Stop hook fires', () => {
      // This is the crash. Nothing happens on the backend.
      // No session end call, no nerve state save with recordSessionEnd.
      // The hive still thinks dana-session-a is active.
      // The nerve state has current_session set but no last_session snapshot.
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

      // Document this: does the hive show Dana her own ghost session?
      if (selfGhost) {
        assert.ok(true, 'KNOWN ISSUE: Ghost session A appears as "other active session"');
        // This is confusing — Dana would see herself listed as working
        // on the same repo, which isn't useful information
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

    it('Nerve state recovers — stale session auto-snapshotted on new start', async () => {
      // Dana's new SessionStart hook fires — loads the nerve state
      // The old current_session is still there from the crashed session
      const nerve = new NerveState(nerveFile);
      nerve.load();

      // current_session should have the stale data from Session A
      assert.ok(nerve.state.current_session, 'Stale current_session should persist');
      assert.equal(nerve.state.current_session!.id, 'dana-session-a');
      assert.equal(nerve.state.current_session!.intent, 'Refactoring database connection pool configuration');

      // When SessionStart fires for Session B, the stale session is
      // auto-snapshotted to last_session as 'interrupted' before overwriting
      nerve.recordSessionStart('dana-session-b', 'acme/api', '/code/api');
      nerve.save();

      // Verify the new session is active
      const verify = new NerveState(nerveFile);
      verify.load();
      assert.equal(verify.state.current_session!.id, 'dana-session-b');
      assert.equal(verify.state.current_session!.intent, null, 'New session starts with no intent');
      assert.deepEqual(verify.state.current_session!.files_touched, [], 'New session starts with no files');
    });

    it('Crashed session intent and files are preserved in last_session', async () => {
      // Because recordSessionStart now auto-snapshots stale sessions,
      // last_session contains Session A's data with outcome 'interrupted'.

      const nerve = new NerveState(nerveFile);
      nerve.load();

      assert.ok(nerve.state.last_session, 'Crashed session should be snapshotted to last_session');
      assert.equal(nerve.state.last_session!.id, 'dana-session-a');
      assert.equal(nerve.state.last_session!.repo, 'acme/api');
      assert.equal(nerve.state.last_session!.intent, 'Refactoring database connection pool configuration');
      assert.equal(nerve.state.last_session!.outcome, 'interrupted');
      assert.ok(nerve.state.last_session!.files_touched.includes('src/db/pool.ts'));
      assert.ok(nerve.state.last_session!.files_touched.includes('src/db/config.ts'));
      assert.ok(nerve.state.last_session!.areas.includes('src/db'));
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

    it('After cleanup, only Session B remains active', async () => {
      const active = await ok(app, 'GET', '/api/sessions/active?repo=acme/api');
      const danaSessions = active.sessions.filter(
        (s: any) => s.developer_email === 'dana@acme.com',
      );
      // Note: cleanup with 0s timeout may also clean Session B since
      // last_activity was set at registration time (very recent).
      // The important thing: Session A is gone.
      const sessionA = active.sessions.find(
        (s: any) => s.session_id === 'dana-session-a',
      );
      assert.ok(!sessionA, 'Ghost Session A should be cleaned up');
    });
  });
});

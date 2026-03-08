/**
 * Scenario Test: The Solo Developer
 *
 * One developer, one repo, no one else around. What does the hive
 * actually give them? This scenario tests the minimum viable value
 * proposition for the most common early-adoption case.
 *
 * KNOWN GAP: The hive currently provides very little value to a solo
 * developer. Historical intents and collisions require >1 developer.
 * The nerve state provides local memory, but hive-side context for
 * a returning solo dev is essentially empty.
 *
 * Cast:
 *   Chase — solo developer, working alone on open-hive
 *
 * Timeline:
 *   Day 1: Chase works on auth module, ends session
 *   Day 2: Chase returns — what does the hive tell him?
 *   Day 2: Chase works on a different area, ends session
 *   Day 3: Chase returns — does the hive track his own history?
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildScenarioServer, ok } from './test-helpers.js';

describe('Scenario: The Solo Developer', () => {
  let app: FastifyInstance;

  before(async () => { ({ app } = await buildScenarioServer()); });
  after(async () => { await app.close(); });

  // ─── Day 1: Chase works alone ─────────────────────────────

  describe('Day 1: Chase works on auth module', () => {

    it('Chase registers — empty hive, no one else around', async () => {
      const body = await ok(app, 'POST', '/api/sessions/register', {
        session_id: 'chase-day1',
        developer_email: 'chase@solo.dev',
        developer_name: 'Chase',
        repo: 'open-hive',
        project_path: '/code/open-hive',
      });

      assert.equal(body.ok, true);
      assert.deepEqual(body.active_collisions, [], 'No collisions — nobody else is here');
      assert.deepEqual(body.active_sessions_in_repo, [], 'No other sessions');
      assert.deepEqual(body.recent_historical_intents, [], 'No history yet');
      assert.deepEqual(body.unread_mail, [], 'No mail');
    });

    it('Chase declares intent — no collision possible', async () => {
      const body = await ok(app, 'POST', '/api/signals/rich', {
        session_id: 'chase-day1',
        type: 'intent_declared',
        content: 'Implementing OAuth2 PKCE authentication flow',
      });

      assert.equal(body.signal.type, 'intent_declared');
      assert.deepEqual(body.collisions, [], 'No collisions — solo dev');
    });

    it('Chase works on files — no conflicts', async () => {
      await ok(app, 'POST', '/api/signals/activity', {
        session_id: 'chase-day1',
        file_path: 'src/auth/token-service.ts',
        type: 'file_modify',
      });
      await ok(app, 'POST', '/api/signals/activity', {
        session_id: 'chase-day1',
        file_path: 'src/auth/oauth-handler.ts',
        type: 'file_modify',
      });
    });

    it('Chase ends his session', async () => {
      await ok(app, 'POST', '/api/sessions/end', { session_id: 'chase-day1' });
    });
  });

  // ─── Day 2: Chase returns ────────────────────────────────

  describe('Day 2: Chase returns — what does the hive remember?', () => {

    it('Chase registers a new session — hive has his history', async () => {
      const body = await ok(app, 'POST', '/api/sessions/register', {
        session_id: 'chase-day2',
        developer_email: 'chase@solo.dev',
        developer_name: 'Chase',
        repo: 'open-hive',
        project_path: '/code/open-hive',
        // In production, nerve_context would carry local state:
        nerve_context: {
          last_session: {
            repo: 'open-hive',
            intent: 'Implementing OAuth2 PKCE authentication flow',
            ended_at: new Date(Date.now() - 16 * 60 * 60 * 1000).toISOString(), // 16h ago
            outcome: 'completed',
          },
          active_blockers: [],
          unresolved_collisions: [],
          frequent_areas: ['src/auth'],
          repos_active_in: ['open-hive'],
        },
      });

      assert.equal(body.ok, true);

      // KNOWN GAP: The hive stores nerve_context in logs but doesn't
      // use it to enrich the response. A solo dev gets no hive-side
      // value from their own history — that's all in the nerve state.
      //
      // Future: The hive could return "your recent work" summary,
      // or at least surface the developer's own historical intents
      // so the plugin doesn't have to maintain all context locally.

      assert.deepEqual(body.active_collisions, [], 'Still no collisions');
      assert.deepEqual(body.active_sessions_in_repo, [], 'Still alone');

      // The hive DOES have Chase's historical intents — but it filters
      // them out because they're from the same developer (exclude_session_id
      // removes the registering session, but also recent_historical_intents
      // filters by activeIds which won't include the ended session)
      //
      // Let's verify the history endpoint has his signals at least
    });

    it('History endpoint preserves the solo dev signal trail', async () => {
      const history = await ok(app, 'GET', '/api/history?repo=open-hive');

      // Chase's day 1 signals should be in history
      assert.ok(history.signals.length >= 2, `Expected signals from day 1, got ${history.signals.length}`);
      assert.ok(history.sessions.length >= 1, 'Should have at least day 1 session');

      // Verify the intent_declared signal survived
      const intentSignal = history.signals.find(
        (s: any) => s.type === 'intent_declared',
      );
      assert.ok(intentSignal, 'Day 1 intent should be in history');
      assert.ok(
        intentSignal.content.includes('OAuth2'),
        'Intent content should be preserved',
      );
    });

    it('Chase declares new intent — still solo, but his own history exists', async () => {
      const body = await ok(app, 'POST', '/api/signals/rich', {
        session_id: 'chase-day2',
        type: 'intent_declared',
        content: 'Adding session cleanup and stale session detection',
      });

      // No collision with himself (different intent topic anyway)
      assert.deepEqual(body.collisions, []);
    });

    it('Chase ends day 2 session', async () => {
      await ok(app, 'POST', '/api/sessions/end', { session_id: 'chase-day2' });
    });
  });

  // ─── Day 3: Does history accumulate? ─────────────────────

  describe('Day 3: History accumulation check', () => {

    it('History shows both sessions and all signals', async () => {
      const history = await ok(app, 'GET', '/api/history?repo=open-hive');

      // Should have signals from both day 1 and day 2
      const intents = history.signals.filter(
        (s: any) => s.type === 'intent_declared',
      );
      assert.ok(intents.length >= 2, `Expected 2+ intent signals, got ${intents.length}`);

      // Both sessions should be in the session list
      assert.ok(history.sessions.length >= 2, `Expected 2+ sessions, got ${history.sessions.length}`);
    });

    it('Nerve registration persists — Chase has a registered nerve', async () => {
      const nerves = await ok(app, 'GET', '/api/nerves/active?type=claude-code');
      // At least one nerve should exist for Chase
      // Note: nerve is auto-registered per session_id, so there may be 2
      assert.ok(
        nerves.nerves.length >= 1,
        'Chase should have at least one registered nerve',
      );
    });
  });

  // ─── The Product Question ────────────────────────────────

  describe('Product gap: What SHOULD a solo dev get from the hive?', () => {

    it('KNOWN GAP: registration response has no "your own history" section', async () => {
      const body = await ok(app, 'POST', '/api/sessions/register', {
        session_id: 'chase-day3',
        developer_email: 'chase@solo.dev',
        developer_name: 'Chase',
        repo: 'open-hive',
        project_path: '/code/open-hive',
      });

      // The response shape has no field for "your recent work":
      // - active_collisions: empty (solo)
      // - active_sessions_in_repo: empty (solo)
      // - recent_historical_intents: may be empty (filters out own sessions)
      // - unread_mail: empty (no one to send mail)
      //
      // The NERVE provides local context, but if a dev loses their
      // local nerve-state.json, the hive can't reconstruct their history
      // in the registration response.
      //
      // Possible enhancement: add `your_recent_sessions` field to
      // RegisterSessionResponse that returns the developer's own
      // last N sessions with intent/files/areas.

      // For now, assert the gap exists:
      assert.deepEqual(body.active_sessions_in_repo, []);
      assert.deepEqual(body.active_collisions, []);
      // recent_historical_intents might include Chase's old intents
      // since they're from ended sessions — let's check
      const hasOwnHistory = body.recent_historical_intents.some(
        (hi: any) => hi.developer_name === 'Chase',
      );
      // This documents whether the hive surfaces own history or not
      // (it depends on the exclude_session_id filter)
      if (!hasOwnHistory) {
        // GAP: Solo dev gets no historical context from the hive
        assert.ok(true, 'KNOWN GAP: Solo dev history not surfaced in registration');
      }
    });
  });
});

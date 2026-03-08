import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NerveState } from './nerve-state.js';

describe('NerveState — multi-session lifecycle', () => {
  let tempDir: string;
  let filePath: string;

  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'nerve-lifecycle-'));
    filePath = join(tempDir, 'nerve-state.json');
  });
  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('Session 1: developer works on auth, ends session', () => {
    const ns = new NerveState(filePath);
    ns.load();

    ns.recordSessionStart('session-1', 'platform', '/code/platform');
    ns.recordIntent('Implementing OAuth2 PKCE flow');
    ns.recordFileTouch('src/auth/token-service.ts');
    ns.recordFileTouch('src/auth/oauth-handler.ts');
    ns.recordFileTouch('src/middleware/cors.ts');
    ns.recordCollision({
      collision_id: 'col-1', with_developer: 'Bob',
      area: 'src/auth', detected_at: '2026-03-07T21:00:00Z',
    });
    ns.recordSessionEnd('completed');
    ns.save();
  });

  it('Session 2: developer opens new session, nerve remembers everything', () => {
    // Fresh NerveState instance — simulates new process
    const ns = new NerveState(filePath);
    ns.load();

    // Last session is remembered
    assert.ok(ns.state.last_session);
    assert.equal(ns.state.last_session.id, 'session-1');
    assert.equal(ns.state.last_session.repo, 'platform');
    assert.equal(ns.state.last_session.intent, 'Implementing OAuth2 PKCE flow');
    assert.equal(ns.state.last_session.outcome, 'completed');
    assert.ok(ns.state.last_session.files_touched.includes('src/auth/token-service.ts'));

    // Collision carries forward
    assert.equal(ns.state.carry_forward.unresolved_collisions.length, 1);
    assert.equal(ns.state.carry_forward.unresolved_collisions[0].collision_id, 'col-1');

    // Profile accumulated
    assert.ok(ns.state.profile.repos.some(r => r.name === 'platform'));
    assert.ok(ns.state.profile.areas.some(a => a.path === 'src/auth'));
    assert.ok(ns.state.profile.areas.some(a => a.path === 'src/middleware'));

    // Check-in context is rich
    const ctx = ns.getCheckInContext();
    assert.equal(ctx.last_session?.intent, 'Implementing OAuth2 PKCE flow');
    assert.ok(ctx.frequent_areas.includes('src/auth'));
    assert.ok(ctx.repos_active_in.includes('platform'));
    assert.deepEqual(ctx.unresolved_collisions, ['col-1']);
  });

  it('Session 2: developer works on different repo, profile grows', () => {
    const ns = new NerveState(filePath);
    ns.load();

    ns.recordSessionStart('session-2', 'docs', '/code/docs');
    ns.recordIntent('Updating API documentation');
    ns.recordFileTouch('api/auth.md');
    ns.recordSessionEnd('completed');
    ns.save();

    // Reload — verify both repos tracked
    const ns2 = new NerveState(filePath);
    ns2.load();
    const repoNames = ns2.state.profile.repos.map(r => r.name);
    assert.ok(repoNames.includes('platform'));
    assert.ok(repoNames.includes('docs'));
    assert.equal(ns2.state.last_session?.repo, 'docs');
  });

  it('Session 3: collision resolved, carry_forward cleaned up', () => {
    const ns = new NerveState(filePath);
    ns.load();

    ns.clearResolvedCollision('col-1');
    ns.save();

    const ns2 = new NerveState(filePath);
    ns2.load();
    assert.equal(ns2.state.carry_forward.unresolved_collisions.length, 0);
  });
});

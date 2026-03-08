import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
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

describe('NerveState — cross-process persistence', () => {
  let tempDir: string;
  let filePath: string;

  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'nerve-xproc-'));
    filePath = join(tempDir, 'nerve-state.json');
  });
  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('accumulates intent and files across separate process instances', () => {
    // Process 1: SessionStart hook
    const p1 = new NerveState(filePath);
    p1.load();
    p1.recordSessionStart('sess-xp', 'my-repo', '/code/my-repo');
    p1.save();

    // Process 2: UserPromptSubmit hook (fresh instance, like a new process)
    const p2 = new NerveState(filePath);
    p2.load();
    p2.recordIntent('fix the auth bug');
    p2.save();

    // Process 3: PostToolUse hook (another fresh instance)
    const p3 = new NerveState(filePath);
    p3.load();
    p3.recordFileTouch('src/auth/login.ts');
    p3.save();

    // Process 4: PostToolUse hook (yet another file)
    const p4 = new NerveState(filePath);
    p4.load();
    p4.recordFileTouch('src/auth/types.ts');
    p4.save();

    // Process 5: SessionEnd hook (fresh instance — must have accumulated state)
    const p5 = new NerveState(filePath);
    p5.load();
    p5.recordSessionEnd('completed');
    p5.save();

    // Verify: last_session has the full accumulated data
    const verify = new NerveState(filePath);
    verify.load();
    assert.ok(verify.state.last_session);
    assert.equal(verify.state.last_session.id, 'sess-xp');
    assert.equal(verify.state.last_session.repo, 'my-repo');
    assert.equal(verify.state.last_session.intent, 'fix the auth bug');
    assert.equal(verify.state.last_session.files_touched.length, 2);
    assert.ok(verify.state.last_session.files_touched.includes('src/auth/login.ts'));
    assert.ok(verify.state.last_session.files_touched.includes('src/auth/types.ts'));
    assert.ok(verify.state.last_session.areas.includes('src/auth'));
    assert.equal(verify.state.last_session.outcome, 'completed');

    // current_session should be cleared after session end
    assert.equal(verify.state.current_session, null);
  });

  it('crash recovery: stale session is auto-snapshotted to last_session as interrupted', () => {
    const fp = join(tempDir, 'crash-recovery.json');

    // Process 1: SessionStart for session A
    const p1 = new NerveState(fp);
    p1.load();
    p1.recordSessionStart('sess-a', 'repo-a', '/code/a');
    p1.save();

    // Process 2: Intent + file touches during session A
    const p2 = new NerveState(fp);
    p2.load();
    p2.recordIntent('fix the auth bug');
    p2.recordFileTouch('src/auth/login.ts');
    p2.recordFileTouch('src/auth/types.ts');
    p2.save();

    // 💥 CRASH — no recordSessionEnd fires

    // Process 3: New session starts (after crash recovery)
    const p3 = new NerveState(fp);
    p3.load();
    p3.recordSessionStart('sess-b', 'repo-a', '/code/a');
    p3.save();

    // Verify: crashed session A was auto-snapshotted to last_session
    const verify = new NerveState(fp);
    verify.load();
    assert.ok(verify.state.last_session, 'Crashed session should be snapshotted to last_session');
    assert.equal(verify.state.last_session!.id, 'sess-a');
    assert.equal(verify.state.last_session!.repo, 'repo-a');
    assert.equal(verify.state.last_session!.intent, 'fix the auth bug');
    assert.equal(verify.state.last_session!.outcome, 'interrupted');
    assert.ok(verify.state.last_session!.files_touched.includes('src/auth/login.ts'));
    assert.ok(verify.state.last_session!.files_touched.includes('src/auth/types.ts'));
    assert.ok(verify.state.last_session!.areas.includes('src/auth'));

    // New session B should be active
    assert.equal(verify.state.current_session!.id, 'sess-b');
    assert.equal(verify.state.current_session!.intent, null);
  });

  it('current_session is visible during an active session', () => {
    const fp = join(tempDir, 'active.json');

    const p1 = new NerveState(fp);
    p1.load();
    p1.recordSessionStart('sess-active', 'repo-a', '/code/a');
    p1.recordIntent('build feature X');
    p1.save();

    // Read the raw JSON — current_session should be persisted
    const raw = JSON.parse(readFileSync(fp, 'utf-8'));
    assert.ok(raw.current_session);
    assert.equal(raw.current_session.id, 'sess-active');
    assert.equal(raw.current_session.intent, 'build feature X');
  });
});

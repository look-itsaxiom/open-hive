import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NerveState, MAX_AREAS, MAX_REPOS } from './nerve-state.js';

describe('NerveState — load/save', () => {
  let tempDir: string;

  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'nerve-test-'));
  });
  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns defaults when file does not exist', () => {
    const ns = new NerveState(join(tempDir, 'nonexistent.json'));
    ns.load();
    assert.equal(ns.state.last_session, null);
    assert.deepEqual(ns.state.carry_forward.blockers, []);
    assert.deepEqual(ns.state.profile.areas, []);
  });

  it('saves state to disk and loads it back', () => {
    const filePath = join(tempDir, 'state.json');
    const ns = new NerveState(filePath);
    ns.load();
    ns.state.last_session = {
      id: 'test-1', repo: 'myrepo', ended_at: '2026-03-08T00:00:00Z',
      intent: 'testing', files_touched: ['a.ts'], areas: ['src/'],
      outcome: 'completed',
    };
    ns.save();

    const ns2 = new NerveState(filePath);
    ns2.load();
    assert.equal(ns2.state.last_session?.id, 'test-1');
    assert.equal(ns2.state.last_session?.intent, 'testing');
  });

  it('recovers from corrupted file by resetting to defaults', () => {
    const filePath = join(tempDir, 'corrupt.json');
    writeFileSync(filePath, 'NOT JSON{{{');
    const ns = new NerveState(filePath);
    ns.load();
    assert.equal(ns.state.last_session, null);
  });

  it('creates parent directory if missing', () => {
    const deepPath = join(tempDir, 'sub', 'dir', 'state.json');
    const ns = new NerveState(deepPath);
    ns.load();
    ns.save();
    assert.ok(readFileSync(deepPath, 'utf-8').includes('"last_session"'));
  });
});

describe('NerveState — mutations', () => {
  let tempDir: string;

  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'nerve-mut-'));
  });
  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('recordSessionStart bumps repo session count', () => {
    const ns = new NerveState(join(tempDir, 'mut1.json'));
    ns.load();
    ns.recordSessionStart('s1', 'my-repo', '/project');
    ns.recordSessionStart('s2', 'my-repo', '/project');
    const repo = ns.state.profile.repos.find(r => r.name === 'my-repo');
    assert.ok(repo);
    assert.equal(repo.session_count, 2);
  });

  it('recordIntent updates current intent', () => {
    const ns = new NerveState(join(tempDir, 'mut2.json'));
    ns.load();
    ns.recordIntent('fix the login bug');
    assert.equal(ns.currentIntent, 'fix the login bug');
  });

  it('recordFileTouch tracks files and updates area profile', () => {
    const ns = new NerveState(join(tempDir, 'mut3.json'));
    ns.load();
    ns.recordSessionStart('s1', 'repo', '/p');
    ns.recordFileTouch('src/auth/login.ts');
    ns.recordFileTouch('src/auth/logout.ts');
    ns.recordFileTouch('src/utils/helpers.ts');

    assert.equal(ns.currentFilesTouched.length, 3);
    assert.ok(ns.currentFilesTouched.includes('src/auth/login.ts'));

    const areaPaths = ns.state.profile.areas.map(a => a.path);
    assert.ok(areaPaths.includes('src/auth'));
    assert.ok(areaPaths.includes('src/utils'));
  });

  it('recordSessionEnd snapshots to last_session', () => {
    const ns = new NerveState(join(tempDir, 'mut4.json'));
    ns.load();
    ns.recordSessionStart('sess-42', 'cool-repo', '/proj');
    ns.recordIntent('refactor auth');
    ns.recordFileTouch('src/auth/index.ts');
    ns.recordFileTouch('src/auth/types.ts');
    ns.recordSessionEnd('completed');

    const ls = ns.state.last_session;
    assert.ok(ls);
    assert.equal(ls.id, 'sess-42');
    assert.equal(ls.repo, 'cool-repo');
    assert.equal(ls.intent, 'refactor auth');
    assert.equal(ls.outcome, 'completed');
    assert.equal(ls.files_touched.length, 2);
    assert.ok(ls.areas.includes('src/auth'));
    assert.ok(ls.ended_at);
  });

  it('recordCollision adds to carry_forward', () => {
    const ns = new NerveState(join(tempDir, 'mut5.json'));
    ns.load();
    ns.recordCollision({
      collision_id: 'c1',
      with_developer: 'alice',
      area: 'src/auth',
      detected_at: '2026-03-08T00:00:00Z',
    });
    assert.equal(ns.state.carry_forward.unresolved_collisions.length, 1);
    assert.equal(ns.state.carry_forward.unresolved_collisions[0].collision_id, 'c1');
    assert.equal(ns.state.carry_forward.unresolved_collisions[0].with_developer, 'alice');
  });

  it('clearResolvedCollision removes from carry_forward', () => {
    const ns = new NerveState(join(tempDir, 'mut6.json'));
    ns.load();
    ns.recordCollision({
      collision_id: 'c1',
      with_developer: 'alice',
      area: 'src/auth',
      detected_at: '2026-03-08T00:00:00Z',
    });
    ns.clearResolvedCollision('c1');
    assert.equal(ns.state.carry_forward.unresolved_collisions.length, 0);
  });

  it('recordMailReceived adds to carry_forward', () => {
    const ns = new NerveState(join(tempDir, 'mut7.json'));
    ns.load();
    ns.recordMailReceived({
      from: 'bob',
      subject: 'PR review needed',
      received_at: '2026-03-08T12:00:00Z',
    });
    assert.equal(ns.state.carry_forward.pending_mail_context.length, 1);
  });

  it('caps profile areas at MAX_AREAS', () => {
    const ns = new NerveState(join(tempDir, 'mut8.json'));
    ns.load();
    ns.recordSessionStart('s1', 'repo', '/p');
    for (let i = 0; i < 60; i++) {
      ns.recordFileTouch(`dir${i}/file.ts`);
    }
    assert.ok(ns.state.profile.areas.length <= MAX_AREAS);
  });

  it('caps profile repos at MAX_REPOS', () => {
    const ns = new NerveState(join(tempDir, 'mut9.json'));
    ns.load();
    for (let i = 0; i < 60; i++) {
      ns.recordSessionStart(`s${i}`, `repo-${i}`, '/p');
    }
    assert.ok(ns.state.profile.repos.length <= 50);
  });
});

describe('NerveState — getCheckInContext', () => {
  let tempDir: string;
  before(() => { tempDir = mkdtempSync(join(tmpdir(), 'nerve-ctx-')); });
  after(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it('composes enriched context from nerve state', () => {
    const ns = new NerveState(join(tempDir, 'ctx.json'));
    ns.load();

    ns.state.last_session = {
      id: 'prev-1', repo: 'platform', ended_at: '2026-03-07T22:00:00Z',
      intent: 'OAuth2 PKCE flow', files_touched: ['src/auth/token.ts'],
      areas: ['src/auth'], outcome: null,
    };
    ns.state.carry_forward.blockers.push({ text: 'Waiting on PRD', since: '2026-03-07T20:00:00Z' });
    ns.state.carry_forward.unresolved_collisions.push({
      collision_id: 'c1', with_developer: 'Bob', area: 'src/auth', detected_at: '2026-03-07T21:00:00Z',
    });
    ns.state.profile.areas.push({ path: 'src/auth', session_count: 12, last_active: '2026-03-07T22:00:00Z' });
    ns.state.profile.repos.push({ name: 'platform', session_count: 8, last_active: '2026-03-07T22:00:00Z' });

    const ctx = ns.getCheckInContext();
    assert.ok(ctx.last_session);
    assert.equal(ctx.last_session.intent, 'OAuth2 PKCE flow');
    assert.deepEqual(ctx.active_blockers, ['Waiting on PRD']);
    assert.deepEqual(ctx.unresolved_collisions, ['c1']);
    assert.ok(ctx.frequent_areas.includes('src/auth'));
    assert.ok(ctx.repos_active_in.includes('platform'));
  });

  it('returns empty context when state is fresh', () => {
    const ns = new NerveState(join(tempDir, 'fresh.json'));
    ns.load();
    const ctx = ns.getCheckInContext();
    assert.equal(ctx.last_session, null);
    assert.deepEqual(ctx.active_blockers, []);
    assert.deepEqual(ctx.unresolved_collisions, []);
    assert.deepEqual(ctx.frequent_areas, []);
    assert.deepEqual(ctx.repos_active_in, []);
  });
});

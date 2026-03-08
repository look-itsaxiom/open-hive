import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NerveState } from './nerve-state.js';

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

# Nerve State Persistence Layer — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add persistent between-session memory to the open-hive Claude Code plugin so it sends richer signals to the hive on check-in.

**Architecture:** A `NerveState` class manages `~/.open-hive/nerve-state.json`. The hook handler loads on SessionStart, mutates during the session, saves on Stop/SessionEnd. The enriched context is sent to the backend on registration.

**Tech Stack:** TypeScript, Node.js fs, JSON, node:test, existing plugin hook infrastructure.

**Design doc:** `docs/plans/2026-03-08-nerve-state-design.md`

---

## Context for the Implementer

### Repo structure
```
packages/
  shared/     — types shared between backend + plugin (@open-hive/shared)
  backend/    — Fastify server (not touched in this plan)
  plugin/     — Claude Code plugin (main work area)
    src/
      client/hive-client.ts    — HTTP client for backend API
      config/config.ts         — loads ~/.open-hive.yaml
      hooks/handler.ts         — routes hook events to handlers
    hooks/hooks.json           — hook registration
```

### How the plugin works today
- `hooks.json` registers 6 hook events, all route to `handler.ts`
- `handler.ts` reads stdin JSON → routes by `hook_event_name` → writes stdout JSON
- `config.ts` loads `~/.open-hive.yaml` for backend_url and identity
- `hive-client.ts` makes HTTP calls to the backend with 3s timeouts
- **No local state persists between sessions.** Every hook fire is independent.

### What we're adding
- `NerveState` class that loads/saves `~/.open-hive/nerve-state.json`
- Hook handler calls NerveState methods at the right moments
- New hooks in `hooks.json`: Stop event, Read matcher on PostToolUse (for exploration tracking)
- Enriched registration payload with `nerve_context` field
- Backend accepts (and for now, ignores) the `nerve_context` field

### Test approach
- `NerveState` is pure local I/O — test with node:test using temp directories
- Hook handler integration is tested via the scenario tests in the backend package
- No backend changes needed for the core nerve state (backwards compatible)

---

## Task 1: NerveState Data Types

**Files:**
- Create: `packages/plugin/src/nerve/nerve-state.ts`

**Step 1: Define the NerveStateData interface and defaults**

```typescript
// packages/plugin/src/nerve/nerve-state.ts

export interface NerveStateData {
  last_session: {
    id: string;
    repo: string;
    ended_at: string;
    intent: string | null;
    files_touched: string[];
    areas: string[];
    outcome: 'completed' | 'interrupted' | null;
  } | null;

  carry_forward: {
    blockers: Array<{
      text: string;
      since: string;
    }>;
    unresolved_collisions: Array<{
      collision_id: string;
      with_developer: string;
      area: string;
      detected_at: string;
    }>;
    pending_mail_context: Array<{
      from: string;
      subject: string;
      received_at: string;
    }>;
  };

  profile: {
    areas: Array<{
      path: string;
      session_count: number;
      last_active: string;
    }>;
    repos: Array<{
      name: string;
      session_count: number;
      last_active: string;
    }>;
  };
}

export const DEFAULT_NERVE_STATE: NerveStateData = {
  last_session: null,
  carry_forward: {
    blockers: [],
    unresolved_collisions: [],
    pending_mail_context: [],
  },
  profile: {
    areas: [],
    repos: [],
  },
};

const MAX_AREAS = 50;
const MAX_REPOS = 50;
const MAX_FILES_TOUCHED = 200;
```

**Step 2: Commit**

```bash
git add packages/plugin/src/nerve/nerve-state.ts
git commit -m "feat(plugin): define NerveStateData interface and defaults"
```

---

## Task 2: NerveState Class — Load/Save

**Files:**
- Modify: `packages/plugin/src/nerve/nerve-state.ts`
- Create: `packages/plugin/src/nerve/nerve-state.test.ts`

**Step 1: Write the failing tests for load/save**

```typescript
// packages/plugin/src/nerve/nerve-state.test.ts
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
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
    const ns = new NerveState(join(tempDir, 'nonexistent'));
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

    // Load in a fresh instance
    const ns2 = new NerveState(filePath);
    ns2.load();
    assert.equal(ns2.state.last_session?.id, 'test-1');
    assert.equal(ns2.state.last_session?.intent, 'testing');
  });

  it('recovers from corrupted file by resetting to defaults', () => {
    const filePath = join(tempDir, 'corrupt.json');
    require('node:fs').writeFileSync(filePath, 'NOT JSON{{{');
    const ns = new NerveState(filePath);
    ns.load();
    assert.equal(ns.state.last_session, null); // defaults, not crash
  });

  it('creates parent directory if missing', () => {
    const deepPath = join(tempDir, 'sub', 'dir', 'state.json');
    const ns = new NerveState(deepPath);
    ns.load();
    ns.save();
    assert.ok(readFileSync(deepPath, 'utf-8').includes('"last_session"'));
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd packages/plugin && npx tsx --test src/nerve/nerve-state.test.ts
```
Expected: FAIL — `NerveState` class doesn't exist yet.

**Step 3: Implement load/save**

Add to `packages/plugin/src/nerve/nerve-state.ts`:

```typescript
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

export class NerveState {
  state: NerveStateData = structuredClone(DEFAULT_NERVE_STATE);

  constructor(private filePath: string) {}

  load(): void {
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      this.state = {
        ...structuredClone(DEFAULT_NERVE_STATE),
        ...parsed,
        carry_forward: {
          ...structuredClone(DEFAULT_NERVE_STATE.carry_forward),
          ...(parsed.carry_forward ?? {}),
        },
        profile: {
          ...structuredClone(DEFAULT_NERVE_STATE.profile),
          ...(parsed.profile ?? {}),
        },
      };
    } catch {
      this.state = structuredClone(DEFAULT_NERVE_STATE);
    }
  }

  save(): void {
    try {
      const dir = dirname(this.filePath);
      mkdirSync(dir, { recursive: true });
      const tmp = this.filePath + '.tmp';
      writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf-8');
      renameSync(tmp, this.filePath);
    } catch {
      // Never block the developer — log and move on
    }
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
cd packages/plugin && npx tsx --test src/nerve/nerve-state.test.ts
```
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add packages/plugin/src/nerve/nerve-state.ts packages/plugin/src/nerve/nerve-state.test.ts
git commit -m "feat(plugin): NerveState load/save with atomic writes and corruption recovery"
```

---

## Task 3: NerveState Class — Mutation Methods

**Files:**
- Modify: `packages/plugin/src/nerve/nerve-state.ts`
- Modify: `packages/plugin/src/nerve/nerve-state.test.ts`

**Step 1: Write failing tests for mutation methods**

Add to the test file:

```typescript
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
    ns.recordSessionStart('s1', 'myrepo', '/code/myrepo');
    assert.equal(ns.state.profile.repos.length, 1);
    assert.equal(ns.state.profile.repos[0].name, 'myrepo');
    assert.equal(ns.state.profile.repos[0].session_count, 1);

    // Second session in same repo
    ns.recordSessionStart('s2', 'myrepo', '/code/myrepo');
    assert.equal(ns.state.profile.repos[0].session_count, 2);
  });

  it('recordIntent updates current intent', () => {
    const ns = new NerveState(join(tempDir, 'mut2.json'));
    ns.load();
    ns.recordSessionStart('s1', 'repo', '/code/repo');
    ns.recordIntent('refactoring auth module');
    // Intent stored in current session tracking
    assert.equal(ns.currentIntent, 'refactoring auth module');
  });

  it('recordFileTouch tracks files and updates area profile', () => {
    const ns = new NerveState(join(tempDir, 'mut3.json'));
    ns.load();
    ns.recordSessionStart('s1', 'repo', '/code/repo');
    ns.recordFileTouch('src/auth/login.ts');
    ns.recordFileTouch('src/auth/logout.ts');
    ns.recordFileTouch('src/utils/helper.ts');

    assert.ok(ns.currentFilesTouched.includes('src/auth/login.ts'));
    assert.ok(ns.currentFilesTouched.includes('src/auth/logout.ts'));

    // Areas should have src/auth and src/utils
    const areaPaths = ns.state.profile.areas.map(a => a.path);
    assert.ok(areaPaths.includes('src/auth'));
    assert.ok(areaPaths.includes('src/utils'));
  });

  it('recordSessionEnd snapshots to last_session', () => {
    const ns = new NerveState(join(tempDir, 'mut4.json'));
    ns.load();
    ns.recordSessionStart('s1', 'myrepo', '/code/myrepo');
    ns.recordIntent('fixing bug');
    ns.recordFileTouch('src/bug.ts');
    ns.recordSessionEnd('completed');

    assert.ok(ns.state.last_session);
    assert.equal(ns.state.last_session.id, 's1');
    assert.equal(ns.state.last_session.repo, 'myrepo');
    assert.equal(ns.state.last_session.intent, 'fixing bug');
    assert.deepEqual(ns.state.last_session.files_touched, ['src/bug.ts']);
    assert.equal(ns.state.last_session.outcome, 'completed');
  });

  it('recordCollision adds to carry_forward', () => {
    const ns = new NerveState(join(tempDir, 'mut5.json'));
    ns.load();
    ns.recordCollision({ collision_id: 'c1', with_developer: 'Bob', area: 'src/auth', detected_at: '2026-03-08T00:00:00Z' });
    assert.equal(ns.state.carry_forward.unresolved_collisions.length, 1);
    assert.equal(ns.state.carry_forward.unresolved_collisions[0].with_developer, 'Bob');
  });

  it('clearResolvedCollision removes from carry_forward', () => {
    const ns = new NerveState(join(tempDir, 'mut6.json'));
    ns.load();
    ns.recordCollision({ collision_id: 'c1', with_developer: 'Bob', area: 'src/auth', detected_at: '2026-03-08T00:00:00Z' });
    ns.clearResolvedCollision('c1');
    assert.equal(ns.state.carry_forward.unresolved_collisions.length, 0);
  });

  it('recordMailReceived adds to carry_forward', () => {
    const ns = new NerveState(join(tempDir, 'mut7.json'));
    ns.load();
    ns.recordMailReceived({ from: 'Alice', subject: 'heads up', received_at: '2026-03-08T00:00:00Z' });
    assert.equal(ns.state.carry_forward.pending_mail_context.length, 1);
  });

  it('caps profile areas at MAX_AREAS', () => {
    const ns = new NerveState(join(tempDir, 'mut8.json'));
    ns.load();
    ns.recordSessionStart('s1', 'repo', '/code/repo');
    for (let i = 0; i < 60; i++) {
      ns.recordFileTouch(`area${i}/file.ts`);
    }
    assert.ok(ns.state.profile.areas.length <= 50);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd packages/plugin && npx tsx --test src/nerve/nerve-state.test.ts
```
Expected: FAIL — mutation methods don't exist.

**Step 3: Implement mutation methods**

Add to the `NerveState` class in `nerve-state.ts`:

```typescript
  // --- Current session tracking (in-memory, not persisted directly) ---
  private _currentSessionId: string | null = null;
  private _currentRepo: string | null = null;
  private _currentIntent: string | null = null;
  private _currentFilesTouched: string[] = [];
  private _currentAreas: Set<string> = new Set();

  get currentIntent(): string | null { return this._currentIntent; }
  get currentFilesTouched(): string[] { return [...this._currentFilesTouched]; }

  recordSessionStart(sessionId: string, repo: string, _projectPath: string): void {
    this._currentSessionId = sessionId;
    this._currentRepo = repo;
    this._currentIntent = null;
    this._currentFilesTouched = [];
    this._currentAreas = new Set();

    // Bump repo profile
    const now = new Date().toISOString();
    const existing = this.state.profile.repos.find(r => r.name === repo);
    if (existing) {
      existing.session_count++;
      existing.last_active = now;
    } else {
      this.state.profile.repos.push({ name: repo, session_count: 1, last_active: now });
      if (this.state.profile.repos.length > MAX_REPOS) {
        this.state.profile.repos.sort((a, b) => b.session_count - a.session_count);
        this.state.profile.repos = this.state.profile.repos.slice(0, MAX_REPOS);
      }
    }
  }

  recordIntent(content: string): void {
    this._currentIntent = content;
  }

  recordFileTouch(filePath: string): void {
    if (!this._currentFilesTouched.includes(filePath)) {
      this._currentFilesTouched.push(filePath);
      if (this._currentFilesTouched.length > MAX_FILES_TOUCHED) {
        this._currentFilesTouched.shift();
      }
    }

    // Extract directory as area
    const parts = filePath.split('/');
    if (parts.length > 1) {
      const area = parts.slice(0, -1).join('/');
      if (!this._currentAreas.has(area)) {
        this._currentAreas.add(area);
        const now = new Date().toISOString();
        const existing = this.state.profile.areas.find(a => a.path === area);
        if (existing) {
          existing.session_count++;
          existing.last_active = now;
        } else {
          this.state.profile.areas.push({ path: area, session_count: 1, last_active: now });
          if (this.state.profile.areas.length > MAX_AREAS) {
            this.state.profile.areas.sort((a, b) => b.session_count - a.session_count);
            this.state.profile.areas = this.state.profile.areas.slice(0, MAX_AREAS);
          }
        }
      }
    }
  }

  recordSessionEnd(outcome?: 'completed' | 'interrupted' | null): void {
    this.state.last_session = {
      id: this._currentSessionId ?? 'unknown',
      repo: this._currentRepo ?? 'unknown',
      ended_at: new Date().toISOString(),
      intent: this._currentIntent,
      files_touched: [...this._currentFilesTouched],
      areas: [...this._currentAreas],
      outcome: outcome ?? null,
    };
  }

  recordCollision(collision: {
    collision_id: string; with_developer: string; area: string; detected_at: string;
  }): void {
    // Don't duplicate
    if (this.state.carry_forward.unresolved_collisions.some(c => c.collision_id === collision.collision_id)) return;
    this.state.carry_forward.unresolved_collisions.push(collision);
  }

  clearResolvedCollision(collisionId: string): void {
    this.state.carry_forward.unresolved_collisions =
      this.state.carry_forward.unresolved_collisions.filter(c => c.collision_id !== collisionId);
  }

  recordMailReceived(mail: { from: string; subject: string; received_at: string }): void {
    this.state.carry_forward.pending_mail_context.push(mail);
  }
```

**Step 4: Run tests to verify they pass**

```bash
cd packages/plugin && npx tsx --test src/nerve/nerve-state.test.ts
```
Expected: PASS (all tests including new mutation tests)

**Step 5: Commit**

```bash
git add packages/plugin/src/nerve/nerve-state.ts packages/plugin/src/nerve/nerve-state.test.ts
git commit -m "feat(plugin): NerveState mutation methods — session tracking, file touch, collisions, mail"
```

---

## Task 4: NerveState — getCheckInContext

**Files:**
- Modify: `packages/plugin/src/nerve/nerve-state.ts`
- Modify: `packages/plugin/src/nerve/nerve-state.test.ts`

**Step 1: Write failing test**

```typescript
describe('NerveState — getCheckInContext', () => {
  it('composes enriched context from nerve state', () => {
    const ns = new NerveState(join(tempDir, 'ctx.json'));
    ns.load();

    // Simulate a previous session
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
    ns.state.profile.repos.push({ path: 'platform', session_count: 8, last_active: '2026-03-07T22:00:00Z' } as any);

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
```

**Step 2: Run tests to verify failure**

```bash
cd packages/plugin && npx tsx --test src/nerve/nerve-state.test.ts
```

**Step 3: Implement getCheckInContext**

```typescript
  getCheckInContext(): NerveCheckInContext {
    return {
      last_session: this.state.last_session ? {
        repo: this.state.last_session.repo,
        intent: this.state.last_session.intent,
        ended_at: this.state.last_session.ended_at,
        outcome: this.state.last_session.outcome,
      } : null,
      active_blockers: this.state.carry_forward.blockers.map(b => b.text),
      unresolved_collisions: this.state.carry_forward.unresolved_collisions.map(c => c.collision_id),
      frequent_areas: this.state.profile.areas
        .sort((a, b) => b.session_count - a.session_count)
        .slice(0, 10)
        .map(a => a.path),
      repos_active_in: this.state.profile.repos.map(r => r.name),
    };
  }
```

Also export the context type:

```typescript
export interface NerveCheckInContext {
  last_session: {
    repo: string;
    intent: string | null;
    ended_at: string;
    outcome: 'completed' | 'interrupted' | null;
  } | null;
  active_blockers: string[];
  unresolved_collisions: string[];
  frequent_areas: string[];
  repos_active_in: string[];
}
```

**Step 4: Run tests**

```bash
cd packages/plugin && npx tsx --test src/nerve/nerve-state.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add packages/plugin/src/nerve/nerve-state.ts packages/plugin/src/nerve/nerve-state.test.ts
git commit -m "feat(plugin): getCheckInContext composes enriched payload from nerve state"
```

---

## Task 5: Wire NerveState into Hook Handler

**Files:**
- Modify: `packages/plugin/src/hooks/handler.ts`
- Modify: `packages/plugin/hooks/hooks.json`

**Step 1: Update hooks.json to add Stop hook**

Add the Stop event to `hooks.json`:

```json
"Stop": [
  {
    "matcher": "*",
    "hooks": [
      {
        "type": "command",
        "command": "npx tsx ${CLAUDE_PLUGIN_ROOT}/src/hooks/handler.ts",
        "timeout": 3
      }
    ]
  }
]
```

**Step 2: Update handler.ts to use NerveState**

At the top of `handler.ts`, add:

```typescript
import { NerveState } from '../nerve/nerve-state.js';
import { join } from 'node:path';

const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
const nerveStatePath = join(home, '.open-hive', 'nerve-state.json');
```

Modify `handleSessionStart`:

```typescript
async function handleSessionStart(input: HookInput): Promise<Record<string, unknown>> {
  if (!client || !config) return {};
  const session_id = getSessionId(input);
  const repo = getRepo(input);

  // Load nerve state and record session start
  const nerve = new NerveState(nerveStatePath);
  nerve.load();
  nerve.recordSessionStart(session_id, repo, input.cwd ?? process.cwd());
  nerve.save(); // checkpoint — we started

  const result = await client.registerSession({
    session_id,
    developer_email: config.identity.email,
    developer_name: config.identity.display_name,
    repo,
    project_path: input.cwd ?? process.cwd(),
  });

  if (!result) return {};

  // Record collisions and mail from registration response into nerve state
  for (const collision of result.active_collisions) {
    nerve.recordCollision({
      collision_id: collision.collision_id,
      with_developer: collision.details, // best we have from the collision object
      area: '',
      detected_at: collision.detected_at,
    });
  }
  for (const mail of (result.unread_mail ?? [])) {
    nerve.recordMailReceived({
      from: mail.from_session_id ?? 'hive',
      subject: mail.subject,
      received_at: mail.created_at,
    });
  }
  nerve.save();

  const messages: string[] = [];

  // Show nerve context — what happened since last session
  const nerveCtx = nerve.getCheckInContext();
  if (nerveCtx.last_session) {
    messages.push(`Open Hive: Last session — ${nerveCtx.last_session.intent ?? 'no intent'} in ${nerveCtx.last_session.repo} (${nerveCtx.last_session.outcome ?? 'interrupted'})`);
  }
  if (nerveCtx.active_blockers.length > 0) {
    messages.push(`Open Hive: Active blockers: ${nerveCtx.active_blockers.join(', ')}`);
  }

  if (result.active_sessions_in_repo.length > 0) {
    messages.push('Open Hive: Active sessions in this repo:');
    for (const s of result.active_sessions_in_repo) {
      messages.push(`  - ${s.developer_name}: ${s.intent ?? 'no intent declared'} (areas: ${s.areas.join(', ') || 'none yet'})`);
    }
  }
  if (result.recent_historical_intents?.length > 0) {
    messages.push('Open Hive: Recent work in this repo (last 48h):');
    for (const hi of result.recent_historical_intents) {
      const ago = timeSince(hi.timestamp);
      messages.push(`  - ${hi.developer_name} (${ago} ago): ${hi.intent}`);
    }
  }
  if (result.active_collisions.length > 0) {
    messages.push(formatCollisions(result.active_collisions));
  }

  return messages.length > 0 ? { systemMessage: messages.join('\n') } : {};
}
```

Modify `handleUserPromptSubmit` — add `recordIntent`:

```typescript
async function handleUserPromptSubmit(input: HookInput): Promise<Record<string, unknown>> {
  if (!client) return {};
  const session_id = getSessionId(input);
  const prompt = input.prompt ?? input.user_prompt ?? '';
  if (!prompt) return {};

  // Record intent in nerve state
  const nerve = new NerveState(nerveStatePath);
  nerve.load();
  nerve.recordIntent(prompt);
  // Don't save here — Stop hook will checkpoint

  const result = await client.sendIntent({
    session_id,
    content: prompt,
    type: 'prompt',
  });

  if (!result || result.collisions.length === 0) return {};

  // Record any new collisions
  for (const collision of result.collisions) {
    nerve.recordCollision({
      collision_id: collision.collision_id,
      with_developer: collision.details,
      area: '',
      detected_at: collision.detected_at,
    });
  }
  nerve.save();

  return { systemMessage: formatCollisions(result.collisions) };
}
```

Modify `handlePostToolUse` — add `recordFileTouch`:

```typescript
async function handlePostToolUse(input: HookInput): Promise<Record<string, unknown>> {
  if (!client) return {};
  const toolName = input.tool_name ?? '';
  if (!['Write', 'Edit'].includes(toolName)) return {};

  const filePath = input.tool_input?.file_path as string | undefined;
  if (!filePath) return {};

  const session_id = getSessionId(input);

  // Record file touch in nerve state
  const nerve = new NerveState(nerveStatePath);
  nerve.load();
  nerve.recordFileTouch(filePath);
  // Don't save — Stop hook will checkpoint

  await client.sendActivity({
    session_id,
    file_path: filePath,
    type: 'file_modify',
  });

  return {};
}
```

Add `handleStop`:

```typescript
async function handleStop(input: HookInput): Promise<Record<string, unknown>> {
  // Checkpoint nerve state to disk
  const nerve = new NerveState(nerveStatePath);
  nerve.load();
  nerve.save();
  return {};
}
```

Modify `handleSessionEnd`:

```typescript
async function handleSessionEnd(input: HookInput): Promise<Record<string, unknown>> {
  if (!client) return {};

  // Snapshot session to nerve state
  const nerve = new NerveState(nerveStatePath);
  nerve.load();
  nerve.recordSessionEnd('completed');
  nerve.save();

  await client.endSession({ session_id: getSessionId(input) });
  return {};
}
```

Add the `Stop` case to the main switch:

```typescript
case 'Stop':
  result = await handleStop(input);
  break;
```

**Step 3: Commit**

```bash
git add packages/plugin/src/hooks/handler.ts packages/plugin/hooks/hooks.json
git commit -m "feat(plugin): wire NerveState into hook handler — load/mutate/save lifecycle"
```

---

## Task 6: Add nerve_context to Registration API

**Files:**
- Modify: `packages/shared/src/api.ts`
- Modify: `packages/backend/src/routes/sessions.ts`

**Step 1: Add optional nerve_context to RegisterSessionRequest**

In `packages/shared/src/api.ts`, add to `RegisterSessionRequest`:

```typescript
export interface RegisterSessionRequest {
  session_id: string;
  developer_email: string;
  developer_name: string;
  repo: string;
  project_path: string;
  nerve_context?: {
    last_session?: {
      repo: string;
      intent: string | null;
      ended_at: string;
      outcome: 'completed' | 'interrupted' | null;
    };
    active_blockers?: string[];
    unresolved_collisions?: string[];
    frequent_areas?: string[];
    repos_active_in?: string[];
  };
}
```

**Step 2: Backend accepts and logs nerve_context (no processing yet)**

In `packages/backend/src/routes/sessions.ts`, after registration succeeds, log the nerve context if present:

```typescript
if (req.body.nerve_context) {
  req.log.info({ nerve_context: req.body.nerve_context }, 'Nerve context received');
}
```

This is intentionally minimal — the backend accepts the field but doesn't act on it yet. Future work will use nerve_context for smarter relevance filtering.

**Step 3: Update HiveClient to pass nerve_context**

In `packages/plugin/src/client/hive-client.ts`, the `registerSession` method already sends the full request object, so it will pass `nerve_context` through automatically once the handler includes it.

Update `handleSessionStart` in handler.ts to include nerve_context in the registration call:

```typescript
const result = await client.registerSession({
  session_id,
  developer_email: config.identity.email,
  developer_name: config.identity.display_name,
  repo,
  project_path: input.cwd ?? process.cwd(),
  nerve_context: nerve.getCheckInContext(),
});
```

**Step 4: Commit**

```bash
git add packages/shared/src/api.ts packages/backend/src/routes/sessions.ts packages/plugin/src/hooks/handler.ts
git commit -m "feat: add nerve_context to session registration API (backwards compatible)"
```

---

## Task 7: Smoke Test — Nerve State Survives Session Boundaries

**Files:**
- Create: `packages/plugin/src/nerve/nerve-state-lifecycle.test.ts`

**Step 1: Write a lifecycle test that simulates multiple sessions**

```typescript
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
```

**Step 2: Run test**

```bash
cd packages/plugin && npx tsx --test src/nerve/nerve-state-lifecycle.test.ts
```
Expected: PASS (all 4 lifecycle tests)

**Step 3: Commit**

```bash
git add packages/plugin/src/nerve/nerve-state-lifecycle.test.ts
git commit -m "test(plugin): multi-session lifecycle test — nerve state survives session boundaries"
```

---

## Summary

| Task | What | Files |
|---|---|---|
| 1 | Data types and defaults | `plugin/src/nerve/nerve-state.ts` (create) |
| 2 | Load/save with atomic writes | `nerve-state.ts` + `nerve-state.test.ts` (create) |
| 3 | Mutation methods | `nerve-state.ts` + `nerve-state.test.ts` (modify) |
| 4 | getCheckInContext | `nerve-state.ts` + `nerve-state.test.ts` (modify) |
| 5 | Wire into hook handler | `handler.ts` + `hooks.json` (modify) |
| 6 | nerve_context in registration API | `shared/api.ts` + `backend/sessions.ts` + `handler.ts` (modify) |
| 7 | Multi-session lifecycle test | `nerve-state-lifecycle.test.ts` (create) |

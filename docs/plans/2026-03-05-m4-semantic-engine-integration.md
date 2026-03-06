# M4: L3b/L3c Semantic Engine Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure the collision engine fully supports multiple `ISemanticAnalyzer` tiers running in sequence, with proper tier attribution, severity mapping, and short-circuit behavior. After this milestone, installing an L3b or L3c skill is truly plug-and-play.

**Architecture:** M2 already refactors `CollisionEngine` to iterate `ISemanticAnalyzer[]`. This milestone adds the nuanced behaviors: tier-ordered execution, severity escalation (L3a=info, L3b=warning, L3c=warning), deduplication across tiers, and collision detail attribution showing which tier detected the overlap.

**Tech Stack:** TypeScript, Node.js test runner

**Dependencies:** M2 must be merged (CollisionEngine already accepts `ISemanticAnalyzer[]`).

**Branch:** `feature/m4-semantic-engine-integration` → PR to `develop`

---

## Task 1: Add tier-ordered execution tests

**Files:**
- Create: `packages/backend/src/services/collision-engine-semantic.test.ts`

**Step 1: Write tests for multi-analyzer behavior**

```typescript
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { HiveStore } from '../db/store.js';
import { CollisionEngine } from './collision-engine.js';
import { KeywordAnalyzer } from './keyword-analyzer.js';
import type { ISemanticAnalyzer, SemanticMatch, HiveBackendConfig } from '@open-hive/shared';

function createTestConfig(): HiveBackendConfig {
  return {
    port: 3000,
    database: { type: 'sqlite', url: ':memory:' },
    collision: {
      scope: 'org',
      semantic: {
        keywords_enabled: true,
        embeddings_enabled: false,
        llm_enabled: false,
      },
    },
    alerts: { min_severity: 'info', webhook_urls: [] },
    identity: { provider: 'passthrough' },
    webhooks: { urls: [] },
    session: { heartbeat_interval_seconds: 30, idle_timeout_seconds: 300 },
  };
}

function createTestDB(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE sessions (
      session_id TEXT PRIMARY KEY, developer_email TEXT NOT NULL,
      developer_name TEXT NOT NULL, repo TEXT NOT NULL,
      project_path TEXT NOT NULL, started_at TEXT NOT NULL,
      last_activity TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      intent TEXT, files_touched TEXT NOT NULL DEFAULT '[]',
      areas TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE signals (
      signal_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(session_id),
      timestamp TEXT NOT NULL, type TEXT NOT NULL, content TEXT NOT NULL,
      file_path TEXT, semantic_area TEXT
    );
    CREATE TABLE collisions (
      collision_id TEXT PRIMARY KEY, session_ids TEXT NOT NULL,
      type TEXT NOT NULL, severity TEXT NOT NULL, details TEXT NOT NULL,
      detected_at TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0,
      resolved_by TEXT
    );
  `);
  return db;
}

/** A fake L3b analyzer that always matches with a fixed score. */
class FakeEmbeddingAnalyzer implements ISemanticAnalyzer {
  readonly name = 'fake-embeddings';
  readonly tier = 'L3b' as const;
  constructor(private fixedScore: number) {}
  async compare(a: string, b: string): Promise<SemanticMatch | null> {
    if (this.fixedScore < 0.5) return null;
    return { score: this.fixedScore, tier: 'L3b', explanation: `Fake embedding match: ${this.fixedScore}` };
  }
}

/** A fake L3c analyzer that always matches. */
class FakeLLMAnalyzer implements ISemanticAnalyzer {
  readonly name = 'fake-llm';
  readonly tier = 'L3c' as const;
  async compare(a: string, b: string): Promise<SemanticMatch | null> {
    return { score: 0.9, tier: 'L3c', explanation: 'LLM says these overlap' };
  }
}

async function seedSession(store: HiveStore, id: string, name: string, intent?: string) {
  await store.createSession({
    session_id: id, developer_email: `${name.toLowerCase()}@test.com`,
    developer_name: name, repo: 'test-repo', project_path: '/code/test',
    started_at: new Date().toISOString(), intent: intent ?? null,
  });
  if (intent) {
    await store.updateSessionActivity(id, { intent });
  }
}

describe('CollisionEngine — multi-tier semantic analysis', () => {
  let db: DatabaseSync;
  let store: HiveStore;

  beforeEach(() => {
    db = createTestDB();
    store = new HiveStore(db);
  });

  it('runs analyzers in tier order (L3a before L3b)', async () => {
    const callOrder: string[] = [];
    const trackingL3a: ISemanticAnalyzer = {
      name: 'tracking-l3a', tier: 'L3a',
      async compare() { callOrder.push('L3a'); return null; },
    };
    const trackingL3b: ISemanticAnalyzer = {
      name: 'tracking-l3b', tier: 'L3b',
      async compare() { callOrder.push('L3b'); return null; },
    };

    // Pass L3b first to verify engine reorders
    const engine = new CollisionEngine(store, createTestConfig(), [trackingL3b, trackingL3a]);

    await seedSession(store, 'a', 'Alice', 'working on auth');
    await seedSession(store, 'b', 'Bob', 'working on auth');

    await engine.checkIntentCollision('b', 'working on auth', 'test-repo');

    assert.deepEqual(callOrder, ['L3a', 'L3b']);
  });

  it('first matching analyzer wins — stops iterating tiers for that pair', async () => {
    const calls: string[] = [];
    const matchingL3a: ISemanticAnalyzer = {
      name: 'matching-l3a', tier: 'L3a',
      async compare() {
        calls.push('L3a');
        return { score: 0.5, tier: 'L3a', explanation: 'keyword match' };
      },
    };
    const l3b: ISemanticAnalyzer = {
      name: 'l3b', tier: 'L3b',
      async compare() { calls.push('L3b'); return null; },
    };

    const engine = new CollisionEngine(store, createTestConfig(), [matchingL3a, l3b]);

    await seedSession(store, 'a', 'Alice', 'working on auth');
    await seedSession(store, 'b', 'Bob', 'working on auth');

    await engine.checkIntentCollision('b', 'working on auth', 'test-repo');

    // L3b should NOT have been called since L3a matched
    assert.deepEqual(calls, ['L3a']);
  });

  it('collision details include tier attribution', async () => {
    const engine = new CollisionEngine(store, createTestConfig(), [new FakeEmbeddingAnalyzer(0.8)]);

    await seedSession(store, 'a', 'Alice', 'refactoring authentication');
    await seedSession(store, 'b', 'Bob', 'refactoring authentication');

    const collisions = await engine.checkIntentCollision('b', 'refactoring authentication', 'test-repo');

    assert.equal(collisions.length, 1);
    assert.ok(collisions[0].details.includes('L3b'));
  });

  it('L3b/L3c collisions get warning severity', async () => {
    const engine = new CollisionEngine(store, createTestConfig(), [new FakeEmbeddingAnalyzer(0.8)]);

    await seedSession(store, 'a', 'Alice', 'refactoring authentication');
    await seedSession(store, 'b', 'Bob', 'refactoring authentication');

    const collisions = await engine.checkIntentCollision('b', 'refactoring authentication', 'test-repo');

    assert.equal(collisions[0].severity, 'warning');
  });

  it('L3a collisions get info severity', async () => {
    const engine = new CollisionEngine(store, createTestConfig(), [new KeywordAnalyzer()]);

    await seedSession(store, 'a', 'Alice', 'auth token refresh bug in login');
    await seedSession(store, 'b', 'Bob');

    const collisions = await engine.checkIntentCollision(
      'b', 'auth token expiry logic in login', 'test-repo'
    );

    if (collisions.length > 0) {
      assert.equal(collisions[0].severity, 'info');
    }
  });

  it('works with zero analyzers — returns empty', async () => {
    const engine = new CollisionEngine(store, createTestConfig(), []);

    await seedSession(store, 'a', 'Alice', 'auth stuff');
    await seedSession(store, 'b', 'Bob', 'auth stuff');

    const collisions = await engine.checkIntentCollision('b', 'auth stuff', 'test-repo');
    assert.equal(collisions.length, 0);
  });
});
```

**Step 2: Run tests — verify behavior**

```bash
cd packages/backend && node --import tsx --test src/services/collision-engine-semantic.test.ts
```

Some tests may pass already if M2 is done correctly. Fix any that fail by updating `CollisionEngine`:

**Step 3: Implement tier ordering in CollisionEngine**

In the constructor, sort analyzers by tier:

```typescript
constructor(
  private store: IHiveStore,
  private config: HiveBackendConfig,
  analyzers: ISemanticAnalyzer[] = [],
) {
  const tierOrder = { 'L3a': 0, 'L3b': 1, 'L3c': 2 };
  this.analyzers = [...analyzers].sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier]);
}
```

**Step 4: Implement severity mapping**

```typescript
private tierSeverity(tier: 'L3a' | 'L3b' | 'L3c'): CollisionSeverity {
  return tier === 'L3a' ? 'info' : 'warning';
}
```

**Step 5: Run all tests**

```bash
npm run test
```
Expected: All tests pass.

**Step 6: Commit**

```bash
git add packages/backend/src/services/collision-engine-semantic.test.ts packages/backend/src/services/collision-engine.ts
git commit -m "feat: tier-ordered semantic analysis with severity mapping"
```

---

## Task 2: Apply same pattern to `checkHistoricalIntentCollision`

**Files:**
- Modify: `packages/backend/src/services/collision-engine.ts`
- Add tests to: `packages/backend/src/services/collision-engine-semantic.test.ts`

**Step 1: Add historical collision tests with multi-tier**

```typescript
describe('CollisionEngine — historical multi-tier', () => {
  it('uses analyzers for historical intent comparison', async () => {
    // Seed a session, end it, then check a new session against historical
    const db = createTestDB();
    const store = new HiveStore(db);
    const engine = new CollisionEngine(store, createTestConfig(), [new KeywordAnalyzer()]);

    await seedSession(store, 'old', 'Alice', 'refactoring auth middleware');
    // Create a signal so it shows up in history
    await store.createSignal({
      session_id: 'old', timestamp: new Date().toISOString(),
      type: 'prompt', content: 'refactoring auth middleware',
      file_path: null, semantic_area: null,
    });
    await store.endSession('old');

    await seedSession(store, 'new', 'Bob');

    const collisions = await engine.checkHistoricalIntentCollision(
      'new', 'refactoring auth middleware', 'test-repo'
    );

    assert.ok(collisions.length >= 1);
    assert.ok(collisions[0].details.includes('Historical'));
  });
});
```

**Step 2: Refactor `checkHistoricalIntentCollision` to use analyzers**

Apply the same `for (const analyzer of this.analyzers)` pattern with break-on-first-match.

**Step 3: Run tests, commit**

```bash
npm run test
git commit -m "feat: historical collision detection uses ISemanticAnalyzer tiers"
```

---

## Task 3: Final verification and PR

**Step 1: Full build + test**

```bash
npm run build && npm run test
```

**Step 2: Push and create PR**

```bash
git push -u origin feature/m4-semantic-engine-integration
gh pr create --base develop --title "feat: multi-tier semantic analysis in collision engine (M4)" --body "$(cat <<'EOF'
## Summary
- Tier-ordered execution (L3a → L3b → L3c)
- First matching analyzer wins per session pair (short-circuit)
- Tier-based severity mapping (L3a=info, L3b/L3c=warning)
- Collision details include tier attribution
- Historical collision detection uses same analyzer pipeline
- Comprehensive multi-tier test suite with fake analyzers

## Context
Phase 2, Milestone 4. The collision engine is now fully pluggable.
Installing an L3b or L3c skill is truly plug-and-play — implement
`ISemanticAnalyzer`, register in PortRegistry, done.

Depends on: #<M2_ISSUE_NUMBER>
Closes: #<M4_ISSUE_NUMBER>

## Test plan
- [ ] `npm run build` — 0 errors
- [ ] `npm run test` — all tests pass
- [ ] Tier ordering verified (L3a runs before L3b)
- [ ] Short-circuit verified (L3b skipped when L3a matches)
- [ ] Historical collisions use analyzer pipeline
EOF
)"
```

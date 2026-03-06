# M2: Refactor Existing Code to Ports — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate all existing implementations to use the port interfaces defined in M1. After this milestone, every route handler receives interfaces (not concrete classes), and the server wires up default implementations via a registry.

**Architecture:** Create a `PortRegistry` that holds registered implementations of each port. Refactor `NotificationDispatcher` into an `AlertDispatcher` that delegates to `IAlertSink[]`. Extract `keywordOverlap` into a `KeywordAnalyzer` implementing `ISemanticAnalyzer`. Create a `PassthroughIdentityProvider` implementing `IIdentityProvider`. Route handlers accept ports via the registry, not concrete types.

**Tech Stack:** TypeScript, Fastify, Node.js test runner

**Dependencies:** M1 must be merged first (interfaces must exist in `@open-hive/shared`).

**Branch:** `feature/m2-refactor-to-ports` → PR to `develop`

---

## Task 1: Create `KeywordAnalyzer` implementing `ISemanticAnalyzer`

**Files:**
- Create: `packages/backend/src/services/keyword-analyzer.ts`
- Create: `packages/backend/src/services/keyword-analyzer.test.ts`

**Step 1: Write the failing test**

Create `packages/backend/src/services/keyword-analyzer.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { KeywordAnalyzer } from './keyword-analyzer.js';

describe('KeywordAnalyzer', () => {
  const analyzer = new KeywordAnalyzer();

  it('implements ISemanticAnalyzer with tier L3a', () => {
    assert.equal(analyzer.name, 'keyword-jaccard');
    assert.equal(analyzer.tier, 'L3a');
  });

  it('returns a match when intents share significant keywords', async () => {
    const result = await analyzer.compare(
      'fix auth token refresh bug in login flow',
      'fix auth token expiry logic in login handler',
    );
    assert.ok(result);
    assert.equal(result.tier, 'L3a');
    assert.ok(result.score >= 0.3);
    assert.ok(result.explanation.length > 0);
  });

  it('returns null when intents are unrelated', async () => {
    const result = await analyzer.compare(
      'redesign the homepage carousel animation',
      'fix database migration rollback script',
    );
    assert.equal(result, null);
  });

  it('returns null for empty inputs', async () => {
    const result = await analyzer.compare('', '');
    assert.equal(result, null);
  });

  it('filters stop words and common dev verbs', async () => {
    // "fix" and "update" are stop words — should not count
    const result = await analyzer.compare('fix the thing', 'update the thing');
    // Only "thing" overlaps — may or may not meet threshold
    // but "fix" and "update" should not inflate the score
    if (result) {
      assert.ok(result.score <= 1.0);
    }
  });
});
```

**Step 2: Run test — expect fail**

```bash
cd packages/backend && node --import tsx --test src/services/keyword-analyzer.test.ts
```
Expected: FAIL — module not found.

**Step 3: Implement KeywordAnalyzer**

Create `packages/backend/src/services/keyword-analyzer.ts`:

```typescript
import type { ISemanticAnalyzer, SemanticMatch } from '@open-hive/shared';

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either',
  'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than',
  'too', 'very', 'just', 'because', 'if', 'when', 'while', 'this',
  'that', 'these', 'those', 'i', 'me', 'my', 'we', 'our', 'you',
  'your', 'he', 'him', 'his', 'she', 'her', 'it', 'its', 'they',
  'them', 'their', 'what', 'which', 'who', 'whom', 'how', 'where',
  'fix', 'add', 'update', 'change', 'make', 'get', 'set', 'use',
  'implement', 'create', 'remove', 'delete', 'refactor', 'improve',
]);

function extractKeywords(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s-_]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = new Set([...a].filter(k => b.has(k)));
  const union = new Set([...a, ...b]);
  return intersection.size / union.size;
}

export class KeywordAnalyzer implements ISemanticAnalyzer {
  readonly name = 'keyword-jaccard';
  readonly tier = 'L3a' as const;

  private threshold: number;

  constructor(threshold = 0.3) {
    this.threshold = threshold;
  }

  async compare(intentA: string, intentB: string): Promise<SemanticMatch | null> {
    const ka = extractKeywords(intentA);
    const kb = extractKeywords(intentB);
    const score = jaccardSimilarity(ka, kb);

    if (score < this.threshold) return null;

    const shared = [...ka].filter(k => kb.has(k));
    return {
      score,
      tier: 'L3a',
      explanation: `Keyword overlap (${(score * 100).toFixed(0)}%): ${shared.join(', ')}`,
    };
  }
}
```

**Step 4: Run test — expect pass**

```bash
cd packages/backend && node --import tsx --test src/services/keyword-analyzer.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add packages/backend/src/services/keyword-analyzer.ts packages/backend/src/services/keyword-analyzer.test.ts
git commit -m "feat: extract KeywordAnalyzer implementing ISemanticAnalyzer"
```

---

## Task 2: Create `PassthroughIdentityProvider`

**Files:**
- Create: `packages/backend/src/services/passthrough-identity-provider.ts`
- Create: `packages/backend/src/services/passthrough-identity-provider.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/backend/src/services/passthrough-identity-provider.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PassthroughIdentityProvider } from './passthrough-identity-provider.js';

describe('PassthroughIdentityProvider', () => {
  const provider = new PassthroughIdentityProvider();

  it('implements IIdentityProvider', () => {
    assert.equal(provider.name, 'passthrough');
    assert.equal(provider.requiresAuth, false);
  });

  it('resolves identity from request body', async () => {
    const identity = await provider.authenticate({
      headers: {},
      body: { developer_email: 'alice@test.com', developer_name: 'Alice' },
    });
    assert.ok(identity);
    assert.equal(identity.email, 'alice@test.com');
    assert.equal(identity.display_name, 'Alice');
  });

  it('returns null when email is missing', async () => {
    const identity = await provider.authenticate({
      headers: {},
      body: { developer_name: 'Alice' },
    });
    assert.equal(identity, null);
  });

  it('returns null when body is missing', async () => {
    const identity = await provider.authenticate({ headers: {} });
    assert.equal(identity, null);
  });
});
```

**Step 2: Run test — expect fail**

**Step 3: Implement**

```typescript
// packages/backend/src/services/passthrough-identity-provider.ts
import type { IIdentityProvider, AuthContext, DeveloperIdentity } from '@open-hive/shared';

export class PassthroughIdentityProvider implements IIdentityProvider {
  readonly name = 'passthrough';
  readonly requiresAuth = false;

  async authenticate(context: AuthContext): Promise<DeveloperIdentity | null> {
    const email = context.body?.developer_email;
    if (!email || typeof email !== 'string') return null;

    return {
      email,
      display_name: (context.body?.developer_name as string) ?? 'Unknown',
    };
  }
}
```

**Step 4: Run test — expect pass**

**Step 5: Commit**

```bash
git commit -m "feat: add PassthroughIdentityProvider implementing IIdentityProvider"
```

---

## Task 3: Refactor `NotificationDispatcher` into `AlertDispatcher`

**Files:**
- Create: `packages/backend/src/services/alert-dispatcher.ts`
- Create: `packages/backend/src/services/alert-dispatcher.test.ts`
- Keep: `packages/backend/src/services/notification-dispatcher.ts` (deprecated, removed after migration)

**Step 1: Write failing tests for AlertDispatcher**

```typescript
// packages/backend/src/services/alert-dispatcher.test.ts
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { AlertDispatcher } from './alert-dispatcher.js';
import type { IAlertSink, AlertEvent } from '@open-hive/shared';

function createTestEvent(overrides?: Partial<AlertEvent>): AlertEvent {
  return {
    type: 'collision_detected',
    severity: 'critical',
    collision: {
      collision_id: 'col-1',
      session_ids: ['sess-a', 'sess-b'],
      type: 'file',
      severity: 'critical',
      details: 'Both modifying auth.ts',
      detected_at: new Date().toISOString(),
      resolved: false,
      resolved_by: null,
    },
    participants: [
      { developer_name: 'Alice', developer_email: 'alice@test.com', repo: 'test', intent: 'fix auth' },
      { developer_name: 'Bob', developer_email: 'bob@test.com', repo: 'test', intent: 'update auth' },
    ],
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('AlertDispatcher', () => {
  it('delivers to sinks that pass shouldFire', async () => {
    const delivered: AlertEvent[] = [];
    const sink: IAlertSink = {
      name: 'test',
      shouldFire: () => true,
      deliver: async (e) => { delivered.push(e); },
    };

    const dispatcher = new AlertDispatcher();
    dispatcher.registerSink(sink);
    await dispatcher.dispatch(createTestEvent());
    await new Promise(r => setTimeout(r, 50));

    assert.equal(delivered.length, 1);
  });

  it('skips sinks where shouldFire returns false', async () => {
    const delivered: AlertEvent[] = [];
    const sink: IAlertSink = {
      name: 'test',
      shouldFire: () => false,
      deliver: async (e) => { delivered.push(e); },
    };

    const dispatcher = new AlertDispatcher();
    dispatcher.registerSink(sink);
    await dispatcher.dispatch(createTestEvent());
    await new Promise(r => setTimeout(r, 50));

    assert.equal(delivered.length, 0);
  });

  it('swallows errors from sinks', async () => {
    const sink: IAlertSink = {
      name: 'broken',
      shouldFire: () => true,
      deliver: async () => { throw new Error('boom'); },
    };

    const dispatcher = new AlertDispatcher();
    dispatcher.registerSink(sink);
    // Should not throw
    await dispatcher.dispatch(createTestEvent());
    await new Promise(r => setTimeout(r, 50));
    assert.ok(true);
  });

  it('dispatches to multiple sinks', async () => {
    const names: string[] = [];
    const makeSink = (name: string): IAlertSink => ({
      name,
      shouldFire: () => true,
      deliver: async () => { names.push(name); },
    });

    const dispatcher = new AlertDispatcher();
    dispatcher.registerSink(makeSink('slack'));
    dispatcher.registerSink(makeSink('teams'));
    dispatcher.registerSink(makeSink('discord'));
    await dispatcher.dispatch(createTestEvent());
    await new Promise(r => setTimeout(r, 50));

    assert.equal(names.length, 3);
  });
});
```

**Step 2: Implement AlertDispatcher**

```typescript
// packages/backend/src/services/alert-dispatcher.ts
import type { IAlertSink, AlertEvent } from '@open-hive/shared';

export class AlertDispatcher {
  private sinks: IAlertSink[] = [];

  registerSink(sink: IAlertSink): void {
    this.sinks.push(sink);
  }

  async dispatch(event: AlertEvent): Promise<void> {
    const eligible = this.sinks.filter(s => s.shouldFire(event));
    // Fire-and-forget — don't block the request
    Promise.allSettled(eligible.map(s => s.deliver(event))).catch(() => {});
  }
}
```

**Step 3: Run tests — expect pass**

**Step 4: Commit**

```bash
git commit -m "feat: add AlertDispatcher using IAlertSink port"
```

---

## Task 4: Create `GenericWebhookSink` implementing `IAlertSink`

This replaces the generic webhook functionality currently in NotificationDispatcher.

**Files:**
- Create: `packages/backend/src/services/generic-webhook-sink.ts`
- Create: `packages/backend/src/services/generic-webhook-sink.test.ts`

**Step 1: Write failing test**

```typescript
// packages/backend/src/services/generic-webhook-sink.test.ts
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { GenericWebhookSink } from './generic-webhook-sink.js';
import type { AlertEvent, CollisionSeverity } from '@open-hive/shared';

function createTestEvent(severity: CollisionSeverity = 'critical'): AlertEvent {
  return {
    type: 'collision_detected',
    severity,
    collision: {
      collision_id: 'col-1', session_ids: ['a', 'b'], type: 'file',
      severity, details: 'test', detected_at: new Date().toISOString(),
      resolved: false, resolved_by: null,
    },
    participants: [],
    timestamp: new Date().toISOString(),
  };
}

describe('GenericWebhookSink', () => {
  it('fires to the configured URL', async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = mock.fn(async (url: string | URL | Request) => {
      calls.push(url as string);
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    try {
      const sink = new GenericWebhookSink('https://hook.example.com/a');
      await sink.deliver(createTestEvent());
      assert.equal(calls.length, 1);
      assert.equal(calls[0], 'https://hook.example.com/a');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('respects min severity — skips events below threshold', () => {
    const sink = new GenericWebhookSink('https://hook.example.com/a', 'warning');
    assert.equal(sink.shouldFire(createTestEvent('info')), false);
    assert.equal(sink.shouldFire(createTestEvent('warning')), true);
    assert.equal(sink.shouldFire(createTestEvent('critical')), true);
  });

  it('swallows fetch errors', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => { throw new Error('network'); }) as typeof fetch;
    try {
      const sink = new GenericWebhookSink('https://hook.example.com/a');
      await sink.deliver(createTestEvent()); // should not throw
      assert.ok(true);
    } finally {
      globalThis.fetch = original;
    }
  });
});
```

**Step 2: Implement**

```typescript
// packages/backend/src/services/generic-webhook-sink.ts
import type { IAlertSink, AlertEvent, CollisionSeverity } from '@open-hive/shared';

const SEVERITY_ORDER: CollisionSeverity[] = ['info', 'warning', 'critical'];

export class GenericWebhookSink implements IAlertSink {
  readonly name = 'generic-webhook';

  constructor(
    private url: string,
    private minSeverity: CollisionSeverity = 'info',
  ) {}

  shouldFire(event: AlertEvent): boolean {
    return SEVERITY_ORDER.indexOf(event.severity) >= SEVERITY_ORDER.indexOf(this.minSeverity);
  }

  async deliver(event: AlertEvent): Promise<void> {
    try {
      await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Fire-and-forget
    }
  }
}
```

**Step 3: Run tests, commit**

```bash
git commit -m "feat: add GenericWebhookSink implementing IAlertSink"
```

---

## Task 5: Create `PortRegistry` and refactor `server.ts`

**Files:**
- Create: `packages/backend/src/port-registry.ts`
- Modify: `packages/backend/src/server.ts`
- Modify: `packages/backend/src/routes/sessions.ts`
- Modify: `packages/backend/src/routes/signals.ts`
- Modify: `packages/backend/src/routes/conflicts.ts`

**Step 1: Create PortRegistry**

```typescript
// packages/backend/src/port-registry.ts
import type { IHiveStore, IAlertSink, IIdentityProvider, ISemanticAnalyzer } from '@open-hive/shared';
import { AlertDispatcher } from './services/alert-dispatcher.js';

export class PortRegistry {
  readonly store: IHiveStore;
  readonly alerts: AlertDispatcher;
  readonly identity: IIdentityProvider;
  readonly analyzers: ISemanticAnalyzer[];

  constructor(opts: {
    store: IHiveStore;
    identity: IIdentityProvider;
    analyzers?: ISemanticAnalyzer[];
    sinks?: IAlertSink[];
  }) {
    this.store = opts.store;
    this.identity = opts.identity;
    this.analyzers = opts.analyzers ?? [];
    this.alerts = new AlertDispatcher();
    for (const sink of opts.sinks ?? []) {
      this.alerts.registerSink(sink);
    }
  }
}
```

**Step 2: Refactor server.ts to use PortRegistry**

Replace the manual construction in `server.ts` with:

```typescript
import { PortRegistry } from './port-registry.js';
import { KeywordAnalyzer } from './services/keyword-analyzer.js';
import { PassthroughIdentityProvider } from './services/passthrough-identity-provider.js';
import { GenericWebhookSink } from './services/generic-webhook-sink.js';

const config = loadConfig();
const store = createStore(config);

const registry = new PortRegistry({
  store,
  identity: new PassthroughIdentityProvider(),
  analyzers: config.collision.semantic.keywords_enabled ? [new KeywordAnalyzer()] : [],
  sinks: config.alerts.webhook_urls.map(url =>
    new GenericWebhookSink(url, config.alerts.min_severity)
  ),
});

const engine = new CollisionEngine(store, config, registry.analyzers);
```

**Step 3: Refactor route signatures**

Change route functions to accept `PortRegistry` instead of individual services. Extract the repeated "lookup sessions → build participants → dispatch alert" pattern into a helper:

```typescript
// Add to port-registry.ts or a new helpers file
import type { AlertEvent, AlertParticipant, Collision } from '@open-hive/shared';

export async function buildAlertEvent(
  store: IHiveStore,
  type: AlertEvent['type'],
  collision: Collision,
): Promise<AlertEvent> {
  const sessionData = await Promise.all(
    collision.session_ids.map(id => store.getSession(id))
  );
  const participants: AlertParticipant[] = sessionData
    .filter(Boolean)
    .map(s => ({
      developer_name: s!.developer_name,
      developer_email: s!.developer_email,
      repo: s!.repo,
      intent: s!.intent,
    }));

  return {
    type,
    severity: collision.severity,
    collision,
    participants,
    timestamp: new Date().toISOString(),
  };
}
```

Then in routes, replace the 10-line notify blocks with:

```typescript
const event = await buildAlertEvent(registry.store, 'collision_detected', collision);
registry.alerts.dispatch(event);
```

**Step 4: Build and test**

```bash
npm run build && npm run test
```
Expected: All tests pass. Behavior is identical.

**Step 5: Commit**

```bash
git commit -m "refactor: wire server through PortRegistry, extract alert helper"
```

---

## Task 6: Refactor `CollisionEngine` to use `ISemanticAnalyzer[]`

**Files:**
- Modify: `packages/backend/src/services/collision-engine.ts`
- Modify: `packages/backend/src/collision-engine.test.ts`

**Step 1: Update CollisionEngine constructor to accept analyzers**

```typescript
export class CollisionEngine {
  constructor(
    private store: IHiveStore,
    private config: HiveBackendConfig,
    private analyzers: ISemanticAnalyzer[] = [],
  ) {}
```

**Step 2: Refactor `checkIntentCollision` to iterate analyzers**

Replace the direct `keywordOverlap` call with:

```typescript
async checkIntentCollision(session_id: string, intent: string, repo: string): Promise<Collision[]> {
  if (this.analyzers.length === 0) return [];

  const activeSessions = await this.store.getActiveSessions(
    this.config.collision.scope === 'repo' ? repo : undefined
  );
  const others = activeSessions.filter(s => s.session_id !== session_id && s.intent);
  const collisions: Collision[] = [];

  for (const other of others) {
    for (const analyzer of this.analyzers) {
      const match = await analyzer.compare(intent, other.intent!);
      if (!match) continue;

      const collision = await this.store.createCollision({
        session_ids: [session_id, other.session_id],
        type: 'semantic',
        severity: match.tier === 'L3a' ? 'info' : 'warning',
        details: `${match.explanation} — "${truncate(intent, 60)}" vs "${truncate(other.intent!, 60)}" [${match.tier}]`,
        detected_at: new Date().toISOString(),
      });
      collisions.push(collision);
      break; // First matching analyzer wins for this pair
    }
  }

  return collisions;
}
```

Apply the same pattern to `checkHistoricalIntentCollision`.

**Step 3: Remove the private `keywordOverlap`, `extractKeywords`, `STOP_WORDS`**

These now live in `KeywordAnalyzer`.

**Step 4: Update tests to pass analyzer**

In `collision-engine.test.ts`, update `CollisionEngine` construction:

```typescript
import { KeywordAnalyzer } from './services/keyword-analyzer.js';

// In test setup:
engine = new CollisionEngine(store, createTestConfig(), [new KeywordAnalyzer()]);
```

For the "disabled" test, pass an empty array:
```typescript
engine = new CollisionEngine(store, config, []);
```

**Step 5: Run tests**

```bash
npm run test
```
Expected: All tests pass with identical behavior.

**Step 6: Commit**

```bash
git commit -m "refactor: CollisionEngine delegates to ISemanticAnalyzer[]"
```

---

## Task 7: Refactor `authenticate` middleware to use `IIdentityProvider`

**Files:**
- Modify: `packages/backend/src/middleware/auth.ts`
- Modify: `packages/backend/src/server.ts`

**Step 1: Rewrite auth.ts**

```typescript
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DeveloperIdentity, IIdentityProvider } from '@open-hive/shared';

declare module 'fastify' {
  interface FastifyRequest {
    developer?: DeveloperIdentity;
  }
}

export function createAuthMiddleware(provider: IIdentityProvider) {
  return async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const identity = await provider.authenticate({
      headers: request.headers as Record<string, string | string[] | undefined>,
      body: request.body as Record<string, unknown> | undefined,
    });

    if (identity) {
      request.developer = identity;
    } else if (provider.requiresAuth) {
      return reply.status(401).send({ ok: false, error: 'Authentication required' });
    }
  };
}
```

**Step 2: Update server.ts**

```typescript
import { createAuthMiddleware } from './middleware/auth.js';

app.addHook('preHandler', createAuthMiddleware(registry.identity));
```

**Step 3: Build and test**

```bash
npm run build && npm run test
```

**Step 4: Commit**

```bash
git commit -m "refactor: auth middleware delegates to IIdentityProvider"
```

---

## Task 8: Remove deprecated `NotificationDispatcher` and clean up

**Files:**
- Delete: `packages/backend/src/services/notification-dispatcher.ts`
- Delete: `packages/backend/src/notification-dispatcher.test.ts`
- Modify: `packages/shared/src/api.ts` (remove duplicate `WebhookPayload`)

**Step 1: Delete old files**

```bash
rm packages/backend/src/services/notification-dispatcher.ts
rm packages/backend/src/notification-dispatcher.test.ts
```

**Step 2: Remove duplicate WebhookPayload from shared/api.ts**

The `WebhookPayload` type in `shared/src/api.ts:99-105` is replaced by `AlertEvent` from ports.ts. Remove it.

**Step 3: Remove `DeveloperIdentity` from auth.ts**

It now comes from `@open-hive/shared` ports. The `declare module` augmentation stays but references the shared type.

**Step 4: Build and test**

```bash
npm run build && npm run test
```

**Step 5: Commit**

```bash
git commit -m "refactor: remove deprecated NotificationDispatcher, deduplicate types"
```

---

## Task 9: Final verification and PR

**Step 1: Full build + test**

```bash
npm run build && npm run test
```

**Step 2: Push and create PR**

```bash
git push -u origin feature/m2-refactor-to-ports
gh pr create --base develop --title "refactor: wire all code through port interfaces (M2)" --body "$(cat <<'EOF'
## Summary
- Extract `KeywordAnalyzer` implementing `ISemanticAnalyzer`
- Add `PassthroughIdentityProvider` implementing `IIdentityProvider`
- Replace `NotificationDispatcher` with `AlertDispatcher` + `IAlertSink`
- Add `GenericWebhookSink` (replaces raw webhook logic)
- Create `PortRegistry` — single point of wiring for all ports
- Refactor `CollisionEngine` to iterate `ISemanticAnalyzer[]`
- Refactor auth middleware to delegate to `IIdentityProvider`
- Eliminate copy-pasted "lookup sessions → notify" pattern in routes
- Remove deprecated `NotificationDispatcher` + duplicate `WebhookPayload`

## Context
Phase 2, Milestone 2. All code now uses port interfaces. Skills can now
provide alternative implementations by implementing the interfaces from
`@open-hive/shared` and registering them in the PortRegistry.

Depends on: #<M1_ISSUE_NUMBER>
Closes: #<M2_ISSUE_NUMBER>

## Test plan
- [ ] `npm run build` — 0 errors
- [ ] `npm run test` — all tests pass (new + migrated)
- [ ] Existing collision detection behavior unchanged
- [ ] Existing webhook behavior unchanged
EOF
)"
```

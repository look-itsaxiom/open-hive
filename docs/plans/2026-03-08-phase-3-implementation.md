# Phase 3 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Evolve Open Hive from collision detector to organizational coordination layer through three sequential experiments, each validating assumptions before the next builds on them.

**Architecture:** Extend the existing hexagonal architecture (Phase 2 ports). New concepts added to `@open-hive/shared`, new services to `packages/backend/src/services/`, new routes to `packages/backend/src/routes/`. Each experiment produces working code, tests, and documented learnings.

**Tech Stack:** Node.js 22+, Fastify v5, TypeScript, node:sqlite (WAL mode), node:test, Turborepo monorepo. A2A-informed protocol patterns (JSON-RPC 2.0 concepts, Agent Card schema, contextId grouping, task state machine).

**Reference:** `docs/plans/2026-03-08-phase-3-design.md` is the conceptual design. Open Workshop (`~/.open-workshop/`) is the blueprint for consciousness state patterns — study but don't modify.

**Branch strategy:** `develop` → `feature/p3-exp-N` branches. PR to develop after each experiment.

---

## Experiment 1: Richer Signals + Decay

**Hypothesis:** Expanding signal types beyond file/intent and adding weighted decay produces a more accurate picture of organizational activity than the current accumulate-forever model.

**What we learn:** Which signal types are actually useful. Whether weighted decay produces meaningfully different query results. What half-lives make sense per signal type. Whether the hot storage tier (SQLite WAL) handles the added complexity without performance issues.

### Task 1.1: Expand Signal Types in Shared Models

**Files:**
- Modify: `packages/shared/src/models.ts`
- Modify: `packages/shared/src/api.ts`

**Step 1: Update SignalType union**

In `packages/shared/src/models.ts`, expand SignalType:

```typescript
export type SignalType =
  // Phase 2 (existing)
  | 'prompt' | 'file_modify' | 'file_read' | 'search' | 'explicit'
  // Phase 3 — richer taxonomy
  | 'intent_declared'        // what the agent's human wants to accomplish
  | 'outcome_achieved'       // work completed, merged, deployed
  | 'blocker_hit'            // something is stuck
  | 'context_needed'         // agent needs more information to proceed
  | 'dependency_discovered'  // this work depends on something else
  | 'state_report';          // periodic snapshot from an orchestration nerve
```

**Step 2: Add weight field to Signal model**

In `packages/shared/src/models.ts`, add `weight` to Signal:

```typescript
export interface Signal {
  signal_id: string;
  session_id: string;
  timestamp: string;
  type: SignalType;
  content: string;
  file_path: string | null;
  semantic_area: string | null;
  weight: number;  // 0.0 (fully decayed) to 1.0 (fresh). Initialized to 1.0.
}
```

**Step 3: Add signal weight to API types**

In `packages/shared/src/api.ts`, add a new request type for the richer signals:

```typescript
export interface RichSignalRequest {
  session_id: string;
  type: SignalType;
  content: string;
  file_path?: string;
  semantic_area?: string;
  context_id?: string;  // A2A-inspired: groups related work
}

export interface RichSignalResponse {
  ok: boolean;
  signal: Signal;
  collisions: Collision[];
}
```

**Step 4: Commit**

```bash
git add packages/shared/src/models.ts packages/shared/src/api.ts
git commit -m "feat(shared): expand signal types and add decay weight model"
```

### Task 1.2: Add Decay Configuration

**Files:**
- Modify: `packages/shared/src/config.ts`

**Step 1: Add decay config to HiveBackendConfig**

```typescript
// Add to HiveBackendConfig:
decay: {
  /** Whether signal decay is enabled. */
  enabled: boolean;
  /** Default half-life in seconds for signals without a type-specific override. */
  default_half_life_seconds: number;
  /** Per-type half-life overrides in seconds. */
  type_overrides: Partial<Record<SignalType, number>>;
  /** Minimum weight before a signal is considered fully decayed (still queryable). */
  floor: number;
};
```

**Step 2: Add decay defaults to env.ts**

In `packages/backend/src/env.ts`, add defaults:

```typescript
decay: {
  enabled: process.env.DECAY_ENABLED !== 'false',
  default_half_life_seconds: parseInt(process.env.DECAY_HALF_LIFE ?? '86400', 10), // 24h default
  type_overrides: {},
  floor: parseFloat(process.env.DECAY_FLOOR ?? '0.01'),
},
```

**Step 3: Commit**

```bash
git add packages/shared/src/config.ts packages/backend/src/env.ts
git commit -m "feat(config): add signal decay configuration"
```

### Task 1.3: Implement Decay Service (TDD)

**Files:**
- Create: `packages/backend/src/services/decay-service.ts`
- Create: `packages/backend/src/services/decay-service.test.ts`

**Step 1: Write failing tests**

```typescript
// decay-service.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DecayService } from './decay-service.js';

describe('DecayService', () => {
  const service = new DecayService({
    enabled: true,
    default_half_life_seconds: 3600, // 1 hour
    type_overrides: { blocker_hit: 7200 }, // 2 hours for blockers
    floor: 0.01,
  });

  it('returns 1.0 for a brand new signal', () => {
    const now = new Date().toISOString();
    assert.equal(service.calculateWeight(now, 'file_modify'), 1.0);
  });

  it('returns ~0.5 after one half-life', () => {
    const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
    const weight = service.calculateWeight(oneHourAgo, 'file_modify');
    assert.ok(weight > 0.49 && weight < 0.51, `Expected ~0.5, got ${weight}`);
  });

  it('respects type-specific half-life overrides', () => {
    const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
    const weight = service.calculateWeight(oneHourAgo, 'blocker_hit');
    // blocker_hit has 2h half-life, so after 1h it should be ~0.707
    assert.ok(weight > 0.69 && weight < 0.72, `Expected ~0.707, got ${weight}`);
  });

  it('never drops below floor', () => {
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const weight = service.calculateWeight(weekAgo, 'file_modify');
    assert.equal(weight, 0.01);
  });

  it('returns 1.0 when decay is disabled', () => {
    const disabled = new DecayService({
      enabled: false,
      default_half_life_seconds: 3600,
      type_overrides: {},
      floor: 0.01,
    });
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    assert.equal(disabled.calculateWeight(weekAgo, 'file_modify'), 1.0);
  });

  it('applies weight to an array of signals and sorts by weighted relevance', () => {
    const signals = [
      { timestamp: new Date(Date.now() - 7200 * 1000).toISOString(), type: 'file_modify' as const },
      { timestamp: new Date(Date.now() - 60 * 1000).toISOString(), type: 'file_modify' as const },
      { timestamp: new Date(Date.now() - 86400 * 1000).toISOString(), type: 'file_modify' as const },
    ];
    const weighted = service.applyDecay(signals);
    // Should be sorted by weight descending (freshest first)
    assert.ok(weighted[0].weight > weighted[1].weight);
    assert.ok(weighted[1].weight > weighted[2].weight);
  });
});
```

**Step 2: Run tests — verify they fail**

```bash
cd packages/backend && npx tsx --test src/services/decay-service.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement DecayService**

```typescript
// decay-service.ts
import type { SignalType } from '@open-hive/shared';

export interface DecayConfig {
  enabled: boolean;
  default_half_life_seconds: number;
  type_overrides: Partial<Record<SignalType, number>>;
  floor: number;
}

export class DecayService {
  constructor(private config: DecayConfig) {}

  /**
   * Calculate the current weight of a signal based on its age and type.
   * Uses exponential decay: weight = max(floor, 2^(-age/half_life))
   */
  calculateWeight(timestamp: string, type: SignalType): number {
    if (!this.config.enabled) return 1.0;

    const ageSeconds = (Date.now() - new Date(timestamp).getTime()) / 1000;
    if (ageSeconds <= 0) return 1.0;

    const halfLife = this.config.type_overrides[type] ?? this.config.default_half_life_seconds;
    const weight = Math.pow(2, -(ageSeconds / halfLife));

    return Math.max(this.config.floor, weight);
  }

  /**
   * Apply decay weights to an array of objects with timestamp + type,
   * returning them sorted by weight descending (most relevant first).
   */
  applyDecay<T extends { timestamp: string; type: SignalType }>(
    items: T[],
  ): (T & { weight: number })[] {
    return items
      .map(item => ({
        ...item,
        weight: this.calculateWeight(item.timestamp, item.type),
      }))
      .sort((a, b) => b.weight - a.weight);
  }
}
```

**Step 4: Run tests — verify they pass**

```bash
cd packages/backend && npx tsx --test src/services/decay-service.test.ts
```

Expected: all 6 tests PASS.

**Step 5: Commit**

```bash
git add packages/backend/src/services/decay-service.ts packages/backend/src/services/decay-service.test.ts
git commit -m "feat(backend): implement DecayService with exponential half-life model"
```

### Task 1.4: Add Weight Column to SQLite Schema + Store

**Files:**
- Modify: `packages/backend/src/db/sqlite.ts`
- Modify: `packages/backend/src/db/store.ts`
- Modify: `packages/backend/src/smoke.test.ts`

**Step 1: Write failing smoke test**

Add to `smoke.test.ts` a new describe block:

```typescript
describe('Smoke: signal decay weight', () => {
  let app: FastifyInstance;
  before(async () => { app = await buildTestServer(); });
  after(async () => { await app.close(); });

  it('signals are created with weight 1.0', async () => {
    await app.inject({
      method: 'POST', url: '/api/sessions/register',
      payload: {
        session_id: 'decay-1', developer_email: 'alice@test.com',
        developer_name: 'Alice', repo: 'app', project_path: '/code/app',
      },
    });

    await app.inject({
      method: 'POST', url: '/api/signals/activity',
      payload: { session_id: 'decay-1', file_path: 'src/foo.ts', type: 'file_modify' },
    });

    const history = await app.inject({ method: 'GET', url: '/api/history?repo=app' });
    const body = JSON.parse(history.body);
    assert.ok(body.signals.length >= 1);
    assert.equal(body.signals[0].weight, 1.0);
  });
});
```

**Step 2: Run test — verify it fails**

```bash
cd packages/backend && npx tsx --test src/smoke.test.ts
```

Expected: FAIL — weight property missing from signal.

**Step 3: Add weight column to schema**

In the SQLite schema creation (both `sqlite.ts` and the test helper in `smoke.test.ts`), add:

```sql
-- Add to signals table:
weight REAL NOT NULL DEFAULT 1.0
```

**Step 4: Update HiveStore.createSignal to accept weight**

In `store.ts`, the `createSignal` method should set `weight: 1.0` as default:

```typescript
// In the INSERT statement, add weight column
// In the return object, include weight: 1.0
```

**Step 5: Update HiveStore.getRecentSignals to return weight**

Ensure the SELECT query includes the weight column and maps it to the Signal interface.

**Step 6: Run tests — verify they pass**

```bash
cd packages/backend && npm test
```

Expected: all tests PASS including the new decay weight test.

**Step 7: Commit**

```bash
git add packages/backend/src/db/sqlite.ts packages/backend/src/db/store.ts packages/backend/src/smoke.test.ts
git commit -m "feat(backend): add signal weight column to SQLite schema"
```

### Task 1.5: Wire Decay Into Signal Queries

**Files:**
- Modify: `packages/backend/src/server.ts`
- Modify: `packages/backend/src/port-registry.ts`
- Modify: `packages/backend/src/routes/history.ts`

**Step 1: Add DecayService to PortRegistry**

```typescript
// In port-registry.ts, add to PortRegistry interface:
decay: DecayService;
```

**Step 2: Wire DecayService in server.ts**

Create DecayService from config, add to registry.

**Step 3: Apply decay weights in history route**

When returning signals from the history endpoint, run them through `decayService.applyDecay()` so that returned signals include their current weight and are sorted by relevance.

**Step 4: Write a smoke test that verifies ordering**

Create two signals at different times, query history, verify the fresher signal has a higher weight and appears first.

**Step 5: Run all tests**

```bash
cd packages/backend && npm test
```

Expected: all tests PASS.

**Step 6: Commit**

```bash
git add packages/backend/src/server.ts packages/backend/src/port-registry.ts packages/backend/src/routes/history.ts packages/backend/src/smoke.test.ts
git commit -m "feat(backend): wire decay into signal queries, sort by weighted relevance"
```

### Task 1.6: Rich Signal Endpoint

**Files:**
- Create: `packages/backend/src/routes/rich-signals.ts`
- Modify: `packages/backend/src/server.ts`
- Modify: `packages/backend/src/smoke.test.ts`

**Step 1: Write failing smoke test**

```typescript
describe('Smoke: rich signal endpoint', () => {
  let app: FastifyInstance;
  before(async () => { app = await buildTestServer(); });
  after(async () => { await app.close(); });

  it('accepts intent_declared signal type', async () => {
    await app.inject({
      method: 'POST', url: '/api/sessions/register',
      payload: {
        session_id: 'rich-1', developer_email: 'alice@test.com',
        developer_name: 'Alice', repo: 'app', project_path: '/code/app',
      },
    });

    const res = await app.inject({
      method: 'POST', url: '/api/signals/rich',
      payload: {
        session_id: 'rich-1',
        type: 'intent_declared',
        content: 'Refactoring the authentication middleware for JWT support',
      },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.ok(body.signal);
    assert.equal(body.signal.type, 'intent_declared');
    assert.equal(body.signal.weight, 1.0);
  });

  it('accepts blocker_hit with context_id', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/signals/rich',
      payload: {
        session_id: 'rich-1',
        type: 'blocker_hit',
        content: 'Waiting on database migration to complete before proceeding',
        context_id: 'auth-refactor-2026',
      },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.signal.type, 'blocker_hit');
  });

  it('rejects unknown signal type', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/signals/rich',
      payload: {
        session_id: 'rich-1',
        type: 'nonexistent_type',
        content: 'test',
      },
    });
    assert.equal(res.statusCode, 400);
  });
});
```

**Step 2: Implement rich signal route**

Create `routes/rich-signals.ts` — a unified signal endpoint that accepts any valid SignalType, stores the signal, runs collision detection where applicable (intent types), and returns the created signal with weight.

**Step 3: Register route in server.ts**

**Step 4: Run all tests**

```bash
cd packages/backend && npm test
```

**Step 5: Commit**

```bash
git add packages/backend/src/routes/rich-signals.ts packages/backend/src/server.ts packages/backend/src/smoke.test.ts
git commit -m "feat(backend): add rich signal endpoint supporting Phase 3 signal types"
```

### Task 1.7: Experiment 1 Learnings Document

**Files:**
- Create: `docs/experiments/2026-03-XX-exp1-signals-decay.md`

Document what we learned:
- Which signal types felt natural during testing
- Whether the decay model produced meaningfully different results
- Performance observations
- Any surprises or course corrections

**Commit and PR to develop.**

---

## Experiment 2: Agent Mail

**Hypothesis:** Persistent, decaying messages between agents (created by both the consciousness and individual agents) enable coordination across session boundaries that isn't possible with the current real-time-only collision model.

**Depends on:** Experiment 1 (decay service, richer signal types).

**What we learn:** Whether async agent-to-agent messaging is useful. What kinds of messages are valuable (collision alerts, context sharing, dependency notifications). How decay affects message relevance. Whether the consciousness should auto-generate mail or just provide the mailbox.

### Task 2.1: Agent Mail Data Model

**Files:**
- Modify: `packages/shared/src/models.ts`
- Modify: `packages/shared/src/api.ts`

**Step 1: Define AgentMail model**

```typescript
// In models.ts
export interface AgentMail {
  mail_id: string;
  from_session_id: string | null;  // null = generated by consciousness
  to_session_id: string | null;    // null = addressed to "anyone working on X"
  to_context_id: string | null;    // A2A-inspired: addressed to a workstream
  type: AgentMailType;
  subject: string;
  content: string;
  created_at: string;
  read_at: string | null;
  weight: number;                  // decays like signals
}

export type AgentMailType =
  | 'collision_alert'       // consciousness detected overlap
  | 'context_share'         // agent sharing relevant context
  | 'dependency_notice'     // "my work depends on / affects yours"
  | 'blocker_notice'        // "I'm stuck on something in your area"
  | 'completion_notice'     // "I finished work relevant to you"
  | 'general';              // freeform
```

**Step 2: Define API types**

```typescript
// In api.ts
export interface SendMailRequest {
  from_session_id: string;
  to_session_id?: string;
  to_context_id?: string;
  type: AgentMailType;
  subject: string;
  content: string;
}

export interface SendMailResponse {
  ok: boolean;
  mail: AgentMail;
}

export interface CheckMailResponse {
  ok: boolean;
  mail: AgentMail[];
}
```

**Step 3: Commit**

```bash
git add packages/shared/src/models.ts packages/shared/src/api.ts
git commit -m "feat(shared): define AgentMail data model and API types"
```

### Task 2.2: Agent Mail Table + Store Methods

**Files:**
- Modify: `packages/backend/src/db/sqlite.ts`
- Modify: `packages/backend/src/db/store.ts`
- Modify: `packages/backend/src/smoke.test.ts` (schema in test helper)

**Step 1: Add agent_mail table to SQLite schema**

```sql
CREATE TABLE IF NOT EXISTS agent_mail (
  mail_id TEXT PRIMARY KEY,
  from_session_id TEXT,
  to_session_id TEXT,
  to_context_id TEXT,
  type TEXT NOT NULL,
  subject TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT,
  weight REAL NOT NULL DEFAULT 1.0
);
CREATE INDEX IF NOT EXISTS idx_mail_to_session ON agent_mail(to_session_id);
CREATE INDEX IF NOT EXISTS idx_mail_to_context ON agent_mail(to_context_id);
CREATE INDEX IF NOT EXISTS idx_mail_read ON agent_mail(read_at);
```

**Step 2: Add store methods**

Add to `IHiveStore` in `ports.ts`:

```typescript
createMail(m: Omit<AgentMail, 'mail_id' | 'read_at' | 'weight'>): Promise<AgentMail>;
getUnreadMail(session_id: string): Promise<AgentMail[]>;
getMailByContext(context_id: string): Promise<AgentMail[]>;
markMailRead(mail_id: string): Promise<void>;
```

Implement in `HiveStore`.

**Step 3: Write unit tests for store methods**

**Step 4: Run tests, commit**

```bash
git commit -m "feat(backend): add agent_mail table and store methods"
```

### Task 2.3: Agent Mail Routes (TDD)

**Files:**
- Create: `packages/backend/src/routes/mail.ts`
- Modify: `packages/backend/src/server.ts`
- Modify: `packages/backend/src/smoke.test.ts`

**Step 1: Write failing smoke tests**

```typescript
describe('Smoke: agent mail', () => {
  let app: FastifyInstance;
  before(async () => { app = await buildTestServer(); });
  after(async () => { await app.close(); });

  it('agent sends mail → recipient picks it up on check-in', async () => {
    // Register Alice and Bob
    await app.inject({
      method: 'POST', url: '/api/sessions/register',
      payload: {
        session_id: 'mail-alice', developer_email: 'alice@test.com',
        developer_name: 'Alice', repo: 'app', project_path: '/code/app',
      },
    });
    await app.inject({
      method: 'POST', url: '/api/sessions/register',
      payload: {
        session_id: 'mail-bob', developer_email: 'bob@test.com',
        developer_name: 'Bob', repo: 'app', project_path: '/code/app',
      },
    });

    // Alice sends mail to Bob
    const send = await app.inject({
      method: 'POST', url: '/api/mail/send',
      payload: {
        from_session_id: 'mail-alice',
        to_session_id: 'mail-bob',
        type: 'context_share',
        subject: 'Auth refactor heads up',
        content: 'I refactored the JWT middleware — your login flow may need updating',
      },
    });
    assert.equal(send.statusCode, 200);
    const sendBody = JSON.parse(send.body);
    assert.equal(sendBody.ok, true);
    assert.ok(sendBody.mail.mail_id);

    // Bob checks mail
    const check = await app.inject({
      method: 'GET', url: '/api/mail/check?session_id=mail-bob',
    });
    assert.equal(check.statusCode, 200);
    const checkBody = JSON.parse(check.body);
    assert.equal(checkBody.mail.length, 1);
    assert.equal(checkBody.mail[0].subject, 'Auth refactor heads up');
    assert.equal(checkBody.mail[0].type, 'context_share');

    // Bob marks it read
    const mark = await app.inject({
      method: 'POST', url: '/api/mail/read',
      payload: { mail_id: checkBody.mail[0].mail_id },
    });
    assert.equal(mark.statusCode, 200);

    // Check again — no unread mail
    const check2 = await app.inject({
      method: 'GET', url: '/api/mail/check?session_id=mail-bob',
    });
    const check2Body = JSON.parse(check2.body);
    assert.equal(check2Body.mail.length, 0);
  });

  it('consciousness-generated mail (no from_session_id) is delivered', async () => {
    // Simulate hive-generated mail by posting without from_session_id
    const send = await app.inject({
      method: 'POST', url: '/api/mail/send',
      payload: {
        to_session_id: 'mail-alice',
        type: 'collision_alert',
        subject: 'Potential overlap detected',
        content: 'Bob is working in the same auth area as you',
      },
    });
    assert.equal(send.statusCode, 200);

    const check = await app.inject({
      method: 'GET', url: '/api/mail/check?session_id=mail-alice',
    });
    const body = JSON.parse(check.body);
    assert.ok(body.mail.some((m: any) => m.type === 'collision_alert'));
  });
});
```

**Step 2: Implement mail routes**

- `POST /api/mail/send` — create agent mail
- `GET /api/mail/check?session_id=X` — get unread mail for session (with decay weights applied)
- `POST /api/mail/read` — mark mail as read

**Step 3: Wire routes in server.ts**

**Step 4: Run all tests**

```bash
cd packages/backend && npm test
```

**Step 5: Commit**

```bash
git commit -m "feat(backend): add agent mail endpoints — send, check, read"
```

### Task 2.4: Auto-Generate Mail on Collision Detection

**Files:**
- Modify: `packages/backend/src/routes/signals.ts`

**Step 1: After collision detection, auto-create agent mail**

When the collision engine detects a new collision, the system (acting as consciousness) creates agent mail to both participants:

```typescript
// After collision detection in signal routes:
for (const collision of collisions) {
  const event = await buildAlertEvent(store, 'collision_detected', collision);
  alerts.dispatch(event);

  // Consciousness generates mail for each participant
  for (const sessionId of collision.session_ids) {
    const otherSessions = collision.session_ids.filter(id => id !== sessionId);
    await store.createMail({
      from_session_id: null, // consciousness-generated
      to_session_id: sessionId,
      to_context_id: null,
      type: 'collision_alert',
      subject: `Collision detected: ${collision.type} (${collision.severity})`,
      content: collision.details,
      created_at: new Date().toISOString(),
    });
  }
}
```

**Step 2: Write smoke test verifying auto-generated mail after collision**

**Step 3: Run all tests, commit**

```bash
git commit -m "feat(backend): auto-generate agent mail on collision detection"
```

### Task 2.5: Agent Mail Decay

**Files:**
- Modify: `packages/backend/src/routes/mail.ts`

**Step 1: Apply DecayService to mail check endpoint**

When returning unread mail, apply decay weights. Mail below the floor weight is still returned but marked as low-relevance. Sort by weight descending.

**Step 2: Add mail-specific half-life config**

Agent mail should decay slower than transient signals — a message is more deliberate than an activity signal.

**Step 3: Test, commit**

```bash
git commit -m "feat(backend): apply signal decay to agent mail relevance"
```

### Task 2.6: Integrate Mail Check Into Session Registration

**Files:**
- Modify: `packages/backend/src/routes/sessions.ts`
- Modify: `packages/shared/src/api.ts`

**Step 1: Expand RegisterSessionResponse**

```typescript
export interface RegisterSessionResponse {
  ok: boolean;
  active_collisions: Collision[];
  active_sessions_in_repo: Pick<Session, 'session_id' | 'developer_name' | 'intent' | 'areas'>[];
  recent_historical_intents: RecentHistoricalIntent[];
  unread_mail: AgentMail[];  // NEW — mail picked up on check-in
}
```

**Step 2: Fetch unread mail during registration**

In the session register route, after the existing parallel queries, also fetch unread mail for the session_id. Include it in the response.

**Step 3: Smoke test, commit**

```bash
git commit -m "feat(backend): deliver unread agent mail on session registration"
```

### Task 2.7: Experiment 2 Learnings Document

Document what we learned about agent mail. **Commit and PR to develop.**

---

## Experiment 3: Nerve Registration Protocol

**Hypothesis:** A generic registration protocol (informed by A2A Agent Cards) allows any tool to connect to the hive as a nerve — declaring identity, human client, and capabilities — without changing the core codebase.

**Depends on:** Experiment 1 (richer signals that nerve types need to emit).

**What we learn:** Whether the Agent Card schema is sufficient for nerve registration. Whether capability declaration (sensory/motor) is the right abstraction. What the admin experience looks like for grafting a new port. Whether a second nerve type can actually register and communicate using only the protocol.

### Task 3.1: Nerve & Agent Card Models

**Files:**
- Modify: `packages/shared/src/models.ts`
- Modify: `packages/shared/src/ports.ts`

**Step 1: Define Nerve and AgentCard types**

```typescript
// In models.ts
export interface AgentCard {
  agent_id: string;
  name: string;
  description: string;
  version: string;
  human_client: {
    email: string;
    display_name: string;
    org?: string;
    teams?: string[];
  };
  capabilities: {
    sensory: SignalType[];    // what signal types this nerve can emit
    motor: DirectiveType[];   // what directive types this nerve can receive
  };
  endpoint_url?: string;      // where to send directives (push)
  registered_at: string;
  last_seen: string;
  status: 'active' | 'idle' | 'disconnected';
}

export type DirectiveType =
  | 'context_injection'       // push relevant context to the agent
  | 'collision_alert'         // alert about detected collision
  | 'mail_delivery'           // deliver agent mail
  | 'coordination_nudge';     // suggest an action

export interface Nerve {
  nerve_id: string;
  agent_card: AgentCard;
  nerve_type: string;         // e.g., 'claude-code', 'open-workshop', 'jira', 'teams'
  created_at: string;
}
```

**Step 2: Add INerveRegistry port**

```typescript
// In ports.ts
export interface INerveRegistry {
  readonly name: string;
  registerNerve(card: AgentCard, nerve_type: string): Promise<Nerve>;
  getNerve(agent_id: string): Promise<Nerve | null>;
  getActiveNerves(nerve_type?: string): Promise<Nerve[]>;
  updateLastSeen(agent_id: string): Promise<void>;
  deregisterNerve(agent_id: string): Promise<void>;
}
```

**Step 3: Commit**

```bash
git commit -m "feat(shared): define Nerve, AgentCard, and INerveRegistry port"
```

### Task 3.2: Nerve Registry Table + Store

**Files:**
- Modify: `packages/backend/src/db/sqlite.ts`
- Modify: `packages/backend/src/db/store.ts`

**Step 1: Add nerves table**

```sql
CREATE TABLE IF NOT EXISTS nerves (
  nerve_id TEXT PRIMARY KEY,
  agent_id TEXT UNIQUE NOT NULL,
  nerve_type TEXT NOT NULL,
  agent_card TEXT NOT NULL,  -- JSON blob
  created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_nerves_type ON nerves(nerve_type);
CREATE INDEX IF NOT EXISTS idx_nerves_status ON nerves(status);
```

**Step 2: Implement store methods**

**Step 3: Test, commit**

```bash
git commit -m "feat(backend): add nerves table and INerveRegistry implementation"
```

### Task 3.3: Nerve Registration API (TDD)

**Files:**
- Create: `packages/backend/src/routes/nerves.ts`
- Modify: `packages/backend/src/server.ts`
- Modify: `packages/backend/src/smoke.test.ts`

**Step 1: Write failing smoke tests**

```typescript
describe('Smoke: nerve registration', () => {
  let app: FastifyInstance;
  before(async () => { app = await buildTestServer(); });
  after(async () => { await app.close(); });

  it('registers a Claude Code nerve with agent card', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/nerves/register',
      payload: {
        nerve_type: 'claude-code',
        agent_card: {
          agent_id: 'cc-alice-001',
          name: 'Alice Claude Code',
          description: 'Claude Code session for Alice',
          version: '1.0.0',
          human_client: {
            email: 'alice@test.com',
            display_name: 'Alice',
          },
          capabilities: {
            sensory: ['file_modify', 'file_read', 'intent_declared', 'outcome_achieved'],
            motor: ['context_injection', 'collision_alert', 'mail_delivery'],
          },
        },
      },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.ok(body.nerve.nerve_id);
    assert.equal(body.nerve.nerve_type, 'claude-code');
  });

  it('lists active nerves', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/nerves/active',
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.nerves.length >= 1);
  });

  it('filters nerves by type', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/nerves/active?type=claude-code',
    });
    const body = JSON.parse(res.body);
    assert.ok(body.nerves.every((n: any) => n.nerve_type === 'claude-code'));
  });

  it('deregisters a nerve', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/nerves/deregister',
      payload: { agent_id: 'cc-alice-001' },
    });
    assert.equal(res.statusCode, 200);

    const check = await app.inject({
      method: 'GET', url: '/api/nerves/active',
    });
    const body = JSON.parse(check.body);
    assert.equal(body.nerves.length, 0);
  });
});
```

**Step 2: Implement nerve routes**

- `POST /api/nerves/register` — register with agent card
- `GET /api/nerves/active` — list active nerves, optional `?type=` filter
- `POST /api/nerves/deregister` — remove a nerve
- `POST /api/nerves/heartbeat` — update last_seen

**Step 3: Wire in server.ts, run all tests, commit**

```bash
git commit -m "feat(backend): add nerve registration API endpoints"
```

### Task 3.4: Add Nerve Registry to PortRegistry

**Files:**
- Modify: `packages/backend/src/port-registry.ts`
- Modify: `packages/backend/src/server.ts`

**Step 1: Extend PortRegistry**

```typescript
export interface PortRegistry {
  store: IHiveStore;
  identity: IIdentityProvider;
  analyzers: ISemanticAnalyzer[];
  alerts: AlertDispatcher;
  decay: DecayService;
  nerves: INerveRegistry;  // NEW
}
```

**Step 2: Wire in server.ts, commit**

```bash
git commit -m "feat(backend): add INerveRegistry to PortRegistry"
```

### Task 3.5: Bridge Sessions to Nerves

**Files:**
- Modify: `packages/backend/src/routes/sessions.ts`

**Step 1: On session registration, auto-register as Claude Code nerve if not already registered**

When a session registers, check if a nerve exists for that agent. If not, auto-create one using the session info as a basic agent card. This bridges the existing session model to the new nerve model without breaking backwards compatibility.

**Step 2: On session end, update nerve last_seen**

**Step 3: Smoke test, commit**

```bash
git commit -m "feat(backend): bridge session registration to nerve model"
```

### Task 3.6: Version Bump + Update Health Endpoint

**Files:**
- Modify: `packages/backend/src/server.ts`

**Step 1: Bump version to 0.3.0**

Update health endpoint to return `version: '0.3.0'` and include nerve count:

```typescript
app.get('/api/health', async () => {
  const nerves = await registry.nerves.getActiveNerves();
  return {
    status: 'ok',
    version: '0.3.0',
    active_nerves: nerves.length,
  };
});
```

**Step 2: Update smoke test health check assertion**

**Step 3: Commit**

```bash
git commit -m "feat(backend): bump to v0.3.0, add nerve count to health endpoint"
```

### Task 3.7: Experiment 3 Learnings Document

Document what we learned about nerve registration. **Commit and PR to develop.**

---

## Post-Experiment: Integration + Release

After all three experiments are merged to develop:

### Task 4.1: Full Integration Test Suite

Run all smoke tests together. Verify that signals + decay + mail + nerves all work in concert. Write one end-to-end test that exercises the full flow:

1. Register two nerves (Claude Code sessions)
2. Both emit rich signals
3. Collision detected → auto-generated agent mail
4. Recipient picks up mail on next registration
5. Signals decay over time
6. Verify history endpoint shows weighted, sorted signals

### Task 4.2: Update CI Pipeline

Add the new test files to the CI workflow. Verify Docker build still works.

### Task 4.3: Update Documentation

- Update the Open Hive status in Open Workshop
- Update `docs/plans/2026-03-08-phase-3-design.md` with learnings
- Update Phase 2's `README.md` references if needed

### Task 4.4: Cut Release v1.3

Branch `releases/v1.3` from develop, run full test suite, merge to main, tag.

---

*Each experiment should take 1-2 sessions. Run experiments sequentially — each builds on the last. Document learnings before starting the next experiment.*

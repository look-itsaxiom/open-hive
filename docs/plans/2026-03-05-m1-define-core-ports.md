# M1: Define Core Port Interfaces — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create `IAlertSink`, `IIdentityProvider`, and `ISemanticAnalyzer` interfaces in `@open-hive/shared`, alongside the existing `IHiveStore`, so all four port contracts live in the shared package where skill authors can import them.

**Architecture:** Move `IHiveStore` from backend to shared. Define three new interfaces following the same pattern. Each interface describes the *concept* (alerting, identity, semantic analysis) without coupling to any specific implementation. All interfaces are exported from `@open-hive/shared`.

**Tech Stack:** TypeScript, `@open-hive/shared` package, Node.js test runner

**Dependencies:** None — this is the foundation milestone.

**Branch:** `feature/m1-core-port-interfaces` → PR to `develop`

---

## Task 1: Move `IHiveStore` to shared package

**Files:**
- Create: `packages/shared/src/ports.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/backend/src/db/store.ts`

**Step 1: Create ports.ts with IHiveStore copied from backend**

Create `packages/shared/src/ports.ts`. Copy the `IHiveStore` interface and `HistoricalIntent` type from `packages/backend/src/db/store.ts` into it. The interface should reference types already in `@open-hive/shared` (Session, Signal, Collision).

```typescript
// packages/shared/src/ports.ts
import type {
  Session, Signal, Collision,
} from './models.js';

// ─── Storage Port ───────────────────────────────────────────

export interface HistoricalIntent {
  session_id: string;
  developer_name: string;
  developer_email: string;
  repo: string;
  intent: string;
  timestamp: string;
}

export interface IHiveStore {
  createSession(s: Omit<Session, 'last_activity' | 'status' | 'files_touched' | 'areas'>): Promise<Session>;
  getSession(session_id: string): Promise<Session | null>;
  getActiveSessions(repo?: string): Promise<Session[]>;
  updateSessionActivity(session_id: string, updates: {
    intent?: string;
    files_touched?: string[];
    areas?: string[];
  }): Promise<void>;
  endSession(session_id: string): Promise<void>;
  cleanupStaleSessions(idle_timeout_seconds: number): Promise<string[]>;
  createSignal(s: Omit<Signal, 'signal_id'>): Promise<Signal>;
  getRecentSignals(opts: {
    repo?: string; file_path?: string; area?: string; since?: string; limit?: number;
  }): Promise<Signal[]>;
  getRecentIntents(opts: {
    repo?: string; exclude_session_id?: string; since?: string; limit?: number;
  }): Promise<HistoricalIntent[]>;
  createCollision(c: Omit<Collision, 'collision_id' | 'resolved' | 'resolved_by'>): Promise<Collision>;
  getActiveCollisions(session_id?: string): Promise<Collision[]>;
  resolveCollision(collision_id: string, resolved_by: string): Promise<void>;
}
```

**Step 2: Export from shared index**

Add to `packages/shared/src/index.ts`:
```typescript
export * from './ports.js';
```

**Step 3: Update backend store.ts to import from shared**

In `packages/backend/src/db/store.ts`:
- Remove the local `HistoricalIntent` interface and `IHiveStore` interface
- Add: `import type { IHiveStore, HistoricalIntent } from '@open-hive/shared';`
- `HiveStore` class should still `implements IHiveStore`
- Re-export from store.ts for backwards compat: `export type { IHiveStore, HistoricalIntent } from '@open-hive/shared';`

**Step 4: Verify build**

```bash
cd packages/shared && npm run build
cd ../backend && npm run build
```
Expected: Both compile with 0 errors.

**Step 5: Run existing tests**

```bash
npm run test
```
Expected: All 40 tests pass — this is a pure refactor.

**Step 6: Commit**

```bash
git add packages/shared/src/ports.ts packages/shared/src/index.ts packages/backend/src/db/store.ts
git commit -m "refactor: move IHiveStore interface to @open-hive/shared"
```

---

## Task 2: Define `IAlertSink` interface

**Files:**
- Modify: `packages/shared/src/ports.ts`
- Create: `packages/shared/src/ports.test.ts` (type-level tests)

**Step 1: Define the interface**

Add to `packages/shared/src/ports.ts`:

```typescript
// ─── Alerts Port ────────────────────────────────────────────

import type { CollisionSeverity } from './models.js';

/** Event payload delivered to alert sinks when a collision is detected or resolved. */
export interface AlertEvent {
  type: 'collision_detected' | 'collision_resolved';
  severity: CollisionSeverity;
  collision: Collision;
  /** The developers involved in this collision. */
  participants: AlertParticipant[];
  timestamp: string;
}

export interface AlertParticipant {
  developer_name: string;
  developer_email: string;
  repo: string;
  intent: string | null;
}

/**
 * An alert sink receives collision events and delivers them to an external channel.
 * Each sink controls its own delivery mechanism, URL, filtering, and formatting.
 *
 * Implementations: Slack webhook, Teams webhook, Discord webhook, email, PagerDuty, etc.
 */
export interface IAlertSink {
  /** Human-readable name for logging (e.g., "slack", "pagerduty"). */
  readonly name: string;

  /** Return true if this sink should fire for the given event. */
  shouldFire(event: AlertEvent): boolean;

  /**
   * Deliver the alert. Implementations should be fire-and-forget:
   * swallow errors, respect timeouts, never throw.
   */
  deliver(event: AlertEvent): Promise<void>;
}
```

**Step 2: Write a type-level conformance test**

Create `packages/shared/src/ports.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IAlertSink, AlertEvent } from './ports.js';

describe('IAlertSink — interface contract', () => {
  it('can be implemented with minimal conforming object', () => {
    const sink: IAlertSink = {
      name: 'test-sink',
      shouldFire: (_event: AlertEvent) => true,
      deliver: async (_event: AlertEvent) => {},
    };
    assert.equal(sink.name, 'test-sink');
    assert.equal(sink.shouldFire({} as AlertEvent), true);
  });
});
```

**Step 3: Run test**

```bash
cd packages/shared && node --import tsx --test src/ports.test.ts
```
Expected: PASS

**Step 4: Commit**

```bash
git add packages/shared/src/ports.ts packages/shared/src/ports.test.ts
git commit -m "feat: define IAlertSink port interface in shared"
```

---

## Task 3: Define `IIdentityProvider` interface

**Files:**
- Modify: `packages/shared/src/ports.ts`
- Modify: `packages/shared/src/ports.test.ts`

**Step 1: Define the interface**

Add to `packages/shared/src/ports.ts`:

```typescript
// ─── Identity Port ──────────────────────────────────────────

/** Canonical developer identity resolved by an identity provider. */
export interface DeveloperIdentity {
  email: string;
  display_name: string;
  org?: string;
  teams?: string[];
}

/**
 * An identity provider authenticates incoming requests and resolves
 * developer identity. The default (no-auth) provider trusts self-reported
 * identity from the request body.
 *
 * Implementations: GitHub OAuth, GitLab OAuth, Azure DevOps OAuth, LDAP, SAML, etc.
 */
export interface IIdentityProvider {
  /** Human-readable name for logging (e.g., "github-oauth", "passthrough"). */
  readonly name: string;

  /**
   * Authenticate a request. Return the resolved identity, or null if
   * authentication fails. Implementations receive the raw request headers
   * and body so they can extract tokens, API keys, etc.
   */
  authenticate(context: AuthContext): Promise<DeveloperIdentity | null>;

  /**
   * Return true if this provider requires authentication.
   * When false, unauthenticated requests are allowed through.
   */
  readonly requiresAuth: boolean;
}

/** Minimal request context passed to identity providers. */
export interface AuthContext {
  headers: Record<string, string | string[] | undefined>;
  body?: {
    developer_email?: string;
    developer_name?: string;
    [key: string]: unknown;
  };
}
```

**Step 2: Add type-level test**

Add to `packages/shared/src/ports.test.ts`:

```typescript
import type { IIdentityProvider, AuthContext, DeveloperIdentity } from './ports.js';

describe('IIdentityProvider — interface contract', () => {
  it('can be implemented as a passthrough provider', () => {
    const provider: IIdentityProvider = {
      name: 'passthrough',
      requiresAuth: false,
      authenticate: async (ctx: AuthContext): Promise<DeveloperIdentity | null> => {
        if (!ctx.body?.developer_email) return null;
        return {
          email: ctx.body.developer_email,
          display_name: ctx.body.developer_name ?? 'Unknown',
        };
      },
    };
    assert.equal(provider.name, 'passthrough');
    assert.equal(provider.requiresAuth, false);
  });
});
```

**Step 3: Run test**

```bash
cd packages/shared && node --import tsx --test src/ports.test.ts
```
Expected: PASS

**Step 4: Commit**

```bash
git add packages/shared/src/ports.ts packages/shared/src/ports.test.ts
git commit -m "feat: define IIdentityProvider port interface in shared"
```

---

## Task 4: Define `ISemanticAnalyzer` interface

**Files:**
- Modify: `packages/shared/src/ports.ts`
- Modify: `packages/shared/src/ports.test.ts`

**Step 1: Define the interface**

Add to `packages/shared/src/ports.ts`:

```typescript
// ─── Semantic Analysis Port ─────────────────────────────────

/** Result of comparing two developer intents for semantic overlap. */
export interface SemanticMatch {
  /** Similarity score from 0.0 (unrelated) to 1.0 (identical intent). */
  score: number;
  /** Which tier produced this result. */
  tier: 'L3a' | 'L3b' | 'L3c';
  /** Human-readable explanation of why overlap was detected. */
  explanation: string;
}

/**
 * A semantic analyzer compares two developer intents and returns a
 * similarity score. Multiple analyzers can be registered and the
 * collision engine runs them in tier order (L3a → L3b → L3c).
 *
 * Implementations:
 * - L3a: Keyword extraction + Jaccard similarity (built-in, free)
 * - L3b: Embedding cosine similarity (OpenAI, Ollama)
 * - L3c: LLM-based comparison (any chat model)
 */
export interface ISemanticAnalyzer {
  /** Human-readable name for logging (e.g., "keyword-jaccard", "openai-embeddings"). */
  readonly name: string;

  /** Which detection tier this analyzer implements. */
  readonly tier: 'L3a' | 'L3b' | 'L3c';

  /**
   * Compare two intents. Return a SemanticMatch if overlap is detected
   * above the analyzer's internal threshold, or null if no meaningful overlap.
   */
  compare(intentA: string, intentB: string): Promise<SemanticMatch | null>;
}
```

**Step 2: Add type-level test**

Add to `packages/shared/src/ports.test.ts`:

```typescript
import type { ISemanticAnalyzer, SemanticMatch } from './ports.js';

describe('ISemanticAnalyzer — interface contract', () => {
  it('can be implemented as a keyword analyzer', () => {
    const analyzer: ISemanticAnalyzer = {
      name: 'keyword-jaccard',
      tier: 'L3a',
      compare: async (a: string, b: string): Promise<SemanticMatch | null> => {
        // Minimal implementation for type checking
        if (a === b) return { score: 1.0, tier: 'L3a', explanation: 'Identical' };
        return null;
      },
    };
    assert.equal(analyzer.tier, 'L3a');
    assert.equal(analyzer.name, 'keyword-jaccard');
  });
});
```

**Step 3: Run test**

```bash
cd packages/shared && node --import tsx --test src/ports.test.ts
```
Expected: PASS

**Step 4: Commit**

```bash
git add packages/shared/src/ports.ts packages/shared/src/ports.test.ts
git commit -m "feat: define ISemanticAnalyzer port interface in shared"
```

---

## Task 5: Update `HiveBackendConfig` to reference ports

**Files:**
- Modify: `packages/shared/src/config.ts`

**Step 1: Add alert and identity config sections**

Update `HiveBackendConfig` in `packages/shared/src/config.ts`:

```typescript
export interface HiveBackendConfig {
  port: number;
  database: {
    type: 'sqlite' | 'postgres';
    url: string;
  };
  collision: {
    scope: 'repo' | 'org';
    semantic: {
      keywords_enabled: boolean;
      embeddings_enabled: boolean;
      embeddings_provider?: string;
      embeddings_api_key?: string;
      llm_enabled: boolean;
      llm_provider?: string;
      llm_api_key?: string;
    };
  };
  alerts: {
    /** Minimum severity for generic webhook alerts. */
    min_severity: 'info' | 'warning' | 'critical';
    /** Generic webhook URLs (raw JSON POST). */
    webhook_urls: string[];
  };
  identity: {
    /** Identity provider type. 'passthrough' means self-reported, no auth. */
    provider: 'passthrough' | 'oauth' | 'custom';
  };
  /** @deprecated Use alerts.webhook_urls instead */
  webhooks: {
    urls: string[];
  };
  session: {
    heartbeat_interval_seconds: number;
    idle_timeout_seconds: number;
  };
}
```

**Step 2: Update env.ts to populate new config sections**

In `packages/backend/src/env.ts`, add the new sections to `loadConfig()`:

```typescript
alerts: {
  min_severity: (process.env.ALERT_MIN_SEVERITY as 'info' | 'warning' | 'critical') ?? 'info',
  webhook_urls: process.env.WEBHOOK_URLS?.split(',').filter(Boolean) ?? [],
},
identity: {
  provider: (process.env.IDENTITY_PROVIDER as 'passthrough' | 'oauth' | 'custom') ?? 'passthrough',
},
```

Keep the `webhooks` section for backwards compat but mirror the value.

**Step 3: Build all packages**

```bash
npm run build
```
Expected: 0 errors. (Some downstream code still uses `config.webhooks.urls` — that's fine, M2 will migrate.)

**Step 4: Run tests**

```bash
npm run test
```
Expected: All tests pass.

**Step 5: Commit**

```bash
git add packages/shared/src/config.ts packages/backend/src/env.ts
git commit -m "feat: add alerts and identity config sections to HiveBackendConfig"
```

---

## Task 6: Final build verification and PR

**Step 1: Full build + test**

```bash
npm run build && npm run test
```
Expected: 0 errors, all tests pass.

**Step 2: Push and create PR**

```bash
git push -u origin feature/m1-core-port-interfaces
gh pr create --base develop --title "feat: define core port interfaces (M1)" --body "$(cat <<'EOF'
## Summary
- Move `IHiveStore` from backend to `@open-hive/shared`
- Define `IAlertSink` — abstract alert delivery port
- Define `IIdentityProvider` — abstract authentication/identity port
- Define `ISemanticAnalyzer` — abstract intent comparison port (L3a/L3b/L3c)
- Add `alerts` and `identity` config sections to `HiveBackendConfig`
- Type-level conformance tests for all new interfaces

## Context
Phase 2, Milestone 1 of the hexagonal architecture migration.
These interfaces are the contracts that all skills will implement.
No behavioral changes — existing code continues to work.

Closes #<M1_ISSUE_NUMBER>

## Test plan
- [ ] `npm run build` — all packages compile
- [ ] `npm run test` — all 40+ tests pass
- [ ] Type-level tests verify interfaces are implementable
EOF
)"
```

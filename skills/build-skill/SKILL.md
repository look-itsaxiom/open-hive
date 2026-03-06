# build-skill

You are building a new Open Hive integration skill. This meta-skill teaches you how to create skills that extend Open Hive's backend with new capabilities using the port-based architecture.

## Overview

Open Hive skills are self-contained SKILL.md files that teach Claude how to add an integration to a user's Open Hive installation. Each skill targets one of four **port interfaces** defined in `@open-hive/shared`. The skill file contains all the code, tests, configuration, and instructions needed to wire the integration end-to-end.

Your job is to:
1. Identify which port the user's desired integration targets
2. Write a complete SKILL.md with all code inline as fenced blocks
3. Ensure tests exist and the build passes

## Architecture: The Four Ports

Open Hive uses a hexagonal (ports & adapters) architecture. All extension points are defined as TypeScript interfaces in `packages/shared/src/ports.ts`. At startup, the backend creates a `PortRegistry` that wires all adapters together.

```
PortRegistry {
  store:      IHiveStore          — where data lives
  identity:   IIdentityProvider   — who is making requests
  analyzers:  ISemanticAnalyzer[] — how intents are compared
  alerts:     AlertDispatcher     — where alerts go (holds IAlertSink[])
}
```

### Decision Tree: Which Port Do I Implement?

```
Is your skill about...
  ...where to send collision alerts?        --> implement IAlertSink
  ...how to authenticate developers?        --> implement IIdentityProvider
  ...how to compare developer intents?      --> implement ISemanticAnalyzer
  ...where to store data?                   --> implement IHiveStore
  ...something else (UI, tooling, etc.)?    --> consume PortRegistry (no port to implement)
```

---

## Port Reference

### 1. IAlertSink (Notification skills)

Send collision alerts to external services (Slack, Discord, PagerDuty, email, etc.).

**Import:**
```typescript
import type { IAlertSink, AlertEvent } from '@open-hive/shared';
```

**Interface:**
```typescript
export interface IAlertSink {
  readonly name: string;
  shouldFire(event: AlertEvent): boolean;
  deliver(event: AlertEvent): Promise<void>;
}
```

**AlertEvent shape:**
```typescript
export interface AlertEvent {
  type: 'collision_detected' | 'collision_resolved';
  severity: CollisionSeverity;     // 'info' | 'warning' | 'critical'
  collision: Collision;
  participants: AlertParticipant[];
  timestamp: string;               // ISO 8601
}
```

**Registration:**
```typescript
import { MyAlertSink } from './services/my-alert-sink.js';

// After PortRegistry creation:
if (process.env.MY_WEBHOOK_URL) {
  registry.alerts.registerSink(
    new MyAlertSink(process.env.MY_WEBHOOK_URL)
  );
}
```

**Template:**
```typescript
import type { IAlertSink, AlertEvent } from '@open-hive/shared';

export class MyAlertSink implements IAlertSink {
  readonly name = 'my-service';

  constructor(private webhookUrl: string) {}

  shouldFire(event: AlertEvent): boolean {
    return event.severity !== 'info';
  }

  async deliver(event: AlertEvent): Promise<void> {
    const devNames = event.participants.map(p => p.developer_name).join(', ');
    await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `[${event.severity.toUpperCase()}] ${event.collision.details} (${devNames})`,
      }),
    });
  }
}
```

**Complexity:** Low -- implement 3 members, register in server.ts

---

### 2. IIdentityProvider (Auth skills)

Authenticate incoming requests and resolve developer identities.

**Import:**
```typescript
import type { IIdentityProvider, AuthContext, DeveloperIdentity } from '@open-hive/shared';
```

**Interface:**
```typescript
export interface IIdentityProvider {
  readonly name: string;
  readonly requiresAuth: boolean;
  authenticate(ctx: AuthContext): Promise<DeveloperIdentity | null>;
}
```

**Registration:**
```typescript
import { MyOAuthProvider } from './services/my-oauth-provider.js';

const identity = authEnabled
  ? new MyOAuthProvider({ clientId: '...', clientSecret: '...' })
  : new PassthroughIdentityProvider();

const registry: PortRegistry = {
  store,
  identity,
  analyzers,
  alerts,
};
```

**Template:**
```typescript
import type { IIdentityProvider, AuthContext, DeveloperIdentity } from '@open-hive/shared';

export class MyOAuthProvider implements IIdentityProvider {
  readonly name = 'my-oauth';
  readonly requiresAuth = true;

  async authenticate(ctx: AuthContext): Promise<DeveloperIdentity | null> {
    const authHeader = ctx.headers['authorization'];
    const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (!headerValue?.startsWith('Bearer ')) return null;

    const token = headerValue.slice(7);
    // Validate token, return DeveloperIdentity or null
    return {
      email: 'user@example.com',
      display_name: 'User',
      org: 'my-org',
      teams: ['team-a'],
    };
  }
}
```

**Complexity:** Medium -- requires token handling, route additions, identity mapping

**Important:** Auth skills MUST maintain backward compatibility. When `AUTH_ENABLED` is `false` (default), the `PassthroughIdentityProvider` remains active. Existing deployments without auth continue to work.

---

### 3. ISemanticAnalyzer (Collision tier skills)

Compare developer intents for semantic overlap.

**Import:**
```typescript
import type { ISemanticAnalyzer, SemanticMatch } from '@open-hive/shared';
```

**Interface:**
```typescript
export interface ISemanticAnalyzer {
  readonly name: string;
  readonly tier: 'L3a' | 'L3b' | 'L3c';
  compare(a: string, b: string): Promise<SemanticMatch | null>;
}
```

**SemanticMatch shape:**
```typescript
export interface SemanticMatch {
  score: number;                   // 0.0 to 1.0
  tier: 'L3a' | 'L3b' | 'L3c';
  explanation: string;
}
```

**Registration:**
```typescript
import { MyAnalyzer } from './services/my-analyzer.js';
import { KeywordAnalyzer } from './services/keyword-analyzer.js';

const analyzers: ISemanticAnalyzer[] = [
  new KeywordAnalyzer(),       // L3a — always first, free
  ...(config.myAnalyzerEnabled
    ? [new MyAnalyzer({ tier: 'L3b', apiKey: '...' })]
    : []),
];

const registry: PortRegistry = {
  store,
  identity,
  analyzers,
  alerts,
};
```

**Template:**
```typescript
import type { ISemanticAnalyzer, SemanticMatch } from '@open-hive/shared';

export class MyAnalyzer implements ISemanticAnalyzer {
  readonly name = 'my-analyzer';
  readonly tier = 'L3b' as const;

  constructor(private apiKey: string, private threshold = 0.75) {}

  async compare(a: string, b: string): Promise<SemanticMatch | null> {
    // Your comparison logic
    const score = await this.computeSimilarity(a, b);
    if (score < this.threshold) return null;

    return {
      score,
      tier: 'L3b',
      explanation: `Similarity: ${(score * 100).toFixed(0)}%`,
    };
  }
}
```

**Tier ordering:** L3a (keyword, always included) -> L3b (embeddings) -> L3c (LLM). Multiple analyzers run in order; first match per session pair wins.

**Complexity:** Medium -- requires understanding the collision scoring model

---

### 4. IHiveStore (Storage skills)

Replace the default SQLite store with a different database backend.

**Import:**
```typescript
import type { IHiveStore } from '@open-hive/shared';
```

**Interface:**
```typescript
export interface IHiveStore {
  createSession(...): Promise<Session>;
  getSession(session_id: string): Promise<Session | null>;
  getActiveSessions(repo?: string): Promise<Session[]>;
  updateSessionActivity(...): Promise<void>;
  endSession(session_id: string): Promise<void>;
  cleanupStaleSessions(idle_timeout_seconds: number): Promise<string[]>;
  createSignal(...): Promise<Signal>;
  getRecentSignals(...): Promise<Signal[]>;
  getRecentIntents(...): Promise<HistoricalIntent[]>;
  createCollision(...): Promise<Collision>;
  getActiveCollisions(session_id?: string): Promise<Collision[]>;
  resolveCollision(collision_id: string, resolved_by: string): Promise<void>;
}
```

**Registration:**
```typescript
import type { IHiveStore } from '@open-hive/shared';

const store: IHiveStore = config.database.type === 'my-db'
  ? new MyStore(config.database.url)
  : createSQLiteStore(config.database.url);

const registry: PortRegistry = {
  store,
  identity,
  analyzers,
  alerts,
};
```

**Complexity:** High -- 12 methods to implement, must pass all existing tests

**Important:** Import `IHiveStore` from `@open-hive/shared`, not from `../db/store.js`. The shared package is the canonical source for all port interfaces.

---

## Skill Template

Every skill SKILL.md must follow this structure:

````markdown
---
name: add-<integration-name>
description: <One-line description>
category: notification | auth | store | collision-tier
port: IAlertSink | IIdentityProvider | ISemanticAnalyzer | IHiveStore
requires:
  - <npm packages to install>
modifies:
  - <files this skill creates or changes>
tests:
  - <test files this skill creates>
---

# add-<integration-name>

<2-3 sentence description.>

## Prerequisites

<What the user needs.>

## What This Skill Does

<Bullet list of files and why.>

## Implementation Steps

### Step 1: Install dependencies

```bash
cd packages/backend && npm install <package-name>
```

### Step 2: Create the <component>

```typescript
import type { <Port> } from '@open-hive/shared';

export class My<Component> implements <Port> {
  // ...
}
```

### Step 3: Register in PortRegistry

```typescript
// In server.ts, after PortRegistry creation:
registry.<port>.register(new My<Component>(...));
```

## Tests

```typescript
// Tests using node:test and node:assert/strict
```

## Verify

```bash
npm run build && npm test
```

## Configuration

```bash
# .env.example entries
```
````

## Conventions

1. **Skill files live in `skills/<skill-name>/SKILL.md`**. Directory name: `add-<integration>`.

2. **All code goes inside the SKILL.md as fenced code blocks**. Self-contained.

3. **Tests are mandatory**. Use `node:test` and `node:assert/strict`.

4. **Env vars go in `.env.example` with comments**.

5. **Backward compatibility**. New features must be opt-in. Default code path unchanged.

6. **Port types from `@open-hive/shared`**. Always import port interfaces from `@open-hive/shared`, never from backend-internal modules.

7. **Registration via PortRegistry**. All adapters are wired through the `PortRegistry` in `server.ts`.

8. **Use `nanoid` for ID generation** (already a project dependency).

9. **Fire-and-forget for alert sinks**. `deliver()` must not throw or block.

10. **TypeScript strict mode**. No `any`, no `@ts-ignore`.

## Process

### Step 1: Understand the integration
Ask what integration the user wants. Clarify the external service, trigger, and credentials.

### Step 2: Identify the port
Map to one of the four ports using the decision tree above.

### Step 3: Design the integration
Plan files: new adapter, modified server.ts, tests, env vars.

### Step 4: Write the SKILL.md
Complete skill file with all code, tests, configuration.

### Step 5: Validate
Build and test: `npm run build && npm test`.

# build-skill

You are building a new Open Hive integration skill. This meta-skill teaches you how to create skills that extend Open Hive's backend with new capabilities using the port-based architecture.

## Overview

Open Hive skills are self-contained SKILL.md files that teach Claude how to add an integration to a user's Open Hive installation. Each skill targets one of five **port interfaces** defined in `@open-hive/shared`. The skill file contains all the code, tests, configuration, and instructions needed to wire the integration end-to-end.

Your job is to:
1. Identify which port the user's desired integration targets
2. Write a complete SKILL.md with all code inline as fenced blocks
3. Ensure tests exist and the build passes

## Architecture: The Five Ports

Open Hive uses a hexagonal (ports & adapters) architecture. All extension points are defined as TypeScript interfaces in `packages/shared/src/ports.ts`. At startup, the backend creates a `PortRegistry` that wires all adapters together.

```
PortRegistry {
  store:      IHiveStore          — where data lives (sessions, signals, collisions, mail)
  identity:   IIdentityProvider   — who is making requests
  analyzers:  ISemanticAnalyzer[] — how intents are compared
  alerts:     AlertDispatcher     — where alerts go (holds IAlertSink[])
  decay:      DecayService        — signal/mail weight decay over time (core service, not a port)
  nerves:     INerveRegistry      — connected nerve registration and discovery
}
```

### Decision Tree: Which Port Do I Implement?

```
Is your skill about...
  ...where to send collision alerts?        --> implement IAlertSink
  ...how to authenticate developers?        --> implement IIdentityProvider
  ...how to compare developer intents?      --> implement ISemanticAnalyzer
  ...where to store data?                   --> implement IHiveStore + INerveRegistry
  ...managing nerve connections?             --> implement INerveRegistry
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
  store, identity, analyzers, alerts, decay, nerves,
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
  store, identity, analyzers, alerts, decay, nerves,
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

Replace the default SQLite store with a different database backend. Storage skills must implement both `IHiveStore` (16 methods) and `INerveRegistry` (5 methods), since the store manages all persistence.

**Import:**
```typescript
import type { IHiveStore, INerveRegistry } from '@open-hive/shared';
```

**Interface (IHiveStore — 16 methods):**
```typescript
export interface IHiveStore {
  // Sessions (6)
  createSession(...): Promise<Session>;
  getSession(session_id: string): Promise<Session | null>;
  getActiveSessions(repo?: string): Promise<Session[]>;
  updateSessionActivity(...): Promise<void>;
  endSession(session_id: string): Promise<void>;
  cleanupStaleSessions(idle_timeout_seconds: number): Promise<string[]>;
  // Signals (3)
  createSignal(...): Promise<Signal>;
  getRecentSignals(...): Promise<Signal[]>;
  getRecentIntents(...): Promise<HistoricalIntent[]>;
  // Collisions (3)
  createCollision(...): Promise<Collision>;
  getActiveCollisions(session_id?: string): Promise<Collision[]>;
  resolveCollision(collision_id: string, resolved_by: string): Promise<void>;
  // Agent Mail (4)
  createMail(m: Omit<AgentMail, 'mail_id' | 'read_at' | 'weight'>): Promise<AgentMail>;
  getUnreadMail(sessionIdOrOpts: string | { session_id?: string; developer_email?: string }): Promise<AgentMail[]>;
  getMailByContext(context_id: string): Promise<AgentMail[]>;
  markMailRead(mail_id: string): Promise<void>;
}
```

**Interface (INerveRegistry — 5 methods):**
```typescript
export interface INerveRegistry {
  readonly name: string;
  registerNerve(card: AgentCard, nerve_type: string): Promise<Nerve>;
  getNerve(agent_id: string): Promise<Nerve | null>;
  getActiveNerves(nerve_type?: string): Promise<Nerve[]>;
  updateLastSeen(agent_id: string): Promise<void>;
  deregisterNerve(agent_id: string): Promise<void>;
}
```

**Key models (from `@open-hive/shared`):**
```typescript
// Agent Mail — persistent inter-agent messages surviving session boundaries
interface AgentMail {
  mail_id: string;
  from_session_id: string | null;
  to_session_id: string | null;
  to_context_id: string | null;    // addressed to a workstream
  type: AgentMailType;
  subject: string;
  content: string;
  created_at: string;
  read_at: string | null;
  weight: number;                  // decays like signals
}

// Nerve — a registered agent connection
interface Nerve {
  nerve_id: string;
  agent_card: AgentCard;
  nerve_type: string;              // e.g., 'claude-code', 'jira', 'teams'
  created_at: string;
}

// Agent Card — nerve self-description
interface AgentCard {
  agent_id: string;
  name: string;
  description: string;
  version: string;
  human_client: { email: string; display_name: string; org?: string; teams?: string[] };
  capabilities: { sensory: SignalType[]; motor: DirectiveType[] };
  endpoint_url?: string;
  registered_at: string;
  last_seen: string;
  status: 'active' | 'idle' | 'disconnected';
}
```

**Registration:**
```typescript
import type { IHiveStore, INerveRegistry } from '@open-hive/shared';

const store: IHiveStore & INerveRegistry = config.database.type === 'my-db'
  ? new MyStore(config.database.url)
  : createSQLiteStore(config.database.url);

const registry: PortRegistry = {
  store,
  identity,
  analyzers,
  alerts,
  decay,
  nerves: store,  // same object implements both
};
```

**Important notes:**
- The `agent_mail` table has a `to_developer_email` column for cross-session mail delivery. When creating mail addressed to a session, resolve the developer's email and store it too.
- The `getUnreadMail` method accepts either a session_id string OR an options object with `session_id` and/or `developer_email` for OR-based lookup. This is how mail survives session ID changes.
- The `nerves` table stores `agent_card` as JSON. Use `JSONB` in PostgreSQL, `TEXT` with `JSON.stringify` in SQLite.

**Complexity:** High -- 21 methods to implement, 6 tables, must pass all existing tests

**Important:** Import `IHiveStore` and `INerveRegistry` from `@open-hive/shared`, not from `../db/store.js`. The shared package is the canonical source for all port interfaces.

---

### 5. INerveRegistry (Nerve management skills)

Manage connected nerve registrations. This port is typically implemented alongside `IHiveStore` (same class handles both), but can be implemented independently for custom nerve discovery mechanisms.

**Import:**
```typescript
import type { INerveRegistry, AgentCard, Nerve } from '@open-hive/shared';
```

**API Endpoints** (already wired in `packages/backend/src/routes/nerves.ts`):
- `POST /api/nerves/register` — register a nerve with its agent card
- `GET /api/nerves/active?type=<nerve_type>` — list active nerves
- `POST /api/nerves/heartbeat` — update last_seen timestamp
- `POST /api/nerves/deregister` — deregister a nerve

**Complexity:** Low if extending an existing `IHiveStore` implementation, Medium if standalone

---

## Skill Template

Every skill SKILL.md must follow this structure:

````markdown
---
name: add-<integration-name>
description: <One-line description>
category: notification | auth | store | collision-tier | nerve
port: IAlertSink | IIdentityProvider | ISemanticAnalyzer | IHiveStore | INerveRegistry
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

11. **Idempotent operations**. Skills that implement `INerveRegistry.registerNerve()` should upsert (update if agent_id exists) to handle crash recovery — a nerve that crashes and restarts will re-register with the same agent_id.

12. **Mail addressing includes developer_email**. When implementing `createMail()` for `IHiveStore`, always resolve `to_developer_email` from `to_session_id`. This ensures mail survives session ID changes (crashes, restarts).

## Process

### Step 1: Understand the integration
Ask what integration the user wants. Clarify the external service, trigger, and credentials.

### Step 2: Identify the port
Map to one of the five ports using the decision tree above.

### Step 3: Design the integration
Plan files: new adapter, modified server.ts, tests, env vars.

### Step 4: Write the SKILL.md
Complete skill file with all code, tests, configuration.

### Step 5: Validate
Build and test: `npm run build && npm test`.

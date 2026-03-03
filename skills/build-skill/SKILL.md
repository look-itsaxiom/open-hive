# build-skill

You are building a new Open Hive integration skill. This meta-skill teaches you how to create skills that extend Open Hive's backend with new capabilities.

## Overview

Open Hive skills are self-contained SKILL.md files that teach Claude how to add an integration to a user's Open Hive installation. Each skill targets one of four extension points in the backend. The skill file contains all the code, tests, configuration, and instructions needed to wire the integration end-to-end.

Your job is to:
1. Identify which extension point the user's desired integration targets
2. Write a complete SKILL.md with all code inline as fenced blocks
3. Ensure tests exist and the build passes

## Skill Categories

There are four categories of skills, each targeting a different backend extension point:

### 1. Notification (`notification`)
Send collision alerts to external services (Slack, Discord, PagerDuty, email, etc.).
- **Extension point**: `NotificationDispatcher.registerFormatter()`
- **Complexity**: Low -- implement a single interface, register it in server.ts
- **Examples**: Slack webhooks, Discord webhooks, PagerDuty Events API, email via SendGrid

### 2. Auth (`auth`)
Replace the default pass-through authentication with real identity verification.
- **Extension point**: Replace middleware in `packages/backend/src/middleware/auth.ts`
- **Complexity**: Medium -- requires token handling, route additions, identity mapping
- **Examples**: GitHub OAuth, Google OAuth, API key auth, JWT bearer tokens

### 3. Store (`store`)
Replace the default SQLite store with a different database backend.
- **Extension point**: Implement `IHiveStore` interface, update `createStore` factory
- **Complexity**: High -- 11 methods to implement, must pass all existing tests
- **Examples**: PostgreSQL, MySQL, DynamoDB, Turso/libSQL

### 4. Collision Tier (`collision-tier`)
Add new semantic analysis to the collision detection pipeline.
- **Extension point**: Add analysis method in `CollisionEngine`, wire into `checkIntentCollision`
- **Complexity**: Medium -- requires understanding the collision scoring model
- **Examples**: LLM-based semantic comparison, embedding similarity, AST analysis

## Skill Template

Every skill SKILL.md must follow this structure:

````markdown
---
name: add-<integration-name>
description: <One-line description of what this skill adds>
category: notification | auth | store | collision-tier
requires:
  - <npm packages to install, if any>
modifies:
  - <files this skill creates or changes>
tests:
  - <test files this skill creates>
---

# add-<integration-name>

<2-3 sentence description of what this skill does and why you'd want it.>

## Prerequisites

<What the user needs before running this skill: API keys, accounts, etc.>

## What This Skill Does

<Bullet list of exactly what files are created/modified and why.>

## Implementation Steps

### Step 1: Install dependencies

```bash
cd packages/backend && npm install <package-name>
```

### Step 2: Create the <component>

Create `packages/backend/src/<path>/<file>.ts`:

```typescript
// Complete implementation here
```

### Step 3: Register in server.ts

Add to `packages/backend/src/server.ts`:

```typescript
// Registration code
```

### Step N: ...

## Tests

Create `packages/backend/src/<test-file>.test.ts`:

```typescript
// Complete test file
```

## Verify

```bash
npm run build && npm test
```

Confirm:
- [ ] Build succeeds with no type errors
- [ ] All existing tests still pass
- [ ] New tests pass
- [ ] Integration works end-to-end (describe manual test)

## Configuration

Add to `.env.example`:

```bash
# <Integration Name>
# <Description of each variable>
VARIABLE_NAME=
```
````

## Extension Point Catalog

### Notification Formatters

**Interface to implement** (from `packages/backend/src/services/notification-dispatcher.ts`):

```typescript
export interface NotificationFormatter {
  name: string;
  format(payload: WebhookPayload): {
    url: string;
    body: unknown;
    headers?: Record<string, string>;
  };
  shouldFire(payload: WebhookPayload): boolean;
}
```

**WebhookPayload shape**:

```typescript
export interface WebhookPayload {
  type: 'collision_detected' | 'collision_resolved';
  severity: CollisionSeverity;              // 'info' | 'warning' | 'critical'
  collision: Collision;                      // full collision object
  sessions: Pick<Session,
    'developer_name' | 'developer_email' | 'repo' | 'intent'
  >[];
  timestamp: string;                        // ISO 8601
}
```

**Where to create files**:
- Formatter: `packages/backend/src/notifications/<name>-formatter.ts`
- Tests: `packages/backend/src/notifications/<name>-formatter.test.ts`

**Where to register** -- add to `packages/backend/src/server.ts` after the dispatcher is created:

```typescript
import { MyFormatter } from './notifications/my-formatter.js';

// After: const dispatcher = new NotificationDispatcher(config.webhooks.urls);
if (process.env.MY_WEBHOOK_URL) {
  dispatcher.registerFormatter(new MyFormatter(process.env.MY_WEBHOOK_URL));
}
```

**Env vars to add**:
- The webhook URL (e.g., `SLACK_WEBHOOK_URL`, `DISCORD_WEBHOOK_URL`)
- Any API keys or routing keys the service needs
- Optional: severity filter override (the formatter's `shouldFire` can read from env)

**What tests to write**:
1. `format()` returns correct URL, body shape, and headers for a collision_detected payload
2. `format()` returns correct body for a collision_resolved payload
3. `shouldFire()` returns true for target severities and false for others
4. Body includes relevant collision details (file path, developer names, repo)
5. Edge case: sessions array is empty

**Example formatter skeleton**:

```typescript
import type { NotificationFormatter, WebhookPayload } from '../services/notification-dispatcher.js';

export class ExampleFormatter implements NotificationFormatter {
  name = 'example';

  constructor(private webhookUrl: string) {}

  shouldFire(payload: WebhookPayload): boolean {
    // Fire for warnings and critical only
    return payload.severity !== 'info';
  }

  format(payload: WebhookPayload): { url: string; body: unknown; headers?: Record<string, string> } {
    const devNames = payload.sessions.map(s => s.developer_name).join(', ');
    return {
      url: this.webhookUrl,
      body: {
        text: `[${payload.severity.toUpperCase()}] ${payload.type}: ${payload.collision.details} (${devNames})`,
      },
    };
  }
}
```

---

### Auth Adapters

**Interface to implement** (from `packages/backend/src/middleware/auth.ts`):

```typescript
export interface DeveloperIdentity {
  email: string;
  display_name: string;
  org?: string;
}

// Replace these two functions:
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void>;

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void>;
```

The `authenticate` function runs as a Fastify `preHandler` on every request. It should:
1. Extract a token/credential from the request (header, cookie, query param)
2. Validate it against the auth provider
3. Set `request.developer` to a `DeveloperIdentity` if valid
4. Return silently if no token is present (unauthenticated requests are allowed through for endpoints that don't require auth)

The `requireAuth` function rejects requests where `request.developer` is not set:

```typescript
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.developer) {
    reply.status(401).send({ ok: false, error: 'Authentication required' });
  }
}
```

**Where to create files**:
- Auth middleware: Replace `packages/backend/src/middleware/auth.ts`
- OAuth callback route (if needed): `packages/backend/src/routes/auth.ts`
- Token utilities: `packages/backend/src/middleware/tokens.ts`
- Tests: `packages/backend/src/middleware/auth.test.ts`

**Where to wire in** -- if adding OAuth routes, register them in `packages/backend/src/server.ts`:

```typescript
import { authRoutes } from './routes/auth.js';

// After app.addHook('preHandler', authenticate);
authRoutes(app);
```

**Env vars to add**:
- `AUTH_PROVIDER` -- which auth provider to use (e.g., `github`, `google`, `apikey`)
- Provider-specific: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `JWT_SECRET`, etc.
- `AUTH_REQUIRED` -- set to `true` to enforce auth on all endpoints (default: false for backward compat)

**What tests to write**:
1. Unauthenticated request passes through `authenticate` without error (backward compat)
2. Valid token sets `request.developer` correctly
3. Invalid/expired token does NOT set `request.developer`
4. `requireAuth` returns 401 when `request.developer` is not set
5. `requireAuth` passes when `request.developer` is set

**Important**: Auth skills MUST maintain backward compatibility. When `AUTH_PROVIDER` is unset, the middleware must behave identically to the default pass-through. This means existing deployments without auth continue to work.

---

### Store Adapters

**Interface to implement** (from `packages/backend/src/db/store.ts`):

```typescript
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
  createCollision(c: Omit<Collision, 'collision_id' | 'resolved' | 'resolved_by'>): Promise<Collision>;
  getActiveCollisions(session_id?: string): Promise<Collision[]>;
  resolveCollision(collision_id: string, resolved_by: string): Promise<void>;
}
```

**Where to create files**:
- Store implementation: `packages/backend/src/db/<adapter-name>.ts`
- Tests: `packages/backend/src/db/<adapter-name>.test.ts`

**Where to wire in** -- update the factory in `packages/backend/src/db/index.ts`:

```typescript
import { MyStore } from './<adapter-name>.js';

export function createStore(config: HiveBackendConfig): IHiveStore {
  if (config.database.type === '<adapter-name>') {
    return new MyStore(config.database.url);
  }
  if (config.database.type === 'sqlite') {
    const db = createSQLiteDB(config.database.url);
    return new HiveStore(db);
  }
  throw new Error(`Unsupported database type: ${config.database.type}`);
}
```

Also update the `HiveBackendConfig` type in `packages/shared/src/config.ts` to include the new database type:

```typescript
database: {
  type: 'sqlite' | 'postgres' | '<new-type>';
  url: string;
};
```

And update the `loadConfig` parser in `packages/backend/src/env.ts`:

```typescript
database: {
  type: (process.env.DB_TYPE as 'sqlite' | 'postgres' | '<new-type>') ?? 'sqlite',
  url: process.env.DATABASE_URL ?? './data/hive.db',
},
```

**Env vars to add**:
- `DB_TYPE` -- set to the adapter name (e.g., `postgres`)
- `DATABASE_URL` -- connection string for the database

**What tests to write**:
Store skills are unique because ALL existing tests in `collision-engine.test.ts` exercise the store through the `HiveStore` (SQLite) implementation. Your new store must pass an equivalent test suite. The easiest approach:

1. Copy the store-related `describe` blocks from `collision-engine.test.ts` (the "HiveStore -- sessions", "HiveStore -- signals", "HiveStore -- collisions" sections)
2. Replace the `createTestDB()` + `new HiveStore(db)` setup with your adapter's constructor
3. Add adapter-specific tests (connection handling, reconnection, etc.)

**Important**: The `files_touched` and `areas` fields are stored as JSON arrays. Your adapter must serialize/deserialize them correctly. The `updateSessionActivity` method must MERGE arrays, not replace them (see the SQLite implementation for the merge logic with `Set` deduplication and `MAX_TRACKED_ENTRIES` slicing).

---

### Collision Tiers

**Where to add code** -- in `packages/backend/src/services/collision-engine.ts`:

The collision engine has a layered detection model:
- **L1**: Exact file match (severity: `critical`)
- **L2**: Same directory (severity: `warning`)
- **L3a**: Keyword overlap in intent (severity: `info`) -- currently implemented
- **L3b**: Embedding similarity (severity: `info`) -- extension point
- **L4**: LLM-based semantic analysis (severity: `info`) -- extension point

To add a new tier:

1. Add a new method to `CollisionEngine`:

```typescript
async checkEmbeddingCollision(session_id: string, intent: string, repo: string): Promise<Collision[]> {
  if (!this.config.collision.semantic.embeddings_enabled) return [];
  // Your embedding comparison logic
}
```

2. Wire it into the `checkIntentCollision` method or create a new top-level check method. If extending `checkIntentCollision`, call your method after the keyword check:

```typescript
async checkIntentCollision(session_id: string, intent: string, repo: string): Promise<Collision[]> {
  // Existing keyword check...
  const keywordCollisions = [...]; // existing code

  // New: embedding check
  const embeddingCollisions = await this.checkEmbeddingCollision(session_id, intent, repo);

  return [...keywordCollisions, ...embeddingCollisions];
}
```

3. If the tier needs external services, add config fields to `HiveBackendConfig` in `packages/shared/src/config.ts` and parse them in `packages/backend/src/env.ts`. The existing config already has placeholder fields:

```typescript
semantic: {
  keywords_enabled: boolean;
  embeddings_enabled: boolean;       // <-- already exists
  embeddings_provider?: string;      // <-- already exists
  embeddings_api_key?: string;       // <-- already exists
  llm_enabled: boolean;             // <-- already exists
  llm_provider?: string;            // <-- already exists
  llm_api_key?: string;             // <-- already exists
}
```

**Where to create files**:
- Analysis logic: `packages/backend/src/services/<tier-name>-analyzer.ts`
- Tests: `packages/backend/src/services/<tier-name>-analyzer.test.ts`

**Env vars to add**:
- Enable flag: `SEMANTIC_EMBEDDINGS=true` or `SEMANTIC_LLM=true`
- Provider: `EMBEDDINGS_PROVIDER=openai` or `LLM_PROVIDER=anthropic`
- API key: `EMBEDDINGS_API_KEY=sk-...` or `LLM_API_KEY=sk-ant-...`

**What tests to write**:
1. Tier is skipped when its enable flag is false
2. Tier detects overlap for semantically similar intents
3. Tier returns empty for unrelated intents
4. Tier handles API errors gracefully (no throw, returns empty)
5. Collisions have correct type (`semantic`) and severity (`info`)

## Conventions

Follow these rules when writing a skill:

1. **Skill files live in `skills/<skill-name>/SKILL.md`**. The directory name should be `add-<integration>` (e.g., `add-slack`, `add-postgres`, `add-github-oauth`).

2. **All code goes inside the SKILL.md as fenced code blocks**. Do not reference external files. The skill must be completely self-contained -- someone reading only the SKILL.md has everything they need.

3. **Tests are mandatory**. Every skill must include at least one test file. Use `node:test` and `node:assert/strict` (the project's existing test framework). Do not introduce Jest, Vitest, or other test runners.

4. **Env vars go in `.env.example` with comments**. Every environment variable the skill introduces must be documented with a comment explaining what it does and what values are valid.

5. **Backward compatibility**. New features must be opt-in via environment variables. An Open Hive instance with no env changes must behave identically after applying a skill. The default code path must remain the same.

6. **Skills must include a Verify step**. The final verification is always `npm run build && npm test`. Additionally, describe a manual smoke test the user can perform.

7. **Import from `@open-hive/shared`** for shared types (`Session`, `Signal`, `Collision`, `CollisionSeverity`, etc.). Import from relative paths for backend-internal modules.

8. **Use `nanoid` for ID generation** (already a project dependency). Do not introduce `uuid` or other ID libraries.

9. **Fire-and-forget pattern for notifications**. Notification formatters must never throw or block the request pipeline. The dispatcher handles this, but your formatter's `format()` must not throw either.

10. **TypeScript strict mode**. All code must compile under the project's tsconfig (strict: true). No `any` types, no `@ts-ignore`.

## Process

Follow these steps when the user asks you to create a new skill:

### Step 1: Understand the integration
Ask the user what integration they want to add. Clarify:
- What external service or capability?
- What should trigger it? (collisions, auth, data storage)
- Do they have API credentials or documentation?

### Step 2: Identify the extension point category
Map the integration to one of the four categories:
- Sending alerts/notifications to external services --> `notification`
- Adding user authentication/authorization --> `auth`
- Using a different database backend --> `store`
- Adding smarter collision/overlap detection --> `collision-tier`

### Step 3: Design the integration
Plan which files will be created and modified. List them out:
- New files (formatter, adapter, analyzer, route)
- Modified files (server.ts, db/index.ts, env.ts, config.ts)
- New test files
- New env vars

### Step 4: Write the SKILL.md
Write the complete skill file following the template. Include:
- Frontmatter with metadata
- Every code block with complete, working implementations
- Every test with complete, runnable test cases
- Env var documentation
- Verify checklist

### Step 5: Validate
Run the skill yourself:
1. Create all files listed in the skill
2. Run `npm run build` -- must succeed
3. Run `npm test` -- must pass
4. Verify the integration works (or describe how to verify manually)

## Example: PagerDuty Notification Skill

Below is a complete example of a notification skill to illustrate the pattern. Use this as a reference when writing new skills.

````markdown
---
name: add-pagerduty
description: Send critical collision alerts to PagerDuty as incidents
category: notification
requires:
  - (none -- uses PagerDuty Events API v2 via fetch)
modifies:
  - packages/backend/src/notifications/pagerduty-formatter.ts (new)
  - packages/backend/src/notifications/pagerduty-formatter.test.ts (new)
  - packages/backend/src/server.ts (register formatter)
tests:
  - packages/backend/src/notifications/pagerduty-formatter.test.ts
---

# add-pagerduty

Sends PagerDuty incidents when critical collisions are detected between developer sessions. Only fires for `critical` severity by default, so your on-call team is alerted when two developers are editing the exact same file simultaneously.

## Prerequisites

- A PagerDuty account with an Events API v2 integration
- A routing key (integration key) from your PagerDuty service

## What This Skill Does

- Creates `packages/backend/src/notifications/pagerduty-formatter.ts` -- a `NotificationFormatter` that formats collision payloads into PagerDuty Events API v2 requests
- Creates `packages/backend/src/notifications/pagerduty-formatter.test.ts` -- tests for the formatter
- Modifies `packages/backend/src/server.ts` -- registers the formatter when `PAGERDUTY_ROUTING_KEY` is set

## Implementation Steps

### Step 1: Create the formatter

Create `packages/backend/src/notifications/pagerduty-formatter.ts`:

```typescript
import type {
  NotificationFormatter,
  WebhookPayload,
} from '../services/notification-dispatcher.js';

const PAGERDUTY_EVENTS_URL = 'https://events.pagerduty.com/v2/enqueue';

export class PagerDutyFormatter implements NotificationFormatter {
  name = 'pagerduty';

  constructor(
    private routingKey: string,
    private minSeverity: 'info' | 'warning' | 'critical' = 'critical',
  ) {}

  shouldFire(payload: WebhookPayload): boolean {
    if (payload.type !== 'collision_detected') return false;
    const levels = ['info', 'warning', 'critical'] as const;
    return levels.indexOf(payload.severity) >= levels.indexOf(this.minSeverity);
  }

  format(payload: WebhookPayload): {
    url: string;
    body: unknown;
    headers?: Record<string, string>;
  } {
    const devNames = payload.sessions
      .map((s) => s.developer_name)
      .join(', ');
    const repo =
      payload.sessions[0]?.repo ?? 'unknown repo';

    const pdSeverity =
      payload.severity === 'critical'
        ? 'critical'
        : payload.severity === 'warning'
          ? 'warning'
          : 'info';

    return {
      url: PAGERDUTY_EVENTS_URL,
      body: {
        routing_key: this.routingKey,
        event_action: 'trigger',
        dedup_key: `open-hive-${payload.collision.collision_id}`,
        payload: {
          summary: `[Open Hive] ${payload.collision.details}`,
          source: `open-hive:${repo}`,
          severity: pdSeverity,
          component: 'collision-engine',
          group: repo,
          custom_details: {
            collision_id: payload.collision.collision_id,
            collision_type: payload.collision.type,
            developers: devNames,
            details: payload.collision.details,
            detected_at: payload.collision.detected_at,
          },
        },
      },
    };
  }
}
```

### Step 2: Register in server.ts

Add to `packages/backend/src/server.ts`, after the dispatcher is created:

```typescript
import { PagerDutyFormatter } from './notifications/pagerduty-formatter.js';

// After: const dispatcher = new NotificationDispatcher(config.webhooks.urls);
if (process.env.PAGERDUTY_ROUTING_KEY) {
  dispatcher.registerFormatter(
    new PagerDutyFormatter(
      process.env.PAGERDUTY_ROUTING_KEY,
      (process.env.PAGERDUTY_MIN_SEVERITY as 'info' | 'warning' | 'critical') ?? 'critical',
    ),
  );
}
```

## Tests

Create `packages/backend/src/notifications/pagerduty-formatter.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PagerDutyFormatter } from './pagerduty-formatter.js';
import type { WebhookPayload } from '../services/notification-dispatcher.js';
import type { Collision } from '@open-hive/shared';

function createPayload(
  overrides?: Partial<WebhookPayload>,
): WebhookPayload {
  return {
    type: 'collision_detected',
    severity: 'critical',
    collision: {
      collision_id: 'col-1',
      session_ids: ['sess-a', 'sess-b'],
      type: 'file',
      severity: 'critical',
      details: 'Both sessions modifying src/auth.ts in my-repo',
      detected_at: '2026-01-15T10:00:00Z',
      resolved: false,
      resolved_by: null,
    },
    sessions: [
      { developer_name: 'Alice', developer_email: 'alice@test.com', repo: 'my-repo', intent: 'fix auth' },
      { developer_name: 'Bob', developer_email: 'bob@test.com', repo: 'my-repo', intent: 'update auth' },
    ],
    timestamp: '2026-01-15T10:00:00Z',
    ...overrides,
  };
}

describe('PagerDutyFormatter', () => {
  it('formats a collision_detected payload as a PagerDuty event', () => {
    const formatter = new PagerDutyFormatter('test-routing-key');
    const result = formatter.format(createPayload());

    assert.equal(result.url, 'https://events.pagerduty.com/v2/enqueue');

    const body = result.body as Record<string, unknown>;
    assert.equal(body.routing_key, 'test-routing-key');
    assert.equal(body.event_action, 'trigger');
    assert.equal(body.dedup_key, 'open-hive-col-1');

    const pd = body.payload as Record<string, unknown>;
    assert.ok((pd.summary as string).includes('src/auth.ts'));
    assert.equal(pd.severity, 'critical');
    assert.equal(pd.source, 'open-hive:my-repo');

    const details = pd.custom_details as Record<string, unknown>;
    assert.equal(details.collision_id, 'col-1');
    assert.ok((details.developers as string).includes('Alice'));
    assert.ok((details.developers as string).includes('Bob'));
  });

  it('shouldFire returns true for critical when minSeverity is critical', () => {
    const formatter = new PagerDutyFormatter('key', 'critical');
    assert.equal(formatter.shouldFire(createPayload({ severity: 'critical' })), true);
  });

  it('shouldFire returns false for warning when minSeverity is critical', () => {
    const formatter = new PagerDutyFormatter('key', 'critical');
    assert.equal(formatter.shouldFire(createPayload({ severity: 'warning' })), false);
  });

  it('shouldFire returns false for info when minSeverity is critical', () => {
    const formatter = new PagerDutyFormatter('key', 'critical');
    assert.equal(formatter.shouldFire(createPayload({ severity: 'info' })), false);
  });

  it('shouldFire returns true for warning and critical when minSeverity is warning', () => {
    const formatter = new PagerDutyFormatter('key', 'warning');
    assert.equal(formatter.shouldFire(createPayload({ severity: 'critical' })), true);
    assert.equal(formatter.shouldFire(createPayload({ severity: 'warning' })), true);
    assert.equal(formatter.shouldFire(createPayload({ severity: 'info' })), false);
  });

  it('shouldFire returns false for collision_resolved events', () => {
    const formatter = new PagerDutyFormatter('key', 'critical');
    assert.equal(
      formatter.shouldFire(createPayload({ type: 'collision_resolved' })),
      false,
    );
  });

  it('handles empty sessions array', () => {
    const formatter = new PagerDutyFormatter('key');
    const payload = createPayload({ sessions: [] });
    const result = formatter.format(payload);

    const body = result.body as Record<string, unknown>;
    const pd = body.payload as Record<string, unknown>;
    assert.equal(pd.source, 'open-hive:unknown repo');

    const details = pd.custom_details as Record<string, unknown>;
    assert.equal(details.developers, '');
  });

  it('uses dedup_key based on collision_id for PagerDuty deduplication', () => {
    const formatter = new PagerDutyFormatter('key');
    const result = formatter.format(createPayload());

    const body = result.body as Record<string, unknown>;
    assert.equal(body.dedup_key, 'open-hive-col-1');
  });
});
```

## Verify

```bash
npm run build && npm test
```

Confirm:
- [ ] Build succeeds with no type errors
- [ ] All existing tests still pass
- [ ] PagerDuty formatter tests pass
- [ ] With `PAGERDUTY_ROUTING_KEY` unset, server starts normally (backward compat)
- [ ] With `PAGERDUTY_ROUTING_KEY` set, trigger a file collision and verify a PagerDuty incident is created

## Configuration

Add to `.env.example`:

```bash
# PagerDuty — send collision alerts as PagerDuty incidents
# Get a routing key from: PagerDuty > Services > your-service > Integrations > Events API v2
PAGERDUTY_ROUTING_KEY=

# Minimum severity to trigger PagerDuty (critical | warning | info). Default: critical
PAGERDUTY_MIN_SEVERITY=critical
```
````

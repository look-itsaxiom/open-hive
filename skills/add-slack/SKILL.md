---
name: add-slack
description: Add Slack webhook notifications for collision alerts
category: notification
requires: []
modifies:
  - packages/backend/src/notifications/slack-formatter.ts
  - packages/backend/src/env.ts
  - packages/backend/src/server.ts
  - .env.example
tests:
  - packages/backend/src/notifications/slack-formatter.test.ts
---

# Add Slack Webhook Notifications

This skill adds Slack Block Kit webhook notifications to Open Hive. When the collision engine detects that two developers are working on overlapping code, a richly-formatted Slack message is posted to a channel of your choice.

## Prerequisites

1. The Open Hive backend source is cloned and dependencies are installed (`npm install` from the repo root).
2. The project builds cleanly (`npm run build`).
3. You have a **Slack Incoming Webhook URL**. Create one at [https://api.slack.com/messaging/webhooks](https://api.slack.com/messaging/webhooks) and note the URL (it looks like `https://hooks.slack.com/services/YOUR/WEBHOOK/URL`).

## What This Skill Does

- Creates a `SlackFormatter` class that implements the `NotificationFormatter` interface.
- Transforms raw `WebhookPayload` objects into Slack Block Kit messages with color-coded severity, a header, a details section listing the colliding developers, and a timestamp footer.
- Provides per-formatter severity filtering via the `SLACK_MIN_SEVERITY` environment variable (independent of the dispatcher-level `WEBHOOK_MIN_SEVERITY`).
- Registers the formatter conditionally -- only when `SLACK_WEBHOOK_URL` is set.

---

## Step 1: Create the Slack Formatter

Create the file `packages/backend/src/notifications/slack-formatter.ts` with the following content:

```typescript
// packages/backend/src/notifications/slack-formatter.ts

import type {
  NotificationFormatter,
  WebhookPayload,
} from '../services/notification-dispatcher.js';
import type { CollisionSeverity } from '@open-hive/shared';

export interface SlackFormatterConfig {
  webhookUrl: string;
  minSeverity: CollisionSeverity;
}

const SEVERITY_COLORS: Record<CollisionSeverity, string> = {
  critical: '#E01E5A', // red
  warning:  '#ECB22E', // yellow
  info:     '#36C5F0', // blue
};

const SEVERITY_EMOJI: Record<CollisionSeverity, string> = {
  critical: ':red_circle:',
  warning:  ':warning:',
  info:     ':large_blue_circle:',
};

const SEVERITY_ORDER: CollisionSeverity[] = ['info', 'warning', 'critical'];

export class SlackFormatter implements NotificationFormatter {
  readonly name = 'slack';
  private config: SlackFormatterConfig;

  constructor(config: SlackFormatterConfig) {
    this.config = config;
  }

  shouldFire(payload: WebhookPayload): boolean {
    const payloadLevel = SEVERITY_ORDER.indexOf(payload.severity);
    const minLevel = SEVERITY_ORDER.indexOf(this.config.minSeverity);
    return payloadLevel >= minLevel;
  }

  format(payload: WebhookPayload): { url: string; body: unknown; headers?: Record<string, string> } {
    const color = SEVERITY_COLORS[payload.severity];
    const emoji = SEVERITY_EMOJI[payload.severity];
    const isResolved = payload.type === 'collision_resolved';

    const headerText = isResolved
      ? `${emoji} Collision Resolved — ${payload.collision.type} (${payload.severity})`
      : `${emoji} Collision Detected — ${payload.collision.type} (${payload.severity})`;

    const developerLines = payload.sessions
      .map(s => `*${s.developer_name}* (${s.developer_email}) — _${s.intent ?? 'no intent declared'}_`)
      .join('\n');

    const body = {
      attachments: [
        {
          color,
          blocks: [
            {
              type: 'header',
              text: {
                type: 'plain_text',
                text: headerText,
                emoji: true,
              },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Details:* ${payload.collision.details}`,
              },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Developers:*\n${developerLines}`,
              },
            },
            {
              type: 'section',
              fields: [
                {
                  type: 'mrkdwn',
                  text: `*Repo:* ${payload.sessions[0]?.repo ?? 'unknown'}`,
                },
                {
                  type: 'mrkdwn',
                  text: `*Type:* ${payload.collision.type}`,
                },
              ],
            },
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: `Collision ID: \`${payload.collision.collision_id}\` | ${payload.timestamp}`,
                },
              ],
            },
          ],
        },
      ],
    };

    return {
      url: this.config.webhookUrl,
      body,
    };
  }
}
```

### Key design decisions

- **Attachments wrapper**: Slack Block Kit messages need an `attachments` array to get color-coded sidebars. The `color` field on the attachment controls the sidebar color.
- **Header block**: Uses `plain_text` type (required by Slack's header block schema).
- **mrkdwn fields**: Slack uses `mrkdwn` (not `markdown`) for its markup syntax.
- **Severity filtering is self-contained**: The formatter checks its own `minSeverity` independently of the dispatcher's global minimum. This lets teams set the Slack channel to `warning` while keeping raw webhooks at `info`.

---

## Step 2: Add Environment Configuration

Edit `packages/backend/src/env.ts` to load the two new environment variables.

### Before (the full file):

```typescript
import type { HiveBackendConfig } from '@open-hive/shared';

export function loadConfig(): HiveBackendConfig {
  return {
    port: parseInt(process.env.PORT ?? '3000', 10),
    database: {
      type: (process.env.DB_TYPE as 'sqlite' | 'postgres') ?? 'sqlite',
      url: process.env.DATABASE_URL ?? './data/hive.db',
    },
    collision: {
      scope: (process.env.COLLISION_SCOPE as 'repo' | 'org') ?? 'org',
      semantic: {
        keywords_enabled: process.env.SEMANTIC_KEYWORDS !== 'false',
        embeddings_enabled: process.env.SEMANTIC_EMBEDDINGS === 'true',
        embeddings_provider: process.env.EMBEDDINGS_PROVIDER,
        embeddings_api_key: process.env.EMBEDDINGS_API_KEY,
        llm_enabled: process.env.SEMANTIC_LLM === 'true',
        llm_provider: process.env.LLM_PROVIDER,
        llm_api_key: process.env.LLM_API_KEY,
      },
    },
    webhooks: {
      urls: process.env.WEBHOOK_URLS?.split(',').filter(Boolean) ?? [],
    },
    session: {
      heartbeat_interval_seconds: parseInt(process.env.HEARTBEAT_INTERVAL ?? '30', 10),
      idle_timeout_seconds: parseInt(process.env.IDLE_TIMEOUT ?? '300', 10),
    },
  };
}
```

### After:

```typescript
import type { HiveBackendConfig } from '@open-hive/shared';
import type { CollisionSeverity } from '@open-hive/shared';
import type { SlackFormatterConfig } from './notifications/slack-formatter.js';

export interface HiveBackendConfigWithSlack extends HiveBackendConfig {
  slack?: SlackFormatterConfig;
}

export function loadConfig(): HiveBackendConfigWithSlack {
  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;

  return {
    port: parseInt(process.env.PORT ?? '3000', 10),
    database: {
      type: (process.env.DB_TYPE as 'sqlite' | 'postgres') ?? 'sqlite',
      url: process.env.DATABASE_URL ?? './data/hive.db',
    },
    collision: {
      scope: (process.env.COLLISION_SCOPE as 'repo' | 'org') ?? 'org',
      semantic: {
        keywords_enabled: process.env.SEMANTIC_KEYWORDS !== 'false',
        embeddings_enabled: process.env.SEMANTIC_EMBEDDINGS === 'true',
        embeddings_provider: process.env.EMBEDDINGS_PROVIDER,
        embeddings_api_key: process.env.EMBEDDINGS_API_KEY,
        llm_enabled: process.env.SEMANTIC_LLM === 'true',
        llm_provider: process.env.LLM_PROVIDER,
        llm_api_key: process.env.LLM_API_KEY,
      },
    },
    webhooks: {
      urls: process.env.WEBHOOK_URLS?.split(',').filter(Boolean) ?? [],
    },
    session: {
      heartbeat_interval_seconds: parseInt(process.env.HEARTBEAT_INTERVAL ?? '30', 10),
      idle_timeout_seconds: parseInt(process.env.IDLE_TIMEOUT ?? '300', 10),
    },
    // Slack integration — only present when SLACK_WEBHOOK_URL is set
    ...(slackWebhookUrl
      ? {
          slack: {
            webhookUrl: slackWebhookUrl,
            minSeverity: (process.env.SLACK_MIN_SEVERITY as CollisionSeverity) ?? 'info',
          },
        }
      : {}),
  };
}
```

### What changed

1. Imported `CollisionSeverity` from `@open-hive/shared` and `SlackFormatterConfig` from the new formatter.
2. Created `HiveBackendConfigWithSlack` that extends the shared config type with an optional `slack` property.
3. Changed the return type from `HiveBackendConfig` to `HiveBackendConfigWithSlack`.
4. Added a conditional spread that only populates `config.slack` when `SLACK_WEBHOOK_URL` is set in the environment.

---

## Step 3: Register the Formatter in server.ts

Edit `packages/backend/src/server.ts` to import and conditionally register the Slack formatter.

### Add this import at the top of the file (after the existing imports):

```typescript
import { SlackFormatter } from './notifications/slack-formatter.js';
```

### After the line that creates the dispatcher:

```typescript
const dispatcher = new NotificationDispatcher(config.webhooks.urls);
```

Add:

```typescript
if (config.slack?.webhookUrl) {
  dispatcher.registerFormatter(new SlackFormatter(config.slack));
}
```

### Full server.ts after edits:

```typescript
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadConfig } from './env.js';
import { createStore } from './db/index.js';
import { CollisionEngine } from './services/collision-engine.js';
import { NotificationDispatcher } from './services/notification-dispatcher.js';
import { SlackFormatter } from './notifications/slack-formatter.js';
import { authenticate } from './middleware/auth.js';
import { sessionRoutes } from './routes/sessions.js';
import { signalRoutes } from './routes/signals.js';
import { conflictRoutes } from './routes/conflicts.js';
import { historyRoutes } from './routes/history.js';

const config = loadConfig();
const store = createStore(config);
const engine = new CollisionEngine(store, config);
const dispatcher = new NotificationDispatcher(config.webhooks.urls);

if (config.slack?.webhookUrl) {
  dispatcher.registerFormatter(new SlackFormatter(config.slack));
}

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
app.addHook('preHandler', authenticate);

app.get('/api/health', async () => ({ status: 'ok', version: '0.2.0' }));

sessionRoutes(app, store, engine, dispatcher);
signalRoutes(app, store, engine, dispatcher);
conflictRoutes(app, store, engine, dispatcher);
historyRoutes(app, store);

// Periodic cleanup of stale sessions
const cleanupIntervalMs = config.session.heartbeat_interval_seconds * 1000;
setInterval(async () => {
  try {
    const cleaned = await store.cleanupStaleSessions(config.session.idle_timeout_seconds);
    if (cleaned.length > 0) {
      app.log.info({ count: cleaned.length, session_ids: cleaned }, 'Cleaned up stale sessions');
    }
  } catch (err) {
    app.log.error({ err }, 'Failed to cleanup stale sessions');
  }
}, cleanupIntervalMs);

await app.listen({ port: config.port, host: '0.0.0.0' });
app.log.info(`Open Hive backend listening on port ${config.port}`);
```

---

## Step 4: Update .env.example

If `.env.example` does not exist yet, create it at the repo root. If it already exists, append the Slack section.

### Add these lines to `.env.example`:

```bash
# ─── Slack Notifications ─────────────────────────────────────
# Incoming Webhook URL from https://api.slack.com/messaging/webhooks
# When set, collision alerts are posted to Slack as Block Kit messages.
# Leave unset to disable Slack notifications.
# SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# Minimum severity for Slack messages: info | warning | critical
# Default: info (all collisions are posted)
# SLACK_MIN_SEVERITY=info
```

---

## Step 5: Add Tests

Create the file `packages/backend/src/notifications/slack-formatter.test.ts` with the following content:

```typescript
// packages/backend/src/notifications/slack-formatter.test.ts

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SlackFormatter } from './slack-formatter.js';
import type { SlackFormatterConfig } from './slack-formatter.js';
import type { WebhookPayload } from '../services/notification-dispatcher.js';
import type { Collision, CollisionSeverity } from '@open-hive/shared';

// ─── Test Helpers ────────────────────────────────────────────

function makeConfig(overrides?: Partial<SlackFormatterConfig>): SlackFormatterConfig {
  return {
    webhookUrl: 'https://hooks.slack.com/services/YOUR/TEST/HOOK',
    minSeverity: 'info',
    ...overrides,
  };
}

function makePayload(overrides?: Partial<WebhookPayload>): WebhookPayload {
  const collision: Collision = {
    collision_id: 'col-test-1',
    session_ids: ['sess-a', 'sess-b'],
    type: 'file',
    severity: 'critical',
    details: 'Both sessions modifying src/auth.ts in my-repo',
    detected_at: '2026-03-03T12:00:00.000Z',
    resolved: false,
    resolved_by: null,
  };

  return {
    type: 'collision_detected',
    severity: 'critical',
    collision,
    sessions: [
      { developer_name: 'Alice', developer_email: 'alice@example.com', repo: 'my-repo', intent: 'fix auth bug' },
      { developer_name: 'Bob', developer_email: 'bob@example.com', repo: 'my-repo', intent: 'refactor auth module' },
    ],
    timestamp: '2026-03-03T12:00:00.000Z',
    ...overrides,
  };
}

// ─── format() ────────────────────────────────────────────────

describe('SlackFormatter — format()', () => {
  it('returns the configured webhook URL', () => {
    const url = 'https://hooks.slack.com/services/YOUR/MOCK/HOOK';
    const formatter = new SlackFormatter(makeConfig({ webhookUrl: url }));
    const result = formatter.format(makePayload());
    assert.equal(result.url, url);
  });

  it('produces valid Slack Block Kit JSON with attachments', () => {
    const formatter = new SlackFormatter(makeConfig());
    const result = formatter.format(makePayload());
    const body = result.body as { attachments: Array<{ color: string; blocks: unknown[] }> };

    assert.ok(Array.isArray(body.attachments), 'body must have attachments array');
    assert.equal(body.attachments.length, 1);
    assert.ok(Array.isArray(body.attachments[0].blocks), 'attachment must have blocks array');
    assert.ok(body.attachments[0].color, 'attachment must have a color');
  });

  it('includes a header block with collision type and severity', () => {
    const formatter = new SlackFormatter(makeConfig());
    const result = formatter.format(makePayload({ severity: 'warning' }));
    const body = result.body as { attachments: Array<{ blocks: Array<{ type: string; text?: { text: string } }> }> };
    const header = body.attachments[0].blocks.find(b => b.type === 'header');

    assert.ok(header, 'must contain a header block');
    assert.ok(header.text?.text.includes('warning'), 'header should include severity');
    assert.ok(header.text?.text.includes('file'), 'header should include collision type');
  });

  it('includes developer names and intents in the body', () => {
    const formatter = new SlackFormatter(makeConfig());
    const result = formatter.format(makePayload());
    const bodyStr = JSON.stringify(result.body);

    assert.ok(bodyStr.includes('Alice'), 'should contain first developer name');
    assert.ok(bodyStr.includes('Bob'), 'should contain second developer name');
    assert.ok(bodyStr.includes('fix auth bug'), 'should contain first developer intent');
    assert.ok(bodyStr.includes('refactor auth module'), 'should contain second developer intent');
  });

  it('includes collision details', () => {
    const formatter = new SlackFormatter(makeConfig());
    const result = formatter.format(makePayload());
    const bodyStr = JSON.stringify(result.body);

    assert.ok(bodyStr.includes('Both sessions modifying src/auth.ts'), 'should contain collision details');
  });

  it('includes a context block with timestamp and collision ID', () => {
    const formatter = new SlackFormatter(makeConfig());
    const payload = makePayload({ timestamp: '2026-03-03T15:30:00.000Z' });
    const result = formatter.format(payload);
    const body = result.body as { attachments: Array<{ blocks: Array<{ type: string; elements?: Array<{ text: string }> }> }> };
    const ctx = body.attachments[0].blocks.find(b => b.type === 'context');

    assert.ok(ctx, 'must contain a context block');
    const contextText = ctx.elements?.[0]?.text ?? '';
    assert.ok(contextText.includes('col-test-1'), 'context should include collision ID');
    assert.ok(contextText.includes('2026-03-03T15:30:00.000Z'), 'context should include timestamp');
  });

  it('shows "Collision Resolved" header for resolved events', () => {
    const formatter = new SlackFormatter(makeConfig());
    const result = formatter.format(makePayload({ type: 'collision_resolved' }));
    const body = result.body as { attachments: Array<{ blocks: Array<{ type: string; text?: { text: string } }> }> };
    const header = body.attachments[0].blocks.find(b => b.type === 'header');

    assert.ok(header?.text?.text.includes('Resolved'), 'header should say Resolved');
  });

  it('handles sessions with null intent gracefully', () => {
    const formatter = new SlackFormatter(makeConfig());
    const payload = makePayload();
    payload.sessions = [
      { developer_name: 'Charlie', developer_email: 'charlie@example.com', repo: 'my-repo', intent: null },
    ];
    const result = formatter.format(payload);
    const bodyStr = JSON.stringify(result.body);

    assert.ok(bodyStr.includes('no intent declared'), 'should show fallback text for null intent');
  });

  it('does not set custom headers', () => {
    const formatter = new SlackFormatter(makeConfig());
    const result = formatter.format(makePayload());
    assert.equal(result.headers, undefined, 'Slack webhooks need no extra headers');
  });
});

// ─── Color mapping ───────────────────────────────────────────

describe('SlackFormatter — color mapping', () => {
  const cases: Array<{ severity: CollisionSeverity; expectedColor: string }> = [
    { severity: 'critical', expectedColor: '#E01E5A' },
    { severity: 'warning',  expectedColor: '#ECB22E' },
    { severity: 'info',     expectedColor: '#36C5F0' },
  ];

  for (const { severity, expectedColor } of cases) {
    it(`uses ${expectedColor} for ${severity}`, () => {
      const formatter = new SlackFormatter(makeConfig());
      const result = formatter.format(makePayload({ severity }));
      const body = result.body as { attachments: Array<{ color: string }> };
      assert.equal(body.attachments[0].color, expectedColor);
    });
  }
});

// ─── shouldFire() ────────────────────────────────────────────

describe('SlackFormatter — shouldFire()', () => {
  it('fires for all severities when minSeverity is info', () => {
    const formatter = new SlackFormatter(makeConfig({ minSeverity: 'info' }));

    assert.equal(formatter.shouldFire(makePayload({ severity: 'info' })), true);
    assert.equal(formatter.shouldFire(makePayload({ severity: 'warning' })), true);
    assert.equal(formatter.shouldFire(makePayload({ severity: 'critical' })), true);
  });

  it('fires for warning and critical when minSeverity is warning', () => {
    const formatter = new SlackFormatter(makeConfig({ minSeverity: 'warning' }));

    assert.equal(formatter.shouldFire(makePayload({ severity: 'info' })), false);
    assert.equal(formatter.shouldFire(makePayload({ severity: 'warning' })), true);
    assert.equal(formatter.shouldFire(makePayload({ severity: 'critical' })), true);
  });

  it('fires only for critical when minSeverity is critical', () => {
    const formatter = new SlackFormatter(makeConfig({ minSeverity: 'critical' }));

    assert.equal(formatter.shouldFire(makePayload({ severity: 'info' })), false);
    assert.equal(formatter.shouldFire(makePayload({ severity: 'warning' })), false);
    assert.equal(formatter.shouldFire(makePayload({ severity: 'critical' })), true);
  });
});

// ─── name property ───────────────────────────────────────────

describe('SlackFormatter — name', () => {
  it('has name "slack"', () => {
    const formatter = new SlackFormatter(makeConfig());
    assert.equal(formatter.name, 'slack');
  });
});
```

---

## Step 6: Verify

Run the build and test suite from the repo root:

```bash
npm run build && npm test
```

If the test runner glob `src/**/*.test.ts` picks up files in subdirectories (which it should), the new `notifications/slack-formatter.test.ts` will be included automatically. Verify you see output like:

```
# tests 20
# pass 20
# fail 0
```

If the glob does not pick up nested directories, update the test script in `packages/backend/package.json` to:

```json
"test": "node --import tsx --test 'src/**/*.test.ts'"
```

---

## Configuration

| Environment Variable | Required | Default | Description |
|---|---|---|---|
| `SLACK_WEBHOOK_URL` | No | _(unset = disabled)_ | Slack Incoming Webhook URL. When set, collision alerts are posted as Block Kit messages. |
| `SLACK_MIN_SEVERITY` | No | `info` | Minimum severity for Slack notifications. One of: `info`, `warning`, `critical`. |

### Docker Compose

To enable Slack notifications in Docker, add the environment variables to `docker-compose.yaml`:

```yaml
services:
  open-hive:
    environment:
      SLACK_WEBHOOK_URL: https://hooks.slack.com/services/YOUR/WEBHOOK/URL
      SLACK_MIN_SEVERITY: warning
```

### Interaction with generic webhooks

The Slack formatter runs **in addition to** any generic webhook URLs configured via `WEBHOOK_URLS`. They are independent systems:

- `WEBHOOK_URLS` sends raw `WebhookPayload` JSON to each URL.
- `SLACK_WEBHOOK_URL` sends Slack Block Kit formatted messages.

You can use both, either, or neither.

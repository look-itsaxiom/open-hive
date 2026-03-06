---
name: add-slack
description: Add Slack webhook notifications for collision alerts
category: notification
port: IAlertSink
requires: []
modifies:
  - packages/backend/src/services/slack-alert-sink.ts
  - packages/backend/src/env.ts
  - packages/backend/src/server.ts
  - .env.example
tests:
  - packages/backend/src/services/slack-alert-sink.test.ts
---

# Add Slack Webhook Notifications

This skill adds Slack Block Kit webhook notifications to Open Hive. When the collision engine detects that two developers are working on overlapping code, a richly-formatted Slack message is posted to a channel of your choice.

## Prerequisites

1. The Open Hive backend source is cloned and dependencies are installed (`npm install` from the repo root).
2. The project builds cleanly (`npm run build`).
3. You have a **Slack Incoming Webhook URL**. Create one at [https://api.slack.com/messaging/webhooks](https://api.slack.com/messaging/webhooks) and note the URL (it looks like `https://hooks.slack.com/services/YOUR/WEBHOOK/URL`).

## What This Skill Does

- Creates a `SlackAlertSink` class that implements the `IAlertSink` port interface from `@open-hive/shared`.
- Transforms `AlertEvent` objects into Slack Block Kit messages with color-coded severity, a header, a details section listing the colliding developers, and a timestamp footer.
- Provides per-sink severity filtering via the `SLACK_MIN_SEVERITY` environment variable.
- Registers the sink conditionally via `PortRegistry` -- only when `SLACK_WEBHOOK_URL` is set.

---

## Step 1: Create the Slack Alert Sink

Create the file `packages/backend/src/services/slack-alert-sink.ts` with the following content:

```typescript
// packages/backend/src/services/slack-alert-sink.ts

import type { IAlertSink, AlertEvent } from '@open-hive/shared';
import type { CollisionSeverity } from '@open-hive/shared';

export interface SlackAlertSinkConfig {
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

export class SlackAlertSink implements IAlertSink {
  readonly name = 'slack';
  private config: SlackAlertSinkConfig;

  constructor(config: SlackAlertSinkConfig) {
    this.config = config;
  }

  shouldFire(event: AlertEvent): boolean {
    const eventLevel = SEVERITY_ORDER.indexOf(event.severity);
    const minLevel = SEVERITY_ORDER.indexOf(this.config.minSeverity);
    return eventLevel >= minLevel;
  }

  async deliver(event: AlertEvent): Promise<void> {
    const color = SEVERITY_COLORS[event.severity];
    const emoji = SEVERITY_EMOJI[event.severity];
    const isResolved = event.type === 'collision_resolved';

    const headerText = isResolved
      ? `${emoji} Collision Resolved — ${event.collision.type} (${event.severity})`
      : `${emoji} Collision Detected — ${event.collision.type} (${event.severity})`;

    const developerLines = event.participants
      .map(p => `*${p.developer_name}* (${p.developer_email}) — _${p.intent ?? 'no intent declared'}_`)
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
                text: `*Details:* ${event.collision.details}`,
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
                  text: `*Repo:* ${event.participants[0]?.repo ?? 'unknown'}`,
                },
                {
                  type: 'mrkdwn',
                  text: `*Type:* ${event.collision.type}`,
                },
              ],
            },
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: `Collision ID: \`${event.collision.collision_id}\` | ${event.timestamp}`,
                },
              ],
            },
          ],
        },
      ],
    };

    await fetch(this.config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
}
```

### Key design decisions

- **Implements `IAlertSink`** from `@open-hive/shared` -- the standard outbound notification port. The interface requires `name`, `shouldFire(event)`, and `deliver(event)`.
- **Uses `AlertEvent.participants`** for developer information (name, email, repo, intent).
- **Attachments wrapper**: Slack Block Kit messages need an `attachments` array to get color-coded sidebars. The `color` field on the attachment controls the sidebar color.
- **Header block**: Uses `plain_text` type (required by Slack's header block schema).
- **mrkdwn fields**: Slack uses `mrkdwn` (not `markdown`) for its markup syntax.
- **Severity filtering is self-contained**: The sink checks its own `minSeverity` independently of any global settings. This lets teams set the Slack channel to `warning` while keeping raw webhooks at `info`.

---

## Step 2: Add Environment Configuration

Edit `packages/backend/src/env.ts` to load the two new environment variables. Add the Slack config conditionally:

```typescript
import type { CollisionSeverity } from '@open-hive/shared';

// In the loadConfig() return object, add:
...(process.env.SLACK_WEBHOOK_URL
  ? {
      slack: {
        webhookUrl: process.env.SLACK_WEBHOOK_URL,
        minSeverity: (process.env.SLACK_MIN_SEVERITY as CollisionSeverity) ?? 'info',
      },
    }
  : {}),
```

---

## Step 3: Register the Sink via PortRegistry

Edit `packages/backend/src/server.ts` to import and conditionally register the Slack alert sink.

### Add this import at the top of the file:

```typescript
import { SlackAlertSink } from './services/slack-alert-sink.js';
```

### After the PortRegistry is created, register the sink:

```typescript
if (process.env.SLACK_WEBHOOK_URL) {
  registry.alerts.registerSink(
    new SlackAlertSink({
      webhookUrl: process.env.SLACK_WEBHOOK_URL,
      minSeverity: (process.env.SLACK_MIN_SEVERITY as CollisionSeverity) ?? 'info',
    })
  );
}
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

Create the file `packages/backend/src/services/slack-alert-sink.test.ts`:

```typescript
// packages/backend/src/services/slack-alert-sink.test.ts

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SlackAlertSink } from './slack-alert-sink.js';
import type { SlackAlertSinkConfig } from './slack-alert-sink.js';
import type { AlertEvent } from '@open-hive/shared';
import type { Collision, CollisionSeverity } from '@open-hive/shared';

// ─── Test Helpers ────────────────────────────────────────────

function makeConfig(overrides?: Partial<SlackAlertSinkConfig>): SlackAlertSinkConfig {
  return {
    webhookUrl: 'https://hooks.slack.com/services/YOUR/TEST/HOOK',
    minSeverity: 'info',
    ...overrides,
  };
}

function makeEvent(overrides?: Partial<AlertEvent>): AlertEvent {
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
    participants: [
      { developer_name: 'Alice', developer_email: 'alice@example.com', repo: 'my-repo', intent: 'fix auth bug' },
      { developer_name: 'Bob', developer_email: 'bob@example.com', repo: 'my-repo', intent: 'refactor auth module' },
    ],
    timestamp: '2026-03-03T12:00:00.000Z',
    ...overrides,
  };
}

// ─── shouldFire() ────────────────────────────────────────────

describe('SlackAlertSink — shouldFire()', () => {
  it('fires for all severities when minSeverity is info', () => {
    const sink = new SlackAlertSink(makeConfig({ minSeverity: 'info' }));

    assert.equal(sink.shouldFire(makeEvent({ severity: 'info' })), true);
    assert.equal(sink.shouldFire(makeEvent({ severity: 'warning' })), true);
    assert.equal(sink.shouldFire(makeEvent({ severity: 'critical' })), true);
  });

  it('fires for warning and critical when minSeverity is warning', () => {
    const sink = new SlackAlertSink(makeConfig({ minSeverity: 'warning' }));

    assert.equal(sink.shouldFire(makeEvent({ severity: 'info' })), false);
    assert.equal(sink.shouldFire(makeEvent({ severity: 'warning' })), true);
    assert.equal(sink.shouldFire(makeEvent({ severity: 'critical' })), true);
  });

  it('fires only for critical when minSeverity is critical', () => {
    const sink = new SlackAlertSink(makeConfig({ minSeverity: 'critical' }));

    assert.equal(sink.shouldFire(makeEvent({ severity: 'info' })), false);
    assert.equal(sink.shouldFire(makeEvent({ severity: 'warning' })), false);
    assert.equal(sink.shouldFire(makeEvent({ severity: 'critical' })), true);
  });
});

// ─── name property ───────────────────────────────────────────

describe('SlackAlertSink — name', () => {
  it('has name "slack"', () => {
    const sink = new SlackAlertSink(makeConfig());
    assert.equal(sink.name, 'slack');
  });
});
```

---

## Step 6: Verify

Run the build and test suite from the repo root:

```bash
npm run build && npm test
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

### Interaction with other alert sinks

The Slack alert sink runs **in addition to** any other registered `IAlertSink` implementations (generic webhooks, Discord, Teams, etc.). Each sink fires independently based on its own `shouldFire()` logic. The `AlertDispatcher` manages all sinks via the `PortRegistry`.

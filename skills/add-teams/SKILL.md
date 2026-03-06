---
name: add-teams
description: Add Microsoft Teams webhook notifications for collision alerts
category: notification
port: IAlertSink
requires: []
modifies:
  - packages/backend/src/services/teams-alert-sink.ts
  - packages/backend/src/env.ts
  - packages/backend/src/server.ts
  - .env.example
tests:
  - packages/backend/src/services/teams-alert-sink.test.ts
---

# Add Microsoft Teams Webhook Notifications

This skill adds Microsoft Teams Adaptive Card webhook notifications to Open Hive. When the collision engine detects that two developers are working on overlapping code, a richly-formatted Teams message is posted to a channel of your choice.

## Prerequisites

1. The Open Hive backend source is cloned and dependencies are installed (`npm install` from the repo root).
2. The project builds cleanly (`npm run build`).
3. You have a **Microsoft Teams Incoming Webhook URL**. Create one by:
   - In Teams, go to the channel where you want notifications
   - Click "..." > "Connectors" (or "Manage channel" > "Connectors")
   - Find "Incoming Webhook", click "Configure"
   - Name it "Open Hive", optionally set an icon, click "Create"
   - Copy the webhook URL

## What This Skill Does

- Creates a `TeamsAlertSink` class that implements the `IAlertSink` port interface from `@open-hive/shared`.
- Transforms `AlertEvent` objects into Microsoft Teams Adaptive Card messages with color-coded theme, header, details sections, and timestamp.
- Provides per-sink severity filtering via the `TEAMS_MIN_SEVERITY` environment variable.
- Registers the sink conditionally via `PortRegistry` -- only when `TEAMS_WEBHOOK_URL` is set.

## Step 1: Create the Teams Alert Sink

Create `packages/backend/src/services/teams-alert-sink.ts`:

```typescript
import type { IAlertSink, AlertEvent } from '@open-hive/shared';
import type { CollisionSeverity } from '@open-hive/shared';

export interface TeamsAlertSinkConfig {
  webhookUrl: string;
  minSeverity: CollisionSeverity;
}

const SEVERITY_LEVELS: CollisionSeverity[] = ['info', 'warning', 'critical'];

const THEME_COLORS: Record<CollisionSeverity, string> = {
  critical: 'attention',  // red
  warning: 'warning',     // yellow
  info: 'accent',         // blue
};

const SEVERITY_EMOJI: Record<CollisionSeverity, string> = {
  critical: '🔴',
  warning: '🟡',
  info: '🔵',
};

export class TeamsAlertSink implements IAlertSink {
  readonly name = 'teams';

  constructor(private config: TeamsAlertSinkConfig) {}

  shouldFire(event: AlertEvent): boolean {
    return (
      SEVERITY_LEVELS.indexOf(event.severity) >=
      SEVERITY_LEVELS.indexOf(this.config.minSeverity)
    );
  }

  async deliver(event: AlertEvent): Promise<void> {
    const emoji = SEVERITY_EMOJI[event.severity];
    const isResolved = event.type === 'collision_resolved';
    const title = isResolved
      ? `${emoji} Collision Resolved — ${event.collision.type} (${event.severity})`
      : `${emoji} Collision Detected — ${event.collision.type} (${event.severity})`;

    const developers = event.participants
      .map(p => `**${p.developer_name}** (${p.developer_email})${p.intent ? ` — _${p.intent}_` : ''}`)
      .join('\n\n');

    const card = {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          contentUrl: null,
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.4',
            msteams: { width: 'Full' },
            body: [
              {
                type: 'TextBlock',
                text: title,
                size: 'Large',
                weight: 'Bolder',
                color: THEME_COLORS[event.severity],
                wrap: true,
              },
              {
                type: 'TextBlock',
                text: event.collision.details,
                wrap: true,
              },
              {
                type: 'FactSet',
                facts: [
                  { title: 'Severity', value: event.severity.toUpperCase() },
                  { title: 'Type', value: event.collision.type },
                  ...(event.participants.length > 0 && event.participants[0].repo
                    ? [{ title: 'Repository', value: event.participants[0].repo }]
                    : []),
                ],
              },
              {
                type: 'TextBlock',
                text: '**Developers Involved:**',
                weight: 'Bolder',
                spacing: 'Medium',
              },
              {
                type: 'TextBlock',
                text: developers || '_No developer details available_',
                wrap: true,
              },
              {
                type: 'TextBlock',
                text: `Collision ID: ${event.collision.collision_id} | ${new Date(event.timestamp).toLocaleString()}`,
                size: 'Small',
                isSubtle: true,
                spacing: 'Medium',
              },
            ],
          },
        },
      ],
    };

    await fetch(this.config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card),
    });
  }
}
```

## Step 2: Add Environment Configuration

In `packages/backend/src/env.ts`, add to the `loadConfig()` return object:

```typescript
import type { CollisionSeverity } from '@open-hive/shared';

// Add after the existing config:
...(process.env.TEAMS_WEBHOOK_URL
  ? {
      teams: {
        webhookUrl: process.env.TEAMS_WEBHOOK_URL,
        minSeverity: (process.env.TEAMS_MIN_SEVERITY as CollisionSeverity) ?? 'info',
      },
    }
  : {}),
```

## Step 3: Register the Sink via PortRegistry

After the `PortRegistry` is created in `packages/backend/src/server.ts`:

```typescript
import { TeamsAlertSink } from './services/teams-alert-sink.js';

if (process.env.TEAMS_WEBHOOK_URL) {
  registry.alerts.registerSink(
    new TeamsAlertSink({
      webhookUrl: process.env.TEAMS_WEBHOOK_URL,
      minSeverity: (process.env.TEAMS_MIN_SEVERITY as CollisionSeverity) ?? 'info',
    })
  );
}
```

## Step 4: Update .env.example

```bash
# Microsoft Teams Notifications (optional)
# TEAMS_WEBHOOK_URL=https://your-org.webhook.office.com/webhookb2/YOUR/WEBHOOK/URL
# TEAMS_MIN_SEVERITY=info    # info | warning | critical
```

## Step 5: Add Tests

Create `packages/backend/src/services/teams-alert-sink.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TeamsAlertSink } from './teams-alert-sink.js';
import type { AlertEvent } from '@open-hive/shared';
import type { Collision, CollisionSeverity } from '@open-hive/shared';

function makeEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    type: 'collision_detected',
    severity: 'critical' as CollisionSeverity,
    collision: {
      collision_id: 'col-1',
      session_ids: ['s1', 's2'],
      type: 'file',
      severity: 'critical',
      details: 'Both sessions modifying src/auth/login.ts in my-app',
      detected_at: '2026-03-03T10:00:00.000Z',
      resolved: false,
      resolved_by: null,
    } as Collision,
    participants: [
      { developer_name: 'Alice', developer_email: 'alice@team.com', repo: 'my-app', intent: 'Refactoring auth' },
      { developer_name: 'Bob', developer_email: 'bob@team.com', repo: 'my-app', intent: 'Fixing login bugs' },
    ],
    timestamp: '2026-03-03T10:00:00.000Z',
    ...overrides,
  };
}

const WEBHOOK_URL = 'https://example.webhook.office.com/webhookb2/test';

describe('TeamsAlertSink — shouldFire()', () => {
  it('fires for all severities when min is info', () => {
    const sink = new TeamsAlertSink({ webhookUrl: WEBHOOK_URL, minSeverity: 'info' });
    assert.ok(sink.shouldFire(makeEvent({ severity: 'info' })));
    assert.ok(sink.shouldFire(makeEvent({ severity: 'warning' })));
    assert.ok(sink.shouldFire(makeEvent({ severity: 'critical' })));
  });

  it('skips info when min is warning', () => {
    const sink = new TeamsAlertSink({ webhookUrl: WEBHOOK_URL, minSeverity: 'warning' });
    assert.ok(!sink.shouldFire(makeEvent({ severity: 'info' })));
    assert.ok(sink.shouldFire(makeEvent({ severity: 'warning' })));
    assert.ok(sink.shouldFire(makeEvent({ severity: 'critical' })));
  });

  it('only fires critical when min is critical', () => {
    const sink = new TeamsAlertSink({ webhookUrl: WEBHOOK_URL, minSeverity: 'critical' });
    assert.ok(!sink.shouldFire(makeEvent({ severity: 'info' })));
    assert.ok(!sink.shouldFire(makeEvent({ severity: 'warning' })));
    assert.ok(sink.shouldFire(makeEvent({ severity: 'critical' })));
  });
});

describe('TeamsAlertSink — name', () => {
  it('has name "teams"', () => {
    const sink = new TeamsAlertSink({ webhookUrl: WEBHOOK_URL, minSeverity: 'info' });
    assert.equal(sink.name, 'teams');
  });
});
```

## Step 6: Verify

```bash
npm run build && cd packages/backend && node --import tsx --test src/**/*.test.ts
```

All existing tests should still pass, plus the new Teams alert sink tests.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `TEAMS_WEBHOOK_URL` | -- | Microsoft Teams Incoming Webhook URL. Sink only activates when set. |
| `TEAMS_MIN_SEVERITY` | `info` | Minimum severity to send to Teams (`info`, `warning`, `critical`). |

### Docker Compose Example

```yaml
services:
  backend:
    environment:
      TEAMS_WEBHOOK_URL: https://your-org.webhook.office.com/webhookb2/YOUR/WEBHOOK/URL
      TEAMS_MIN_SEVERITY: warning
```

The Teams alert sink works alongside any other registered `IAlertSink` implementations (generic webhooks, Slack, Discord, etc.). Each sink fires independently based on its own `shouldFire()` logic. The `AlertDispatcher` manages all sinks via the `PortRegistry`.

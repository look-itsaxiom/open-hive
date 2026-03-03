---
name: add-teams
description: Add Microsoft Teams webhook notifications for collision alerts
category: notification
requires: []
modifies:
  - packages/backend/src/notifications/teams-formatter.ts
  - packages/backend/src/env.ts
  - packages/backend/src/server.ts
  - .env.example
tests:
  - packages/backend/src/notifications/teams-formatter.test.ts
---

# Add Microsoft Teams Webhook Notifications

This skill adds Microsoft Teams Adaptive Card webhook notifications to Open Hive. When the collision engine detects that two developers are working on overlapping code, a richly-formatted Teams message is posted to a channel of your choice.

## Prerequisites

1. The Open Hive backend source is cloned and dependencies are installed (`npm install` from the repo root).
2. The project builds cleanly (`npm run build`).
3. You have a **Microsoft Teams Incoming Webhook URL**. Create one by:
   - In Teams, go to the channel where you want notifications
   - Click "..." → "Connectors" (or "Manage channel" → "Connectors")
   - Find "Incoming Webhook", click "Configure"
   - Name it "Open Hive", optionally set an icon, click "Create"
   - Copy the webhook URL

## What This Skill Does

- Creates a `TeamsFormatter` class that implements the `NotificationFormatter` interface.
- Transforms raw `WebhookPayload` objects into Microsoft Teams Adaptive Card messages with color-coded theme, header, details sections, and timestamp.
- Provides per-formatter severity filtering via the `TEAMS_MIN_SEVERITY` environment variable.
- Registers the formatter conditionally — only when `TEAMS_WEBHOOK_URL` is set.

## Step 1: Create the Teams Formatter

Create `packages/backend/src/notifications/teams-formatter.ts`:

```typescript
import type { CollisionSeverity } from '@open-hive/shared';
import type { NotificationFormatter, WebhookPayload } from '../services/notification-dispatcher.js';

export interface TeamsFormatterConfig {
  webhookUrl: string;
  minSeverity: CollisionSeverity;
}

const SEVERITY_LEVELS: CollisionSeverity[] = ['info', 'warning', 'critical'];

const THEME_COLORS: Record<CollisionSeverity, string> = {
  critical: 'attention',  // red
  warning: 'warning',     // yellow
  info: 'accent',         // blue
};

const HEX_COLORS: Record<CollisionSeverity, string> = {
  critical: '#E74C3C',
  warning: '#F39C12',
  info: '#3498DB',
};

const SEVERITY_EMOJI: Record<CollisionSeverity, string> = {
  critical: '🔴',
  warning: '🟡',
  info: '🔵',
};

export class TeamsFormatter implements NotificationFormatter {
  readonly name = 'teams';

  constructor(private config: TeamsFormatterConfig) {}

  shouldFire(payload: WebhookPayload): boolean {
    return (
      SEVERITY_LEVELS.indexOf(payload.severity) >=
      SEVERITY_LEVELS.indexOf(this.config.minSeverity)
    );
  }

  format(payload: WebhookPayload): { url: string; body: unknown; headers?: Record<string, string> } {
    const emoji = SEVERITY_EMOJI[payload.severity];
    const isResolved = payload.type === 'collision_resolved';
    const title = isResolved
      ? `${emoji} Collision Resolved — ${payload.collision.type} (${payload.severity})`
      : `${emoji} Collision Detected — ${payload.collision.type} (${payload.severity})`;

    const developers = payload.sessions
      .map(s => `**${s.developer_name}** (${s.developer_email})${s.intent ? ` — _${s.intent}_` : ''}`)
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
            msteams: {
              width: 'Full',
            },
            body: [
              {
                type: 'TextBlock',
                text: title,
                size: 'Large',
                weight: 'Bolder',
                color: THEME_COLORS[payload.severity],
                wrap: true,
              },
              {
                type: 'TextBlock',
                text: payload.collision.details,
                wrap: true,
              },
              {
                type: 'FactSet',
                facts: [
                  { title: 'Severity', value: payload.severity.toUpperCase() },
                  { title: 'Type', value: payload.collision.type },
                  ...(payload.sessions.length > 0 && payload.sessions[0].repo
                    ? [{ title: 'Repository', value: payload.sessions[0].repo }]
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
                text: `Collision ID: ${payload.collision.collision_id} | ${new Date(payload.timestamp).toLocaleString()}`,
                size: 'Small',
                isSubtle: true,
                spacing: 'Medium',
              },
            ],
          },
        },
      ],
    };

    return {
      url: this.config.webhookUrl,
      body: card,
    };
  }
}
```

## Step 2: Add Environment Configuration

In `packages/backend/src/env.ts`, add to the `loadConfig()` return object:

```typescript
// Add after the existing webhooks config:
...(process.env.TEAMS_WEBHOOK_URL
  ? {
      teams: {
        webhookUrl: process.env.TEAMS_WEBHOOK_URL,
        minSeverity: (process.env.TEAMS_MIN_SEVERITY as CollisionSeverity) ?? 'info',
      },
    }
  : {}),
```

Import `CollisionSeverity` from `@open-hive/shared` if not already imported.

## Step 3: Register the Formatter in server.ts

After the dispatcher is created in `packages/backend/src/server.ts`:

```typescript
import { TeamsFormatter } from './notifications/teams-formatter.js';

// After: const dispatcher = new NotificationDispatcher(config.webhooks.urls);
if ((config as any).teams?.webhookUrl) {
  dispatcher.registerFormatter(new TeamsFormatter((config as any).teams));
}
```

## Step 4: Update .env.example

```bash
# Microsoft Teams Notifications (optional)
# TEAMS_WEBHOOK_URL=https://your-org.webhook.office.com/webhookb2/YOUR/WEBHOOK/URL
# TEAMS_MIN_SEVERITY=info    # info | warning | critical
```

## Step 5: Add Tests

Create `packages/backend/src/notifications/teams-formatter.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TeamsFormatter } from './teams-formatter.js';
import type { WebhookPayload } from '../services/notification-dispatcher.js';
import type { Collision, CollisionSeverity } from '@open-hive/shared';

function makePayload(overrides: Partial<WebhookPayload> = {}): WebhookPayload {
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
    sessions: [
      { developer_name: 'Alice', developer_email: 'alice@team.com', repo: 'my-app', intent: 'Refactoring auth' },
      { developer_name: 'Bob', developer_email: 'bob@team.com', repo: 'my-app', intent: 'Fixing login bugs' },
    ],
    timestamp: '2026-03-03T10:00:00.000Z',
    ...overrides,
  };
}

const WEBHOOK_URL = 'https://example.webhook.office.com/webhookb2/test';

describe('TeamsFormatter — format()', () => {
  it('returns the configured webhook URL', () => {
    const fmt = new TeamsFormatter({ webhookUrl: WEBHOOK_URL, minSeverity: 'info' });
    const result = fmt.format(makePayload());
    assert.equal(result.url, WEBHOOK_URL);
  });

  it('produces an Adaptive Card attachment', () => {
    const fmt = new TeamsFormatter({ webhookUrl: WEBHOOK_URL, minSeverity: 'info' });
    const result = fmt.format(makePayload());
    const body = result.body as any;
    assert.equal(body.type, 'message');
    assert.equal(body.attachments.length, 1);
    assert.equal(body.attachments[0].contentType, 'application/vnd.microsoft.card.adaptive');
    assert.equal(body.attachments[0].content.type, 'AdaptiveCard');
  });

  it('includes collision details in the card body', () => {
    const fmt = new TeamsFormatter({ webhookUrl: WEBHOOK_URL, minSeverity: 'info' });
    const result = fmt.format(makePayload());
    const content = body(result).body;
    const detailsBlock = content.find((b: any) => b.text?.includes('src/auth/login.ts'));
    assert.ok(detailsBlock);
  });

  it('includes developer names', () => {
    const fmt = new TeamsFormatter({ webhookUrl: WEBHOOK_URL, minSeverity: 'info' });
    const result = fmt.format(makePayload());
    const content = JSON.stringify(body(result));
    assert.ok(content.includes('Alice'));
    assert.ok(content.includes('Bob'));
  });

  it('shows severity in FactSet', () => {
    const fmt = new TeamsFormatter({ webhookUrl: WEBHOOK_URL, minSeverity: 'info' });
    const result = fmt.format(makePayload({ severity: 'warning' }));
    const content = JSON.stringify(body(result));
    assert.ok(content.includes('WARNING'));
  });

  it('handles collision_resolved events', () => {
    const fmt = new TeamsFormatter({ webhookUrl: WEBHOOK_URL, minSeverity: 'info' });
    const result = fmt.format(makePayload({ type: 'collision_resolved' }));
    const content = JSON.stringify(body(result));
    assert.ok(content.includes('Resolved'));
  });

  it('handles sessions with null intent', () => {
    const fmt = new TeamsFormatter({ webhookUrl: WEBHOOK_URL, minSeverity: 'info' });
    const result = fmt.format(makePayload({
      sessions: [
        { developer_name: 'Alice', developer_email: 'a@t.com', repo: 'r', intent: null },
      ],
    }));
    const content = JSON.stringify(body(result));
    assert.ok(content.includes('Alice'));
  });

  it('does not set custom headers', () => {
    const fmt = new TeamsFormatter({ webhookUrl: WEBHOOK_URL, minSeverity: 'info' });
    const result = fmt.format(makePayload());
    assert.equal(result.headers, undefined);
  });
});

describe('TeamsFormatter — shouldFire()', () => {
  it('fires for all severities when min is info', () => {
    const fmt = new TeamsFormatter({ webhookUrl: WEBHOOK_URL, minSeverity: 'info' });
    assert.ok(fmt.shouldFire(makePayload({ severity: 'info' })));
    assert.ok(fmt.shouldFire(makePayload({ severity: 'warning' })));
    assert.ok(fmt.shouldFire(makePayload({ severity: 'critical' })));
  });

  it('skips info when min is warning', () => {
    const fmt = new TeamsFormatter({ webhookUrl: WEBHOOK_URL, minSeverity: 'warning' });
    assert.ok(!fmt.shouldFire(makePayload({ severity: 'info' })));
    assert.ok(fmt.shouldFire(makePayload({ severity: 'warning' })));
    assert.ok(fmt.shouldFire(makePayload({ severity: 'critical' })));
  });

  it('only fires critical when min is critical', () => {
    const fmt = new TeamsFormatter({ webhookUrl: WEBHOOK_URL, minSeverity: 'critical' });
    assert.ok(!fmt.shouldFire(makePayload({ severity: 'info' })));
    assert.ok(!fmt.shouldFire(makePayload({ severity: 'warning' })));
    assert.ok(fmt.shouldFire(makePayload({ severity: 'critical' })));
  });
});

describe('TeamsFormatter — name', () => {
  it('has name "teams"', () => {
    const fmt = new TeamsFormatter({ webhookUrl: WEBHOOK_URL, minSeverity: 'info' });
    assert.equal(fmt.name, 'teams');
  });
});

function body(result: { body: unknown }): any {
  return (result.body as any).attachments[0].content;
}
```

## Step 6: Verify

```bash
npm run build && cd packages/backend && node --import tsx --test src/**/*.test.ts
```

All existing tests should still pass, plus the new Teams formatter tests.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `TEAMS_WEBHOOK_URL` | — | Microsoft Teams Incoming Webhook URL. Formatter only activates when set. |
| `TEAMS_MIN_SEVERITY` | `info` | Minimum severity to send to Teams (`info`, `warning`, `critical`). |

### Docker Compose Example

```yaml
services:
  backend:
    environment:
      TEAMS_WEBHOOK_URL: https://your-org.webhook.office.com/webhookb2/YOUR/WEBHOOK/URL
      TEAMS_MIN_SEVERITY: warning
```

The Teams formatter works alongside the generic webhook emitter. Generic webhooks still fire to `WEBHOOK_URLS`; the Teams formatter provides additional richly-formatted notifications.

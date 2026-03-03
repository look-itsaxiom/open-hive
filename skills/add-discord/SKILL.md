---
name: add-discord
description: Add Discord webhook notifications for collision alerts
category: notification
requires: []
modifies:
  - packages/backend/src/notifications/discord-formatter.ts
  - packages/backend/src/env.ts
  - packages/backend/src/server.ts
  - .env.example
tests:
  - packages/backend/src/notifications/discord-formatter.test.ts
---

# Add Discord Webhook Notifications

This skill adds Discord embed webhook notifications to Open Hive. When the collision engine detects that two developers are working on overlapping code, a richly-formatted Discord embed is posted to a channel of your choice.

## Prerequisites

1. The Open Hive backend source is cloned and dependencies are installed (`npm install` from the repo root).
2. The project builds cleanly (`npm run build`).
3. You have a **Discord Webhook URL**. Create one by:
   - In Discord, go to the channel → Edit Channel → Integrations → Webhooks
   - Click "New Webhook", name it "Open Hive", optionally set an avatar
   - Click "Copy Webhook URL"

## What This Skill Does

- Creates a `DiscordFormatter` class that implements the `NotificationFormatter` interface.
- Transforms raw `WebhookPayload` objects into Discord embed messages with color-coded severity, title, fields, and timestamp.
- Provides per-formatter severity filtering via the `DISCORD_MIN_SEVERITY` environment variable.
- Registers the formatter conditionally — only when `DISCORD_WEBHOOK_URL` is set.

## Step 1: Create the Discord Formatter

Create `packages/backend/src/notifications/discord-formatter.ts`:

```typescript
import type { CollisionSeverity } from '@open-hive/shared';
import type { NotificationFormatter, WebhookPayload } from '../services/notification-dispatcher.js';

export interface DiscordFormatterConfig {
  webhookUrl: string;
  minSeverity: CollisionSeverity;
}

const SEVERITY_LEVELS: CollisionSeverity[] = ['info', 'warning', 'critical'];

// Discord embed colors are decimal integers
const EMBED_COLORS: Record<CollisionSeverity, number> = {
  critical: 0xE74C3C, // red
  warning: 0xF39C12,  // yellow/orange
  info: 0x3498DB,     // blue
};

const SEVERITY_EMOJI: Record<CollisionSeverity, string> = {
  critical: '🔴',
  warning: '🟡',
  info: '🔵',
};

export class DiscordFormatter implements NotificationFormatter {
  readonly name = 'discord';

  constructor(private config: DiscordFormatterConfig) {}

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

    const fields = payload.sessions.map(s => ({
      name: s.developer_name,
      value: [
        s.developer_email,
        s.intent ? `Intent: _${s.intent}_` : '_No intent declared_',
      ].join('\n'),
      inline: true,
    }));

    if (payload.sessions.length > 0 && payload.sessions[0].repo) {
      fields.push({
        name: 'Repository',
        value: payload.sessions[0].repo,
        inline: true,
      });
    }

    const embed = {
      embeds: [
        {
          title,
          description: payload.collision.details,
          color: EMBED_COLORS[payload.severity],
          fields,
          footer: {
            text: `Collision ID: ${payload.collision.collision_id}`,
          },
          timestamp: payload.timestamp,
        },
      ],
      username: 'Open Hive',
    };

    return {
      url: this.config.webhookUrl,
      body: embed,
    };
  }
}
```

## Step 2: Add Environment Configuration

In `packages/backend/src/env.ts`, add to the `loadConfig()` return object:

```typescript
// Add after the existing webhooks config:
...(process.env.DISCORD_WEBHOOK_URL
  ? {
      discord: {
        webhookUrl: process.env.DISCORD_WEBHOOK_URL,
        minSeverity: (process.env.DISCORD_MIN_SEVERITY as CollisionSeverity) ?? 'info',
      },
    }
  : {}),
```

Import `CollisionSeverity` from `@open-hive/shared` if not already imported.

## Step 3: Register the Formatter in server.ts

After the dispatcher is created in `packages/backend/src/server.ts`:

```typescript
import { DiscordFormatter } from './notifications/discord-formatter.js';

// After: const dispatcher = new NotificationDispatcher(config.webhooks.urls);
if ((config as any).discord?.webhookUrl) {
  dispatcher.registerFormatter(new DiscordFormatter((config as any).discord));
}
```

## Step 4: Update .env.example

```bash
# Discord Notifications (optional)
# DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR/WEBHOOK/URL
# DISCORD_MIN_SEVERITY=info    # info | warning | critical
```

## Step 5: Add Tests

Create `packages/backend/src/notifications/discord-formatter.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DiscordFormatter } from './discord-formatter.js';
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

const WEBHOOK_URL = 'https://discord.com/api/webhooks/123/abc';

describe('DiscordFormatter — format()', () => {
  it('returns the configured webhook URL', () => {
    const fmt = new DiscordFormatter({ webhookUrl: WEBHOOK_URL, minSeverity: 'info' });
    const result = fmt.format(makePayload());
    assert.equal(result.url, WEBHOOK_URL);
  });

  it('produces a Discord embed structure', () => {
    const fmt = new DiscordFormatter({ webhookUrl: WEBHOOK_URL, minSeverity: 'info' });
    const result = fmt.format(makePayload());
    const body = result.body as any;
    assert.ok(Array.isArray(body.embeds));
    assert.equal(body.embeds.length, 1);
    assert.equal(body.username, 'Open Hive');
  });

  it('sets correct color for critical severity', () => {
    const fmt = new DiscordFormatter({ webhookUrl: WEBHOOK_URL, minSeverity: 'info' });
    const result = fmt.format(makePayload({ severity: 'critical' }));
    const embed = (result.body as any).embeds[0];
    assert.equal(embed.color, 0xE74C3C);
  });

  it('sets correct color for warning severity', () => {
    const fmt = new DiscordFormatter({ webhookUrl: WEBHOOK_URL, minSeverity: 'info' });
    const result = fmt.format(makePayload({ severity: 'warning' }));
    const embed = (result.body as any).embeds[0];
    assert.equal(embed.color, 0xF39C12);
  });

  it('sets correct color for info severity', () => {
    const fmt = new DiscordFormatter({ webhookUrl: WEBHOOK_URL, minSeverity: 'info' });
    const result = fmt.format(makePayload({ severity: 'info' }));
    const embed = (result.body as any).embeds[0];
    assert.equal(embed.color, 0x3498DB);
  });

  it('includes collision details as description', () => {
    const fmt = new DiscordFormatter({ webhookUrl: WEBHOOK_URL, minSeverity: 'info' });
    const result = fmt.format(makePayload());
    const embed = (result.body as any).embeds[0];
    assert.ok(embed.description.includes('src/auth/login.ts'));
  });

  it('includes developer fields', () => {
    const fmt = new DiscordFormatter({ webhookUrl: WEBHOOK_URL, minSeverity: 'info' });
    const result = fmt.format(makePayload());
    const embed = (result.body as any).embeds[0];
    const names = embed.fields.map((f: any) => f.name);
    assert.ok(names.includes('Alice'));
    assert.ok(names.includes('Bob'));
  });

  it('includes repository field', () => {
    const fmt = new DiscordFormatter({ webhookUrl: WEBHOOK_URL, minSeverity: 'info' });
    const result = fmt.format(makePayload());
    const embed = (result.body as any).embeds[0];
    const repoField = embed.fields.find((f: any) => f.name === 'Repository');
    assert.ok(repoField);
    assert.equal(repoField.value, 'my-app');
  });

  it('includes timestamp', () => {
    const fmt = new DiscordFormatter({ webhookUrl: WEBHOOK_URL, minSeverity: 'info' });
    const result = fmt.format(makePayload());
    const embed = (result.body as any).embeds[0];
    assert.equal(embed.timestamp, '2026-03-03T10:00:00.000Z');
  });

  it('includes collision ID in footer', () => {
    const fmt = new DiscordFormatter({ webhookUrl: WEBHOOK_URL, minSeverity: 'info' });
    const result = fmt.format(makePayload());
    const embed = (result.body as any).embeds[0];
    assert.ok(embed.footer.text.includes('col-1'));
  });

  it('handles collision_resolved events', () => {
    const fmt = new DiscordFormatter({ webhookUrl: WEBHOOK_URL, minSeverity: 'info' });
    const result = fmt.format(makePayload({ type: 'collision_resolved' }));
    const embed = (result.body as any).embeds[0];
    assert.ok(embed.title.includes('Resolved'));
  });

  it('handles sessions with null intent', () => {
    const fmt = new DiscordFormatter({ webhookUrl: WEBHOOK_URL, minSeverity: 'info' });
    const result = fmt.format(makePayload({
      sessions: [
        { developer_name: 'Alice', developer_email: 'a@t.com', repo: 'r', intent: null },
      ],
    }));
    const embed = (result.body as any).embeds[0];
    const aliceField = embed.fields.find((f: any) => f.name === 'Alice');
    assert.ok(aliceField.value.includes('No intent declared'));
  });

  it('does not set custom headers', () => {
    const fmt = new DiscordFormatter({ webhookUrl: WEBHOOK_URL, minSeverity: 'info' });
    const result = fmt.format(makePayload());
    assert.equal(result.headers, undefined);
  });
});

describe('DiscordFormatter — shouldFire()', () => {
  it('fires for all severities when min is info', () => {
    const fmt = new DiscordFormatter({ webhookUrl: WEBHOOK_URL, minSeverity: 'info' });
    assert.ok(fmt.shouldFire(makePayload({ severity: 'info' })));
    assert.ok(fmt.shouldFire(makePayload({ severity: 'warning' })));
    assert.ok(fmt.shouldFire(makePayload({ severity: 'critical' })));
  });

  it('skips info when min is warning', () => {
    const fmt = new DiscordFormatter({ webhookUrl: WEBHOOK_URL, minSeverity: 'warning' });
    assert.ok(!fmt.shouldFire(makePayload({ severity: 'info' })));
    assert.ok(fmt.shouldFire(makePayload({ severity: 'warning' })));
    assert.ok(fmt.shouldFire(makePayload({ severity: 'critical' })));
  });

  it('only fires critical when min is critical', () => {
    const fmt = new DiscordFormatter({ webhookUrl: WEBHOOK_URL, minSeverity: 'critical' });
    assert.ok(!fmt.shouldFire(makePayload({ severity: 'info' })));
    assert.ok(!fmt.shouldFire(makePayload({ severity: 'warning' })));
    assert.ok(fmt.shouldFire(makePayload({ severity: 'critical' })));
  });
});

describe('DiscordFormatter — name', () => {
  it('has name "discord"', () => {
    const fmt = new DiscordFormatter({ webhookUrl: WEBHOOK_URL, minSeverity: 'info' });
    assert.equal(fmt.name, 'discord');
  });
});
```

## Step 6: Verify

```bash
npm run build && cd packages/backend && node --import tsx --test src/**/*.test.ts
```

All existing tests should still pass, plus the new Discord formatter tests.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DISCORD_WEBHOOK_URL` | — | Discord Webhook URL. Formatter only activates when set. |
| `DISCORD_MIN_SEVERITY` | `info` | Minimum severity to send to Discord (`info`, `warning`, `critical`). |

### Docker Compose Example

```yaml
services:
  backend:
    environment:
      DISCORD_WEBHOOK_URL: https://discord.com/api/webhooks/YOUR/WEBHOOK/URL
      DISCORD_MIN_SEVERITY: warning
```

The Discord formatter works alongside the generic webhook emitter and any other registered formatters (Slack, Teams, etc.). Each formatter fires independently based on its own configuration.

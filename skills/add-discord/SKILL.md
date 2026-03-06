---
name: add-discord
description: Add Discord webhook notifications for collision alerts
category: notification
port: IAlertSink
requires: []
modifies:
  - packages/backend/src/services/discord-alert-sink.ts
  - packages/backend/src/env.ts
  - packages/backend/src/server.ts
  - .env.example
tests:
  - packages/backend/src/services/discord-alert-sink.test.ts
---

# Add Discord Webhook Notifications

This skill adds Discord embed webhook notifications to Open Hive. When the collision engine detects that two developers are working on overlapping code, a richly-formatted Discord embed is posted to a channel of your choice.

## Prerequisites

1. The Open Hive backend source is cloned and dependencies are installed (`npm install` from the repo root).
2. The project builds cleanly (`npm run build`).
3. You have a **Discord Webhook URL**. Create one by:
   - In Discord, go to the channel > Edit Channel > Integrations > Webhooks
   - Click "New Webhook", name it "Open Hive", optionally set an avatar
   - Click "Copy Webhook URL"

## What This Skill Does

- Creates a `DiscordAlertSink` class that implements the `IAlertSink` port interface from `@open-hive/shared`.
- Transforms `AlertEvent` objects into Discord embed messages with color-coded severity, title, fields, and timestamp.
- Provides per-sink severity filtering via the `DISCORD_MIN_SEVERITY` environment variable.
- Registers the sink conditionally via `PortRegistry` -- only when `DISCORD_WEBHOOK_URL` is set.

## Step 1: Create the Discord Alert Sink

Create `packages/backend/src/services/discord-alert-sink.ts`:

```typescript
import type { IAlertSink, AlertEvent } from '@open-hive/shared';
import type { CollisionSeverity } from '@open-hive/shared';

export interface DiscordAlertSinkConfig {
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

export class DiscordAlertSink implements IAlertSink {
  readonly name = 'discord';

  constructor(private config: DiscordAlertSinkConfig) {}

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

    const fields = event.participants.map(p => ({
      name: p.developer_name,
      value: [
        p.developer_email,
        p.intent ? `Intent: _${p.intent}_` : '_No intent declared_',
      ].join('\n'),
      inline: true,
    }));

    if (event.participants.length > 0 && event.participants[0].repo) {
      fields.push({
        name: 'Repository',
        value: event.participants[0].repo,
        inline: true,
      });
    }

    const embed = {
      embeds: [
        {
          title,
          description: event.collision.details,
          color: EMBED_COLORS[event.severity],
          fields,
          footer: {
            text: `Collision ID: ${event.collision.collision_id}`,
          },
          timestamp: event.timestamp,
        },
      ],
      username: 'Open Hive',
    };

    await fetch(this.config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(embed),
    });
  }
}
```

## Step 2: Add Environment Configuration

In `packages/backend/src/env.ts`, add to the `loadConfig()` return object:

```typescript
import type { CollisionSeverity } from '@open-hive/shared';

// Add after the existing config:
...(process.env.DISCORD_WEBHOOK_URL
  ? {
      discord: {
        webhookUrl: process.env.DISCORD_WEBHOOK_URL,
        minSeverity: (process.env.DISCORD_MIN_SEVERITY as CollisionSeverity) ?? 'info',
      },
    }
  : {}),
```

## Step 3: Register the Sink via PortRegistry

After the `PortRegistry` is created in `packages/backend/src/server.ts`:

```typescript
import { DiscordAlertSink } from './services/discord-alert-sink.js';

if (process.env.DISCORD_WEBHOOK_URL) {
  registry.alerts.registerSink(
    new DiscordAlertSink({
      webhookUrl: process.env.DISCORD_WEBHOOK_URL,
      minSeverity: (process.env.DISCORD_MIN_SEVERITY as CollisionSeverity) ?? 'info',
    })
  );
}
```

## Step 4: Update .env.example

```bash
# Discord Notifications (optional)
# DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR/WEBHOOK/URL
# DISCORD_MIN_SEVERITY=info    # info | warning | critical
```

## Step 5: Add Tests

Create `packages/backend/src/services/discord-alert-sink.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DiscordAlertSink } from './discord-alert-sink.js';
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

const WEBHOOK_URL = 'https://discord.com/api/webhooks/123/abc';

describe('DiscordAlertSink — shouldFire()', () => {
  it('fires for all severities when min is info', () => {
    const sink = new DiscordAlertSink({ webhookUrl: WEBHOOK_URL, minSeverity: 'info' });
    assert.ok(sink.shouldFire(makeEvent({ severity: 'info' })));
    assert.ok(sink.shouldFire(makeEvent({ severity: 'warning' })));
    assert.ok(sink.shouldFire(makeEvent({ severity: 'critical' })));
  });

  it('skips info when min is warning', () => {
    const sink = new DiscordAlertSink({ webhookUrl: WEBHOOK_URL, minSeverity: 'warning' });
    assert.ok(!sink.shouldFire(makeEvent({ severity: 'info' })));
    assert.ok(sink.shouldFire(makeEvent({ severity: 'warning' })));
    assert.ok(sink.shouldFire(makeEvent({ severity: 'critical' })));
  });

  it('only fires critical when min is critical', () => {
    const sink = new DiscordAlertSink({ webhookUrl: WEBHOOK_URL, minSeverity: 'critical' });
    assert.ok(!sink.shouldFire(makeEvent({ severity: 'info' })));
    assert.ok(!sink.shouldFire(makeEvent({ severity: 'warning' })));
    assert.ok(sink.shouldFire(makeEvent({ severity: 'critical' })));
  });
});

describe('DiscordAlertSink — name', () => {
  it('has name "discord"', () => {
    const sink = new DiscordAlertSink({ webhookUrl: WEBHOOK_URL, minSeverity: 'info' });
    assert.equal(sink.name, 'discord');
  });
});
```

## Step 6: Verify

```bash
npm run build && cd packages/backend && node --import tsx --test src/**/*.test.ts
```

All existing tests should still pass, plus the new Discord alert sink tests.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DISCORD_WEBHOOK_URL` | -- | Discord Webhook URL. Sink only activates when set. |
| `DISCORD_MIN_SEVERITY` | `info` | Minimum severity to send to Discord (`info`, `warning`, `critical`). |

### Docker Compose Example

```yaml
services:
  backend:
    environment:
      DISCORD_WEBHOOK_URL: https://discord.com/api/webhooks/YOUR/WEBHOOK/URL
      DISCORD_MIN_SEVERITY: warning
```

The Discord alert sink works alongside any other registered `IAlertSink` implementations (generic webhooks, Slack, Teams, etc.). Each sink fires independently based on its own `shouldFire()` logic. The `AlertDispatcher` manages all sinks via the `PortRegistry`.

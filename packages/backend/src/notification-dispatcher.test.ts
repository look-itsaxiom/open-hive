import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { NotificationDispatcher } from './services/notification-dispatcher.js';
import type { WebhookPayload, NotificationFormatter } from './services/notification-dispatcher.js';
import type { Collision, CollisionSeverity } from '@open-hive/shared';

function createTestCollision(overrides?: Partial<Collision>): Collision {
  return {
    collision_id: 'col-1',
    session_ids: ['sess-a', 'sess-b'],
    type: 'file',
    severity: 'critical',
    details: 'Both sessions modifying src/auth.ts',
    detected_at: new Date().toISOString(),
    resolved: false,
    resolved_by: null,
    ...overrides,
  };
}

const testSessions = [
  { developer_name: 'Alice', developer_email: 'alice@test.com', repo: 'test-repo', intent: 'fix auth' },
  { developer_name: 'Bob', developer_email: 'bob@test.com', repo: 'test-repo', intent: 'update auth' },
];

// ─── Severity Filtering ────────────────────────────────────

describe('NotificationDispatcher — severity filtering', () => {
  it('fires webhooks for collisions at min severity', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: url as string, body: init?.body as string });
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    try {
      const dispatcher = new NotificationDispatcher(['https://hook.example.com/a'], 'warning');
      const collision = createTestCollision({ severity: 'warning' });

      await dispatcher.notify('collision_detected', collision, testSessions);
      // Give fire-and-forget a tick to execute
      await new Promise(r => setTimeout(r, 50));

      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'https://hook.example.com/a');
      const payload = JSON.parse(calls[0].body) as WebhookPayload;
      assert.equal(payload.type, 'collision_detected');
      assert.equal(payload.severity, 'warning');
      assert.equal(payload.collision.collision_id, 'col-1');
      assert.equal(payload.sessions.length, 2);
      assert.ok(payload.timestamp);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fires webhooks for collisions above min severity', async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async (url: string | URL | Request) => {
      calls.push(url as string);
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    try {
      const dispatcher = new NotificationDispatcher(['https://hook.example.com/a'], 'warning');
      const collision = createTestCollision({ severity: 'critical' });

      await dispatcher.notify('collision_detected', collision, testSessions);
      await new Promise(r => setTimeout(r, 50));

      assert.equal(calls.length, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('skips collisions below min severity', async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async (url: string | URL | Request) => {
      calls.push(url as string);
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    try {
      const dispatcher = new NotificationDispatcher(['https://hook.example.com/a'], 'warning');
      const collision = createTestCollision({ severity: 'info' });

      await dispatcher.notify('collision_detected', collision, testSessions);
      await new Promise(r => setTimeout(r, 50));

      assert.equal(calls.length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fires for all severities when min is info', async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async (url: string | URL | Request) => {
      calls.push(url as string);
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    try {
      const dispatcher = new NotificationDispatcher(['https://hook.example.com/a'], 'info');

      await dispatcher.notify('collision_detected', createTestCollision({ severity: 'info' }), testSessions);
      await dispatcher.notify('collision_detected', createTestCollision({ severity: 'warning' }), testSessions);
      await dispatcher.notify('collision_detected', createTestCollision({ severity: 'critical' }), testSessions);
      await new Promise(r => setTimeout(r, 50));

      assert.equal(calls.length, 3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('only fires for critical when min is critical', async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async (url: string | URL | Request) => {
      calls.push(url as string);
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    try {
      const dispatcher = new NotificationDispatcher(['https://hook.example.com/a'], 'critical');

      await dispatcher.notify('collision_detected', createTestCollision({ severity: 'info' }), testSessions);
      await dispatcher.notify('collision_detected', createTestCollision({ severity: 'warning' }), testSessions);
      await dispatcher.notify('collision_detected', createTestCollision({ severity: 'critical' }), testSessions);
      await new Promise(r => setTimeout(r, 50));

      assert.equal(calls.length, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ─── Multiple Webhook URLs ──────────────────────────────────

describe('NotificationDispatcher — multiple webhook URLs', () => {
  it('fires to all configured webhook URLs', async () => {
    const calledUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async (url: string | URL | Request) => {
      calledUrls.push(url as string);
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    try {
      const dispatcher = new NotificationDispatcher([
        'https://hook.example.com/a',
        'https://hook.example.com/b',
        'https://hook.example.com/c',
      ]);
      const collision = createTestCollision();

      await dispatcher.notify('collision_detected', collision, testSessions);
      await new Promise(r => setTimeout(r, 50));

      assert.equal(calledUrls.length, 3);
      assert.ok(calledUrls.includes('https://hook.example.com/a'));
      assert.ok(calledUrls.includes('https://hook.example.com/b'));
      assert.ok(calledUrls.includes('https://hook.example.com/c'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fires nothing when no URLs configured and no formatters', async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async (url: string | URL | Request) => {
      calls.push(url as string);
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    try {
      const dispatcher = new NotificationDispatcher([]);
      await dispatcher.notify('collision_detected', createTestCollision(), testSessions);
      await new Promise(r => setTimeout(r, 50));

      assert.equal(calls.length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ─── Formatters ────────────────────────────────────────────

describe('NotificationDispatcher — formatters', () => {
  it('calls registered formatters with correct payload', async () => {
    const receivedPayloads: WebhookPayload[] = [];
    const calledUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async (url: string | URL | Request) => {
      calledUrls.push(url as string);
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    try {
      const formatter: NotificationFormatter = {
        name: 'slack',
        shouldFire: () => true,
        format(payload) {
          receivedPayloads.push(payload);
          return {
            url: 'https://hooks.slack.com/services/xxx',
            body: { text: `Collision: ${payload.collision.details}` },
            headers: { 'X-Custom': 'slack' },
          };
        },
      };

      const dispatcher = new NotificationDispatcher([]);
      dispatcher.registerFormatter(formatter);

      const collision = createTestCollision();
      await dispatcher.notify('collision_detected', collision, testSessions);
      await new Promise(r => setTimeout(r, 50));

      assert.equal(receivedPayloads.length, 1);
      assert.equal(receivedPayloads[0].type, 'collision_detected');
      assert.equal(receivedPayloads[0].collision.collision_id, 'col-1');
      assert.equal(receivedPayloads[0].sessions.length, 2);
      assert.equal(calledUrls.length, 1);
      assert.equal(calledUrls[0], 'https://hooks.slack.com/services/xxx');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('formatter shouldFire filtering works — skips formatter when shouldFire returns false', async () => {
    const calledUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async (url: string | URL | Request) => {
      calledUrls.push(url as string);
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    try {
      const criticalOnlyFormatter: NotificationFormatter = {
        name: 'pagerduty',
        shouldFire: (payload) => payload.severity === 'critical',
        format(payload) {
          return {
            url: 'https://events.pagerduty.com/v2/enqueue',
            body: { routing_key: 'xxx', event_action: 'trigger' },
          };
        },
      };

      const dispatcher = new NotificationDispatcher([]);
      dispatcher.registerFormatter(criticalOnlyFormatter);

      // Warning — should NOT fire
      await dispatcher.notify('collision_detected', createTestCollision({ severity: 'warning' }), testSessions);
      await new Promise(r => setTimeout(r, 50));
      assert.equal(calledUrls.length, 0);

      // Critical — should fire
      await dispatcher.notify('collision_detected', createTestCollision({ severity: 'critical' }), testSessions);
      await new Promise(r => setTimeout(r, 50));
      assert.equal(calledUrls.length, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fires both generic webhooks and formatter webhooks', async () => {
    const calledUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async (url: string | URL | Request) => {
      calledUrls.push(url as string);
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    try {
      const formatter: NotificationFormatter = {
        name: 'discord',
        shouldFire: () => true,
        format() {
          return { url: 'https://discord.com/api/webhooks/xxx', body: { content: 'collision' } };
        },
      };

      const dispatcher = new NotificationDispatcher(['https://generic.example.com/hook']);
      dispatcher.registerFormatter(formatter);

      await dispatcher.notify('collision_detected', createTestCollision(), testSessions);
      await new Promise(r => setTimeout(r, 50));

      assert.equal(calledUrls.length, 2);
      assert.ok(calledUrls.includes('https://generic.example.com/hook'));
      assert.ok(calledUrls.includes('https://discord.com/api/webhooks/xxx'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ─── Fire-and-forget Error Handling ───────────────────────

describe('NotificationDispatcher — fire-and-forget error handling', () => {
  it('failed webhooks do not throw', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => {
      throw new Error('Network error');
    }) as typeof fetch;

    try {
      const dispatcher = new NotificationDispatcher(['https://hook.example.com/a']);

      // This should not throw
      await dispatcher.notify('collision_detected', createTestCollision(), testSessions);
      await new Promise(r => setTimeout(r, 50));

      // If we get here, the test passes — no error was thrown
      assert.ok(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('partial webhook failures do not block other webhooks', async () => {
    let callCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async (url: string | URL | Request) => {
      callCount++;
      if ((url as string).includes('fail')) {
        throw new Error('Network error');
      }
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    try {
      const dispatcher = new NotificationDispatcher([
        'https://hook.example.com/fail',
        'https://hook.example.com/success',
      ]);

      await dispatcher.notify('collision_detected', createTestCollision(), testSessions);
      await new Promise(r => setTimeout(r, 50));

      // Both URLs should have been attempted
      assert.equal(callCount, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ─── Payload Structure ──────────────────────────────────────

describe('NotificationDispatcher — payload structure', () => {
  it('includes correct type for collision_resolved events', async () => {
    const bodies: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(init?.body as string);
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    try {
      const dispatcher = new NotificationDispatcher(['https://hook.example.com/a']);
      const collision = createTestCollision();

      await dispatcher.notify('collision_resolved', collision, testSessions);
      await new Promise(r => setTimeout(r, 50));

      assert.equal(bodies.length, 1);
      const payload = JSON.parse(bodies[0]) as WebhookPayload;
      assert.equal(payload.type, 'collision_resolved');
      assert.equal(payload.severity, 'critical');
      assert.deepEqual(payload.collision.session_ids, ['sess-a', 'sess-b']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('sends Content-Type application/json header', async () => {
    const capturedHeaders: Array<Record<string, string>> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders.push(Object.fromEntries(
        Object.entries(init?.headers ?? {})
      ));
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    try {
      const dispatcher = new NotificationDispatcher(['https://hook.example.com/a']);
      await dispatcher.notify('collision_detected', createTestCollision(), testSessions);
      await new Promise(r => setTimeout(r, 50));

      assert.equal(capturedHeaders.length, 1);
      assert.equal(capturedHeaders[0]['Content-Type'], 'application/json');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

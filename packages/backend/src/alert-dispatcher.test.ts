import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AlertDispatcher } from './services/alert-dispatcher.js';
import { GenericWebhookSink } from './services/generic-webhook-sink.js';
import type { IAlertSink, AlertEvent, Collision } from '@open-hive/shared';

function createTestEvent(overrides?: Partial<AlertEvent>): AlertEvent {
  const collision: Collision = {
    collision_id: 'col-1',
    session_ids: ['sess-a', 'sess-b'],
    type: 'file',
    severity: 'critical',
    details: 'Both sessions modifying src/auth.ts',
    detected_at: new Date().toISOString(),
    resolved: false,
    resolved_by: null,
  };

  return {
    type: 'collision_detected',
    severity: 'critical',
    collision,
    participants: [
      { developer_name: 'Alice', developer_email: 'alice@test.com', repo: 'test-repo', intent: 'fix auth' },
      { developer_name: 'Bob', developer_email: 'bob@test.com', repo: 'test-repo', intent: 'update auth' },
    ],
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ─── AlertDispatcher ─────────────────────────────────────────

describe('AlertDispatcher', () => {
  it('dispatches to registered sinks that accept the event', async () => {
    const delivered: AlertEvent[] = [];
    const sink: IAlertSink = {
      name: 'test',
      shouldFire: () => true,
      deliver: async (event) => { delivered.push(event); },
    };

    const dispatcher = new AlertDispatcher();
    dispatcher.registerSink(sink);

    const event = createTestEvent();
    await dispatcher.dispatch(event);
    await new Promise(r => setTimeout(r, 50));

    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].type, 'collision_detected');
  });

  it('skips sinks that reject the event via shouldFire', async () => {
    const delivered: AlertEvent[] = [];
    const sink: IAlertSink = {
      name: 'critical-only',
      shouldFire: (event) => event.severity === 'critical',
      deliver: async (event) => { delivered.push(event); },
    };

    const dispatcher = new AlertDispatcher();
    dispatcher.registerSink(sink);

    await dispatcher.dispatch(createTestEvent({ severity: 'info' }));
    await new Promise(r => setTimeout(r, 50));

    assert.equal(delivered.length, 0);
  });

  it('dispatches to multiple sinks', async () => {
    const names: string[] = [];
    const sinkA: IAlertSink = {
      name: 'sink-a',
      shouldFire: () => true,
      deliver: async () => { names.push('a'); },
    };
    const sinkB: IAlertSink = {
      name: 'sink-b',
      shouldFire: () => true,
      deliver: async () => { names.push('b'); },
    };

    const dispatcher = new AlertDispatcher();
    dispatcher.registerSink(sinkA);
    dispatcher.registerSink(sinkB);

    await dispatcher.dispatch(createTestEvent());
    await new Promise(r => setTimeout(r, 50));

    assert.equal(names.length, 2);
    assert.ok(names.includes('a'));
    assert.ok(names.includes('b'));
  });

  it('does not throw when sink delivery fails', async () => {
    const sink: IAlertSink = {
      name: 'failing',
      shouldFire: () => true,
      deliver: async () => { throw new Error('Delivery failed'); },
    };

    const dispatcher = new AlertDispatcher();
    dispatcher.registerSink(sink);

    // Should not throw
    await dispatcher.dispatch(createTestEvent());
    await new Promise(r => setTimeout(r, 50));

    assert.ok(true);
  });

  it('does nothing when no sinks registered', async () => {
    const dispatcher = new AlertDispatcher();
    // Should not throw
    await dispatcher.dispatch(createTestEvent());
    assert.ok(true);
  });
});

// ─── GenericWebhookSink ──────────────────────────────────────

describe('GenericWebhookSink', () => {
  it('fires for events at or above min severity', () => {
    const sink = new GenericWebhookSink('https://hook.example.com', 'warning');

    assert.equal(sink.shouldFire(createTestEvent({ severity: 'info' })), false);
    assert.equal(sink.shouldFire(createTestEvent({ severity: 'warning' })), true);
    assert.equal(sink.shouldFire(createTestEvent({ severity: 'critical' })), true);
  });

  it('fires for all severities when min is info', () => {
    const sink = new GenericWebhookSink('https://hook.example.com', 'info');

    assert.equal(sink.shouldFire(createTestEvent({ severity: 'info' })), true);
    assert.equal(sink.shouldFire(createTestEvent({ severity: 'warning' })), true);
    assert.equal(sink.shouldFire(createTestEvent({ severity: 'critical' })), true);
  });

  it('only fires for critical when min is critical', () => {
    const sink = new GenericWebhookSink('https://hook.example.com', 'critical');

    assert.equal(sink.shouldFire(createTestEvent({ severity: 'info' })), false);
    assert.equal(sink.shouldFire(createTestEvent({ severity: 'warning' })), false);
    assert.equal(sink.shouldFire(createTestEvent({ severity: 'critical' })), true);
  });

  it('POSTs JSON to configured URL', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: url as string, body: init?.body as string });
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    try {
      const sink = new GenericWebhookSink('https://hook.example.com/test');
      const event = createTestEvent();
      await sink.deliver(event);

      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'https://hook.example.com/test');

      const payload = JSON.parse(calls[0].body) as AlertEvent;
      assert.equal(payload.type, 'collision_detected');
      assert.equal(payload.severity, 'critical');
      assert.equal(payload.participants.length, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('swallows fetch errors silently', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('Network error');
    }) as typeof fetch;

    try {
      const sink = new GenericWebhookSink('https://hook.example.com/test');
      // Should not throw
      await sink.deliver(createTestEvent());
      assert.ok(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('has correct name property', () => {
    const sink = new GenericWebhookSink('https://hook.example.com');
    assert.equal(sink.name, 'generic-webhook');
  });
});

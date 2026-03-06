import type { IAlertSink, AlertEvent } from '@open-hive/shared';

/**
 * Dispatches AlertEvents to registered IAlertSink adapters.
 * All delivery is fire-and-forget — errors are swallowed.
 */
export class AlertDispatcher {
  private sinks: IAlertSink[] = [];

  registerSink(sink: IAlertSink): void {
    this.sinks.push(sink);
  }

  async dispatch(event: AlertEvent): Promise<void> {
    const eligible = this.sinks.filter(s => s.shouldFire(event));
    if (eligible.length === 0) return;

    // Fire-and-forget — don't await, don't block callers
    Promise.allSettled(
      eligible.map(s => s.deliver(event))
    ).catch(() => {});
  }
}

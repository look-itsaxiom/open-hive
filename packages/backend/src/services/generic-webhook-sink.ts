import type { IAlertSink, AlertEvent, CollisionSeverity } from '@open-hive/shared';

const SEVERITY_LEVELS: CollisionSeverity[] = ['info', 'warning', 'critical'];

/**
 * Generic webhook sink — POSTs the AlertEvent as JSON to a configured URL.
 * Supports severity-based filtering via minSeverity.
 */
export class GenericWebhookSink implements IAlertSink {
  readonly name = 'generic-webhook';
  private url: string;
  private minSeverity: CollisionSeverity;

  constructor(url: string, minSeverity: CollisionSeverity = 'info') {
    this.url = url;
    this.minSeverity = minSeverity;
  }

  shouldFire(event: AlertEvent): boolean {
    return SEVERITY_LEVELS.indexOf(event.severity) >= SEVERITY_LEVELS.indexOf(this.minSeverity);
  }

  async deliver(event: AlertEvent): Promise<void> {
    try {
      await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Fire-and-forget — swallow errors
    }
  }
}

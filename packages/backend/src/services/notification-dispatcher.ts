import type { Collision, Session, CollisionSeverity } from '@open-hive/shared';

export interface WebhookPayload {
  type: 'collision_detected' | 'collision_resolved';
  severity: CollisionSeverity;
  collision: Collision;
  sessions: Pick<Session, 'developer_name' | 'developer_email' | 'repo' | 'intent'>[];
  timestamp: string;
}

export interface NotificationFormatter {
  name: string;
  format(payload: WebhookPayload): { url: string; body: unknown; headers?: Record<string, string> };
  shouldFire(payload: WebhookPayload): boolean;
}

export class NotificationDispatcher {
  private formatters: NotificationFormatter[] = [];
  private webhookUrls: string[];
  private minSeverity: CollisionSeverity;

  constructor(webhookUrls: string[], minSeverity: CollisionSeverity = 'info') {
    this.webhookUrls = webhookUrls;
    this.minSeverity = minSeverity;
  }

  registerFormatter(formatter: NotificationFormatter): void {
    this.formatters.push(formatter);
  }

  async notify(
    type: 'collision_detected' | 'collision_resolved',
    collision: Collision,
    sessions: Pick<Session, 'developer_name' | 'developer_email' | 'repo' | 'intent'>[],
  ): Promise<void> {
    if (!this.shouldNotify(collision.severity)) return;

    const payload: WebhookPayload = {
      type,
      severity: collision.severity,
      collision,
      sessions,
      timestamp: new Date().toISOString(),
    };

    // Fire generic webhooks (raw JSON POST to configured URLs)
    const genericPromises = this.webhookUrls.map(url => this.fireWebhook(url, payload));

    // Fire formatter-specific webhooks
    const formatterPromises = this.formatters
      .filter(f => f.shouldFire(payload))
      .map(f => {
        const formatted = f.format(payload);
        return this.fireWebhook(formatted.url, formatted.body, formatted.headers);
      });

    // Fire-and-forget — don't await, don't block
    Promise.allSettled([...genericPromises, ...formatterPromises]).catch(() => {});
  }

  private shouldNotify(severity: CollisionSeverity): boolean {
    const levels: CollisionSeverity[] = ['info', 'warning', 'critical'];
    return levels.indexOf(severity) >= levels.indexOf(this.minSeverity);
  }

  private async fireWebhook(url: string, body: unknown, headers?: Record<string, string>): Promise<void> {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Fire-and-forget — swallow errors
    }
  }
}

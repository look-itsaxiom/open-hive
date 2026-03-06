import { dirname } from 'node:path';
import type { IHiveStore, ISemanticAnalyzer, HistoricalIntent, CollisionSeverity } from '@open-hive/shared';
import type { Collision, HiveBackendConfig } from '@open-hive/shared';

const TIER_ORDER: Record<string, number> = { L3a: 0, L3b: 1, L3c: 2 };

export class CollisionEngine {
  constructor(
    private store: IHiveStore,
    private config: HiveBackendConfig,
    private analyzers: ISemanticAnalyzer[] = [],
  ) {
    // Sort analyzers by tier order once at construction time
    this.analyzers = [...this.analyzers].sort(
      (a, b) => (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99),
    );
  }

  private tierSeverity(tier: 'L3a' | 'L3b' | 'L3c'): CollisionSeverity {
    return tier === 'L3a' ? 'info' : 'warning';
  }

  async checkFileCollision(session_id: string, file_path: string, repo: string): Promise<Collision[]> {
    const activeSessions = await this.store.getActiveSessions(
      this.config.collision.scope === 'repo' ? repo : undefined
    );
    const others = activeSessions.filter(s => s.session_id !== session_id);
    const existing = await this.store.getActiveCollisions();
    const collisions: Collision[] = [];

    for (const other of others) {
      const pairIds = [session_id, other.session_id].sort();

      // L1: Exact file match
      if (other.files_touched.includes(file_path)) {
        const alreadyExists = existing.some(
          c => c.type === 'file' &&
               c.session_ids.sort().join(',') === pairIds.join(',') &&
               c.details.includes(file_path)
        );
        if (!alreadyExists) {
          const collision = await this.store.createCollision({
            session_ids: pairIds,
            type: 'file',
            severity: 'critical',
            details: `Both sessions modifying ${file_path} in ${repo}`,
            detected_at: new Date().toISOString(),
          });
          collisions.push(collision);
        } else {
          collisions.push(...existing.filter(
            c => c.type === 'file' && c.details.includes(file_path) &&
                 c.session_ids.sort().join(',') === pairIds.join(',')
          ));
        }
        continue;
      }

      // L2: Same directory
      const dir = dirname(file_path);
      const otherDirs = other.files_touched.map(f => dirname(f));
      if (otherDirs.includes(dir)) {
        const alreadyExists = existing.some(
          c => c.type === 'directory' &&
               c.session_ids.sort().join(',') === pairIds.join(',') &&
               c.details.includes(dir)
        );
        if (!alreadyExists) {
          const collision = await this.store.createCollision({
            session_ids: pairIds,
            type: 'directory',
            severity: 'warning',
            details: `Both sessions working in ${dir}/ in ${repo}`,
            detected_at: new Date().toISOString(),
          });
          collisions.push(collision);
        }
      }
    }

    return collisions;
  }

  async checkIntentCollision(session_id: string, intent: string, repo: string): Promise<Collision[]> {
    if (this.analyzers.length === 0) return [];

    const activeSessions = await this.store.getActiveSessions(
      this.config.collision.scope === 'repo' ? repo : undefined
    );
    const others = activeSessions.filter(s => s.session_id !== session_id && s.intent);
    const collisions: Collision[] = [];

    for (const other of others) {
      // Run analyzers in tier order; first match wins per pair
      for (const analyzer of this.analyzers) {
        const match = await analyzer.compare(intent, other.intent!);
        if (!match) continue;

        const collision = await this.store.createCollision({
          session_ids: [session_id, other.session_id],
          type: 'semantic',
          severity: this.tierSeverity(match.tier),
          details: `[${match.tier}] Possible overlap: "${truncate(intent, 60)}" vs "${truncate(other.intent!, 60)}" (${analyzer.name}, score: ${match.score.toFixed(2)})`,
          detected_at: new Date().toISOString(),
        });
        collisions.push(collision);
        break; // first match wins
      }
    }

    return collisions;
  }

  async checkHistoricalIntentCollision(session_id: string, intent: string, repo: string): Promise<Collision[]> {
    if (this.analyzers.length === 0) return [];

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentIntents = await this.store.getRecentIntents({
      repo: this.config.collision.scope === 'repo' ? repo : undefined,
      exclude_session_id: session_id,
      since,
      limit: 200,
    });

    if (recentIntents.length === 0) return [];

    // Deduplicate by session — keep only the most recent intent per session
    const bySession = new Map<string, HistoricalIntent>();
    for (const hi of recentIntents) {
      if (!bySession.has(hi.session_id)) {
        bySession.set(hi.session_id, hi);
      }
    }

    // Filter out sessions that are still active (those are handled by checkIntentCollision)
    const activeSessions = await this.store.getActiveSessions(
      this.config.collision.scope === 'repo' ? repo : undefined
    );
    const activeIds = new Set(activeSessions.map(s => s.session_id));

    const collisions: Collision[] = [];

    for (const [otherSessionId, hi] of bySession) {
      if (activeIds.has(otherSessionId)) continue; // skip active — already checked by checkIntentCollision

      // Run analyzers in tier order; first match wins per pair
      for (const analyzer of this.analyzers) {
        const match = await analyzer.compare(intent, hi.intent);
        if (!match) continue;

        const collision = await this.store.createCollision({
          session_ids: [session_id, otherSessionId],
          type: 'semantic',
          severity: 'warning',
          details: `[${match.tier}] Historical overlap: "${truncate(intent, 60)}" vs "${truncate(hi.intent, 60)}" (${hi.developer_name}, ${timeSince(hi.timestamp)} ago, ${analyzer.name}, score: ${match.score.toFixed(2)})`,
          detected_at: new Date().toISOString(),
        });
        collisions.push(collision);
        break; // first match wins
      }
    }

    return collisions;
  }
}

function timeSince(isoTimestamp: string): string {
  const diff = Date.now() - new Date(isoTimestamp).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return '<1h';
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function truncate(s: string, len: number): string {
  return s.length > len ? s.slice(0, len) + '...' : s;
}

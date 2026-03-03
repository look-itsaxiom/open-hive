import { dirname } from 'node:path';
import type { IHiveStore } from '../db/store.js';
import type { Collision, HiveBackendConfig } from '@open-hive/shared';

export class CollisionEngine {
  constructor(
    private store: IHiveStore,
    private config: HiveBackendConfig,
  ) {}

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
    if (!this.config.collision.semantic.keywords_enabled) return [];

    const activeSessions = await this.store.getActiveSessions(
      this.config.collision.scope === 'repo' ? repo : undefined
    );
    const others = activeSessions.filter(s => s.session_id !== session_id && s.intent);
    const collisions: Collision[] = [];

    for (const other of others) {
      const score = keywordOverlap(intent, other.intent!);
      if (score < 0.3) continue;

      const collision = await this.store.createCollision({
        session_ids: [session_id, other.session_id],
        type: 'semantic',
        severity: 'info',
        details: `Possible overlap: "${truncate(intent, 60)}" vs "${truncate(other.intent!, 60)}" (score: ${score.toFixed(2)})`,
        detected_at: new Date().toISOString(),
      });
      collisions.push(collision);
    }

    return collisions;
  }
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either',
  'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than',
  'too', 'very', 'just', 'because', 'if', 'when', 'while', 'this',
  'that', 'these', 'those', 'i', 'me', 'my', 'we', 'our', 'you',
  'your', 'he', 'him', 'his', 'she', 'her', 'it', 'its', 'they',
  'them', 'their', 'what', 'which', 'who', 'whom', 'how', 'where',
  'fix', 'add', 'update', 'change', 'make', 'get', 'set', 'use',
  'implement', 'create', 'remove', 'delete', 'refactor', 'improve',
]);

function extractKeywords(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s-_]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
  );
}

function keywordOverlap(a: string, b: string): number {
  const ka = extractKeywords(a);
  const kb = extractKeywords(b);
  if (ka.size === 0 || kb.size === 0) return 0;
  const intersection = new Set([...ka].filter(k => kb.has(k)));
  const union = new Set([...ka, ...kb]);
  return intersection.size / union.size;
}

function truncate(s: string, len: number): string {
  return s.length > len ? s.slice(0, len) + '...' : s;
}

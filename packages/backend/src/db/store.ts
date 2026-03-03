import { eq, and, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import type {
  Session, Signal, Collision, CollisionSeverity, CollisionType,
  SignalType, SessionStatus,
} from '@open-hive/shared';

type DB = BetterSQLite3Database<typeof schema>;

export class HiveStore {
  constructor(private db: DB) {}

  // --- Sessions ---

  async createSession(s: Omit<Session, 'last_activity' | 'status' | 'files_touched' | 'areas'>): Promise<Session> {
    const now = new Date().toISOString();
    const session: typeof schema.sessions.$inferInsert = {
      ...s,
      last_activity: now,
      status: 'active',
      files_touched: '[]',
      areas: '[]',
    };
    this.db.insert(schema.sessions).values(session).run();
    return this.getSession(s.session_id) as Promise<Session>;
  }

  async getSession(session_id: string): Promise<Session | null> {
    const row = this.db.select().from(schema.sessions)
      .where(eq(schema.sessions.session_id, session_id))
      .get();
    return row ? this.rowToSession(row) : null;
  }

  async getActiveSessions(repo?: string): Promise<Session[]> {
    const conditions = [eq(schema.sessions.status, 'active')];
    if (repo) conditions.push(eq(schema.sessions.repo, repo));
    const rows = this.db.select().from(schema.sessions)
      .where(and(...conditions))
      .all();
    return rows.map(r => this.rowToSession(r));
  }

  async updateSessionActivity(session_id: string, updates: {
    intent?: string;
    files_touched?: string[];
    areas?: string[];
  }): Promise<void> {
    const existing = await this.getSession(session_id);
    if (!existing) return;

    const merged_files = [...new Set([...existing.files_touched, ...(updates.files_touched ?? [])])];
    const merged_areas = [...new Set([...existing.areas, ...(updates.areas ?? [])])];

    this.db.update(schema.sessions)
      .set({
        last_activity: new Date().toISOString(),
        intent: updates.intent ?? existing.intent,
        files_touched: JSON.stringify(merged_files),
        areas: JSON.stringify(merged_areas),
      })
      .where(eq(schema.sessions.session_id, session_id))
      .run();
  }

  async endSession(session_id: string): Promise<void> {
    this.db.update(schema.sessions)
      .set({ status: 'ended', last_activity: new Date().toISOString() })
      .where(eq(schema.sessions.session_id, session_id))
      .run();
  }

  // --- Signals ---

  async createSignal(s: Omit<Signal, 'signal_id'>): Promise<Signal> {
    const signal_id = nanoid();
    this.db.insert(schema.signals).values({ ...s, signal_id }).run();
    return { ...s, signal_id };
  }

  async getRecentSignals(opts: {
    repo?: string; file_path?: string; area?: string; since?: string; limit?: number;
  }): Promise<Signal[]> {
    const rows = this.db.select({
      signal: schema.signals,
    }).from(schema.signals)
      .innerJoin(schema.sessions, eq(schema.signals.session_id, schema.sessions.session_id))
      .orderBy(desc(schema.signals.timestamp))
      .limit(opts.limit ?? 50)
      .all();

    return rows
      .map(r => r.signal as Signal)
      .filter(s => {
        if (opts.file_path && s.file_path !== opts.file_path) return false;
        if (opts.area && s.file_path && !s.file_path.startsWith(opts.area)) return false;
        if (opts.since && s.timestamp < opts.since) return false;
        return true;
      });
  }

  // --- Collisions ---

  async createCollision(c: Omit<Collision, 'collision_id' | 'resolved' | 'resolved_by'>): Promise<Collision> {
    const collision_id = nanoid();
    this.db.insert(schema.collisions).values({
      collision_id,
      session_ids: JSON.stringify(c.session_ids),
      type: c.type,
      severity: c.severity,
      details: c.details,
      detected_at: c.detected_at,
      resolved: false,
      resolved_by: null,
    }).run();
    return { ...c, collision_id, resolved: false, resolved_by: null };
  }

  async getActiveCollisions(session_id?: string): Promise<Collision[]> {
    const rows = this.db.select().from(schema.collisions)
      .where(eq(schema.collisions.resolved, false))
      .all();
    return rows
      .map(r => this.rowToCollision(r))
      .filter(c => !session_id || c.session_ids.includes(session_id));
  }

  async resolveCollision(collision_id: string, resolved_by: string): Promise<void> {
    this.db.update(schema.collisions)
      .set({ resolved: true, resolved_by })
      .where(eq(schema.collisions.collision_id, collision_id))
      .run();
  }

  // --- Helpers ---

  private rowToSession(row: typeof schema.sessions.$inferSelect): Session {
    return {
      ...row,
      status: row.status as SessionStatus,
      files_touched: JSON.parse(row.files_touched),
      areas: JSON.parse(row.areas),
    };
  }

  private rowToCollision(row: typeof schema.collisions.$inferSelect): Collision {
    return {
      ...row,
      session_ids: JSON.parse(row.session_ids),
      type: row.type as CollisionType,
      severity: row.severity as CollisionSeverity,
    };
  }
}

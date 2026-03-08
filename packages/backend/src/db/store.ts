import type { DatabaseSync } from 'node:sqlite';
import { nanoid } from 'nanoid';
import type {
  Session, Signal, Collision, CollisionSeverity, CollisionType,
  SignalType, SessionStatus, AgentMail, AgentMailType,
  AgentCard, Nerve, INerveRegistry,
  IHiveStore, HistoricalIntent,
} from '@open-hive/shared';

export type { IHiveStore, HistoricalIntent, INerveRegistry } from '@open-hive/shared';

interface SessionRow {
  session_id: string;
  developer_email: string;
  developer_name: string;
  repo: string;
  project_path: string;
  started_at: string;
  last_activity: string;
  status: string;
  intent: string | null;
  files_touched: string;
  areas: string;
}

interface SignalRow {
  signal_id: string;
  session_id: string;
  timestamp: string;
  type: string;
  content: string;
  file_path: string | null;
  semantic_area: string | null;
  weight: number;
}

interface CollisionRow {
  collision_id: string;
  session_ids: string;
  type: string;
  severity: string;
  details: string;
  detected_at: string;
  resolved: number;
  resolved_by: string | null;
}

interface MailRow {
  mail_id: string;
  from_session_id: string | null;
  to_session_id: string | null;
  to_developer_email: string | null;
  to_context_id: string | null;
  type: string;
  subject: string;
  content: string;
  created_at: string;
  read_at: string | null;
  weight: number;
}

interface NerveRow {
  nerve_id: string;
  agent_id: string;
  nerve_type: string;
  agent_card: string;  // JSON blob
  created_at: string;
  last_seen: string;
  status: string;
}

const MAX_TRACKED_ENTRIES = 200;

export class HiveStore implements IHiveStore, INerveRegistry {
  readonly name = 'sqlite';
  constructor(private db: DatabaseSync) {}

  // --- Sessions ---

  async createSession(s: Omit<Session, 'last_activity' | 'status' | 'files_touched' | 'areas'>): Promise<Session> {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      `INSERT INTO sessions (session_id, developer_email, developer_name, repo, project_path, started_at, last_activity, status, intent, files_touched, areas)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, '[]', '[]')`
    );
    stmt.run(s.session_id, s.developer_email, s.developer_name, s.repo, s.project_path, s.started_at, now, s.intent ?? null);
    return this.getSession(s.session_id) as Promise<Session>;
  }

  async getSession(session_id: string): Promise<Session | null> {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE session_id = ?');
    const row = stmt.get(session_id) as unknown as SessionRow | undefined;
    return row ? this.rowToSession(row) : null;
  }

  async getActiveSessions(repo?: string): Promise<Session[]> {
    let rows: SessionRow[];
    if (repo) {
      const stmt = this.db.prepare('SELECT * FROM sessions WHERE status = ? AND repo = ?');
      rows = stmt.all('active', repo) as unknown as SessionRow[];
    } else {
      const stmt = this.db.prepare('SELECT * FROM sessions WHERE status = ?');
      rows = stmt.all('active') as unknown as SessionRow[];
    }
    return rows.map(r => this.rowToSession(r));
  }

  async updateSessionActivity(session_id: string, updates: {
    intent?: string;
    files_touched?: string[];
    areas?: string[];
  }): Promise<void> {
    const existing = await this.getSession(session_id);
    if (!existing) return;

    const merged_files = [...new Set([...existing.files_touched, ...(updates.files_touched ?? [])])].slice(-MAX_TRACKED_ENTRIES);
    const merged_areas = [...new Set([...existing.areas, ...(updates.areas ?? [])])].slice(-MAX_TRACKED_ENTRIES);

    const stmt = this.db.prepare(
      `UPDATE sessions SET last_activity = ?, intent = ?, files_touched = ?, areas = ? WHERE session_id = ?`
    );
    stmt.run(
      new Date().toISOString(),
      updates.intent ?? existing.intent ?? null,
      JSON.stringify(merged_files),
      JSON.stringify(merged_areas),
      session_id,
    );
  }

  async endSession(session_id: string): Promise<void> {
    const stmt = this.db.prepare(
      `UPDATE sessions SET status = 'ended', last_activity = ? WHERE session_id = ?`
    );
    stmt.run(new Date().toISOString(), session_id);
  }

  async cleanupStaleSessions(idle_timeout_seconds: number): Promise<string[]> {
    const cutoff = new Date(Date.now() - idle_timeout_seconds * 1000).toISOString();
    const selectStmt = this.db.prepare(
      `SELECT session_id FROM sessions WHERE status = 'active' AND last_activity < ?`
    );
    const staleRows = selectStmt.all(cutoff) as unknown as Array<{ session_id: string }>;
    const staleIds = staleRows.map(r => r.session_id);

    if (staleIds.length > 0) {
      const updateStmt = this.db.prepare(
        `UPDATE sessions SET status = 'ended' WHERE status = 'active' AND last_activity < ?`
      );
      updateStmt.run(cutoff);
    }

    return staleIds;
  }

  // --- Signals ---

  async createSignal(s: Omit<Signal, 'signal_id'>): Promise<Signal> {
    const signal_id = nanoid();
    const stmt = this.db.prepare(
      `INSERT INTO signals (signal_id, session_id, timestamp, type, content, file_path, semantic_area, weight)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(signal_id, s.session_id, s.timestamp, s.type, s.content, s.file_path ?? null, s.semantic_area ?? null, s.weight);
    return { ...s, signal_id };
  }

  async getRecentSignals(opts: {
    repo?: string; file_path?: string; area?: string; since?: string; limit?: number;
  }): Promise<Signal[]> {
    const limit = opts.limit ?? 50;
    let rows: SignalRow[];

    if (opts.repo) {
      const stmt = this.db.prepare(
        `SELECT s.* FROM signals s
         INNER JOIN sessions sess ON s.session_id = sess.session_id
         WHERE sess.repo = ?
         ORDER BY s.timestamp DESC LIMIT ?`
      );
      rows = stmt.all(opts.repo, limit) as unknown as SignalRow[];
    } else {
      const stmt = this.db.prepare(
        `SELECT s.* FROM signals s
         INNER JOIN sessions sess ON s.session_id = sess.session_id
         ORDER BY s.timestamp DESC LIMIT ?`
      );
      rows = stmt.all(limit) as unknown as SignalRow[];
    }

    return rows
      .map(r => this.rowToSignal(r))
      .filter(s => {
        if (opts.file_path && s.file_path !== opts.file_path) return false;
        if (opts.area && s.file_path && !s.file_path.startsWith(opts.area)) return false;
        if (opts.since && s.timestamp < opts.since) return false;
        return true;
      });
  }

  async getRecentIntents(opts: {
    repo?: string; exclude_session_id?: string; since?: string; limit?: number;
  }): Promise<HistoricalIntent[]> {
    const limit = opts.limit ?? 100;
    const since = opts.since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const conditions = [`s.type IN ('prompt', 'intent_declared')`, `s.timestamp > ?`];
    const params: unknown[] = [since];

    if (opts.repo) {
      conditions.push(`sess.repo = ?`);
      params.push(opts.repo);
    }
    if (opts.exclude_session_id) {
      conditions.push(`s.session_id != ?`);
      params.push(opts.exclude_session_id);
    }

    params.push(limit);

    const sql = `SELECT DISTINCT s.session_id, sess.developer_name, sess.developer_email, sess.repo, s.content AS intent, s.timestamp
      FROM signals s
      INNER JOIN sessions sess ON s.session_id = sess.session_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY s.timestamp DESC LIMIT ?`;

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params as string[]) as unknown as HistoricalIntent[];
    return rows;
  }

  // --- Collisions ---

  async createCollision(c: Omit<Collision, 'collision_id' | 'resolved' | 'resolved_by'>): Promise<Collision> {
    const collision_id = nanoid();
    const stmt = this.db.prepare(
      `INSERT INTO collisions (collision_id, session_ids, type, severity, details, detected_at, resolved, resolved_by)
       VALUES (?, ?, ?, ?, ?, ?, 0, NULL)`
    );
    stmt.run(collision_id, JSON.stringify(c.session_ids), c.type, c.severity, c.details, c.detected_at);
    return { ...c, collision_id, resolved: false, resolved_by: null };
  }

  async getActiveCollisions(session_id?: string): Promise<Collision[]> {
    const stmt = this.db.prepare('SELECT * FROM collisions WHERE resolved = 0');
    const rows = stmt.all() as unknown as CollisionRow[];
    return rows
      .map(r => this.rowToCollision(r))
      .filter(c => !session_id || c.session_ids.includes(session_id));
  }

  async resolveCollision(collision_id: string, resolved_by: string): Promise<void> {
    const stmt = this.db.prepare(
      `UPDATE collisions SET resolved = 1, resolved_by = ? WHERE collision_id = ?`
    );
    stmt.run(resolved_by, collision_id);
  }

  // --- Agent Mail ---

  async createMail(m: Omit<AgentMail, 'mail_id' | 'read_at' | 'weight'>): Promise<AgentMail> {
    const mail_id = nanoid();

    // Resolve developer_email from the target session (if addressed to a session)
    let to_developer_email: string | null = null;
    if (m.to_session_id) {
      const targetSession = await this.getSession(m.to_session_id);
      if (targetSession) {
        to_developer_email = targetSession.developer_email;
      }
    }

    const stmt = this.db.prepare(
      `INSERT INTO agent_mail (mail_id, from_session_id, to_session_id, to_developer_email, to_context_id, type, subject, content, created_at, read_at, weight)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1.0)`
    );
    stmt.run(mail_id, m.from_session_id ?? null, m.to_session_id ?? null, to_developer_email, m.to_context_id ?? null, m.type, m.subject, m.content, m.created_at);
    return { ...m, mail_id, read_at: null, weight: 1.0 };
  }

  async getUnreadMail(sessionIdOrOpts: string | { session_id?: string; developer_email?: string }): Promise<AgentMail[]> {
    const opts = typeof sessionIdOrOpts === 'string'
      ? { session_id: sessionIdOrOpts }
      : sessionIdOrOpts;

    const conditions: string[] = ['read_at IS NULL'];
    const params: string[] = [];

    if (opts.session_id && opts.developer_email) {
      conditions.push('(to_session_id = ? OR to_developer_email = ?)');
      params.push(opts.session_id, opts.developer_email);
    } else if (opts.session_id) {
      conditions.push('to_session_id = ?');
      params.push(opts.session_id);
    } else if (opts.developer_email) {
      conditions.push('to_developer_email = ?');
      params.push(opts.developer_email);
    }

    const sql = `SELECT * FROM agent_mail WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as unknown as MailRow[];

    // Deduplicate by mail_id (in case both conditions match the same mail)
    const seen = new Set<string>();
    const unique: MailRow[] = [];
    for (const row of rows) {
      if (!seen.has(row.mail_id)) {
        seen.add(row.mail_id);
        unique.push(row);
      }
    }

    return unique.map(r => this.rowToMail(r));
  }

  async getMailByContext(context_id: string): Promise<AgentMail[]> {
    const stmt = this.db.prepare(
      `SELECT * FROM agent_mail WHERE to_context_id = ? ORDER BY created_at DESC`
    );
    const rows = stmt.all(context_id) as unknown as MailRow[];
    return rows.map(r => this.rowToMail(r));
  }

  async markMailRead(mail_id: string): Promise<void> {
    const stmt = this.db.prepare(
      `UPDATE agent_mail SET read_at = ? WHERE mail_id = ?`
    );
    stmt.run(new Date().toISOString(), mail_id);
  }

  // --- Nerves ---

  async registerNerve(card: AgentCard, nerve_type: string): Promise<Nerve> {
    const nerve_id = nanoid();
    const now = new Date().toISOString();
    const cardWithTimestamps: AgentCard = {
      ...card,
      registered_at: now,
      last_seen: now,
      status: 'active',
    };
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO nerves (nerve_id, agent_id, nerve_type, agent_card, created_at, last_seen, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`
    );
    stmt.run(nerve_id, card.agent_id, nerve_type, JSON.stringify(cardWithTimestamps), now, now);
    return { nerve_id, agent_card: cardWithTimestamps, nerve_type, created_at: now };
  }

  async getNerve(agent_id: string): Promise<Nerve | null> {
    const stmt = this.db.prepare('SELECT * FROM nerves WHERE agent_id = ?');
    const row = stmt.get(agent_id) as unknown as NerveRow | undefined;
    return row ? this.rowToNerve(row) : null;
  }

  async getActiveNerves(nerve_type?: string): Promise<Nerve[]> {
    let rows: NerveRow[];
    if (nerve_type) {
      const stmt = this.db.prepare('SELECT * FROM nerves WHERE status = ? AND nerve_type = ?');
      rows = stmt.all('active', nerve_type) as unknown as NerveRow[];
    } else {
      const stmt = this.db.prepare('SELECT * FROM nerves WHERE status = ?');
      rows = stmt.all('active') as unknown as NerveRow[];
    }
    return rows.map(r => this.rowToNerve(r));
  }

  async updateLastSeen(agent_id: string): Promise<void> {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      `UPDATE nerves SET last_seen = ?, status = 'active' WHERE agent_id = ?`
    );
    stmt.run(now, agent_id);
  }

  async deregisterNerve(agent_id: string): Promise<void> {
    const stmt = this.db.prepare(
      `UPDATE nerves SET status = 'disconnected' WHERE agent_id = ?`
    );
    stmt.run(agent_id);
  }

  // --- Helpers ---

  private rowToSession(row: SessionRow): Session {
    return {
      ...row,
      status: row.status as SessionStatus,
      files_touched: JSON.parse(row.files_touched),
      areas: JSON.parse(row.areas),
    };
  }

  private rowToSignal(row: SignalRow): Signal {
    return {
      ...row,
      type: row.type as SignalType,
      weight: row.weight,
    };
  }

  private rowToCollision(row: CollisionRow): Collision {
    return {
      ...row,
      session_ids: JSON.parse(row.session_ids),
      type: row.type as CollisionType,
      severity: row.severity as CollisionSeverity,
      resolved: Boolean(row.resolved),
    };
  }

  private rowToMail(row: MailRow): AgentMail {
    return {
      ...row,
      type: row.type as AgentMailType,
    };
  }

  private rowToNerve(row: NerveRow): Nerve {
    return {
      nerve_id: row.nerve_id,
      agent_card: JSON.parse(row.agent_card) as AgentCard,
      nerve_type: row.nerve_type,
      created_at: row.created_at,
    };
  }
}

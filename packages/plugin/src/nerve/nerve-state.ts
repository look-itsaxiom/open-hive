// packages/plugin/src/nerve/nerve-state.ts

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

export interface NerveStateData {
  /** Snapshot of the most recent completed session */
  last_session: {
    id: string;
    repo: string;
    ended_at: string;
    intent: string | null;
    files_touched: string[];
    areas: string[];
    outcome: 'completed' | 'interrupted' | null;
  } | null;

  /** Active session tracking — persisted to survive cross-process hook invocations */
  current_session: {
    id: string;
    repo: string;
    intent: string | null;
    files_touched: string[];
    areas: string[];
  } | null;

  /** Context that carries forward between sessions */
  carry_forward: {
    blockers: Array<{
      text: string;
      since: string;
    }>;
    unresolved_collisions: Array<{
      collision_id: string;
      with_developer: string;
      area: string;
      detected_at: string;
    }>;
    pending_mail_context: Array<{
      from: string;
      subject: string;
      received_at: string;
    }>;
  };

  /** Long-term memory — accumulated over many sessions */
  profile: {
    areas: Array<{
      path: string;
      session_count: number;
      last_active: string;
    }>;
    repos: Array<{
      name: string;
      session_count: number;
      last_active: string;
    }>;
  };
}

export interface NerveCheckInContext {
  last_session: {
    repo: string;
    intent: string | null;
    ended_at: string;
    outcome: 'completed' | 'interrupted' | null;
  } | null;
  active_blockers: string[];
  unresolved_collisions: string[];
  frequent_areas: string[];
  repos_active_in: string[];
}

export const DEFAULT_NERVE_STATE: NerveStateData = {
  last_session: null,
  current_session: null,
  carry_forward: {
    blockers: [],
    unresolved_collisions: [],
    pending_mail_context: [],
  },
  profile: {
    areas: [],
    repos: [],
  },
};

export const MAX_AREAS = 50;
export const MAX_REPOS = 50;
export const MAX_FILES_TOUCHED = 200;

export class NerveState {
  state: NerveStateData = structuredClone(DEFAULT_NERVE_STATE);

  private _currentSessionId: string | null = null;
  private _currentRepo: string | null = null;
  private _currentIntent: string | null = null;
  private _currentFilesTouched: string[] = [];
  private _currentAreas: Set<string> = new Set();

  get currentIntent(): string | null { return this._currentIntent; }
  get currentFilesTouched(): string[] { return [...this._currentFilesTouched]; }

  constructor(private filePath: string) {}

  load(): void {
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      this.state = {
        ...structuredClone(DEFAULT_NERVE_STATE),
        ...parsed,
        carry_forward: {
          ...structuredClone(DEFAULT_NERVE_STATE.carry_forward),
          ...(parsed.carry_forward ?? {}),
        },
        profile: {
          ...structuredClone(DEFAULT_NERVE_STATE.profile),
          ...(parsed.profile ?? {}),
        },
      };
    } catch {
      this.state = structuredClone(DEFAULT_NERVE_STATE);
    }

    // Restore in-memory tracking from persisted current_session
    if (this.state.current_session) {
      this._currentSessionId = this.state.current_session.id;
      this._currentRepo = this.state.current_session.repo;
      this._currentIntent = this.state.current_session.intent;
      this._currentFilesTouched = [...this.state.current_session.files_touched];
      this._currentAreas = new Set(this.state.current_session.areas);
    }
  }

  save(): void {
    // Persist in-memory tracking to current_session before writing
    if (this._currentSessionId) {
      this.state.current_session = {
        id: this._currentSessionId,
        repo: this._currentRepo ?? '',
        intent: this._currentIntent,
        files_touched: [...this._currentFilesTouched],
        areas: [...this._currentAreas],
      };
    }

    try {
      const dir = dirname(this.filePath);
      mkdirSync(dir, { recursive: true });
      const tmp = this.filePath + '.tmp';
      writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf-8');
      renameSync(tmp, this.filePath);
    } catch (err) {
      // Never block the developer — log and move on
      process.stderr.write(`[open-hive] nerve-state save failed: ${err}\n`);
    }
  }

  recordSessionStart(sessionId: string, repo: string, _projectPath: string): void {
    this._currentSessionId = sessionId;
    this._currentRepo = repo;
    this._currentIntent = null;
    this._currentFilesTouched = [];
    this._currentAreas = new Set();

    const now = new Date().toISOString();
    const existing = this.state.profile.repos.find(r => r.name === repo);
    if (existing) {
      existing.session_count += 1;
      existing.last_active = now;
    } else {
      this.state.profile.repos.push({ name: repo, session_count: 1, last_active: now });
    }

    // Cap at MAX_REPOS — keep highest session_count
    if (this.state.profile.repos.length > MAX_REPOS) {
      this.state.profile.repos.sort((a, b) => b.session_count - a.session_count);
      this.state.profile.repos.length = MAX_REPOS;
    }
  }

  recordIntent(content: string): void {
    this._currentIntent = content;
  }

  recordFileTouch(filePath: string): void {
    // Dedup
    if (!this._currentFilesTouched.includes(filePath)) {
      // Cap at MAX_FILES_TOUCHED — shift oldest when full
      if (this._currentFilesTouched.length >= MAX_FILES_TOUCHED) {
        this._currentFilesTouched.shift();
      }
      this._currentFilesTouched.push(filePath);
    }

    // Extract directory as area
    const parts = filePath.split('/');
    const area = parts.length > 1 ? parts.slice(0, -1).join('/') : '';

    if (area && !this._currentAreas.has(area)) {
      this._currentAreas.add(area);

      const now = new Date().toISOString();
      const existing = this.state.profile.areas.find(a => a.path === area);
      if (existing) {
        existing.session_count += 1;
        existing.last_active = now;
      } else {
        this.state.profile.areas.push({ path: area, session_count: 1, last_active: now });
      }

      // Cap at MAX_AREAS — keep highest session_count
      if (this.state.profile.areas.length > MAX_AREAS) {
        this.state.profile.areas.sort((a, b) => b.session_count - a.session_count);
        this.state.profile.areas.length = MAX_AREAS;
      }
    }
  }

  recordSessionEnd(outcome?: 'completed' | 'interrupted' | null): void {
    this.state.last_session = {
      id: this._currentSessionId ?? '',
      repo: this._currentRepo ?? '',
      ended_at: new Date().toISOString(),
      intent: this._currentIntent,
      files_touched: [...this._currentFilesTouched],
      areas: [...this._currentAreas],
      outcome: outcome ?? null,
    };

    // Clear active session — it's been snapshotted
    this._currentSessionId = null;
    this._currentRepo = null;
    this._currentIntent = null;
    this._currentFilesTouched = [];
    this._currentAreas = new Set();
    this.state.current_session = null;
  }

  recordCollision(collision: {
    collision_id: string;
    with_developer: string;
    area: string;
    detected_at: string;
  }): void {
    const exists = this.state.carry_forward.unresolved_collisions.some(
      c => c.collision_id === collision.collision_id,
    );
    if (!exists) {
      this.state.carry_forward.unresolved_collisions.push(collision);
    }
  }

  clearResolvedCollision(collisionId: string): void {
    this.state.carry_forward.unresolved_collisions =
      this.state.carry_forward.unresolved_collisions.filter(
        c => c.collision_id !== collisionId,
      );
  }

  recordMailReceived(mail: {
    from: string;
    subject: string;
    received_at: string;
  }): void {
    this.state.carry_forward.pending_mail_context.push(mail);
  }

  getCheckInContext(): NerveCheckInContext {
    return {
      last_session: this.state.last_session ? {
        repo: this.state.last_session.repo,
        intent: this.state.last_session.intent,
        ended_at: this.state.last_session.ended_at,
        outcome: this.state.last_session.outcome,
      } : null,
      active_blockers: this.state.carry_forward.blockers.map(b => b.text),
      unresolved_collisions: this.state.carry_forward.unresolved_collisions.map(c => c.collision_id),
      frequent_areas: [...this.state.profile.areas]
        .sort((a, b) => b.session_count - a.session_count)
        .slice(0, 10)
        .map(a => a.path),
      repos_active_in: this.state.profile.repos.map(r => r.name),
    };
  }
}

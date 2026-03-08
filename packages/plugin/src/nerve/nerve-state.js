// packages/plugin/src/nerve/nerve-state.ts
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
export const DEFAULT_NERVE_STATE = {
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
    filePath;
    state = structuredClone(DEFAULT_NERVE_STATE);
    _currentSessionId = null;
    _currentRepo = null;
    _currentIntent = null;
    _currentFilesTouched = [];
    _currentAreas = new Set();
    get currentIntent() { return this._currentIntent; }
    get currentFilesTouched() { return [...this._currentFilesTouched]; }
    constructor(filePath) {
        this.filePath = filePath;
    }
    load() {
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
        }
        catch {
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
    save() {
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
        }
        catch (err) {
            // Never block the developer — log and move on
            process.stderr.write(`[open-hive] nerve-state save failed: ${err}\n`);
        }
    }
    recordSessionStart(sessionId, repo, _projectPath) {
        // If there's a stale current_session from a crash, snapshot it
        if (this._currentSessionId && this._currentSessionId !== sessionId) {
            this.state.last_session = {
                id: this._currentSessionId,
                repo: this._currentRepo ?? '',
                ended_at: new Date().toISOString(),
                intent: this._currentIntent,
                files_touched: [...this._currentFilesTouched],
                areas: [...this._currentAreas],
                outcome: 'interrupted',
            };
        }
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
        }
        else {
            this.state.profile.repos.push({ name: repo, session_count: 1, last_active: now });
        }
        // Cap at MAX_REPOS — keep highest session_count
        if (this.state.profile.repos.length > MAX_REPOS) {
            this.state.profile.repos.sort((a, b) => b.session_count - a.session_count);
            this.state.profile.repos.length = MAX_REPOS;
        }
    }
    recordIntent(content) {
        this._currentIntent = content;
    }
    recordFileTouch(filePath) {
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
            }
            else {
                this.state.profile.areas.push({ path: area, session_count: 1, last_active: now });
            }
            // Cap at MAX_AREAS — keep highest session_count
            if (this.state.profile.areas.length > MAX_AREAS) {
                this.state.profile.areas.sort((a, b) => b.session_count - a.session_count);
                this.state.profile.areas.length = MAX_AREAS;
            }
        }
    }
    recordSessionEnd(outcome) {
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
    recordCollision(collision) {
        const exists = this.state.carry_forward.unresolved_collisions.some(c => c.collision_id === collision.collision_id);
        if (!exists) {
            this.state.carry_forward.unresolved_collisions.push(collision);
        }
    }
    clearResolvedCollision(collisionId) {
        this.state.carry_forward.unresolved_collisions =
            this.state.carry_forward.unresolved_collisions.filter(c => c.collision_id !== collisionId);
    }
    recordMailReceived(mail) {
        this.state.carry_forward.pending_mail_context.push(mail);
    }
    getCheckInContext() {
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
//# sourceMappingURL=nerve-state.js.map
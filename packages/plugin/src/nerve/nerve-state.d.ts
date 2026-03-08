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
export declare const DEFAULT_NERVE_STATE: NerveStateData;
export declare const MAX_AREAS = 50;
export declare const MAX_REPOS = 50;
export declare const MAX_FILES_TOUCHED = 200;
export declare class NerveState {
    private filePath;
    state: NerveStateData;
    private _currentSessionId;
    private _currentRepo;
    private _currentIntent;
    private _currentFilesTouched;
    private _currentAreas;
    get currentIntent(): string | null;
    get currentFilesTouched(): string[];
    constructor(filePath: string);
    load(): void;
    save(): void;
    recordSessionStart(sessionId: string, repo: string, _projectPath: string): void;
    recordIntent(content: string): void;
    recordFileTouch(filePath: string): void;
    recordSessionEnd(outcome?: 'completed' | 'interrupted' | null): void;
    recordCollision(collision: {
        collision_id: string;
        with_developer: string;
        area: string;
        detected_at: string;
    }): void;
    clearResolvedCollision(collisionId: string): void;
    recordMailReceived(mail: {
        from: string;
        subject: string;
        received_at: string;
    }): void;
    getCheckInContext(): NerveCheckInContext;
}
//# sourceMappingURL=nerve-state.d.ts.map
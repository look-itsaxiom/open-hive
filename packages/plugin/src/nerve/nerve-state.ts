// packages/plugin/src/nerve/nerve-state.ts

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

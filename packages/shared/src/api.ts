import type {
  Session, Signal, Collision, SignalType,
} from './models.js';

// --- Requests ---

export interface RegisterSessionRequest {
  session_id: string;
  developer_email: string;
  developer_name: string;
  repo: string;
  project_path: string;
}

export interface RecentHistoricalIntent {
  developer_name: string;
  intent: string;
  timestamp: string;
}

export interface RegisterSessionResponse {
  ok: boolean;
  active_collisions: Collision[];
  active_sessions_in_repo: Pick<Session, 'session_id' | 'developer_name' | 'intent' | 'areas'>[];
  recent_historical_intents: RecentHistoricalIntent[];
}

export interface HeartbeatRequest {
  session_id: string;
}

export interface EndSessionRequest {
  session_id: string;
}

export interface IntentSignalRequest {
  session_id: string;
  content: string;
  type: SignalType;
}

export interface IntentSignalResponse {
  ok: boolean;
  collisions: Collision[];
}

export interface ActivitySignalRequest {
  session_id: string;
  file_path: string;
  type: 'file_modify' | 'file_read';
}

export interface ActivitySignalResponse {
  ok: boolean;
  collisions: Collision[];
}

export interface CheckConflictsRequest {
  session_id: string;
  file_path: string;
  repo?: string;
}

export interface CheckConflictsResponse {
  has_conflicts: boolean;
  collisions: Collision[];
  nearby_sessions: Pick<Session, 'session_id' | 'developer_name' | 'intent' | 'files_touched'>[];
}

export interface ListActiveRequest {
  repo?: string;
  team?: string;
}

export interface ListActiveResponse {
  sessions: Session[];
}

export interface ResolveCollisionRequest {
  collision_id: string;
  resolved_by: string;
}

export interface HistoryRequest {
  file_path?: string;
  area?: string;
  repo?: string;
  since?: string;
  limit?: number;
}

export interface HistoryResponse {
  signals: Signal[];
  sessions: Pick<Session, 'session_id' | 'developer_name' | 'repo' | 'intent' | 'started_at'>[];
}

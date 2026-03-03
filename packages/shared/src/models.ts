// Session represents a developer's active Claude Code session
export interface Session {
  session_id: string;
  developer_email: string;
  developer_name: string;
  repo: string;
  project_path: string;
  started_at: string;       // ISO 8601
  last_activity: string;    // ISO 8601
  status: SessionStatus;
  intent: string | null;
  files_touched: string[];
  areas: string[];          // directories being worked in
}

export type SessionStatus = 'active' | 'idle' | 'ended';

// Signal represents a single captured developer action
export interface Signal {
  signal_id: string;
  session_id: string;
  timestamp: string;
  type: SignalType;
  content: string;
  file_path: string | null;
  semantic_area: string | null;
}

export type SignalType = 'prompt' | 'file_modify' | 'file_read' | 'search' | 'explicit';

// Collision represents detected overlap between sessions
export interface Collision {
  collision_id: string;
  session_ids: string[];
  type: CollisionType;
  severity: CollisionSeverity;
  details: string;
  detected_at: string;
  resolved: boolean;
  resolved_by: string | null;
}

export type CollisionType = 'file' | 'directory' | 'semantic';
export type CollisionSeverity = 'critical' | 'warning' | 'info';

// Repo tracked by the backend
export interface TrackedRepo {
  repo_id: string;
  name: string;
  provider: GitProvider;
  remote_url: string | null;
  discovered_at: string;
  last_activity: string | null;
}

export type GitProvider = 'github' | 'azure-devops' | 'gitlab' | 'self-registered';

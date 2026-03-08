/**
 * Core port interfaces for Open Hive's hexagonal architecture.
 *
 * Ports define the boundaries between domain logic and external adapters.
 * Each port is an interface that can be implemented by one or more adapters
 * (e.g., SQLite vs Postgres for IHiveStore, Slack vs Email for IAlertSink).
 */

import type {
  Session, Signal, Collision, CollisionSeverity, AgentMail,
} from './models.js';

// ─── IHiveStore ──────────────────────────────────────────────────────────────

/** A historical intent captured from a developer's prompt signal. */
export interface HistoricalIntent {
  session_id: string;
  developer_name: string;
  developer_email: string;
  repo: string;
  intent: string;
  timestamp: string;
}

/** Primary persistence port — all data access flows through this interface. */
export interface IHiveStore {
  createSession(s: Omit<Session, 'last_activity' | 'status' | 'files_touched' | 'areas'>): Promise<Session>;
  getSession(session_id: string): Promise<Session | null>;
  getActiveSessions(repo?: string): Promise<Session[]>;
  updateSessionActivity(session_id: string, updates: {
    intent?: string;
    files_touched?: string[];
    areas?: string[];
  }): Promise<void>;
  endSession(session_id: string): Promise<void>;
  cleanupStaleSessions(idle_timeout_seconds: number): Promise<string[]>;
  createSignal(s: Omit<Signal, 'signal_id'>): Promise<Signal>;
  getRecentSignals(opts: {
    repo?: string; file_path?: string; area?: string; since?: string; limit?: number;
  }): Promise<Signal[]>;
  getRecentIntents(opts: {
    repo?: string; exclude_session_id?: string; since?: string; limit?: number;
  }): Promise<HistoricalIntent[]>;
  createCollision(c: Omit<Collision, 'collision_id' | 'resolved' | 'resolved_by'>): Promise<Collision>;
  getActiveCollisions(session_id?: string): Promise<Collision[]>;
  resolveCollision(collision_id: string, resolved_by: string): Promise<void>;

  // --- Agent Mail ---
  createMail(m: Omit<AgentMail, 'mail_id' | 'read_at' | 'weight'>): Promise<AgentMail>;
  getUnreadMail(session_id: string): Promise<AgentMail[]>;
  getMailByContext(context_id: string): Promise<AgentMail[]>;
  markMailRead(mail_id: string): Promise<void>;
}

// ─── IAlertSink ──────────────────────────────────────────────────────────────

/** A participant involved in a collision alert. */
export interface AlertParticipant {
  developer_name: string;
  developer_email: string;
  repo: string;
  intent: string | null;
}

/** An alert event fired when a collision is detected or resolved. */
export interface AlertEvent {
  type: 'collision_detected' | 'collision_resolved';
  severity: CollisionSeverity;
  collision: Collision;
  participants: AlertParticipant[];
  timestamp: string;
}

/** Outbound notification port — adapters deliver alerts to external channels. */
export interface IAlertSink {
  /** Human-readable name for logging (e.g., "slack", "email", "webhook"). */
  readonly name: string;
  /** Determine whether this sink should fire for the given event. */
  shouldFire(event: AlertEvent): boolean;
  /** Deliver the alert to the external channel. */
  deliver(event: AlertEvent): Promise<void>;
}

// ─── IIdentityProvider ───────────────────────────────────────────────────────

/** Resolved developer identity after authentication. */
export interface DeveloperIdentity {
  email: string;
  display_name: string;
  org?: string;
  teams?: string[];
}

/** Raw authentication context extracted from an incoming request. */
export interface AuthContext {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

/** Inbound identity port — adapters authenticate requests and resolve identities. */
export interface IIdentityProvider {
  /** Human-readable name for logging (e.g., "static", "jwt", "oauth"). */
  readonly name: string;
  /** Whether this provider requires authentication headers. */
  readonly requiresAuth: boolean;
  /** Authenticate a request and return the resolved identity, or null if invalid. */
  authenticate(ctx: AuthContext): Promise<DeveloperIdentity | null>;
}

// ─── ISemanticAnalyzer ───────────────────────────────────────────────────────

/** Result of a semantic comparison between two developer intents. */
export interface SemanticMatch {
  /** Similarity score from 0.0 (unrelated) to 1.0 (identical intent). */
  score: number;
  /** Which detection tier produced this result. */
  tier: 'L3a' | 'L3b' | 'L3c';
  /** Human-readable explanation of why overlap was detected. */
  explanation: string;
}

/**
 * Semantic analysis port — adapters compare developer intents for overlap.
 *
 * Multiple analyzers can be registered; the collision engine runs them in
 * tier order (L3a → L3b → L3c). First match wins per session pair.
 *
 * Built-in: L3a (keyword/Jaccard). Skills provide L3b (embeddings) and L3c (LLM).
 */
export interface ISemanticAnalyzer {
  /** Human-readable name for logging (e.g., "keyword-jaccard", "openai-embeddings"). */
  readonly name: string;
  /** Which detection tier this analyzer implements. */
  readonly tier: 'L3a' | 'L3b' | 'L3c';
  /**
   * Compare two intents. Return a SemanticMatch if overlap is detected
   * above the analyzer's internal threshold, or null if no meaningful overlap.
   */
  compare(a: string, b: string): Promise<SemanticMatch | null>;
}

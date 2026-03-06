/**
 * Core port interfaces for Open Hive's hexagonal architecture.
 *
 * Ports define the boundaries between domain logic and external adapters.
 * Each port is an interface that can be implemented by one or more adapters
 * (e.g., SQLite vs Postgres for IHiveStore, Slack vs Email for IAlertSink).
 */

import type {
  Session, Signal, Collision, CollisionSeverity,
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
}

// ─── IAlertSink ──────────────────────────────────────────────────────────────

/** A participant involved in a collision alert. */
export interface AlertParticipant {
  developer_name: string;
  developer_email: string;
  repo: string;
  intent: string | null;
}

/** An alert event fired when a collision is detected. */
export interface AlertEvent {
  type: 'collision_detected';
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

/** Result of a semantic comparison between two intents or code areas. */
export interface SemanticMatch {
  /** Similarity score from 0.0 (unrelated) to 1.0 (identical). */
  score: number;
  /** Qualitative tier derived from the score. */
  tier: 'exact' | 'high' | 'medium' | 'low' | 'none';
  /** Human-readable explanation of why the match was scored this way. */
  explanation: string;
}

/** Semantic analysis port — adapters compare intents using different strategies. */
export interface ISemanticAnalyzer {
  /** Human-readable name for logging (e.g., "keyword", "embedding", "llm"). */
  readonly name: string;
  /** The analysis tier this analyzer provides (used for fallback ordering). */
  readonly tier: 'keyword' | 'embedding' | 'llm';
  /** Compare two text inputs and return a semantic match result. */
  compare(a: string, b: string): Promise<SemanticMatch>;
}

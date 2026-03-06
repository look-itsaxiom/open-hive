# Port Interfaces

Open Hive defines four core ports. Each port is a TypeScript interface that skills implement to provide specific functionality.

## IHiveStore (Storage)

Defined in: `packages/shared/src/ports.ts`

Persists sessions, signals, and collisions. The default implementation uses SQLite via `node:sqlite`.

```typescript
interface IHiveStore {
  // Sessions
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

  // Signals
  createSignal(s: Omit<Signal, 'signal_id'>): Promise<Signal>;
  getRecentSignals(opts: {
    repo?: string;
    file_path?: string;
    area?: string;
    since?: string;
    limit?: number;
  }): Promise<Signal[]>;
  getRecentIntents(opts: {
    repo?: string;
    exclude_session_id?: string;
    since?: string;
    limit?: number;
  }): Promise<HistoricalIntent[]>;

  // Collisions
  createCollision(c: Omit<Collision, 'collision_id' | 'resolved' | 'resolved_by'>): Promise<Collision>;
  getActiveCollisions(session_id?: string): Promise<Collision[]>;
  resolveCollision(collision_id: string, resolved_by: string): Promise<void>;
}
```

### HistoricalIntent

```typescript
interface HistoricalIntent {
  session_id: string;
  developer_name: string;
  developer_email: string;
  repo: string;
  intent: string;
  timestamp: string;
}
```

**Skills targeting this port:** PostgreSQL

---

## IAlertSink (Alerts)

Defined in: `packages/shared/src/ports.ts`

Implemented by `AlertDispatcher` (dispatcher) and `GenericWebhookSink` (default adapter) in `packages/backend/src/services/`.

```typescript
interface AlertParticipant {
  developer_name: string;
  developer_email: string;
  repo: string;
  intent: string | null;
}

interface AlertEvent {
  type: 'collision_detected' | 'collision_resolved';
  severity: CollisionSeverity;
  collision: Collision;
  participants: AlertParticipant[];
  timestamp: string;
}

interface IAlertSink {
  readonly name: string;
  shouldFire(event: AlertEvent): boolean;
  deliver(event: AlertEvent): Promise<void>;
}
```

The `AlertDispatcher` manages a list of `IAlertSink` adapters. When a collision is detected or resolved, it:

1. Filters sinks by calling `shouldFire(event)` (e.g., severity-based filtering via `ALERT_MIN_SEVERITY`)
2. Calls each eligible sink's `deliver()` method
3. All delivery is fire-and-forget with a 5-second timeout

**Skills targeting this port:** Slack, Teams, Discord

---

## IIdentityProvider (Identity)

Defined in: `packages/shared/src/ports.ts`

Default adapter: `PassthroughIdentityProvider` in `packages/backend/src/services/passthrough-identity-provider.ts`. Auth middleware in `packages/backend/src/middleware/auth.ts` delegates to the configured `IIdentityProvider`.

```typescript
interface DeveloperIdentity {
  email: string;
  display_name: string;
  org?: string;
  teams?: string[];
}

interface AuthContext {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface IIdentityProvider {
  readonly name: string;
  readonly requiresAuth: boolean;
  authenticate(ctx: AuthContext): Promise<DeveloperIdentity | null>;
}
```

The auth middleware is created via `createAuthMiddleware(provider)` in `middleware/auth.ts`. When the provider's `requiresAuth` is `true`, unauthenticated requests receive a 401. The `PassthroughIdentityProvider` trusts self-reported identity from the request body. OAuth skills provide alternative `IIdentityProvider` implementations with real token validation, org/team discovery, and JWT session management.

**Skills targeting this port:** GitHub OAuth, GitLab OAuth, Azure DevOps OAuth

---

## ISemanticAnalyzer (Semantic Analysis)

Defined in: `packages/shared/src/ports.ts`

Default adapter: `KeywordAnalyzer` (tier L3a) in `packages/backend/src/services/keyword-analyzer.ts`.

```typescript
interface SemanticMatch {
  score: number;
  tier: 'L3a' | 'L3b' | 'L3c';
  explanation: string;
}

interface ISemanticAnalyzer {
  readonly name: string;
  readonly tier: 'L3a' | 'L3b' | 'L3c';
  compare(a: string, b: string): Promise<SemanticMatch | null>;
}
```

The `CollisionEngine` accepts an `ISemanticAnalyzer[]` and sorts them by tier order (L3a, L3b, L3c) at construction time. For each session pair, analyzers run in tier order and the first match wins. Config flags control which analyzers are instantiated:

- `keywords_enabled` -- L3a: `KeywordAnalyzer` using Jaccard similarity (threshold: 0.3)
- `embeddings_enabled` -- L3b: Cosine similarity via embeddings API (requires skill)
- `llm_enabled` -- L3c: LLM-based semantic comparison (requires skill)

Tier severity mapping: L3a produces `info`, L3b and L3c produce `warning`.

**Skills targeting this port:** L3b Embeddings, L3c LLM

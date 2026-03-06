# Port Interfaces

Open Hive defines four core ports. Each port is a TypeScript interface that skills implement to provide specific functionality.

## IHiveStore (Storage)

Defined in: `packages/backend/src/db/store.ts`

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

Currently implemented via `NotificationDispatcher` and `NotificationFormatter` in `packages/backend/src/services/notification-dispatcher.ts`.

```typescript
interface NotificationFormatter {
  name: string;
  format(payload: WebhookPayload): {
    url: string;
    body: unknown;
    headers?: Record<string, string>;
  };
  shouldFire(payload: WebhookPayload): boolean;
}
```

The `NotificationDispatcher` manages a list of formatters and generic webhook URLs. When a collision is detected or resolved, it:

1. Sends raw JSON to all generic `WEBHOOK_URLS` (if severity meets `WEBHOOK_MIN_SEVERITY`)
2. Calls each registered formatter's `format()` method and sends the result
3. All sends are fire-and-forget with a 5-second timeout

**Skills targeting this port:** Slack, Teams, Discord

---

## IIdentityProvider (Identity)

Currently implemented as passthrough middleware in `packages/backend/src/middleware/auth.ts`.

```typescript
interface DeveloperIdentity {
  email: string;
  display_name: string;
  org?: string;
}

// Default: accepts all requests
async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void>;
```

OAuth skills replace the `authenticate` function with real token validation, org/team discovery, and JWT session management.

**Skills targeting this port:** GitHub OAuth, GitLab OAuth, Azure DevOps OAuth

---

## ISemanticAnalyzer (Semantic Analysis)

Planned interface for L3b (embedding) and L3c (LLM) collision detection. Currently, semantic analysis is handled directly by the `CollisionEngine` using keyword extraction (L3a).

The `CollisionEngine` checks these config flags:

- `keywords_enabled` -- L3a: Jaccard similarity of extracted keywords (threshold: 0.3)
- `embeddings_enabled` -- L3b: Cosine similarity via embeddings API (requires skill)
- `llm_enabled` -- L3c: LLM-based semantic comparison (requires skill)

**Skills targeting this port:** L3b Embeddings, L3c LLM

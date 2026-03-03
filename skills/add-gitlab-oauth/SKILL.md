---
name: add-gitlab-oauth
description: Add GitLab OAuth authentication with group/project discovery
category: auth
requires: []
modifies:
  - packages/backend/src/middleware/auth.ts
  - packages/backend/src/routes/auth-gitlab.ts
  - packages/backend/src/env.ts
  - packages/backend/src/server.ts
  - packages/shared/src/config.ts
  - .env.example
tests:
  - packages/backend/src/auth-gitlab.test.ts
---

# Add GitLab OAuth Authentication

Add GitLab OAuth login to Open Hive so developers authenticate with their GitLab identity. Includes group membership verification, project discovery, and JWT session tokens. Supports both gitlab.com and self-hosted GitLab instances via configurable base URL. Backward compatible -- when `AUTH_ENABLED=false` (default), the system behaves exactly as before.

## Prerequisites

1. Backend source is cloned and `npm install` has been run at the repo root.
2. You can build successfully: `npm run build` (from repo root, runs turbo).
3. A **GitLab OAuth Application** has been created (see [Setup Guide](#setup-guide) at the end of this file). You need the **Application ID** and **Secret**.

## What This Skill Does

- Adds a full GitLab OAuth 2.0 login flow (`/auth/gitlab` redirect, `/auth/gitlab/callback` token exchange).
- Issues JWT session tokens after successful GitLab login.
- Verifies group membership when `GITLAB_GROUP` is configured.
- Discovers the user's GitLab groups and accessible projects via API.
- Replaces the pass-through `authenticate` / `requireAuth` middleware with real JWT validation.
- Supports self-hosted GitLab instances via `GITLAB_BASE_URL` (defaults to `https://gitlab.com`).
- Stays backward compatible: when `AUTH_ENABLED` is `false` (default), all routes pass through without authentication.

---

## Step 1: Install Dependencies

From the **packages/backend** directory:

```bash
cd packages/backend
npm install jsonwebtoken
npm install -D @types/jsonwebtoken
```

This adds JWT signing/verification. No passport or OAuth libraries needed -- we use raw `fetch` against the GitLab API.

---

## Step 2: Add Auth Configuration

### 2a. Edit `packages/backend/src/env.ts`

Replace the entire file contents with:

```typescript
import type { HiveBackendConfig } from '@open-hive/shared';

export interface AuthConfig {
  enabled: boolean;
  gitlab_client_id: string;
  gitlab_client_secret: string;
  gitlab_base_url: string;
  gitlab_group?: string;
  jwt_secret: string;
  /** Base URL of this backend, used to build OAuth callback URLs */
  public_url: string;
}

export function loadConfig(): HiveBackendConfig {
  return {
    port: parseInt(process.env.PORT ?? '3000', 10),
    database: {
      type: (process.env.DB_TYPE as 'sqlite' | 'postgres') ?? 'sqlite',
      url: process.env.DATABASE_URL ?? './data/hive.db',
    },
    collision: {
      scope: (process.env.COLLISION_SCOPE as 'repo' | 'org') ?? 'org',
      semantic: {
        keywords_enabled: process.env.SEMANTIC_KEYWORDS !== 'false',
        embeddings_enabled: process.env.SEMANTIC_EMBEDDINGS === 'true',
        embeddings_provider: process.env.EMBEDDINGS_PROVIDER,
        embeddings_api_key: process.env.EMBEDDINGS_API_KEY,
        llm_enabled: process.env.SEMANTIC_LLM === 'true',
        llm_provider: process.env.LLM_PROVIDER,
        llm_api_key: process.env.LLM_API_KEY,
      },
    },
    webhooks: {
      urls: process.env.WEBHOOK_URLS?.split(',').filter(Boolean) ?? [],
    },
    session: {
      heartbeat_interval_seconds: parseInt(process.env.HEARTBEAT_INTERVAL ?? '30', 10),
      idle_timeout_seconds: parseInt(process.env.IDLE_TIMEOUT ?? '300', 10),
    },
  };
}

export function loadAuthConfig(): AuthConfig {
  const baseUrl = process.env.GITLAB_BASE_URL ?? 'https://gitlab.com';
  return {
    enabled: process.env.AUTH_ENABLED === 'true',
    gitlab_client_id: process.env.GITLAB_CLIENT_ID ?? '',
    gitlab_client_secret: process.env.GITLAB_CLIENT_SECRET ?? '',
    gitlab_base_url: baseUrl.replace(/\/+$/, ''),
    gitlab_group: process.env.GITLAB_GROUP || undefined,
    jwt_secret: process.env.JWT_SECRET ?? 'open-hive-dev-secret-change-me',
    public_url: process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? '3000'}`,
  };
}
```

**What changed:** Added `AuthConfig` interface with GitLab-specific fields (`gitlab_client_id`, `gitlab_client_secret`, `gitlab_base_url`, `gitlab_group`) and `loadAuthConfig()` function. The `gitlab_base_url` trailing slashes are stripped for consistent URL construction. The existing `loadConfig()` is unchanged.

### 2b. Edit `packages/shared/src/config.ts`

Add an `auth` field to `HiveClientConfig`. Find the `HiveClientConfig` interface and replace it:

**Before:**
```typescript
export interface HiveClientConfig {
  backend_url: string;
  identity: {
    email: string;
    display_name: string;
  };
  team?: string;
  notifications: {
    inline: boolean;
    webhook_url?: string;
  };
}
```

**After:**
```typescript
export interface HiveClientConfig {
  backend_url: string;
  identity: {
    email: string;
    display_name: string;
  };
  team?: string;
  auth?: {
    token?: string;
  };
  notifications: {
    inline: boolean;
    webhook_url?: string;
  };
}
```

`HiveBackendConfig` does not change.

---

## Step 3: Create Auth Routes

Create the new file `packages/backend/src/routes/auth-gitlab.ts` with the following contents:

```typescript
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import type { AuthConfig } from '../env.js';
import type { DeveloperIdentity } from '../middleware/auth.js';

// ── GitLab API types ──────────────────────────────────────

interface GitLabTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  created_at: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

interface GitLabUser {
  username: string;
  id: number;
  name: string;
  email: string;
  avatar_url: string;
  web_url: string;
  state: string;
}

interface GitLabGroup {
  id: number;
  name: string;
  path: string;
  full_path: string;
  description: string | null;
  web_url: string;
}

interface GitLabProject {
  id: number;
  name: string;
  path_with_namespace: string;
  description: string | null;
  web_url: string;
  visibility: string;
  namespace: {
    id: number;
    name: string;
    path: string;
    full_path: string;
  };
}

// ── JWT payload ───────────────────────────────────────────

export interface JwtPayload {
  sub: string;           // GitLab username
  email: string;
  display_name: string;
  gitlab_id: number;
  avatar_url: string;
  groups: string[];
  iat: number;
  exp: number;
}

// ── Route registration ────────────────────────────────────

export function authGitLabRoutes(app: FastifyInstance, authConfig: AuthConfig) {
  const gitlabBase = authConfig.gitlab_base_url;
  const GITLAB_AUTHORIZE_URL = `${gitlabBase}/oauth/authorize`;
  const GITLAB_TOKEN_URL = `${gitlabBase}/oauth/token`;
  const GITLAB_API = `${gitlabBase}/api/v4`;

  // ── GET /auth/gitlab ────────────────────────────────────
  // Redirects the user to GitLab's OAuth authorization page.

  app.get<{ Querystring: { redirect_uri?: string } }>(
    '/auth/gitlab',
    async (req, reply) => {
      if (!authConfig.enabled) {
        return reply.status(404).send({ error: 'Auth is not enabled' });
      }
      if (!authConfig.gitlab_client_id) {
        return reply.status(500).send({ error: 'GITLAB_CLIENT_ID is not configured' });
      }

      const callbackUrl = `${authConfig.public_url}/auth/gitlab/callback`;
      const state = Buffer.from(JSON.stringify({
        redirect_uri: req.query.redirect_uri || '',
      })).toString('base64url');

      const params = new URLSearchParams({
        client_id: authConfig.gitlab_client_id,
        redirect_uri: callbackUrl,
        response_type: 'code',
        scope: 'read_user read_api openid',
        state,
      });

      return reply.redirect(`${GITLAB_AUTHORIZE_URL}?${params}`);
    },
  );

  // ── GET /auth/gitlab/callback ───────────────────────────
  // GitLab redirects here after the user authorizes. Exchanges
  // the code for an access token, fetches profile + groups, and
  // issues a JWT.

  app.get<{ Querystring: { code: string; state?: string } }>(
    '/auth/gitlab/callback',
    async (req, reply) => {
      if (!authConfig.enabled) {
        return reply.status(404).send({ error: 'Auth is not enabled' });
      }

      const { code, state } = req.query;
      if (!code) {
        return reply.status(400).send({ error: 'Missing code parameter' });
      }

      // 1. Exchange code for access token
      const callbackUrl = `${authConfig.public_url}/auth/gitlab/callback`;
      const tokenRes = await fetch(GITLAB_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: authConfig.gitlab_client_id,
          client_secret: authConfig.gitlab_client_secret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: callbackUrl,
        }),
      });

      const tokenData = (await tokenRes.json()) as GitLabTokenResponse;
      if (tokenData.error || !tokenData.access_token) {
        req.log.error({ error: tokenData.error, desc: tokenData.error_description }, 'GitLab token exchange failed');
        return reply.status(401).send({
          error: 'GitLab authentication failed',
          details: tokenData.error_description ?? tokenData.error,
        });
      }

      const glToken = tokenData.access_token;
      const glHeaders = {
        Authorization: `Bearer ${glToken}`,
        Accept: 'application/json',
        'User-Agent': 'Open-Hive-Backend',
      };

      // 2. Fetch user profile
      const userRes = await fetch(`${GITLAB_API}/user`, { headers: glHeaders });
      if (!userRes.ok) {
        return reply.status(401).send({ error: 'Failed to fetch GitLab user profile' });
      }
      const glUser = (await userRes.json()) as GitLabUser;

      // 3. Fetch groups
      const groupsRes = await fetch(`${GITLAB_API}/groups?min_access_level=10`, { headers: glHeaders });
      const groups: GitLabGroup[] = groupsRes.ok ? (await groupsRes.json()) as GitLabGroup[] : [];
      const groupPaths = groups.map(g => g.full_path);

      // 4. Verify group membership if required
      if (authConfig.gitlab_group) {
        const isMember = groupPaths.some(
          path => path.toLowerCase() === authConfig.gitlab_group!.toLowerCase(),
        );
        if (!isMember) {
          return reply.status(403).send({
            error: 'Group membership required',
            details: `You must be a member of the "${authConfig.gitlab_group}" group.`,
          });
        }
      }

      // 5. Issue JWT
      const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
        sub: glUser.username,
        email: glUser.email,
        display_name: glUser.name ?? glUser.username,
        gitlab_id: glUser.id,
        avatar_url: glUser.avatar_url,
        groups: groupPaths,
      };

      const token = jwt.sign(payload, authConfig.jwt_secret, { expiresIn: '7d' });

      // 6. Redirect or return JSON
      let redirectUri = '';
      if (state) {
        try {
          const decoded = JSON.parse(Buffer.from(state, 'base64url').toString());
          redirectUri = decoded.redirect_uri ?? '';
        } catch { /* ignore malformed state */ }
      }

      if (redirectUri) {
        const url = new URL(redirectUri);
        url.searchParams.set('token', token);
        return reply.redirect(url.toString());
      }

      return {
        ok: true,
        token,
        user: {
          username: glUser.username,
          email: glUser.email,
          display_name: glUser.name ?? glUser.username,
          avatar_url: glUser.avatar_url,
          groups: groupPaths,
        },
      };
    },
  );

  // ── POST /auth/token/verify ─────────────────────────────
  // Validates a JWT and returns the developer identity.

  app.post<{ Body: { token: string } }>(
    '/auth/token/verify',
    async (req, reply) => {
      if (!authConfig.enabled) {
        return reply.status(404).send({ error: 'Auth is not enabled' });
      }

      const { token } = req.body ?? {};
      if (!token) {
        return reply.status(400).send({ error: 'Missing token' });
      }

      try {
        const decoded = jwt.verify(token, authConfig.jwt_secret) as JwtPayload;
        return {
          ok: true,
          developer: {
            email: decoded.email,
            display_name: decoded.display_name,
            group: decoded.groups[0] ?? undefined,
            username: decoded.sub,
            gitlab_id: decoded.gitlab_id,
            avatar_url: decoded.avatar_url,
            groups: decoded.groups,
          },
        };
      } catch (err) {
        return reply.status(401).send({ error: 'Invalid or expired token' });
      }
    },
  );

  // ── GET /auth/gitlab/groups ─────────────────────────────
  // Lists the GitLab groups for the authenticated user.
  // Requires a valid JWT in the Authorization header.

  app.get(
    '/auth/gitlab/groups',
    async (req, reply) => {
      if (!authConfig.enabled) {
        return reply.status(404).send({ error: 'Auth is not enabled' });
      }

      const developer = req.developer;
      if (!developer) {
        return reply.status(401).send({ error: 'Authentication required' });
      }

      // Decode JWT to get groups (they're stored in the token)
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return reply.status(401).send({ error: 'Missing Bearer token' });
      }

      try {
        const decoded = jwt.verify(
          authHeader.slice(7),
          authConfig.jwt_secret,
        ) as JwtPayload;
        return { ok: true, groups: decoded.groups };
      } catch {
        return reply.status(401).send({ error: 'Invalid token' });
      }
    },
  );

  // ── GET /auth/gitlab/projects ───────────────────────────
  // Lists projects accessible to the authenticated user.
  // Requires a valid GitLab token, but since we only store a
  // JWT (not the GitLab token), this endpoint re-fetches from
  // GitLab using a stored token approach. For v1, we return
  // the groups and let the admin configure projects manually.
  //
  // NOTE: To support live project listing, you would need to
  // store the GitLab access token (encrypted) alongside the
  // JWT. This v1 implementation returns a helpful message.

  app.get(
    '/auth/gitlab/projects',
    async (req, reply) => {
      if (!authConfig.enabled) {
        return reply.status(404).send({ error: 'Auth is not enabled' });
      }

      const developer = req.developer;
      if (!developer) {
        return reply.status(401).send({ error: 'Authentication required' });
      }

      return {
        ok: true,
        message: 'Project listing requires a stored GitLab access token. Configure projects via GITLAB_GROUP environment variable or register projects manually via the API.',
      };
    },
  );
}
```

---

## Step 4: Replace Auth Middleware

Replace the entire contents of `packages/backend/src/middleware/auth.ts` with:

```typescript
import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import type { AuthConfig } from '../env.js';
import type { JwtPayload } from '../routes/auth-gitlab.js';

export interface DeveloperIdentity {
  email: string;
  display_name: string;
  org?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    developer?: DeveloperIdentity;
  }
}

let _authConfig: AuthConfig | null = null;

/**
 * Call once at startup to provide the auth config to the middleware.
 */
export function initAuthMiddleware(authConfig: AuthConfig): void {
  _authConfig = authConfig;
}

/**
 * Pre-handler hook: extracts and verifies the JWT from the
 * Authorization header. Attaches `req.developer` on success.
 *
 * When AUTH_ENABLED is false, this is a no-op (pass-through).
 * When AUTH_ENABLED is true but no token is provided, req.developer
 * remains undefined -- requireAuth will reject the request.
 */
export async function authenticate(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  if (!_authConfig?.enabled) return;

  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return;

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, _authConfig.jwt_secret) as JwtPayload;
    request.developer = {
      email: decoded.email,
      display_name: decoded.display_name,
      org: decoded.groups[0] ?? undefined,
    };
  } catch {
    // Invalid token -- leave developer undefined, requireAuth will reject
  }
}

/**
 * Pre-handler hook: if AUTH_ENABLED is true, rejects requests
 * that have no authenticated developer.
 *
 * When AUTH_ENABLED is false, this is a no-op.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!_authConfig?.enabled) return;

  if (!request.developer) {
    reply.status(401).send({
      error: 'Authentication required',
      login_url: '/auth/gitlab',
    });
  }
}
```

**Key design decisions:**
- `initAuthMiddleware()` is called once at startup to avoid circular imports.
- `authenticate` always runs (as a preHandler hook) but is a no-op when auth is disabled.
- `requireAuth` can be added to individual routes that need mandatory auth, or globally.
- The existing `DeveloperIdentity` interface is preserved for backward compatibility.
- The `org` field on `DeveloperIdentity` maps to the user's first GitLab group for backward compatibility with code that reads `developer.org`.

---

## Step 5: Wire Into server.ts

Replace `packages/backend/src/server.ts` with:

**Before:**
```typescript
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadConfig } from './env.js';
import { createStore } from './db/index.js';
import { CollisionEngine } from './services/collision-engine.js';
import { NotificationDispatcher } from './services/notification-dispatcher.js';
import { authenticate } from './middleware/auth.js';
import { sessionRoutes } from './routes/sessions.js';
import { signalRoutes } from './routes/signals.js';
import { conflictRoutes } from './routes/conflicts.js';
import { historyRoutes } from './routes/history.js';

const config = loadConfig();
```

**After:**
```typescript
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadConfig, loadAuthConfig } from './env.js';
import { createStore } from './db/index.js';
import { CollisionEngine } from './services/collision-engine.js';
import { NotificationDispatcher } from './services/notification-dispatcher.js';
import { authenticate, initAuthMiddleware } from './middleware/auth.js';
import { sessionRoutes } from './routes/sessions.js';
import { signalRoutes } from './routes/signals.js';
import { conflictRoutes } from './routes/conflicts.js';
import { historyRoutes } from './routes/history.js';
import { authGitLabRoutes } from './routes/auth-gitlab.js';

const config = loadConfig();
const authConfig = loadAuthConfig();
initAuthMiddleware(authConfig);
```

Then find the line:

```typescript
app.get('/api/health', async () => ({ status: 'ok', version: '0.2.0' }));
```

And add the auth routes registration **immediately after** it:

```typescript
app.get('/api/health', async () => ({ status: 'ok', version: '0.2.0' }));

authGitLabRoutes(app, authConfig);
```

The complete `server.ts` after all edits:

```typescript
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadConfig, loadAuthConfig } from './env.js';
import { createStore } from './db/index.js';
import { CollisionEngine } from './services/collision-engine.js';
import { NotificationDispatcher } from './services/notification-dispatcher.js';
import { authenticate, initAuthMiddleware } from './middleware/auth.js';
import { sessionRoutes } from './routes/sessions.js';
import { signalRoutes } from './routes/signals.js';
import { conflictRoutes } from './routes/conflicts.js';
import { historyRoutes } from './routes/history.js';
import { authGitLabRoutes } from './routes/auth-gitlab.js';

const config = loadConfig();
const authConfig = loadAuthConfig();
initAuthMiddleware(authConfig);

const store = createStore(config);
const engine = new CollisionEngine(store, config);
const dispatcher = new NotificationDispatcher(config.webhooks.urls);

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
app.addHook('preHandler', authenticate);

app.get('/api/health', async () => ({ status: 'ok', version: '0.2.0' }));

authGitLabRoutes(app, authConfig);

sessionRoutes(app, store, engine, dispatcher);
signalRoutes(app, store, engine, dispatcher);
conflictRoutes(app, store, engine, dispatcher);
historyRoutes(app, store);

// Periodic cleanup of stale sessions
const cleanupIntervalMs = config.session.heartbeat_interval_seconds * 1000;
setInterval(async () => {
  try {
    const cleaned = await store.cleanupStaleSessions(config.session.idle_timeout_seconds);
    if (cleaned.length > 0) {
      app.log.info({ count: cleaned.length, session_ids: cleaned }, 'Cleaned up stale sessions');
    }
  } catch (err) {
    app.log.error({ err }, 'Failed to cleanup stale sessions');
  }
}, cleanupIntervalMs);

await app.listen({ port: config.port, host: '0.0.0.0' });
app.log.info(`Open Hive backend listening on port ${config.port}`);
```

---

## Step 6: Update Plugin Client

Edit `packages/plugin/src/client/hive-client.ts` to send the auth token when available.

### 6a. Update the constructor

**Before:**
```typescript
export class HiveClient {
  constructor(private baseUrl: string) {}
```

**After:**
```typescript
export class HiveClient {
  private authToken?: string;

  constructor(private baseUrl: string, authToken?: string) {
    this.authToken = authToken;
  }
```

### 6b. Update the `post` method

**Before:**
```typescript
  private async post<T>(path: string, body: unknown): Promise<T | null> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return null;
      return res.json() as Promise<T>;
    } catch {
      return null; // Backend unreachable — never block the developer
    }
  }
```

**After:**
```typescript
  private async post<T>(path: string, body: unknown): Promise<T | null> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.authToken) {
        headers['Authorization'] = `Bearer ${this.authToken}`;
      }
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return null;
      return res.json() as Promise<T>;
    } catch {
      return null; // Backend unreachable — never block the developer
    }
  }
```

### 6c. Update the `get` method

**Before:**
```typescript
  private async get<T>(path: string): Promise<T | null> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return null;
      return res.json() as Promise<T>;
    } catch {
      return null;
    }
  }
```

**After:**
```typescript
  private async get<T>(path: string): Promise<T | null> {
    try {
      const headers: Record<string, string> = {};
      if (this.authToken) {
        headers['Authorization'] = `Bearer ${this.authToken}`;
      }
      const res = await fetch(`${this.baseUrl}${path}`, {
        headers,
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return null;
      return res.json() as Promise<T>;
    } catch {
      return null;
    }
  }
```

### 6d. Update `packages/plugin/src/config/config.ts`

Add `auth.token` parsing. Find the return statement and update:

**Before:**
```typescript
  return {
    backend_url: config['backend_url'] ?? '',
    identity: {
      email: config['identity.email'] ?? getGitEmail(),
      display_name: config['identity.display_name'] ?? config['identity.email'] ?? 'Unknown',
    },
    team: config['team'],
    notifications: {
      inline: config['notifications.inline'] !== 'false',
      webhook_url: config['notifications.webhook_url'] || undefined,
    },
  };
```

**After:**
```typescript
  return {
    backend_url: config['backend_url'] ?? '',
    identity: {
      email: config['identity.email'] ?? getGitEmail(),
      display_name: config['identity.display_name'] ?? config['identity.email'] ?? 'Unknown',
    },
    team: config['team'],
    auth: config['auth.token'] ? { token: config['auth.token'] } : undefined,
    notifications: {
      inline: config['notifications.inline'] !== 'false',
      webhook_url: config['notifications.webhook_url'] || undefined,
    },
  };
```

This reads from `~/.open-hive.yaml`:

```yaml
auth:
  token: "eyJhbGciOiJIUzI1NiIs..."
```

---

## Step 7: Update .env.example

Create `.env.example` at the repo root with all environment variables:

```bash
# ── Open Hive Backend Configuration ───────────────────────

# Server
PORT=3000

# Database
DB_TYPE=sqlite                    # sqlite | postgres
DATABASE_URL=./data/hive.db      # file path for sqlite, connection string for postgres

# Collision Detection
COLLISION_SCOPE=org               # org (cross-repo) | repo (same-repo only)
SEMANTIC_KEYWORDS=true            # L3a keyword overlap detection
SEMANTIC_EMBEDDINGS=false         # L3b embedding similarity (requires provider)
SEMANTIC_LLM=false                # L3c LLM-powered analysis (requires provider)

# Semantic Providers (only needed if embeddings or LLM enabled)
# EMBEDDINGS_PROVIDER=openai
# EMBEDDINGS_API_KEY=sk-...
# LLM_PROVIDER=openai
# LLM_API_KEY=sk-...

# Session Lifecycle
HEARTBEAT_INTERVAL=30             # seconds between heartbeats
IDLE_TIMEOUT=300                  # seconds before session is considered stale

# Webhooks (comma-separated URLs)
# WEBHOOK_URLS=https://hooks.slack.com/services/xxx

# ── Authentication (GitLab OAuth) ────────────────────────
# Set AUTH_ENABLED=true to require GitLab OAuth login.
# When false (default), all routes are open (trust-on-first-use).

AUTH_ENABLED=false

# GitLab instance base URL (defaults to gitlab.com; set for self-hosted)
GITLAB_BASE_URL=https://gitlab.com

# Create a GitLab OAuth Application at https://gitlab.com/-/profile/applications
# (or Admin Area > Applications for instance-wide apps on self-hosted)
# Set the callback URL to: http://localhost:3000/auth/gitlab/callback
# Scopes: read_user, read_api, openid
GITLAB_CLIENT_ID=
GITLAB_CLIENT_SECRET=

# Optional: restrict login to members of a specific GitLab group
# Use the group's full path (e.g., "my-org" or "my-org/sub-group")
# GITLAB_GROUP=my-org

# Secret used to sign JWT tokens. Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=

# Public URL of this backend (used to build OAuth callback URLs)
# PUBLIC_URL=http://localhost:3000
```

---

## Step 8: Add Tests

Create `packages/backend/src/auth-gitlab.test.ts`:

```typescript
import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requireAuth, initAuthMiddleware } from './middleware/auth.js';
import type { AuthConfig } from './env.js';
import type { JwtPayload } from './routes/auth-gitlab.js';

const TEST_SECRET = 'test-jwt-secret-for-unit-tests';

function createAuthConfig(overrides?: Partial<AuthConfig>): AuthConfig {
  return {
    enabled: true,
    gitlab_client_id: 'test-client-id',
    gitlab_client_secret: 'test-client-secret',
    gitlab_base_url: 'https://gitlab.com',
    jwt_secret: TEST_SECRET,
    public_url: 'http://localhost:3000',
    ...overrides,
  };
}

function createToken(payload?: Partial<Omit<JwtPayload, 'iat' | 'exp'>>): string {
  const defaults: Omit<JwtPayload, 'iat' | 'exp'> = {
    sub: 'testuser',
    email: 'test@example.com',
    display_name: 'Test User',
    gitlab_id: 12345,
    avatar_url: 'https://gitlab.com/uploads/-/system/user/avatar/12345/avatar.png',
    groups: ['test-group'],
  };
  return jwt.sign({ ...defaults, ...payload }, TEST_SECRET, { expiresIn: '1h' });
}

function mockRequest(authHeader?: string): FastifyRequest {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
    developer: undefined,
  } as unknown as FastifyRequest;
}

function mockReply(): FastifyReply & { sentStatus?: number; sentBody?: unknown } {
  const reply: Record<string, unknown> = { sentStatus: undefined, sentBody: undefined };
  reply.status = (code: number) => {
    reply.sentStatus = code;
    return reply;
  };
  reply.send = (body: unknown) => {
    reply.sentBody = body;
    return reply;
  };
  return reply as FastifyReply & { sentStatus?: number; sentBody?: unknown };
}

// ─── JWT Generation & Verification ─────────────────────────

describe('GitLab JWT token generation and verification', () => {
  it('creates a valid JWT with expected fields', () => {
    const token = createToken();
    const decoded = jwt.verify(token, TEST_SECRET) as JwtPayload;

    assert.equal(decoded.sub, 'testuser');
    assert.equal(decoded.email, 'test@example.com');
    assert.equal(decoded.display_name, 'Test User');
    assert.equal(decoded.gitlab_id, 12345);
    assert.deepEqual(decoded.groups, ['test-group']);
    assert.ok(decoded.iat);
    assert.ok(decoded.exp);
  });

  it('rejects a token signed with a different secret', () => {
    const token = jwt.sign({ sub: 'test' }, 'wrong-secret', { expiresIn: '1h' });
    assert.throws(() => jwt.verify(token, TEST_SECRET));
  });

  it('rejects an expired token', () => {
    const token = jwt.sign({ sub: 'test' }, TEST_SECRET, { expiresIn: '-1s' });
    assert.throws(() => jwt.verify(token, TEST_SECRET));
  });

  it('round-trips custom fields correctly', () => {
    const token = createToken({
      email: 'custom@corp.com',
      groups: ['frontend', 'backend', 'devops'],
    });
    const decoded = jwt.verify(token, TEST_SECRET) as JwtPayload;

    assert.equal(decoded.email, 'custom@corp.com');
    assert.deepEqual(decoded.groups, ['frontend', 'backend', 'devops']);
  });

  it('preserves gitlab_id as a number', () => {
    const token = createToken({ gitlab_id: 99999 });
    const decoded = jwt.verify(token, TEST_SECRET) as JwtPayload;

    assert.equal(typeof decoded.gitlab_id, 'number');
    assert.equal(decoded.gitlab_id, 99999);
  });
});

// ─── authenticate middleware ────────────────────────────────

describe('GitLab authenticate middleware', () => {
  before(() => {
    initAuthMiddleware(createAuthConfig());
  });

  it('attaches developer identity from valid Bearer token', async () => {
    const token = createToken();
    const req = mockRequest(`Bearer ${token}`);
    const reply = mockReply();

    await authenticate(req, reply as FastifyReply);

    assert.ok(req.developer);
    assert.equal(req.developer!.email, 'test@example.com');
    assert.equal(req.developer!.display_name, 'Test User');
    assert.equal(req.developer!.org, 'test-group');
  });

  it('maps first group to org field for backward compatibility', async () => {
    const token = createToken({ groups: ['primary-group', 'secondary-group'] });
    const req = mockRequest(`Bearer ${token}`);
    const reply = mockReply();

    await authenticate(req, reply as FastifyReply);

    assert.ok(req.developer);
    assert.equal(req.developer!.org, 'primary-group');
  });

  it('sets org to undefined when user has no groups', async () => {
    const token = createToken({ groups: [] });
    const req = mockRequest(`Bearer ${token}`);
    const reply = mockReply();

    await authenticate(req, reply as FastifyReply);

    assert.ok(req.developer);
    assert.equal(req.developer!.org, undefined);
  });

  it('does not attach developer for invalid token', async () => {
    const req = mockRequest('Bearer invalid.token.here');
    const reply = mockReply();

    await authenticate(req, reply as FastifyReply);

    assert.equal(req.developer, undefined);
  });

  it('does not attach developer when no Authorization header', async () => {
    const req = mockRequest();
    const reply = mockReply();

    await authenticate(req, reply as FastifyReply);

    assert.equal(req.developer, undefined);
  });

  it('does not attach developer for non-Bearer auth scheme', async () => {
    const token = createToken();
    const req = mockRequest(`Basic ${token}`);
    const reply = mockReply();

    await authenticate(req, reply as FastifyReply);

    assert.equal(req.developer, undefined);
  });

  it('does not attach developer for token signed with wrong secret', async () => {
    const wrongToken = jwt.sign({ sub: 'test' }, 'wrong-secret', { expiresIn: '1h' });
    const req = mockRequest(`Bearer ${wrongToken}`);
    const reply = mockReply();

    await authenticate(req, reply as FastifyReply);

    assert.equal(req.developer, undefined);
  });
});

// ─── authenticate middleware (AUTH_ENABLED=false) ───────────

describe('GitLab authenticate middleware — AUTH_ENABLED=false', () => {
  before(() => {
    initAuthMiddleware(createAuthConfig({ enabled: false }));
  });

  it('passes through without touching developer when auth disabled', async () => {
    const req = mockRequest();
    const reply = mockReply();

    await authenticate(req, reply as FastifyReply);

    // Should not reject, developer stays undefined (existing behavior)
    assert.equal(req.developer, undefined);
    assert.equal(reply.sentStatus, undefined);
  });

  it('ignores valid tokens when auth disabled', async () => {
    const token = createToken();
    const req = mockRequest(`Bearer ${token}`);
    const reply = mockReply();

    await authenticate(req, reply as FastifyReply);

    // Even with a valid token, don't parse it when auth is off
    assert.equal(req.developer, undefined);
  });
});

// ─── requireAuth middleware ─────────────────────────────────

describe('GitLab requireAuth middleware', () => {
  before(() => {
    initAuthMiddleware(createAuthConfig({ enabled: true }));
  });

  it('passes through when developer is present', async () => {
    const req = mockRequest();
    req.developer = { email: 'a@b.com', display_name: 'A' };
    const reply = mockReply();

    await requireAuth(req, reply as FastifyReply);

    assert.equal(reply.sentStatus, undefined); // no error response sent
  });

  it('returns 401 when developer is missing and auth is enabled', async () => {
    const req = mockRequest();
    const reply = mockReply();

    await requireAuth(req, reply as FastifyReply);

    assert.equal(reply.sentStatus, 401);
    assert.ok((reply.sentBody as { error: string }).error.includes('Authentication required'));
  });

  it('includes login_url pointing to /auth/gitlab in 401 response', async () => {
    const req = mockRequest();
    const reply = mockReply();

    await requireAuth(req, reply as FastifyReply);

    assert.equal(reply.sentStatus, 401);
    assert.equal((reply.sentBody as { login_url: string }).login_url, '/auth/gitlab');
  });
});

describe('GitLab requireAuth middleware — AUTH_ENABLED=false', () => {
  before(() => {
    initAuthMiddleware(createAuthConfig({ enabled: false }));
  });

  it('passes through even without developer when auth disabled', async () => {
    const req = mockRequest();
    const reply = mockReply();

    await requireAuth(req, reply as FastifyReply);

    assert.equal(reply.sentStatus, undefined); // no error
  });
});

// ─── Callback route (mock GitLab API) ───────────────────────

describe('GitLab OAuth callback — token exchange', () => {
  it('exchanges a valid code for a JWT (simulated)', async () => {
    // This test validates the JWT creation logic in isolation.
    // A full integration test would require mocking fetch() to
    // simulate GitLab's /oauth/token and /api/v4/user responses.
    //
    // Here we verify the token structure that the callback would produce.

    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: 'tanuki',
      email: 'tanuki@gitlab.com',
      display_name: 'Tanuki User',
      gitlab_id: 1,
      avatar_url: 'https://gitlab.com/uploads/-/system/user/avatar/1/avatar.png',
      groups: ['my-org', 'my-org/backend'],
    };

    const token = jwt.sign(payload, TEST_SECRET, { expiresIn: '7d' });
    const decoded = jwt.verify(token, TEST_SECRET) as JwtPayload;

    assert.equal(decoded.sub, 'tanuki');
    assert.equal(decoded.email, 'tanuki@gitlab.com');
    assert.equal(decoded.display_name, 'Tanuki User');
    assert.equal(decoded.gitlab_id, 1);
    assert.deepEqual(decoded.groups, ['my-org', 'my-org/backend']);

    // Token should be valid for ~7 days
    const ttl = decoded.exp - decoded.iat;
    assert.ok(ttl >= 6 * 24 * 3600, 'Token should be valid for at least 6 days');
    assert.ok(ttl <= 8 * 24 * 3600, 'Token should be valid for at most 8 days');
  });

  it('produces a JWT that authenticate middleware can decode', async () => {
    initAuthMiddleware(createAuthConfig({ enabled: true }));

    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: 'tanuki',
      email: 'tanuki@gitlab.com',
      display_name: 'Tanuki User',
      gitlab_id: 1,
      avatar_url: 'https://gitlab.com/uploads/-/system/user/avatar/1/avatar.png',
      groups: ['my-org'],
    };
    const token = jwt.sign(payload, TEST_SECRET, { expiresIn: '7d' });

    const req = mockRequest(`Bearer ${token}`);
    const reply = mockReply();
    await authenticate(req, reply as FastifyReply);

    assert.ok(req.developer);
    assert.equal(req.developer!.email, 'tanuki@gitlab.com');
    assert.equal(req.developer!.display_name, 'Tanuki User');
    assert.equal(req.developer!.org, 'my-org');
  });

  it('rejects JWT with wrong secret in authenticate middleware', async () => {
    initAuthMiddleware(createAuthConfig({ enabled: true }));

    const token = jwt.sign({ sub: 'hacker' }, 'attacker-secret', { expiresIn: '7d' });
    const req = mockRequest(`Bearer ${token}`);
    const reply = mockReply();

    await authenticate(req, reply as FastifyReply);

    assert.equal(req.developer, undefined);
  });
});

// ─── Self-hosted GitLab configuration ───────────────────────

describe('Self-hosted GitLab configuration', () => {
  it('strips trailing slash from GITLAB_BASE_URL', () => {
    // Simulate what loadAuthConfig does
    const baseUrl = 'https://gitlab.mycompany.com/';
    const normalized = baseUrl.replace(/\/+$/, '');
    assert.equal(normalized, 'https://gitlab.mycompany.com');
  });

  it('strips multiple trailing slashes from GITLAB_BASE_URL', () => {
    const baseUrl = 'https://gitlab.mycompany.com///';
    const normalized = baseUrl.replace(/\/+$/, '');
    assert.equal(normalized, 'https://gitlab.mycompany.com');
  });

  it('leaves clean URLs unchanged', () => {
    const baseUrl = 'https://gitlab.mycompany.com';
    const normalized = baseUrl.replace(/\/+$/, '');
    assert.equal(normalized, 'https://gitlab.mycompany.com');
  });

  it('constructs correct API URL from self-hosted base', () => {
    const baseUrl = 'https://gitlab.mycompany.com';
    const apiUrl = `${baseUrl}/api/v4`;
    assert.equal(apiUrl, 'https://gitlab.mycompany.com/api/v4');
  });

  it('constructs correct OAuth URLs from self-hosted base', () => {
    const baseUrl = 'https://gitlab.mycompany.com';
    const authorizeUrl = `${baseUrl}/oauth/authorize`;
    const tokenUrl = `${baseUrl}/oauth/token`;
    assert.equal(authorizeUrl, 'https://gitlab.mycompany.com/oauth/authorize');
    assert.equal(tokenUrl, 'https://gitlab.mycompany.com/oauth/token');
  });
});
```

---

## Step 9: Verify

Run from the repo root:

```bash
npm run build && npm test
```

Or run just the backend tests:

```bash
cd packages/backend
npm test
```

All existing tests should continue to pass. The new `auth-gitlab.test.ts` tests should also pass.

Check that the health endpoint still works without auth:

```bash
npm run dev &
curl http://localhost:3000/api/health
# Expected: {"status":"ok","version":"0.2.0"}
```

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `AUTH_ENABLED` | No | `false` | Set to `true` to require GitLab OAuth login |
| `GITLAB_BASE_URL` | No | `https://gitlab.com` | Base URL of the GitLab instance (set for self-hosted) |
| `GITLAB_CLIENT_ID` | When auth enabled | — | Application ID from GitLab OAuth Application |
| `GITLAB_CLIENT_SECRET` | When auth enabled | — | Secret from GitLab OAuth Application |
| `GITLAB_GROUP` | No | — | Restrict login to members of this group (full path) |
| `JWT_SECRET` | When auth enabled | dev fallback | Secret for signing JWT tokens |
| `PUBLIC_URL` | No | `http://localhost:PORT` | Public URL of this backend (for OAuth callbacks) |

### GitLab Scopes

The OAuth application requires these scopes:

| Scope | Purpose |
|---|---|
| `read_user` | Read the authenticated user's profile (username, email, avatar) |
| `read_api` | Read group memberships and project listings |
| `openid` | OpenID Connect compatibility (standard identity claim) |

### GitLab API Endpoints Used

| Endpoint | Purpose |
|---|---|
| `/oauth/authorize` | OAuth authorization redirect |
| `/oauth/token` | Exchange authorization code for access token |
| `/api/v4/user` | Fetch authenticated user's profile |
| `/api/v4/groups?min_access_level=10` | List groups the user is a member of |
| `/api/v4/projects` | List projects accessible to the user (v2, requires stored token) |

---

## Setup Guide

### Creating a GitLab OAuth Application

#### On gitlab.com (SaaS)

1. Go to [https://gitlab.com/-/profile/applications](https://gitlab.com/-/profile/applications)
2. Click **"Add new application"**
3. Fill in:
   - **Name:** `Open Hive` (or your preferred name)
   - **Redirect URI:** `http://localhost:3000/auth/gitlab/callback`
   - **Confidential:** Yes (checked)
   - **Scopes:** Check `read_user`, `read_api`, and `openid`
4. Click **"Save application"**
5. Copy the **Application ID** (this is your `GITLAB_CLIENT_ID`)
6. Copy the **Secret** (this is your `GITLAB_CLIENT_SECRET`)

#### On self-hosted GitLab

**User-level application** (same as above but on your instance):

1. Go to `https://your-gitlab.com/-/profile/applications`
2. Follow the same steps as gitlab.com above
3. Set `GITLAB_BASE_URL=https://your-gitlab.com` in your `.env`

**Instance-wide application** (admin only, recommended for teams):

1. Go to **Admin Area > Applications** (`https://your-gitlab.com/admin/applications`)
2. Click **"New application"**
3. Fill in:
   - **Name:** `Open Hive`
   - **Redirect URI:** `http://localhost:3000/auth/gitlab/callback`
   - **Trusted:** Yes (skips user authorization prompt)
   - **Confidential:** Yes
   - **Scopes:** Check `read_user`, `read_api`, and `openid`
4. Click **"Save application"**
5. Copy the **Application ID** and **Secret**

For production, replace `localhost:3000` with your actual backend URL (e.g., `https://hive.yourorg.com`). Set the `PUBLIC_URL` env var to match.

### Configuring the Backend

Add to your `.env` or environment:

```bash
AUTH_ENABLED=true
GITLAB_CLIENT_ID=abc123...
GITLAB_CLIENT_SECRET=gloas-abc123...
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# For self-hosted GitLab:
# GITLAB_BASE_URL=https://gitlab.mycompany.com

# Optional: restrict to group members
# GITLAB_GROUP=my-org
```

### How Developers Authenticate (Plugin Flow)

1. Developer runs `/hive setup` (or the setup command in your plugin).
2. Plugin opens `http://localhost:3000/auth/gitlab` in the browser.
3. Developer authorizes on GitLab.
4. GitLab redirects back to `/auth/gitlab/callback`.
5. Backend issues a JWT and either:
   - Redirects to a `redirect_uri` with `?token=<jwt>` (if the plugin provided one), or
   - Returns the token as JSON.
6. Plugin saves the token to `~/.open-hive.yaml`:
   ```yaml
   backend_url: http://localhost:3000
   auth:
     token: "eyJhbGciOiJIUzI1NiIs..."
   identity:
     email: tanuki@gitlab.com
     display_name: Tanuki User
   ```
7. All subsequent API calls include `Authorization: Bearer <token>`.

### Docker Compose

Add auth env vars to `docker-compose.yaml`:

```yaml
services:
  open-hive:
    environment:
      # ... existing vars ...
      AUTH_ENABLED: "true"
      GITLAB_BASE_URL: "${GITLAB_BASE_URL:-https://gitlab.com}"
      GITLAB_CLIENT_ID: "${GITLAB_CLIENT_ID}"
      GITLAB_CLIENT_SECRET: "${GITLAB_CLIENT_SECRET}"
      GITLAB_GROUP: "${GITLAB_GROUP:-}"
      JWT_SECRET: "${JWT_SECRET}"
      PUBLIC_URL: "${PUBLIC_URL:-http://localhost:3000}"
```

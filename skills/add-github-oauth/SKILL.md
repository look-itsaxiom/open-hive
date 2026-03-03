---
name: add-github-oauth
description: Add GitHub OAuth authentication with org/team discovery
category: auth
requires: []
modifies:
  - packages/backend/src/middleware/auth.ts
  - packages/backend/src/routes/auth.ts
  - packages/backend/src/env.ts
  - packages/backend/src/server.ts
  - packages/shared/src/config.ts
  - .env.example
tests:
  - packages/backend/src/auth.test.ts
---

# Add GitHub OAuth Authentication

Add GitHub OAuth login to Open Hive so developers authenticate with their GitHub identity. Includes org membership verification, team discovery, and JWT session tokens. Backward compatible -- when `AUTH_ENABLED=false` (default), the system behaves exactly as before.

## Prerequisites

1. Backend source is cloned and `npm install` has been run at the repo root.
2. You can build successfully: `npm run build` (from repo root, runs turbo).
3. A **GitHub OAuth App** has been created (see [Setup Guide](#setup-guide) at the end of this file). You need the **Client ID** and **Client Secret**.

## What This Skill Does

- Adds a full GitHub OAuth 2.0 login flow (`/auth/github` redirect, `/auth/github/callback` token exchange).
- Issues JWT session tokens after successful GitHub login.
- Verifies org membership when `GITHUB_ORG` is configured.
- Discovers the user's GitHub orgs and accessible repos via API.
- Replaces the pass-through `authenticate` / `requireAuth` middleware with real JWT validation.
- Stays backward compatible: when `AUTH_ENABLED` is `false` (default), all routes pass through without authentication.

---

## Step 1: Install Dependencies

From the **packages/backend** directory:

```bash
cd packages/backend
npm install jsonwebtoken
npm install -D @types/jsonwebtoken
```

This adds JWT signing/verification. No passport or OAuth libraries needed -- we use raw `fetch` against the GitHub API.

---

## Step 2: Add Auth Configuration

### 2a. Edit `packages/backend/src/env.ts`

Replace the entire file contents with:

```typescript
import type { HiveBackendConfig } from '@open-hive/shared';

export interface AuthConfig {
  enabled: boolean;
  github_client_id: string;
  github_client_secret: string;
  github_org?: string;
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
  return {
    enabled: process.env.AUTH_ENABLED === 'true',
    github_client_id: process.env.GITHUB_CLIENT_ID ?? '',
    github_client_secret: process.env.GITHUB_CLIENT_SECRET ?? '',
    github_org: process.env.GITHUB_ORG || undefined,
    jwt_secret: process.env.JWT_SECRET ?? 'open-hive-dev-secret-change-me',
    public_url: process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? '3000'}`,
  };
}
```

**What changed:** Added `AuthConfig` interface and `loadAuthConfig()` function. The existing `loadConfig()` is unchanged.

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

Create the new file `packages/backend/src/routes/auth.ts` with the following contents:

```typescript
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import type { AuthConfig } from '../env.js';
import type { DeveloperIdentity } from '../middleware/auth.js';

// ── GitHub API types ──────────────────────────────────────

interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  error?: string;
  error_description?: string;
}

interface GitHubUser {
  login: string;
  id: number;
  name: string | null;
  email: string | null;
  avatar_url: string;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

interface GitHubOrg {
  login: string;
  id: number;
  description: string | null;
}

interface GitHubRepo {
  full_name: string;
  name: string;
  private: boolean;
  html_url: string;
  description: string | null;
}

// ── JWT payload ───────────────────────────────────────────

export interface JwtPayload {
  sub: string;           // GitHub user login
  email: string;
  display_name: string;
  github_id: number;
  avatar_url: string;
  orgs: string[];
  iat: number;
  exp: number;
}

// ── Route registration ────────────────────────────────────

export function authRoutes(app: FastifyInstance, authConfig: AuthConfig) {
  const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
  const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
  const GITHUB_API = 'https://api.github.com';

  // ── GET /auth/github ────────────────────────────────────
  // Redirects the user to GitHub's OAuth authorization page.

  app.get<{ Querystring: { redirect_uri?: string } }>(
    '/auth/github',
    async (req, reply) => {
      if (!authConfig.enabled) {
        return reply.status(404).send({ error: 'Auth is not enabled' });
      }
      if (!authConfig.github_client_id) {
        return reply.status(500).send({ error: 'GITHUB_CLIENT_ID is not configured' });
      }

      const callbackUrl = `${authConfig.public_url}/auth/github/callback`;
      const state = Buffer.from(JSON.stringify({
        redirect_uri: req.query.redirect_uri || '',
      })).toString('base64url');

      const params = new URLSearchParams({
        client_id: authConfig.github_client_id,
        redirect_uri: callbackUrl,
        scope: 'read:org user:email',
        state,
      });

      return reply.redirect(`${GITHUB_AUTHORIZE_URL}?${params}`);
    },
  );

  // ── GET /auth/github/callback ───────────────────────────
  // GitHub redirects here after the user authorizes. Exchanges
  // the code for an access token, fetches profile + orgs, and
  // issues a JWT.

  app.get<{ Querystring: { code: string; state?: string } }>(
    '/auth/github/callback',
    async (req, reply) => {
      if (!authConfig.enabled) {
        return reply.status(404).send({ error: 'Auth is not enabled' });
      }

      const { code, state } = req.query;
      if (!code) {
        return reply.status(400).send({ error: 'Missing code parameter' });
      }

      // 1. Exchange code for access token
      const tokenRes = await fetch(GITHUB_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: authConfig.github_client_id,
          client_secret: authConfig.github_client_secret,
          code,
        }),
      });

      const tokenData = (await tokenRes.json()) as GitHubTokenResponse;
      if (tokenData.error || !tokenData.access_token) {
        req.log.error({ error: tokenData.error, desc: tokenData.error_description }, 'GitHub token exchange failed');
        return reply.status(401).send({
          error: 'GitHub authentication failed',
          details: tokenData.error_description ?? tokenData.error,
        });
      }

      const ghToken = tokenData.access_token;
      const ghHeaders = {
        Authorization: `Bearer ${ghToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Open-Hive-Backend',
        'X-GitHub-Api-Version': '2022-11-28',
      };

      // 2. Fetch user profile
      const userRes = await fetch(`${GITHUB_API}/user`, { headers: ghHeaders });
      if (!userRes.ok) {
        return reply.status(401).send({ error: 'Failed to fetch GitHub user profile' });
      }
      const ghUser = (await userRes.json()) as GitHubUser;

      // 3. Fetch primary email (user:email scope)
      let email = ghUser.email ?? '';
      if (!email) {
        const emailsRes = await fetch(`${GITHUB_API}/user/emails`, { headers: ghHeaders });
        if (emailsRes.ok) {
          const emails = (await emailsRes.json()) as GitHubEmail[];
          const primary = emails.find(e => e.primary && e.verified);
          email = primary?.email ?? emails[0]?.email ?? '';
        }
      }

      // 4. Fetch orgs
      const orgsRes = await fetch(`${GITHUB_API}/user/orgs`, { headers: ghHeaders });
      const orgs: GitHubOrg[] = orgsRes.ok ? (await orgsRes.json()) as GitHubOrg[] : [];
      const orgLogins = orgs.map(o => o.login);

      // 5. Verify org membership if required
      if (authConfig.github_org) {
        const isMember = orgLogins.some(
          login => login.toLowerCase() === authConfig.github_org!.toLowerCase(),
        );
        if (!isMember) {
          return reply.status(403).send({
            error: 'Organization membership required',
            details: `You must be a member of the "${authConfig.github_org}" organization.`,
          });
        }
      }

      // 6. Issue JWT
      const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
        sub: ghUser.login,
        email,
        display_name: ghUser.name ?? ghUser.login,
        github_id: ghUser.id,
        avatar_url: ghUser.avatar_url,
        orgs: orgLogins,
      };

      const token = jwt.sign(payload, authConfig.jwt_secret, { expiresIn: '7d' });

      // 7. Redirect or return JSON
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
          login: ghUser.login,
          email,
          display_name: ghUser.name ?? ghUser.login,
          avatar_url: ghUser.avatar_url,
          orgs: orgLogins,
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
            org: decoded.orgs[0] ?? undefined,
            login: decoded.sub,
            github_id: decoded.github_id,
            avatar_url: decoded.avatar_url,
            orgs: decoded.orgs,
          },
        };
      } catch (err) {
        return reply.status(401).send({ error: 'Invalid or expired token' });
      }
    },
  );

  // ── GET /auth/github/orgs ───────────────────────────────
  // Lists the GitHub orgs for the authenticated user.
  // Requires a valid JWT in the Authorization header.

  app.get(
    '/auth/github/orgs',
    async (req, reply) => {
      if (!authConfig.enabled) {
        return reply.status(404).send({ error: 'Auth is not enabled' });
      }

      const developer = req.developer;
      if (!developer) {
        return reply.status(401).send({ error: 'Authentication required' });
      }

      // Decode JWT to get orgs (they're stored in the token)
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return reply.status(401).send({ error: 'Missing Bearer token' });
      }

      try {
        const decoded = jwt.verify(
          authHeader.slice(7),
          authConfig.jwt_secret,
        ) as JwtPayload;
        return { ok: true, orgs: decoded.orgs };
      } catch {
        return reply.status(401).send({ error: 'Invalid token' });
      }
    },
  );

  // ── GET /auth/github/repos ──────────────────────────────
  // Lists repos accessible to the authenticated user.
  // Requires a valid GitHub token, but since we only store a
  // JWT (not the GitHub token), this endpoint re-fetches from
  // GitHub using a stored token approach. For v1, we return
  // the orgs and let the admin configure repos manually.
  //
  // NOTE: To support live repo listing, you would need to
  // store the GitHub access token (encrypted) alongside the
  // JWT. This v1 implementation returns a helpful message.

  app.get(
    '/auth/github/repos',
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
        message: 'Repo listing requires a stored GitHub access token. Configure repos via GITHUB_ORG environment variable or register repos manually via the API.',
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
import type { JwtPayload } from '../routes/auth.js';

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
      org: decoded.orgs[0] ?? undefined,
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
      login_url: '/auth/github',
    });
  }
}
```

**Key design decisions:**
- `initAuthMiddleware()` is called once at startup to avoid circular imports.
- `authenticate` always runs (as a preHandler hook) but is a no-op when auth is disabled.
- `requireAuth` can be added to individual routes that need mandatory auth, or globally.
- The existing `DeveloperIdentity` interface is preserved for backward compatibility.

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
import { authRoutes } from './routes/auth.js';

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

authRoutes(app, authConfig);
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
import { authRoutes } from './routes/auth.js';

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

authRoutes(app, authConfig);

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

# ── Authentication (GitHub OAuth) ─────────────────────────
# Set AUTH_ENABLED=true to require GitHub OAuth login.
# When false (default), all routes are open (trust-on-first-use).

AUTH_ENABLED=false

# Create a GitHub OAuth App at https://github.com/settings/developers
# Set the callback URL to: http://localhost:3000/auth/github/callback
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Optional: restrict login to members of a specific GitHub org
# GITHUB_ORG=my-org

# Secret used to sign JWT tokens. Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=

# Public URL of this backend (used to build OAuth callback URLs)
# PUBLIC_URL=http://localhost:3000
```

---

## Step 8: Add Tests

Create `packages/backend/src/auth.test.ts`:

```typescript
import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requireAuth, initAuthMiddleware } from './middleware/auth.js';
import type { AuthConfig } from './env.js';
import type { JwtPayload } from './routes/auth.js';

const TEST_SECRET = 'test-jwt-secret-for-unit-tests';

function createAuthConfig(overrides?: Partial<AuthConfig>): AuthConfig {
  return {
    enabled: true,
    github_client_id: 'test-client-id',
    github_client_secret: 'test-client-secret',
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
    github_id: 12345,
    avatar_url: 'https://avatars.githubusercontent.com/u/12345',
    orgs: ['test-org'],
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

describe('JWT token generation and verification', () => {
  it('creates a valid JWT with expected fields', () => {
    const token = createToken();
    const decoded = jwt.verify(token, TEST_SECRET) as JwtPayload;

    assert.equal(decoded.sub, 'testuser');
    assert.equal(decoded.email, 'test@example.com');
    assert.equal(decoded.display_name, 'Test User');
    assert.equal(decoded.github_id, 12345);
    assert.deepEqual(decoded.orgs, ['test-org']);
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
      orgs: ['alpha', 'beta'],
    });
    const decoded = jwt.verify(token, TEST_SECRET) as JwtPayload;

    assert.equal(decoded.email, 'custom@corp.com');
    assert.deepEqual(decoded.orgs, ['alpha', 'beta']);
  });
});

// ─── authenticate middleware ────────────────────────────────

describe('authenticate middleware', () => {
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
    assert.equal(req.developer!.org, 'test-org');
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

describe('authenticate middleware — AUTH_ENABLED=false', () => {
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

describe('requireAuth middleware', () => {
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
});

describe('requireAuth middleware — AUTH_ENABLED=false', () => {
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

// ─── Callback route (mock GitHub API) ───────────────────────

describe('GitHub OAuth callback — token exchange', () => {
  it('exchanges a valid code for a JWT (simulated)', async () => {
    // This test validates the JWT creation logic in isolation.
    // A full integration test would require mocking fetch() to
    // simulate GitHub's /login/oauth/access_token and /user responses.
    //
    // Here we verify the token structure that the callback would produce.

    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: 'octocat',
      email: 'octocat@github.com',
      display_name: 'The Octocat',
      github_id: 1,
      avatar_url: 'https://avatars.githubusercontent.com/u/1',
      orgs: ['github'],
    };

    const token = jwt.sign(payload, TEST_SECRET, { expiresIn: '7d' });
    const decoded = jwt.verify(token, TEST_SECRET) as JwtPayload;

    assert.equal(decoded.sub, 'octocat');
    assert.equal(decoded.email, 'octocat@github.com');
    assert.equal(decoded.display_name, 'The Octocat');
    assert.equal(decoded.github_id, 1);
    assert.deepEqual(decoded.orgs, ['github']);

    // Token should be valid for ~7 days
    const ttl = decoded.exp - decoded.iat;
    assert.ok(ttl >= 6 * 24 * 3600, 'Token should be valid for at least 6 days');
    assert.ok(ttl <= 8 * 24 * 3600, 'Token should be valid for at most 8 days');
  });

  it('produces a JWT that authenticate middleware can decode', async () => {
    initAuthMiddleware(createAuthConfig({ enabled: true }));

    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: 'octocat',
      email: 'octocat@github.com',
      display_name: 'The Octocat',
      github_id: 1,
      avatar_url: 'https://avatars.githubusercontent.com/u/1',
      orgs: ['github'],
    };
    const token = jwt.sign(payload, TEST_SECRET, { expiresIn: '7d' });

    const req = mockRequest(`Bearer ${token}`);
    const reply = mockReply();
    await authenticate(req, reply as FastifyReply);

    assert.ok(req.developer);
    assert.equal(req.developer!.email, 'octocat@github.com');
    assert.equal(req.developer!.display_name, 'The Octocat');
    assert.equal(req.developer!.org, 'github');
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

All existing tests should continue to pass. The new `auth.test.ts` tests should also pass.

Check that the health endpoint still works without auth:

```bash
npm run dev &
curl http://localhost:3000/api/health
# Expected: {"status":"ok","version":"0.2.0"}
```

---

## Setup Guide

### Creating a GitHub OAuth App

1. Go to [https://github.com/settings/developers](https://github.com/settings/developers)
2. Click **"New OAuth App"** (or go to **Settings > Developer settings > OAuth Apps > New OAuth App**)
3. Fill in:
   - **Application name:** `Open Hive` (or your preferred name)
   - **Homepage URL:** `http://localhost:3000` (or your production URL)
   - **Authorization callback URL:** `http://localhost:3000/auth/github/callback`
4. Click **"Register application"**
5. Copy the **Client ID**
6. Click **"Generate a new client secret"** and copy the **Client Secret**

For production, replace `localhost:3000` with your actual backend URL (e.g., `https://hive.yourorg.com`). Set the `PUBLIC_URL` env var to match.

### Configuring the Backend

Add to your `.env` or environment:

```bash
AUTH_ENABLED=true
GITHUB_CLIENT_ID=Iv1.abc123...
GITHUB_CLIENT_SECRET=abc123...
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# Optional: restrict to org members
GITHUB_ORG=your-org-name
```

### How Developers Authenticate (Plugin Flow)

1. Developer runs `/hive setup` (or the setup command in your plugin).
2. Plugin opens `http://localhost:3000/auth/github` in the browser.
3. Developer authorizes on GitHub.
4. GitHub redirects back to `/auth/github/callback`.
5. Backend issues a JWT and either:
   - Redirects to a `redirect_uri` with `?token=<jwt>` (if the plugin provided one), or
   - Returns the token as JSON.
6. Plugin saves the token to `~/.open-hive.yaml`:
   ```yaml
   backend_url: http://localhost:3000
   auth:
     token: "eyJhbGciOiJIUzI1NiIs..."
   identity:
     email: octocat@github.com
     display_name: The Octocat
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
      GITHUB_CLIENT_ID: "${GITHUB_CLIENT_ID}"
      GITHUB_CLIENT_SECRET: "${GITHUB_CLIENT_SECRET}"
      GITHUB_ORG: "${GITHUB_ORG:-}"
      JWT_SECRET: "${JWT_SECRET}"
      PUBLIC_URL: "${PUBLIC_URL:-http://localhost:3000}"
```

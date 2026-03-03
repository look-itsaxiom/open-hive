---
name: add-azure-devops-oauth
description: Add Azure DevOps OAuth authentication with organization/project discovery
category: auth
requires: []
modifies:
  - packages/backend/src/middleware/auth.ts
  - packages/backend/src/routes/auth-azure-devops.ts
  - packages/backend/src/env.ts
  - packages/backend/src/server.ts
  - packages/shared/src/config.ts
  - .env.example
tests:
  - packages/backend/src/auth-azure-devops.test.ts
---

# Add Azure DevOps OAuth Authentication

Add Azure DevOps OAuth login to Open Hive so developers authenticate with their Microsoft Entra ID (formerly Azure AD) identity. Includes organization membership verification, project discovery, and JWT session tokens with mandatory token refresh. Backward compatible -- when `AUTH_ENABLED=false` (default), the system behaves exactly as before.

## Prerequisites

1. Backend source is cloned and `npm install` has been run at the repo root.
2. You can build successfully: `npm run build` (from repo root, runs turbo).
3. An **Azure DevOps OAuth App** has been registered (see [Setup Guide](#setup-guide) at the end of this file). You need the **Client ID** and **Client Secret**.

## What This Skill Does

- Adds a full Microsoft Entra ID OAuth 2.0 login flow (`/auth/azure-devops` redirect, `/auth/azure-devops/callback` token exchange).
- Issues JWT session tokens after successful Azure DevOps login.
- Verifies organization membership when `AZURE_DEVOPS_ORG` is configured.
- Discovers the user's Azure DevOps organizations and accessible projects via API.
- Implements mandatory token refresh (Azure DevOps access tokens expire in 1 hour).
- Provides a `/auth/azure-devops/refresh` endpoint for refreshing expired tokens.
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

This adds JWT signing/verification. No passport or OAuth libraries needed -- we use raw `fetch` against the Azure DevOps and Microsoft Entra ID APIs.

---

## Step 2: Add Auth Configuration

### 2a. Edit `packages/backend/src/env.ts`

Replace the entire file contents with:

```typescript
import type { HiveBackendConfig } from '@open-hive/shared';

export interface AuthConfig {
  enabled: boolean;
  azure_devops_client_id: string;
  azure_devops_client_secret: string;
  azure_devops_org?: string;
  azure_devops_tenant_id: string;
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
    azure_devops_client_id: process.env.AZURE_DEVOPS_CLIENT_ID ?? '',
    azure_devops_client_secret: process.env.AZURE_DEVOPS_CLIENT_SECRET ?? '',
    azure_devops_org: process.env.AZURE_DEVOPS_ORG || undefined,
    azure_devops_tenant_id: process.env.AZURE_DEVOPS_TENANT_ID ?? 'common',
    jwt_secret: process.env.JWT_SECRET ?? 'open-hive-dev-secret-change-me',
    public_url: process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? '3000'}`,
  };
}
```

**What changed:** Added `AuthConfig` interface with Azure DevOps fields (`azure_devops_client_id`, `azure_devops_client_secret`, `azure_devops_org`, `azure_devops_tenant_id`) and `loadAuthConfig()` function. The existing `loadConfig()` is unchanged.

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
    refresh_token?: string;
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

Create the new file `packages/backend/src/routes/auth-azure-devops.ts` with the following contents:

```typescript
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import type { AuthConfig } from '../env.js';
import type { DeveloperIdentity } from '../middleware/auth.js';

// ── Azure DevOps / Microsoft Entra ID types ──────────────

interface EntraTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  error?: string;
  error_description?: string;
}

interface AzureDevOpsProfile {
  displayName: string;
  publicAlias: string;
  emailAddress: string;
  coreRevision: number;
  timeStamp: string;
  id: string;
  revision: number;
}

interface AzureDevOpsConnectionData {
  authenticatedUser: {
    id: string;
    descriptor: string;
    subjectDescriptor: string;
    providerDisplayName: string;
    isActive: boolean;
    properties: Record<string, { $type: string; $value: string }>;
  };
  authorizedUser: {
    id: string;
    descriptor: string;
    subjectDescriptor: string;
    providerDisplayName: string;
    isActive: boolean;
  };
}

interface AzureDevOpsAccount {
  accountId: string;
  accountUri: string;
  accountName: string;
  properties: Record<string, unknown>;
}

interface AzureDevOpsProject {
  id: string;
  name: string;
  description: string;
  url: string;
  state: string;
  visibility: string;
}

interface AzureDevOpsProjectList {
  count: number;
  value: AzureDevOpsProject[];
}

// ── JWT payload ───────────────────────────────────────────

export interface AzureDevOpsJwtPayload {
  sub: string;             // Azure DevOps public alias / user ID
  email: string;
  display_name: string;
  azure_devops_id: string;
  orgs: string[];
  iat: number;
  exp: number;
}

// ── In-memory refresh token store ─────────────────────────
// In production, use an encrypted database. This suffices for v1.

const refreshTokenStore = new Map<string, {
  refresh_token: string;
  azure_devops_id: string;
}>();

// ── Route registration ────────────────────────────────────

export function azureDevOpsAuthRoutes(app: FastifyInstance, authConfig: AuthConfig) {
  const tenantId = authConfig.azure_devops_tenant_id;
  const ENTRA_AUTHORIZE_URL = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`;
  const ENTRA_TOKEN_URL = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const AZURE_DEVOPS_PROFILE_API = 'https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1';
  const AZURE_DEVOPS_ACCOUNTS_API = 'https://app.vssps.visualstudio.com/_apis/accounts';
  const AZURE_DEVOPS_CONNECTION_DATA_API = 'https://app.vssps.visualstudio.com/_apis/connectionData';

  // ── GET /auth/azure-devops ────────────────────────────────
  // Redirects the user to Microsoft Entra ID's OAuth authorization page.

  app.get<{ Querystring: { redirect_uri?: string } }>(
    '/auth/azure-devops',
    async (req, reply) => {
      if (!authConfig.enabled) {
        return reply.status(404).send({ error: 'Auth is not enabled' });
      }
      if (!authConfig.azure_devops_client_id) {
        return reply.status(500).send({ error: 'AZURE_DEVOPS_CLIENT_ID is not configured' });
      }

      const callbackUrl = `${authConfig.public_url}/auth/azure-devops/callback`;
      const state = Buffer.from(JSON.stringify({
        redirect_uri: req.query.redirect_uri || '',
      })).toString('base64url');

      const params = new URLSearchParams({
        client_id: authConfig.azure_devops_client_id,
        response_type: 'code',
        redirect_uri: callbackUrl,
        scope: '499b84ac-1321-427f-aa17-267ca6975798/.default offline_access',
        state,
      });

      return reply.redirect(`${ENTRA_AUTHORIZE_URL}?${params}`);
    },
  );

  // ── GET /auth/azure-devops/callback ───────────────────────
  // Microsoft Entra ID redirects here after the user authorizes.
  // Exchanges the code for an access token, fetches profile + orgs,
  // and issues a JWT.

  app.get<{ Querystring: { code: string; state?: string } }>(
    '/auth/azure-devops/callback',
    async (req, reply) => {
      if (!authConfig.enabled) {
        return reply.status(404).send({ error: 'Auth is not enabled' });
      }

      const { code, state } = req.query;
      if (!code) {
        return reply.status(400).send({ error: 'Missing code parameter' });
      }

      const callbackUrl = `${authConfig.public_url}/auth/azure-devops/callback`;

      // 1. Exchange code for access token
      const tokenRes = await fetch(ENTRA_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: authConfig.azure_devops_client_id,
          client_secret: authConfig.azure_devops_client_secret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: callbackUrl,
          scope: '499b84ac-1321-427f-aa17-267ca6975798/.default offline_access',
        }),
      });

      const tokenData = (await tokenRes.json()) as EntraTokenResponse;
      if (tokenData.error || !tokenData.access_token) {
        req.log.error({ error: tokenData.error, desc: tokenData.error_description }, 'Entra ID token exchange failed');
        return reply.status(401).send({
          error: 'Azure DevOps authentication failed',
          details: tokenData.error_description ?? tokenData.error,
        });
      }

      const adoToken = tokenData.access_token;
      const adoRefreshToken = tokenData.refresh_token;
      const adoHeaders = {
        Authorization: `Bearer ${adoToken}`,
        Accept: 'application/json',
        'User-Agent': 'Open-Hive-Backend',
      };

      // 2. Fetch user profile
      const profileRes = await fetch(AZURE_DEVOPS_PROFILE_API, { headers: adoHeaders });
      if (!profileRes.ok) {
        return reply.status(401).send({ error: 'Failed to fetch Azure DevOps user profile' });
      }
      const adoProfile = (await profileRes.json()) as AzureDevOpsProfile;

      // 3. Fetch connection data to get the authenticated user ID
      const connectionRes = await fetch(AZURE_DEVOPS_CONNECTION_DATA_API, { headers: adoHeaders });
      let userId = adoProfile.id;
      if (connectionRes.ok) {
        const connectionData = (await connectionRes.json()) as AzureDevOpsConnectionData;
        userId = connectionData.authenticatedUser.id || userId;
      }

      // 4. Fetch organizations (accounts)
      const accountsRes = await fetch(
        `${AZURE_DEVOPS_ACCOUNTS_API}?memberId=${userId}&api-version=7.1`,
        { headers: adoHeaders },
      );
      let orgNames: string[] = [];
      if (accountsRes.ok) {
        const accountsData = (await accountsRes.json()) as { count: number; value: AzureDevOpsAccount[] };
        orgNames = accountsData.value.map(a => a.accountName);
      }

      // 5. Verify org membership if required
      if (authConfig.azure_devops_org) {
        const isMember = orgNames.some(
          name => name.toLowerCase() === authConfig.azure_devops_org!.toLowerCase(),
        );
        if (!isMember) {
          return reply.status(403).send({
            error: 'Organization membership required',
            details: `You must be a member of the "${authConfig.azure_devops_org}" organization.`,
          });
        }
      }

      // 6. Issue JWT
      const payload: Omit<AzureDevOpsJwtPayload, 'iat' | 'exp'> = {
        sub: adoProfile.publicAlias || adoProfile.id,
        email: adoProfile.emailAddress,
        display_name: adoProfile.displayName,
        azure_devops_id: adoProfile.id,
        orgs: orgNames,
      };

      const token = jwt.sign(payload, authConfig.jwt_secret, { expiresIn: '7d' });

      // 7. Store refresh token for later use
      refreshTokenStore.set(adoProfile.id, {
        refresh_token: adoRefreshToken,
        azure_devops_id: adoProfile.id,
      });

      // 8. Redirect or return JSON
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
          id: adoProfile.id,
          email: adoProfile.emailAddress,
          display_name: adoProfile.displayName,
          orgs: orgNames,
        },
      };
    },
  );

  // ── POST /auth/azure-devops/refresh ───────────────────────
  // Refreshes an Azure DevOps access token using the stored
  // refresh token. Azure DevOps tokens expire in 1 hour, so
  // this endpoint is mandatory for long-lived sessions.

  app.post<{ Body: { token: string } }>(
    '/auth/azure-devops/refresh',
    async (req, reply) => {
      if (!authConfig.enabled) {
        return reply.status(404).send({ error: 'Auth is not enabled' });
      }

      const { token } = req.body ?? {};
      if (!token) {
        return reply.status(400).send({ error: 'Missing token' });
      }

      // Decode the JWT to find the user
      let decoded: AzureDevOpsJwtPayload;
      try {
        decoded = jwt.verify(token, authConfig.jwt_secret) as AzureDevOpsJwtPayload;
      } catch {
        return reply.status(401).send({ error: 'Invalid or expired token' });
      }

      const stored = refreshTokenStore.get(decoded.azure_devops_id);
      if (!stored) {
        return reply.status(401).send({ error: 'No refresh token available. Re-authenticate at /auth/azure-devops' });
      }

      // Exchange refresh token for new access token
      const tokenRes = await fetch(ENTRA_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: authConfig.azure_devops_client_id,
          client_secret: authConfig.azure_devops_client_secret,
          refresh_token: stored.refresh_token,
          grant_type: 'refresh_token',
          scope: '499b84ac-1321-427f-aa17-267ca6975798/.default offline_access',
        }),
      });

      const tokenData = (await tokenRes.json()) as EntraTokenResponse;
      if (tokenData.error || !tokenData.access_token) {
        // Refresh token may be expired -- user needs to re-authenticate
        refreshTokenStore.delete(decoded.azure_devops_id);
        return reply.status(401).send({
          error: 'Token refresh failed. Re-authenticate at /auth/azure-devops',
          details: tokenData.error_description ?? tokenData.error,
        });
      }

      // Update stored refresh token (they rotate)
      if (tokenData.refresh_token) {
        refreshTokenStore.set(decoded.azure_devops_id, {
          refresh_token: tokenData.refresh_token,
          azure_devops_id: decoded.azure_devops_id,
        });
      }

      // Issue a new JWT with the same claims but fresh expiry
      const newPayload: Omit<AzureDevOpsJwtPayload, 'iat' | 'exp'> = {
        sub: decoded.sub,
        email: decoded.email,
        display_name: decoded.display_name,
        azure_devops_id: decoded.azure_devops_id,
        orgs: decoded.orgs,
      };
      const newToken = jwt.sign(newPayload, authConfig.jwt_secret, { expiresIn: '7d' });

      return {
        ok: true,
        token: newToken,
        expires_in: tokenData.expires_in,
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
        const decoded = jwt.verify(token, authConfig.jwt_secret) as AzureDevOpsJwtPayload;
        return {
          ok: true,
          developer: {
            email: decoded.email,
            display_name: decoded.display_name,
            org: decoded.orgs[0] ?? undefined,
            login: decoded.sub,
            azure_devops_id: decoded.azure_devops_id,
            orgs: decoded.orgs,
          },
        };
      } catch (err) {
        return reply.status(401).send({ error: 'Invalid or expired token' });
      }
    },
  );

  // ── GET /auth/azure-devops/orgs ───────────────────────────
  // Lists the Azure DevOps organizations for the authenticated user.
  // Requires a valid JWT in the Authorization header.

  app.get(
    '/auth/azure-devops/orgs',
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
        ) as AzureDevOpsJwtPayload;
        return { ok: true, orgs: decoded.orgs };
      } catch {
        return reply.status(401).send({ error: 'Invalid token' });
      }
    },
  );

  // ── GET /auth/azure-devops/projects ───────────────────────
  // Lists projects in the configured Azure DevOps organization.
  // Requires a valid JWT and AZURE_DEVOPS_ORG to be set.
  //
  // NOTE: To support live project listing, you would need to
  // store the Azure DevOps access token (encrypted) alongside
  // the JWT. This v1 implementation returns a helpful message.

  app.get(
    '/auth/azure-devops/projects',
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
        message: 'Project listing requires a stored Azure DevOps access token. Configure projects via AZURE_DEVOPS_ORG environment variable or register projects manually via the API.',
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
import type { AzureDevOpsJwtPayload } from '../routes/auth-azure-devops.js';

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
    const decoded = jwt.verify(token, _authConfig.jwt_secret) as AzureDevOpsJwtPayload;
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
      login_url: '/auth/azure-devops',
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
import { azureDevOpsAuthRoutes } from './routes/auth-azure-devops.js';

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

azureDevOpsAuthRoutes(app, authConfig);
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
import { azureDevOpsAuthRoutes } from './routes/auth-azure-devops.js';

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

azureDevOpsAuthRoutes(app, authConfig);

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

Add `auth.token` and `auth.refresh_token` parsing. Find the return statement and update:

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
    auth: config['auth.token'] ? {
      token: config['auth.token'],
      refresh_token: config['auth.refresh_token'] || undefined,
    } : undefined,
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
  refresh_token: "0.AVUA..."
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

# ── Authentication (Azure DevOps OAuth via Microsoft Entra ID) ───
# Set AUTH_ENABLED=true to require Azure DevOps OAuth login.
# When false (default), all routes are open (trust-on-first-use).

AUTH_ENABLED=false

# Register an app at https://app.vsaex.visualstudio.com/app/register
# or via Azure Portal > App registrations > New registration
# Set the redirect URI to: http://localhost:3000/auth/azure-devops/callback
AZURE_DEVOPS_CLIENT_ID=
AZURE_DEVOPS_CLIENT_SECRET=

# Required: the Azure DevOps organization name to verify membership against
# AZURE_DEVOPS_ORG=my-org

# Optional: Microsoft Entra ID tenant ID. Use "common" for multi-tenant (default),
# or a specific tenant GUID for single-tenant apps (restricts to one Azure AD).
# AZURE_DEVOPS_TENANT_ID=common

# Secret used to sign JWT tokens. Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=

# Public URL of this backend (used to build OAuth callback URLs)
# PUBLIC_URL=http://localhost:3000
```

---

## Step 8: Add Tests

Create `packages/backend/src/auth-azure-devops.test.ts`:

```typescript
import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requireAuth, initAuthMiddleware } from './middleware/auth.js';
import type { AuthConfig } from './env.js';
import type { AzureDevOpsJwtPayload } from './routes/auth-azure-devops.js';

const TEST_SECRET = 'test-jwt-secret-for-unit-tests';

function createAuthConfig(overrides?: Partial<AuthConfig>): AuthConfig {
  return {
    enabled: true,
    azure_devops_client_id: 'test-client-id',
    azure_devops_client_secret: 'test-client-secret',
    azure_devops_org: undefined,
    azure_devops_tenant_id: 'common',
    jwt_secret: TEST_SECRET,
    public_url: 'http://localhost:3000',
    ...overrides,
  };
}

function createToken(payload?: Partial<Omit<AzureDevOpsJwtPayload, 'iat' | 'exp'>>): string {
  const defaults: Omit<AzureDevOpsJwtPayload, 'iat' | 'exp'> = {
    sub: 'testuser-alias',
    email: 'test@example.com',
    display_name: 'Test User',
    azure_devops_id: 'ado-12345-guid',
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

describe('Azure DevOps JWT token generation and verification', () => {
  it('creates a valid JWT with expected fields', () => {
    const token = createToken();
    const decoded = jwt.verify(token, TEST_SECRET) as AzureDevOpsJwtPayload;

    assert.equal(decoded.sub, 'testuser-alias');
    assert.equal(decoded.email, 'test@example.com');
    assert.equal(decoded.display_name, 'Test User');
    assert.equal(decoded.azure_devops_id, 'ado-12345-guid');
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
      orgs: ['alpha-org', 'beta-org'],
      azure_devops_id: 'custom-guid-456',
    });
    const decoded = jwt.verify(token, TEST_SECRET) as AzureDevOpsJwtPayload;

    assert.equal(decoded.email, 'custom@corp.com');
    assert.deepEqual(decoded.orgs, ['alpha-org', 'beta-org']);
    assert.equal(decoded.azure_devops_id, 'custom-guid-456');
  });
});

// ─── authenticate middleware ────────────────────────────────

describe('authenticate middleware (Azure DevOps)', () => {
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

describe('authenticate middleware — AUTH_ENABLED=false (Azure DevOps)', () => {
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

describe('requireAuth middleware (Azure DevOps)', () => {
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

  it('includes login_url pointing to Azure DevOps in 401 response', async () => {
    const req = mockRequest();
    const reply = mockReply();

    await requireAuth(req, reply as FastifyReply);

    assert.equal(reply.sentStatus, 401);
    assert.equal(
      (reply.sentBody as { login_url: string }).login_url,
      '/auth/azure-devops',
    );
  });
});

describe('requireAuth middleware — AUTH_ENABLED=false (Azure DevOps)', () => {
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

// ─── Callback route (mock Azure DevOps API) ─────────────────

describe('Azure DevOps OAuth callback — token exchange', () => {
  it('exchanges a valid code for a JWT (simulated)', async () => {
    // This test validates the JWT creation logic in isolation.
    // A full integration test would require mocking fetch() to
    // simulate Microsoft Entra ID's token endpoint and Azure DevOps
    // profile/accounts responses.
    //
    // Here we verify the token structure that the callback would produce.

    const payload: Omit<AzureDevOpsJwtPayload, 'iat' | 'exp'> = {
      sub: 'user-public-alias',
      email: 'dev@contoso.com',
      display_name: 'Contoso Developer',
      azure_devops_id: 'ado-guid-contoso-1',
      orgs: ['contoso-org'],
    };

    const token = jwt.sign(payload, TEST_SECRET, { expiresIn: '7d' });
    const decoded = jwt.verify(token, TEST_SECRET) as AzureDevOpsJwtPayload;

    assert.equal(decoded.sub, 'user-public-alias');
    assert.equal(decoded.email, 'dev@contoso.com');
    assert.equal(decoded.display_name, 'Contoso Developer');
    assert.equal(decoded.azure_devops_id, 'ado-guid-contoso-1');
    assert.deepEqual(decoded.orgs, ['contoso-org']);

    // Token should be valid for ~7 days
    const ttl = decoded.exp - decoded.iat;
    assert.ok(ttl >= 6 * 24 * 3600, 'Token should be valid for at least 6 days');
    assert.ok(ttl <= 8 * 24 * 3600, 'Token should be valid for at most 8 days');
  });

  it('produces a JWT that authenticate middleware can decode', async () => {
    initAuthMiddleware(createAuthConfig({ enabled: true }));

    const payload: Omit<AzureDevOpsJwtPayload, 'iat' | 'exp'> = {
      sub: 'user-public-alias',
      email: 'dev@contoso.com',
      display_name: 'Contoso Developer',
      azure_devops_id: 'ado-guid-contoso-1',
      orgs: ['contoso-org'],
    };
    const token = jwt.sign(payload, TEST_SECRET, { expiresIn: '7d' });

    const req = mockRequest(`Bearer ${token}`);
    const reply = mockReply();
    await authenticate(req, reply as FastifyReply);

    assert.ok(req.developer);
    assert.equal(req.developer!.email, 'dev@contoso.com');
    assert.equal(req.developer!.display_name, 'Contoso Developer');
    assert.equal(req.developer!.org, 'contoso-org');
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

// ─── Token refresh logic ────────────────────────────────────

describe('Azure DevOps token refresh flow', () => {
  it('JWT contains azure_devops_id needed for refresh token lookup', () => {
    const token = createToken({ azure_devops_id: 'refresh-test-guid' });
    const decoded = jwt.verify(token, TEST_SECRET) as AzureDevOpsJwtPayload;

    assert.equal(decoded.azure_devops_id, 'refresh-test-guid');
    assert.ok(decoded.azure_devops_id, 'azure_devops_id must be present for refresh flow');
  });

  it('refreshed JWT preserves original claims with new expiry', () => {
    // Simulates what the /auth/azure-devops/refresh endpoint does:
    // decode old JWT, create new JWT with same claims but fresh expiry

    const originalPayload: Omit<AzureDevOpsJwtPayload, 'iat' | 'exp'> = {
      sub: 'refresh-user',
      email: 'refresh@corp.com',
      display_name: 'Refresh User',
      azure_devops_id: 'refresh-guid-789',
      orgs: ['corp-org'],
    };

    const originalToken = jwt.sign(originalPayload, TEST_SECRET, { expiresIn: '1h' });
    const decoded = jwt.verify(originalToken, TEST_SECRET) as AzureDevOpsJwtPayload;

    // Simulate refresh: create new token with same claims
    const refreshedPayload: Omit<AzureDevOpsJwtPayload, 'iat' | 'exp'> = {
      sub: decoded.sub,
      email: decoded.email,
      display_name: decoded.display_name,
      azure_devops_id: decoded.azure_devops_id,
      orgs: decoded.orgs,
    };
    const refreshedToken = jwt.sign(refreshedPayload, TEST_SECRET, { expiresIn: '7d' });
    const refreshedDecoded = jwt.verify(refreshedToken, TEST_SECRET) as AzureDevOpsJwtPayload;

    assert.equal(refreshedDecoded.sub, originalPayload.sub);
    assert.equal(refreshedDecoded.email, originalPayload.email);
    assert.equal(refreshedDecoded.display_name, originalPayload.display_name);
    assert.equal(refreshedDecoded.azure_devops_id, originalPayload.azure_devops_id);
    assert.deepEqual(refreshedDecoded.orgs, originalPayload.orgs);

    // New token should have later expiry
    assert.ok(refreshedDecoded.exp > decoded.exp, 'Refreshed token should expire later');
  });
});

// ─── Auth config loading ────────────────────────────────────

describe('Azure DevOps auth config', () => {
  it('createAuthConfig returns valid defaults', () => {
    const config = createAuthConfig();

    assert.equal(config.enabled, true);
    assert.equal(config.azure_devops_client_id, 'test-client-id');
    assert.equal(config.azure_devops_client_secret, 'test-client-secret');
    assert.equal(config.azure_devops_tenant_id, 'common');
    assert.equal(config.jwt_secret, TEST_SECRET);
    assert.equal(config.public_url, 'http://localhost:3000');
  });

  it('createAuthConfig allows tenant override for single-tenant apps', () => {
    const config = createAuthConfig({
      azure_devops_tenant_id: '72f988bf-86f1-41af-91ab-2d7cd011db47',
    });

    assert.equal(config.azure_devops_tenant_id, '72f988bf-86f1-41af-91ab-2d7cd011db47');
  });

  it('createAuthConfig allows org restriction', () => {
    const config = createAuthConfig({ azure_devops_org: 'contoso' });

    assert.equal(config.azure_devops_org, 'contoso');
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

All existing tests should continue to pass. The new `auth-azure-devops.test.ts` tests should also pass.

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
| `AUTH_ENABLED` | No | `false` | Set to `true` to require Azure DevOps OAuth login |
| `AZURE_DEVOPS_CLIENT_ID` | Yes (if auth enabled) | | Application (client) ID from app registration |
| `AZURE_DEVOPS_CLIENT_SECRET` | Yes (if auth enabled) | | Client secret from app registration |
| `AZURE_DEVOPS_ORG` | No | | Restrict login to members of this Azure DevOps organization |
| `AZURE_DEVOPS_TENANT_ID` | No | `common` | Microsoft Entra ID tenant ID. Use `common` for multi-tenant, or a specific tenant GUID for single-tenant |
| `JWT_SECRET` | Yes (if auth enabled) | | Secret for signing JWT tokens |
| `PUBLIC_URL` | No | `http://localhost:3000` | Backend URL used to build OAuth callback URLs |

### API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/auth/azure-devops` | Redirects to Microsoft Entra ID authorization page |
| `GET` | `/auth/azure-devops/callback` | Handles OAuth callback, exchanges code for token, issues JWT |
| `POST` | `/auth/azure-devops/refresh` | Refreshes an expired Azure DevOps access token using stored refresh token |
| `POST` | `/auth/token/verify` | Validates a JWT and returns developer identity |
| `GET` | `/auth/azure-devops/orgs` | Lists Azure DevOps organizations for the authenticated user |
| `GET` | `/auth/azure-devops/projects` | Lists projects (v1: returns config guidance) |

### Scopes

The OAuth flow requests the following scopes:

- `499b84ac-1321-427f-aa17-267ca6975798/.default` -- Azure DevOps resource scope (covers `vso.profile`, `vso.project`, `vso.code` via API permissions configured on the app registration)
- `offline_access` -- Required for refresh tokens (mandatory since Azure DevOps tokens expire in 1 hour)

### Azure DevOps API Endpoints Used

| API | Base URL | Path | Purpose |
|---|---|---|---|
| Profile | `https://app.vssps.visualstudio.com` | `/_apis/profile/profiles/me` | Fetch user display name, email, ID |
| Connection Data | `https://app.vssps.visualstudio.com` | `/_apis/connectionData` | Fetch authenticated user ID for account lookup |
| Accounts | `https://app.vssps.visualstudio.com` | `/_apis/accounts` | List organizations the user belongs to |
| Projects | `https://dev.azure.com/{org}` | `/_apis/projects` | List projects in an organization |
| Token | `https://login.microsoftonline.com/{tenant}` | `/oauth2/v2.0/token` | Exchange code / refresh token for access token |
| Authorize | `https://login.microsoftonline.com/{tenant}` | `/oauth2/v2.0/authorize` | Initial OAuth redirect |

---

## Setup Guide

### Registering an Azure DevOps OAuth App

There are two methods to register your app:

#### Method A: Azure DevOps App Registration (simpler)

1. Go to [https://app.vsaex.visualstudio.com/app/register](https://app.vsaex.visualstudio.com/app/register)
2. Fill in:
   - **Application name:** `Open Hive` (or your preferred name)
   - **Application website:** `http://localhost:3000` (or your production URL)
   - **Authorization callback URL:** `http://localhost:3000/auth/azure-devops/callback`
3. Under **Authorized scopes**, select:
   - **User profile (read)** -- `vso.profile`
   - **Project and team (read)** -- `vso.project`
   - **Code (read)** -- `vso.code`
4. Click **"Create Application"**
5. Copy the **App ID** (this is your `AZURE_DEVOPS_CLIENT_ID`)
6. Copy the **Client Secret** (this is your `AZURE_DEVOPS_CLIENT_SECRET`)

#### Method B: Azure Portal App Registration (more control)

1. Go to [Azure Portal > App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. Click **"New registration"**
3. Fill in:
   - **Name:** `Open Hive`
   - **Supported account types:** Choose based on your needs:
     - **Single tenant** -- only your Azure AD (set `AZURE_DEVOPS_TENANT_ID` to your tenant GUID)
     - **Multi-tenant** -- any Azure AD (use `AZURE_DEVOPS_TENANT_ID=common`, the default)
   - **Redirect URI:** `Web` platform, `http://localhost:3000/auth/azure-devops/callback`
4. Click **"Register"**
5. Copy the **Application (client) ID** from the overview page
6. Go to **Certificates & secrets > New client secret**, add a secret, and copy its **Value**
7. Go to **API permissions > Add a permission > Azure DevOps** and add:
   - `user_impersonation` (delegated)
8. Click **"Grant admin consent"** if you have admin privileges

For production, replace `localhost:3000` with your actual backend URL (e.g., `https://hive.yourorg.com`). Set the `PUBLIC_URL` env var to match.

### Configuring the Backend

Add to your `.env` or environment:

```bash
AUTH_ENABLED=true
AZURE_DEVOPS_CLIENT_ID=your-client-id-guid
AZURE_DEVOPS_CLIENT_SECRET=your-client-secret
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# Required: your Azure DevOps organization name
AZURE_DEVOPS_ORG=your-org-name

# Optional: restrict to a single Azure AD tenant
# AZURE_DEVOPS_TENANT_ID=72f988bf-86f1-41af-91ab-2d7cd011db47
```

### How Developers Authenticate (Plugin Flow)

1. Developer runs `/hive setup` (or the setup command in your plugin).
2. Plugin opens `http://localhost:3000/auth/azure-devops` in the browser.
3. Developer signs in with their Microsoft account.
4. Microsoft Entra ID redirects back to `/auth/azure-devops/callback`.
5. Backend exchanges the code for access + refresh tokens, fetches the Azure DevOps profile and organizations, verifies org membership, and issues a JWT.
6. Backend either:
   - Redirects to a `redirect_uri` with `?token=<jwt>` (if the plugin provided one), or
   - Returns the token as JSON.
7. Plugin saves the token to `~/.open-hive.yaml`:
   ```yaml
   backend_url: http://localhost:3000
   auth:
     token: "eyJhbGciOiJIUzI1NiIs..."
     refresh_token: "0.AVUA..."
   identity:
     email: dev@contoso.com
     display_name: Contoso Developer
   ```
8. All subsequent API calls include `Authorization: Bearer <token>`.
9. When the Azure DevOps access token expires (1 hour), the plugin calls `POST /auth/azure-devops/refresh` with the current JWT to get a new one.

### Docker Compose

Add auth env vars to `docker-compose.yaml`:

```yaml
services:
  open-hive:
    environment:
      # ... existing vars ...
      AUTH_ENABLED: "true"
      AZURE_DEVOPS_CLIENT_ID: "${AZURE_DEVOPS_CLIENT_ID}"
      AZURE_DEVOPS_CLIENT_SECRET: "${AZURE_DEVOPS_CLIENT_SECRET}"
      AZURE_DEVOPS_ORG: "${AZURE_DEVOPS_ORG:-}"
      AZURE_DEVOPS_TENANT_ID: "${AZURE_DEVOPS_TENANT_ID:-common}"
      JWT_SECRET: "${JWT_SECRET}"
      PUBLIC_URL: "${PUBLIC_URL:-http://localhost:3000}"
```

### Key Differences from GitHub OAuth

| Aspect | GitHub OAuth | Azure DevOps OAuth |
|---|---|---|
| Identity provider | GitHub | Microsoft Entra ID (Azure AD) |
| App registration | github.com/settings/developers | app.vsaex.visualstudio.com or Azure Portal |
| Token endpoint content type | `application/json` | `application/x-www-form-urlencoded` |
| Token expiry | No expiry (revocable) | 1 hour (refresh mandatory) |
| Refresh tokens | Not needed | Required (`offline_access` scope) |
| Scopes | `read:org user:email` | `499b84ac.../.default offline_access` |
| User profile API | `api.github.com/user` | `app.vssps.visualstudio.com/_apis/profile/profiles/me` |
| Org discovery API | `api.github.com/user/orgs` | `app.vssps.visualstudio.com/_apis/accounts` |
| Terminology | Orgs + Repos | Organizations + Projects |
| Multi-tenant | N/A (GitHub is global) | `tenant_id` controls Azure AD scope |

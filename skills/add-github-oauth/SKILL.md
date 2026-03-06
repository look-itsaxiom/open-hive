---
name: add-github-oauth
description: Add GitHub OAuth authentication with org/team discovery
category: auth
port: IIdentityProvider
requires:
  - jsonwebtoken
  - "@types/jsonwebtoken"
modifies:
  - packages/backend/src/services/github-oauth-provider.ts (new)
  - packages/backend/src/routes/auth.ts (new)
  - packages/backend/src/env.ts
  - packages/backend/src/server.ts
  - packages/shared/src/config.ts
  - .env.example
tests:
  - packages/backend/src/auth.test.ts
---

# Add GitHub OAuth Authentication

Add GitHub OAuth login to Open Hive so developers authenticate with their GitHub identity. Includes org membership verification, team discovery, and JWT session tokens. Backward compatible -- when `AUTH_ENABLED=false` (default), the system uses the `PassthroughIdentityProvider`.

## Prerequisites

1. Backend source is cloned and `npm install` has been run at the repo root.
2. You can build successfully: `npm run build` (from repo root, runs turbo).
3. A **GitHub OAuth App** has been created (see [Setup Guide](#setup-guide) at the end of this file). You need the **Client ID** and **Client Secret**.

## What This Skill Does

- Creates a `GitHubOAuthProvider` class that implements the `IIdentityProvider` port interface from `@open-hive/shared`.
- Adds a full GitHub OAuth 2.0 login flow (`/auth/github` redirect, `/auth/github/callback` token exchange).
- Issues JWT session tokens after successful GitHub login.
- Verifies org membership when `GITHUB_ORG` is configured.
- Discovers the user's GitHub orgs and accessible repos via API.
- Replaces the `PassthroughIdentityProvider` with `GitHubOAuthProvider` in the `PortRegistry` when `AUTH_ENABLED=true`.
- Stays backward compatible: when `AUTH_ENABLED` is `false` (default), the `PassthroughIdentityProvider` remains active.

---

## Step 1: Install Dependencies

From the **packages/backend** directory:

```bash
cd packages/backend
npm install jsonwebtoken
npm install -D @types/jsonwebtoken
```

---

## Step 2: Create the GitHub OAuth Identity Provider

Create `packages/backend/src/services/github-oauth-provider.ts`:

```typescript
import type { IIdentityProvider, AuthContext, DeveloperIdentity } from '@open-hive/shared';
import jwt from 'jsonwebtoken';

export interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
  jwtSecret: string;
  githubOrg?: string;
}

export class GitHubOAuthProvider implements IIdentityProvider {
  readonly name = 'github-oauth';
  readonly requiresAuth = true;

  constructor(private config: GitHubOAuthConfig) {}

  async authenticate(ctx: AuthContext): Promise<DeveloperIdentity | null> {
    const authHeader = ctx.headers['authorization'];
    const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (!headerValue?.startsWith('Bearer ')) return null;

    const token = headerValue.slice(7);
    try {
      const decoded = jwt.verify(token, this.config.jwtSecret) as {
        email: string;
        display_name: string;
        orgs: string[];
      };
      return {
        email: decoded.email,
        display_name: decoded.display_name,
        org: decoded.orgs[0] ?? undefined,
        teams: decoded.orgs,
      };
    } catch {
      return null; // Invalid or expired token
    }
  }
}
```

---

## Step 3: Register in PortRegistry

In `packages/backend/src/server.ts`, replace the identity provider when auth is enabled:

```typescript
import { GitHubOAuthProvider } from './services/github-oauth-provider.js';

// When building the PortRegistry:
const identity = authConfig.enabled
  ? new GitHubOAuthProvider({
      clientId: authConfig.github_client_id,
      clientSecret: authConfig.github_client_secret,
      jwtSecret: authConfig.jwt_secret,
      githubOrg: authConfig.github_org,
    })
  : new PassthroughIdentityProvider();

const registry: PortRegistry = {
  store,
  identity,
  analyzers: [...],
  alerts,
};
```

---

## Step 4: Create Auth Routes

Create the file `packages/backend/src/routes/auth.ts` with the OAuth flow handlers. This file contains:

- `GET /auth/github` -- Redirects to GitHub's OAuth authorization page
- `GET /auth/github/callback` -- Exchanges code for access token, fetches profile + orgs, issues JWT
- `POST /auth/token/verify` -- Validates a JWT and returns the developer identity
- `GET /auth/github/orgs` -- Lists the GitHub orgs for the authenticated user

Register in `server.ts`:

```typescript
import { authRoutes } from './routes/auth.js';

// After PortRegistry creation:
authRoutes(app, authConfig);
```

---

## Step 5: Add Auth Configuration

### Edit `packages/backend/src/env.ts`

Add `loadAuthConfig()`:

```typescript
export interface AuthConfig {
  enabled: boolean;
  github_client_id: string;
  github_client_secret: string;
  github_org?: string;
  jwt_secret: string;
  public_url: string;
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

---

## Step 6: Add Tests

Create `packages/backend/src/auth.test.ts` with tests covering:

1. JWT token generation and verification
2. `GitHubOAuthProvider.authenticate()` with valid Bearer tokens
3. `GitHubOAuthProvider.authenticate()` returning null for invalid tokens
4. `GitHubOAuthProvider.authenticate()` returning null for missing Authorization header
5. Backward compatibility: `PassthroughIdentityProvider` behavior when auth is disabled

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { GitHubOAuthProvider } from './services/github-oauth-provider.js';
import type { AuthContext } from '@open-hive/shared';

const TEST_SECRET = 'test-jwt-secret-for-unit-tests';

function createProvider(): GitHubOAuthProvider {
  return new GitHubOAuthProvider({
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    jwtSecret: TEST_SECRET,
  });
}

function createToken(payload?: Record<string, unknown>): string {
  const defaults = {
    sub: 'testuser',
    email: 'test@example.com',
    display_name: 'Test User',
    github_id: 12345,
    orgs: ['test-org'],
  };
  return jwt.sign({ ...defaults, ...payload }, TEST_SECRET, { expiresIn: '1h' });
}

function mockAuthContext(authHeader?: string): AuthContext {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
  };
}

describe('GitHubOAuthProvider', () => {
  it('has name "github-oauth"', () => {
    const provider = createProvider();
    assert.equal(provider.name, 'github-oauth');
    assert.equal(provider.requiresAuth, true);
  });

  it('authenticates valid Bearer token', async () => {
    const provider = createProvider();
    const token = createToken();
    const result = await provider.authenticate(mockAuthContext(`Bearer ${token}`));

    assert.ok(result);
    assert.equal(result.email, 'test@example.com');
    assert.equal(result.display_name, 'Test User');
    assert.equal(result.org, 'test-org');
  });

  it('returns null for invalid token', async () => {
    const provider = createProvider();
    const result = await provider.authenticate(mockAuthContext('Bearer invalid.token.here'));
    assert.equal(result, null);
  });

  it('returns null for missing Authorization header', async () => {
    const provider = createProvider();
    const result = await provider.authenticate(mockAuthContext());
    assert.equal(result, null);
  });

  it('returns null for token signed with wrong secret', async () => {
    const provider = createProvider();
    const wrongToken = jwt.sign({ sub: 'test' }, 'wrong-secret', { expiresIn: '1h' });
    const result = await provider.authenticate(mockAuthContext(`Bearer ${wrongToken}`));
    assert.equal(result, null);
  });
});
```

---

## Step 7: Verify

Run from the repo root:

```bash
npm run build && npm test
```

---

## Setup Guide

### Creating a GitHub OAuth App

1. Go to [https://github.com/settings/developers](https://github.com/settings/developers)
2. Click **"New OAuth App"**
3. Fill in:
   - **Application name:** `Open Hive`
   - **Homepage URL:** `http://localhost:3000`
   - **Authorization callback URL:** `http://localhost:3000/auth/github/callback`
4. Click **"Register application"**
5. Copy the **Client ID** and generate a **Client Secret**

### Configuring the Backend

```bash
AUTH_ENABLED=true
GITHUB_CLIENT_ID=Iv1.abc123...
GITHUB_CLIENT_SECRET=abc123...
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
GITHUB_ORG=your-org-name  # optional
```

### Docker Compose

```yaml
services:
  open-hive:
    environment:
      AUTH_ENABLED: "true"
      GITHUB_CLIENT_ID: "${GITHUB_CLIENT_ID}"
      GITHUB_CLIENT_SECRET: "${GITHUB_CLIENT_SECRET}"
      GITHUB_ORG: "${GITHUB_ORG:-}"
      JWT_SECRET: "${JWT_SECRET}"
      PUBLIC_URL: "${PUBLIC_URL:-http://localhost:3000}"
```

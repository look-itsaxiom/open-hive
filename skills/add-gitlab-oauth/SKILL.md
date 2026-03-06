---
name: add-gitlab-oauth
description: Add GitLab OAuth authentication with group/project discovery
category: auth
port: IIdentityProvider
requires:
  - jsonwebtoken
  - "@types/jsonwebtoken"
modifies:
  - packages/backend/src/services/gitlab-oauth-provider.ts (new)
  - packages/backend/src/routes/auth-gitlab.ts (new)
  - packages/backend/src/env.ts
  - packages/backend/src/server.ts
  - packages/shared/src/config.ts
  - .env.example
tests:
  - packages/backend/src/auth-gitlab.test.ts
---

# Add GitLab OAuth Authentication

Add GitLab OAuth login to Open Hive so developers authenticate with their GitLab identity. Includes group membership verification, project discovery, and JWT session tokens. Supports both gitlab.com and self-hosted GitLab instances via configurable base URL. Backward compatible -- when `AUTH_ENABLED=false` (default), the system uses the `PassthroughIdentityProvider`.

## Prerequisites

1. Backend source is cloned and `npm install` has been run at the repo root.
2. You can build successfully: `npm run build` (from repo root, runs turbo).
3. A **GitLab OAuth Application** has been created (see [Setup Guide](#setup-guide) at the end of this file). You need the **Application ID** and **Secret**.

## What This Skill Does

- Creates a `GitLabOAuthProvider` class that implements the `IIdentityProvider` port interface from `@open-hive/shared`.
- Adds a full GitLab OAuth 2.0 login flow (`/auth/gitlab` redirect, `/auth/gitlab/callback` token exchange).
- Issues JWT session tokens after successful GitLab login.
- Verifies group membership when `GITLAB_GROUP` is configured.
- Discovers the user's GitLab groups and accessible projects via API.
- Supports self-hosted GitLab instances via `GITLAB_BASE_URL` (defaults to `https://gitlab.com`).
- Replaces the `PassthroughIdentityProvider` with `GitLabOAuthProvider` in the `PortRegistry` when `AUTH_ENABLED=true`.

---

## Step 1: Install Dependencies

```bash
cd packages/backend
npm install jsonwebtoken
npm install -D @types/jsonwebtoken
```

---

## Step 2: Create the GitLab OAuth Identity Provider

Create `packages/backend/src/services/gitlab-oauth-provider.ts`:

```typescript
import type { IIdentityProvider, AuthContext, DeveloperIdentity } from '@open-hive/shared';
import jwt from 'jsonwebtoken';

export interface GitLabOAuthConfig {
  applicationId: string;
  secret: string;
  jwtSecret: string;
  baseUrl: string;
  gitlabGroup?: string;
}

export class GitLabOAuthProvider implements IIdentityProvider {
  readonly name = 'gitlab-oauth';
  readonly requiresAuth = true;

  constructor(private config: GitLabOAuthConfig) {}

  async authenticate(ctx: AuthContext): Promise<DeveloperIdentity | null> {
    const authHeader = ctx.headers['authorization'];
    const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (!headerValue?.startsWith('Bearer ')) return null;

    const token = headerValue.slice(7);
    try {
      const decoded = jwt.verify(token, this.config.jwtSecret) as {
        email: string;
        display_name: string;
        groups: string[];
      };
      return {
        email: decoded.email,
        display_name: decoded.display_name,
        org: decoded.groups[0] ?? undefined,
        teams: decoded.groups,
      };
    } catch {
      return null;
    }
  }
}
```

---

## Step 3: Register in PortRegistry

In `packages/backend/src/server.ts`, replace the identity provider when auth is enabled:

```typescript
import { GitLabOAuthProvider } from './services/gitlab-oauth-provider.js';

// When building the PortRegistry:
const identity = authConfig.enabled && authConfig.provider === 'gitlab'
  ? new GitLabOAuthProvider({
      applicationId: authConfig.gitlab_application_id,
      secret: authConfig.gitlab_secret,
      jwtSecret: authConfig.jwt_secret,
      baseUrl: authConfig.gitlab_base_url ?? 'https://gitlab.com',
      gitlabGroup: authConfig.gitlab_group,
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

Create `packages/backend/src/routes/auth-gitlab.ts` with the OAuth flow handlers:

- `GET /auth/gitlab` -- Redirects to GitLab's OAuth authorization page
- `GET /auth/gitlab/callback` -- Exchanges code for access token, fetches profile + groups, issues JWT
- `POST /auth/token/verify` -- Validates a JWT and returns the developer identity

Register in `server.ts`:

```typescript
import { authGitLabRoutes } from './routes/auth-gitlab.js';

// After PortRegistry creation:
authGitLabRoutes(app, authConfig);
```

---

## Step 5: Add Tests

Create `packages/backend/src/auth-gitlab.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { GitLabOAuthProvider } from './services/gitlab-oauth-provider.js';
import type { AuthContext } from '@open-hive/shared';

const TEST_SECRET = 'test-jwt-secret';

function createProvider(): GitLabOAuthProvider {
  return new GitLabOAuthProvider({
    applicationId: 'test-app-id',
    secret: 'test-secret',
    jwtSecret: TEST_SECRET,
    baseUrl: 'https://gitlab.com',
  });
}

function mockAuthContext(authHeader?: string): AuthContext {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
  };
}

describe('GitLabOAuthProvider', () => {
  it('has name "gitlab-oauth"', () => {
    const provider = createProvider();
    assert.equal(provider.name, 'gitlab-oauth');
    assert.equal(provider.requiresAuth, true);
  });

  it('authenticates valid Bearer token', async () => {
    const provider = createProvider();
    const token = jwt.sign(
      { email: 'dev@gitlab.com', display_name: 'Dev', groups: ['my-group'] },
      TEST_SECRET,
      { expiresIn: '1h' },
    );
    const result = await provider.authenticate(mockAuthContext(`Bearer ${token}`));

    assert.ok(result);
    assert.equal(result.email, 'dev@gitlab.com');
    assert.equal(result.display_name, 'Dev');
    assert.equal(result.org, 'my-group');
  });

  it('returns null for invalid token', async () => {
    const provider = createProvider();
    const result = await provider.authenticate(mockAuthContext('Bearer bad-token'));
    assert.equal(result, null);
  });

  it('returns null for missing header', async () => {
    const provider = createProvider();
    const result = await provider.authenticate(mockAuthContext());
    assert.equal(result, null);
  });
});
```

---

## Step 6: Verify

```bash
npm run build && npm test
```

---

## Setup Guide

### Creating a GitLab OAuth Application

1. Go to **GitLab > Preferences > Applications** (or Admin Area > Applications for self-hosted)
2. Create a new application:
   - **Name:** `Open Hive`
   - **Redirect URI:** `http://localhost:3000/auth/gitlab/callback`
   - **Scopes:** `read_user`, `read_api`
3. Copy the **Application ID** and **Secret**

### Configuration

```bash
AUTH_ENABLED=true
GITLAB_APPLICATION_ID=...
GITLAB_SECRET=...
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
GITLAB_BASE_URL=https://gitlab.com  # or your self-hosted URL
GITLAB_GROUP=my-group  # optional
```

### Docker Compose

```yaml
services:
  open-hive:
    environment:
      AUTH_ENABLED: "true"
      GITLAB_APPLICATION_ID: "${GITLAB_APPLICATION_ID}"
      GITLAB_SECRET: "${GITLAB_SECRET}"
      GITLAB_BASE_URL: "${GITLAB_BASE_URL:-https://gitlab.com}"
      GITLAB_GROUP: "${GITLAB_GROUP:-}"
      JWT_SECRET: "${JWT_SECRET}"
      PUBLIC_URL: "${PUBLIC_URL:-http://localhost:3000}"
```

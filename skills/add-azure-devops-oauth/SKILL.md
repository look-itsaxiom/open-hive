---
name: add-azure-devops-oauth
description: Add Azure DevOps OAuth authentication with organization/project discovery
category: auth
port: IIdentityProvider
requires:
  - jsonwebtoken
  - "@types/jsonwebtoken"
modifies:
  - packages/backend/src/services/azure-devops-oauth-provider.ts (new)
  - packages/backend/src/routes/auth-azure-devops.ts (new)
  - packages/backend/src/env.ts
  - packages/backend/src/server.ts
  - packages/shared/src/config.ts
  - .env.example
tests:
  - packages/backend/src/auth-azure-devops.test.ts
---

# Add Azure DevOps OAuth Authentication

Add Azure DevOps OAuth login to Open Hive so developers authenticate with their Microsoft Entra ID (formerly Azure AD) identity. Includes organization membership verification, project discovery, and JWT session tokens with mandatory token refresh. Backward compatible -- when `AUTH_ENABLED=false` (default), the system uses the `PassthroughIdentityProvider`.

## Prerequisites

1. Backend source is cloned and `npm install` has been run at the repo root.
2. You can build successfully: `npm run build` (from repo root, runs turbo).
3. An **Azure DevOps OAuth App** has been registered (see [Setup Guide](#setup-guide) at the end of this file). You need the **Client ID** and **Client Secret**.

## What This Skill Does

- Creates an `AzureDevOpsOAuthProvider` class that implements the `IIdentityProvider` port interface from `@open-hive/shared`.
- Adds a full Microsoft Entra ID OAuth 2.0 login flow (`/auth/azure-devops` redirect, `/auth/azure-devops/callback` token exchange).
- Issues JWT session tokens after successful Azure DevOps login.
- Verifies organization membership when `AZURE_DEVOPS_ORG` is configured.
- Discovers the user's Azure DevOps organizations and accessible projects via API.
- Implements mandatory token refresh (Azure DevOps access tokens expire in 1 hour).
- Provides a `/auth/azure-devops/refresh` endpoint for refreshing expired tokens.
- Replaces the `PassthroughIdentityProvider` with `AzureDevOpsOAuthProvider` in the `PortRegistry` when `AUTH_ENABLED=true`.

---

## Step 1: Install Dependencies

```bash
cd packages/backend
npm install jsonwebtoken
npm install -D @types/jsonwebtoken
```

---

## Step 2: Create the Azure DevOps OAuth Identity Provider

Create `packages/backend/src/services/azure-devops-oauth-provider.ts`:

```typescript
import type { IIdentityProvider, AuthContext, DeveloperIdentity } from '@open-hive/shared';
import jwt from 'jsonwebtoken';

export interface AzureDevOpsOAuthConfig {
  clientId: string;
  clientSecret: string;
  jwtSecret: string;
  azureDevOpsOrg?: string;
}

export class AzureDevOpsOAuthProvider implements IIdentityProvider {
  readonly name = 'azure-devops-oauth';
  readonly requiresAuth = true;

  constructor(private config: AzureDevOpsOAuthConfig) {}

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
      return null;
    }
  }
}
```

---

## Step 3: Register in PortRegistry

In `packages/backend/src/server.ts`, replace the identity provider when auth is enabled:

```typescript
import { AzureDevOpsOAuthProvider } from './services/azure-devops-oauth-provider.js';

// When building the PortRegistry:
const identity = authConfig.enabled && authConfig.provider === 'azure-devops'
  ? new AzureDevOpsOAuthProvider({
      clientId: authConfig.azure_devops_client_id,
      clientSecret: authConfig.azure_devops_client_secret,
      jwtSecret: authConfig.jwt_secret,
      azureDevOpsOrg: authConfig.azure_devops_org,
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

Create `packages/backend/src/routes/auth-azure-devops.ts` with the OAuth flow handlers:

- `GET /auth/azure-devops` -- Redirects to Microsoft's OAuth authorization page
- `GET /auth/azure-devops/callback` -- Exchanges code for access token, fetches profile + orgs, issues JWT
- `POST /auth/azure-devops/refresh` -- Refreshes an expired Azure DevOps access token
- `POST /auth/token/verify` -- Validates a JWT and returns the developer identity

Register in `server.ts`:

```typescript
import { authAzureDevOpsRoutes } from './routes/auth-azure-devops.js';

// After PortRegistry creation:
authAzureDevOpsRoutes(app, authConfig);
```

---

## Step 5: Add Tests

Create `packages/backend/src/auth-azure-devops.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { AzureDevOpsOAuthProvider } from './services/azure-devops-oauth-provider.js';
import type { AuthContext } from '@open-hive/shared';

const TEST_SECRET = 'test-jwt-secret';

function createProvider(): AzureDevOpsOAuthProvider {
  return new AzureDevOpsOAuthProvider({
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    jwtSecret: TEST_SECRET,
  });
}

function mockAuthContext(authHeader?: string): AuthContext {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
  };
}

describe('AzureDevOpsOAuthProvider', () => {
  it('has name "azure-devops-oauth"', () => {
    const provider = createProvider();
    assert.equal(provider.name, 'azure-devops-oauth');
    assert.equal(provider.requiresAuth, true);
  });

  it('authenticates valid Bearer token', async () => {
    const provider = createProvider();
    const token = jwt.sign(
      { email: 'dev@corp.com', display_name: 'Dev', orgs: ['my-org'] },
      TEST_SECRET,
      { expiresIn: '1h' },
    );
    const result = await provider.authenticate(mockAuthContext(`Bearer ${token}`));

    assert.ok(result);
    assert.equal(result.email, 'dev@corp.com');
    assert.equal(result.display_name, 'Dev');
    assert.equal(result.org, 'my-org');
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

### Registering an Azure DevOps OAuth App

1. Go to the [Azure Portal](https://portal.azure.com) > Azure Active Directory > App registrations
2. Click **"New registration"**
3. Fill in:
   - **Name:** `Open Hive`
   - **Redirect URI:** `http://localhost:3000/auth/azure-devops/callback` (Web)
4. Under **Certificates & Secrets**, create a new client secret
5. Under **API permissions**, add `Azure DevOps > user_impersonation`

### Configuration

```bash
AUTH_ENABLED=true
AZURE_DEVOPS_CLIENT_ID=...
AZURE_DEVOPS_CLIENT_SECRET=...
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
AZURE_DEVOPS_ORG=my-org  # optional
```

### Docker Compose

```yaml
services:
  open-hive:
    environment:
      AUTH_ENABLED: "true"
      AZURE_DEVOPS_CLIENT_ID: "${AZURE_DEVOPS_CLIENT_ID}"
      AZURE_DEVOPS_CLIENT_SECRET: "${AZURE_DEVOPS_CLIENT_SECRET}"
      AZURE_DEVOPS_ORG: "${AZURE_DEVOPS_ORG:-}"
      JWT_SECRET: "${JWT_SECRET}"
      PUBLIC_URL: "${PUBLIC_URL:-http://localhost:3000}"
```

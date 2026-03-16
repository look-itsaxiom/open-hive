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

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PassthroughIdentityProvider } from './services/passthrough-identity-provider.js';

describe('PassthroughIdentityProvider', () => {
  it('implements IIdentityProvider with requiresAuth = false', () => {
    const provider = new PassthroughIdentityProvider();
    assert.equal(provider.name, 'passthrough');
    assert.equal(provider.requiresAuth, false);
  });

  it('resolves identity from request body with developer_email and developer_name', async () => {
    const provider = new PassthroughIdentityProvider();
    const identity = await provider.authenticate({
      headers: {},
      body: {
        developer_email: 'alice@test.com',
        developer_name: 'Alice',
      },
    });

    assert.ok(identity);
    assert.equal(identity!.email, 'alice@test.com');
    assert.equal(identity!.display_name, 'Alice');
  });

  it('returns null when body is undefined', async () => {
    const provider = new PassthroughIdentityProvider();
    const identity = await provider.authenticate({
      headers: {},
      body: undefined,
    });

    assert.equal(identity, null);
  });

  it('returns null when body is missing developer_email', async () => {
    const provider = new PassthroughIdentityProvider();
    const identity = await provider.authenticate({
      headers: {},
      body: { developer_name: 'Alice' },
    });

    assert.equal(identity, null);
  });

  it('returns null when body is missing developer_name', async () => {
    const provider = new PassthroughIdentityProvider();
    const identity = await provider.authenticate({
      headers: {},
      body: { developer_email: 'alice@test.com' },
    });

    assert.equal(identity, null);
  });
});

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { IIdentityProvider, DeveloperIdentity } from '@open-hive/shared';

export type { DeveloperIdentity } from '@open-hive/shared';

declare module 'fastify' {
  interface FastifyRequest {
    developer?: DeveloperIdentity;
  }
}

/**
 * Create an auth preHandler hook that delegates to an IIdentityProvider.
 * When the provider requires auth, unauthenticated requests are rejected with 401.
 * When the provider does not require auth (e.g., passthrough), requests pass through.
 */
export function createAuthMiddleware(provider: IIdentityProvider) {
  return async function authenticate(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const identity = await provider.authenticate({
      headers: request.headers as Record<string, string | string[] | undefined>,
      body: request.body,
    });

    if (identity) {
      request.developer = identity;
    } else if (provider.requiresAuth) {
      return reply.status(401).send({ ok: false, error: 'Authentication required' });
    }
  };
}

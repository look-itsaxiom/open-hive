import type { FastifyReply, FastifyRequest } from 'fastify';

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

// OAuth skills replace this with real token validation
export async function authenticate(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  return;
}

// When auth is enabled, this rejects unauthenticated requests
export async function requireAuth(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  return;
}

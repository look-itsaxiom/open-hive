import type { IIdentityProvider, DeveloperIdentity, AuthContext } from '@open-hive/shared';

/**
 * Passthrough identity provider — trusts self-reported identity from the request body.
 * Used in single-tenant / local development scenarios where authentication is not required.
 */
export class PassthroughIdentityProvider implements IIdentityProvider {
  readonly name = 'passthrough';
  readonly requiresAuth = false;

  async authenticate(ctx: AuthContext): Promise<DeveloperIdentity | null> {
    const body = ctx.body as Record<string, unknown> | undefined;
    if (!body) return null;

    const email = body.developer_email as string | undefined;
    const display_name = body.developer_name as string | undefined;

    if (!email || !display_name) return null;

    return {
      email,
      display_name,
    };
  }
}

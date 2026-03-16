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

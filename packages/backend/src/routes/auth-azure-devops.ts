import type { FastifyInstance } from 'fastify';
import type { HiveBackendConfig } from '@open-hive/shared';
import jwt from 'jsonwebtoken';

/**
 * Azure DevOps OAuth routes:
 * - GET  /auth/azure-devops          -> redirect to Microsoft OAuth
 * - GET  /auth/azure-devops/callback  -> exchange code for token, issue JWT
 * - POST /auth/azure-devops/refresh   -> refresh expired Azure DevOps token
 * - POST /auth/token/verify           -> validate JWT and return identity
 */
export function authAzureDevOpsRoutes(
  app: FastifyInstance,
  config: HiveBackendConfig,
): void {
  const authConfig = config.identity;

  // Only register if provider is azure-devops and auth is enabled
  if (authConfig.provider !== 'azure-devops') return;
  if (!authConfig.auth_enabled) return;

  const clientId = authConfig.azure_devops_client_id!;
  const clientSecret = authConfig.azure_devops_client_secret!;
  const jwtSecret = authConfig.jwt_secret!;
  const publicUrl = authConfig.public_url ?? `http://localhost:${config.port}`;
  const redirectUri = `${publicUrl}/auth/azure-devops/callback`;
  const scope = 'openid profile email 499b84ac-1321-427f-aa17-267ca6975798/.default';

  // Step 1: redirect to Microsoft login
  app.get('/auth/azure-devops', async (_req, reply) => {
    const url = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', scope);
    url.searchParams.set('response_mode', 'query');
    return reply.redirect(url.toString());
  });

  // Step 2: callback — exchange code for token, fetch profile, issue JWT
  app.get('/auth/azure-devops/callback', async (req, reply) => {
    const { code } = req.query as { code?: string };
    if (!code) return reply.status(400).send({ error: 'Missing authorization code' });

    try {
      // Exchange code for access token
      const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          scope,
        }),
      });
      const tokenData = await tokenRes.json() as {
        access_token?: string;
        refresh_token?: string;
        error?: string;
        error_description?: string;
      };
      if (!tokenData.access_token) {
        return reply.status(401).send({ error: tokenData.error_description ?? 'Token exchange failed' });
      }

      // Fetch user profile from Microsoft Graph
      const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const profile = await profileRes.json() as {
        mail?: string;
        userPrincipalName?: string;
        displayName?: string;
      };

      const email = profile.mail ?? profile.userPrincipalName ?? 'unknown';
      const displayName = profile.displayName ?? email;

      // Fetch Azure DevOps organizations
      const orgsRes = await fetch(
        'https://app.vssps.visualstudio.com/_apis/accounts?api-version=7.0',
        { headers: { Authorization: `Bearer ${tokenData.access_token}` } },
      );
      const orgsData = await orgsRes.json() as { value?: Array<{ accountName: string }> };
      const orgs = (orgsData.value ?? []).map((o) => o.accountName);

      // Optionally verify org membership
      const requiredOrg = authConfig.azure_devops_org;
      if (requiredOrg && !orgs.includes(requiredOrg)) {
        return reply.status(403).send({
          error: `Not a member of required organization: ${requiredOrg}`,
        });
      }

      // Issue JWT
      const sessionToken = jwt.sign(
        { email, display_name: displayName, orgs },
        jwtSecret,
        { expiresIn: '8h' },
      );

      return reply.send({
        token: sessionToken,
        email,
        display_name: displayName,
        orgs,
        refresh_token: tokenData.refresh_token,
      });
    } catch (err) {
      app.log.error({ err }, 'Azure DevOps OAuth callback error');
      return reply.status(500).send({ error: 'Authentication failed' });
    }
  });

  // Step 3: refresh Azure DevOps token
  app.post('/auth/azure-devops/refresh', async (req, reply) => {
    const { refresh_token } = req.body as { refresh_token?: string };
    if (!refresh_token) return reply.status(400).send({ error: 'Missing refresh_token' });

    try {
      const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token,
          grant_type: 'refresh_token',
          scope,
        }),
      });
      const tokenData = await tokenRes.json() as {
        access_token?: string;
        refresh_token?: string;
        error_description?: string;
      };

      if (!tokenData.access_token) {
        return reply.status(401).send({ error: tokenData.error_description ?? 'Refresh failed' });
      }
      return reply.send({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
      });
    } catch (err) {
      app.log.error({ err }, 'Token refresh error');
      return reply.status(500).send({ error: 'Token refresh failed' });
    }
  });

  // Step 4: verify JWT
  app.post('/auth/token/verify', async (req, reply) => {
    const { token } = req.body as { token?: string };
    if (!token) return reply.status(400).send({ error: 'Missing token' });

    try {
      const decoded = jwt.verify(token, jwtSecret) as {
        email: string;
        display_name: string;
        orgs: string[];
      };
      return reply.send({
        valid: true,
        email: decoded.email,
        display_name: decoded.display_name,
        orgs: decoded.orgs,
      });
    } catch {
      return reply.status(401).send({ valid: false, error: 'Invalid or expired token' });
    }
  });
}

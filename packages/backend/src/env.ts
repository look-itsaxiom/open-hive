import type { HiveBackendConfig } from '@open-hive/shared';

export function loadConfig(): HiveBackendConfig {
  return {
    port: parseInt(process.env.PORT ?? '3000', 10),
    database: {
      type: (process.env.DB_TYPE as 'sqlite' | 'postgres') ?? 'sqlite',
      url: process.env.DATABASE_URL ?? './data/hive.db',
    },
    collision: {
      scope: (process.env.COLLISION_SCOPE as 'repo' | 'org') ?? 'org',
      semantic: {
        keywords_enabled: process.env.SEMANTIC_KEYWORDS !== 'false',
        embeddings_enabled: process.env.SEMANTIC_EMBEDDINGS === 'true',
        embeddings_provider: process.env.EMBEDDINGS_PROVIDER,
        embeddings_api_key: process.env.EMBEDDINGS_API_KEY,
        llm_enabled: process.env.SEMANTIC_LLM === 'true',
        llm_provider: process.env.LLM_PROVIDER,
        llm_api_key: process.env.LLM_API_KEY,
      },
    },
    alerts: {
      sinks: (process.env.ALERT_SINKS ?? 'log')
        .split(',')
        .filter(Boolean)
        .map(type => ({
          type: type.trim() as 'webhook' | 'slack' | 'email' | 'log',
          enabled: true,
          url: type.trim() === 'webhook' ? process.env.ALERT_WEBHOOK_URL : undefined,
          channel: type.trim() === 'slack' ? process.env.ALERT_SLACK_CHANNEL : undefined,
          min_severity: (process.env.ALERT_MIN_SEVERITY as 'critical' | 'warning' | 'info') ?? 'warning',
        })),
    },
    identity: {
      provider: (process.env.IDENTITY_PROVIDER as 'static' | 'jwt' | 'oauth') ?? 'static',
      required: process.env.IDENTITY_REQUIRED === 'true',
      jwt_secret: process.env.JWT_SECRET,
      oauth_issuer: process.env.OAUTH_ISSUER,
    },
    webhooks: {
      urls: process.env.WEBHOOK_URLS?.split(',').filter(Boolean) ?? [],
    },
    session: {
      heartbeat_interval_seconds: parseInt(process.env.HEARTBEAT_INTERVAL ?? '30', 10),
      idle_timeout_seconds: parseInt(process.env.IDLE_TIMEOUT ?? '300', 10),
    },
  };
}

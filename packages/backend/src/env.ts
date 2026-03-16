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
        embeddings_base_url: process.env.EMBEDDINGS_BASE_URL,
        embeddings_model: process.env.EMBEDDINGS_MODEL,
        llm_enabled: process.env.SEMANTIC_LLM === 'true',
        llm_provider: process.env.LLM_PROVIDER,
        llm_api_key: process.env.LLM_API_KEY,
        llm_base_url: process.env.LLM_BASE_URL,
        llm_model: process.env.LLM_MODEL,
        llm_confidence_threshold: parseFloat(process.env.LLM_CONFIDENCE_THRESHOLD ?? '0.7'),
        llm_rate_limit_per_min: parseInt(process.env.LLM_RATE_LIMIT_PER_MIN ?? '10', 10),
      },
    },
    alerts: {
      min_severity: (process.env.ALERT_MIN_SEVERITY as 'info' | 'warning' | 'critical') ?? 'info',
      webhook_urls: process.env.WEBHOOK_URLS?.split(',').filter(Boolean) ?? [],
    },
    identity: {
      provider: process.env.IDENTITY_PROVIDER ?? 'passthrough',
    },
    decay: {
      enabled: process.env.DECAY_ENABLED !== 'false',
      default_half_life_seconds: parseInt(process.env.DECAY_HALF_LIFE ?? '86400', 10), // 24h default
      type_overrides: {},
      floor: parseFloat(process.env.DECAY_FLOOR ?? '0.01'),
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

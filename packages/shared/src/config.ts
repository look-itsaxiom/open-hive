export interface HiveClientConfig {
  backend_url: string;
  identity: {
    email: string;
    display_name: string;
  };
  team?: string;
  notifications: {
    inline: boolean;
    webhook_url?: string;
  };
}

export interface HiveBackendConfig {
  port: number;
  database: {
    type: 'sqlite' | 'postgres';
    url: string;
  };
  collision: {
    scope: 'repo' | 'org';
    semantic: {
      keywords_enabled: boolean;
      embeddings_enabled: boolean;
      embeddings_provider?: string;
      embeddings_api_key?: string;
      embeddings_base_url?: string;
      embeddings_model?: string;
      llm_enabled: boolean;
      llm_provider?: string;
      llm_api_key?: string;
      llm_base_url?: string;
      llm_model?: string;
      llm_confidence_threshold: number;
      llm_rate_limit_per_min: number;
    };
  };
  git_provider?: {
    type: 'github' | 'azure-devops' | 'gitlab';
    auth: 'oauth' | 'pat';
    token?: string;
    org?: string;
  };
  alerts: {
    /** Minimum severity for the built-in generic webhook sink. */
    min_severity: 'info' | 'warning' | 'critical';
    /** Generic webhook URLs (raw JSON POST). Skills register their own sinks. */
    webhook_urls: string[];
  };
  identity: {
    /** Which identity provider to use. 'passthrough' trusts self-reported identity. */
    provider: 'passthrough' | string;
  };
  decay: {
    /** Whether signal decay is enabled. */
    enabled: boolean;
    /** Default half-life in seconds for signals without a type-specific override. */
    default_half_life_seconds: number;
    /** Per-type half-life overrides in seconds. */
    type_overrides: Partial<Record<string, number>>;
    /** Minimum weight before a signal is considered fully decayed (still queryable). */
    floor: number;
  };
  webhooks: {
    urls: string[];
  };
  session: {
    heartbeat_interval_seconds: number;
    idle_timeout_seconds: number;
  };
}

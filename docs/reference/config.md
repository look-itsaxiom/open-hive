# Configuration Reference

All configuration options for the Open Hive backend and client plugin.

## Backend Environment Variables

Set these in your `docker-compose.yaml` or shell environment.

### Core

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server listening port |
| `DB_TYPE` | `sqlite` | Database backend (`sqlite` or `postgres`) |
| `DATABASE_URL` | `./data/hive.db` | SQLite file path or PostgreSQL connection string |

### Collision Detection

| Variable | Default | Description |
|----------|---------|-------------|
| `COLLISION_SCOPE` | `org` | Detection scope: `repo` (same repo only) or `org` (cross-repo) |
| `SEMANTIC_KEYWORDS` | `true` | Enable L3a keyword overlap detection |
| `SEMANTIC_EMBEDDINGS` | `false` | Enable L3b embedding similarity (requires skill) |
| `SEMANTIC_LLM` | `false` | Enable L3c LLM comparison (requires skill) |

### Embedding/LLM Providers (skill-dependent)

| Variable | Default | Description |
|----------|---------|-------------|
| `EMBEDDINGS_PROVIDER` | -- | Embeddings provider name (e.g., `openai`, `ollama`) |
| `EMBEDDINGS_API_KEY` | -- | API key for the embeddings provider |
| `LLM_PROVIDER` | -- | LLM provider name |
| `LLM_API_KEY` | -- | API key for the LLM provider |

### Alerts

| Variable | Default | Description |
|----------|---------|-------------|
| `WEBHOOK_URLS` | -- | Comma-separated webhook URLs for generic webhook sinks |
| `ALERT_MIN_SEVERITY` | `info` | Minimum severity for generic webhook sinks (`info`, `warning`, `critical`) |

### Identity

| Variable | Default | Description |
|----------|---------|-------------|
| `IDENTITY_PROVIDER` | `passthrough` | Identity provider to use (`passthrough` trusts self-reported identity; skills provide alternatives) |

### Session Management

| Variable | Default | Description |
|----------|---------|-------------|
| `HEARTBEAT_INTERVAL` | `30` | Seconds between stale session cleanup sweeps |
| `IDLE_TIMEOUT` | `300` | Seconds of inactivity before a session is automatically ended |

## Client Configuration (`~/.open-hive.yaml`)

Created by `/hive setup`. Used by the Claude Code plugin.

```yaml
backend_url: https://hive.internal.company.com
identity:
  email: developer@company.com
  display_name: Developer Name
team: engineering
notifications:
  inline: true
  webhook_url: null
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `backend_url` | string | yes | URL of the Open Hive backend |
| `identity.email` | string | yes | Developer email address |
| `identity.display_name` | string | yes | Display name shown in collision alerts |
| `team` | string | no | Team name for filtering |
| `notifications.inline` | boolean | no | Show collision alerts inline in Claude Code (default: `true`) |
| `notifications.webhook_url` | string | no | Personal webhook URL for collision notifications |

## Backend Config Types

The backend configuration is loaded from environment variables in `packages/backend/src/env.ts` and typed in `packages/shared/src/config.ts`:

```typescript
interface HiveBackendConfig {
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
      llm_enabled: boolean;
      llm_provider?: string;
      llm_api_key?: string;
    };
  };
  git_provider?: {
    type: 'github' | 'azure-devops' | 'gitlab';
    auth: 'oauth' | 'pat';
    token?: string;
    org?: string;
  };
  alerts: {
    min_severity: 'info' | 'warning' | 'critical';
    webhook_urls: string[];
  };
  identity: {
    provider: 'passthrough' | string;
  };
  webhooks: {
    urls: string[];
  };
  session: {
    heartbeat_interval_seconds: number;
    idle_timeout_seconds: number;
  };
}
```

```typescript
interface HiveClientConfig {
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
```

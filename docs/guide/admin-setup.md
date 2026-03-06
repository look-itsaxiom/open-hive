# Admin Setup

Deployment, environment configuration, and operational details for Open Hive.

## Docker Deployment

The recommended deployment uses Docker Compose:

```yaml
services:
  open-hive:
    build:
      context: .
      dockerfile: packages/backend/Dockerfile
    ports:
      - "3000:3000"
    volumes:
      - hive-data:/app/data
    environment:
      PORT: 3000
      DB_TYPE: sqlite
      DATABASE_URL: /app/data/hive.db
      COLLISION_SCOPE: org
      SEMANTIC_KEYWORDS: "true"
      SEMANTIC_EMBEDDINGS: "false"
      SEMANTIC_LLM: "false"
    restart: unless-stopped

volumes:
  hive-data:
```

```bash
docker compose up -d
```

Data is persisted to the `hive-data` Docker volume. The SQLite database runs in WAL mode with zero external dependencies.

## Environment Variables

See [config reference](../reference/config.md) for the full list of all backend environment variables and client configuration options.

### Key Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `DB_TYPE` | `sqlite` | Database type (`sqlite` or `postgres`) |
| `DATABASE_URL` | `./data/hive.db` | Database path or connection string |
| `COLLISION_SCOPE` | `org` | Collision scope (`repo` or `org`) |

## Session Management

The backend automatically cleans up stale sessions. Two environment variables control this:

| Variable | Default | Description |
|----------|---------|-------------|
| `HEARTBEAT_INTERVAL` | `30` | Seconds between cleanup sweeps |
| `IDLE_TIMEOUT` | `300` | Seconds of inactivity before a session is ended |

The cleanup runs on an interval equal to `HEARTBEAT_INTERVAL` and marks any session with no activity in `IDLE_TIMEOUT` seconds as ended.

## Authentication

By default, the backend accepts all requests (no authentication). OAuth skills replace the built-in `authenticate` middleware with real token validation:

- [GitHub OAuth skill](../../skills/add-github-oauth/)
- [GitLab OAuth skill](../../skills/add-gitlab-oauth/)
- [Azure DevOps OAuth skill](../../skills/add-azure-devops-oauth/)

## Notifications

Generic webhooks send raw JSON to configured URLs. For formatted notifications, install a notification skill:

- [Slack skill](../../skills/add-slack/) -- Block Kit webhook alerts
- [Teams skill](../../skills/add-teams/) -- Adaptive Card webhook alerts
- [Discord skill](../../skills/add-discord/) -- Discord embed webhook alerts

See [config reference](../reference/config.md) for webhook-related environment variables.

## Tech Stack

- **Runtime:** Node.js 22+ (uses built-in `node:sqlite`)
- **Backend:** Fastify v5, TypeScript, Pino logging
- **Database:** SQLite with WAL mode (zero external deps)
- **Plugin:** Claude Code hooks API, tsx
- **Build:** Turborepo, TypeScript
- **Testing:** Node.js test runner (40 unit tests)
- **Deploy:** Docker (multi-stage Alpine build)

# Admin Setup

How to deploy Open Hive for your organization.

## Overview

Open Hive has two components:
1. **Backend** — A Fastify API server you deploy once (Docker recommended)
2. **Plugin** — Each developer installs the Claude Code plugin and runs `/hive setup`

The admin deploys the backend and shares the URL. Developers self-onboard via the plugin.

## Step 1: Deploy the Backend

### Docker (recommended)

```bash
git clone https://github.com/look-itsaxiom/open-hive.git
cd open-hive
docker compose up -d
```

The `docker-compose.yaml` provides a production-ready setup:

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

Data is persisted to the `hive-data` Docker volume. The SQLite database runs in WAL mode with zero external dependencies.

### Verify the Backend

```bash
curl http://localhost:3000/api/health
# {"status":"ok","version":"0.3.0","active_nerves":0}
```

### Without Docker

```bash
git clone https://github.com/look-itsaxiom/open-hive.git
cd open-hive
npm install
npm run build
cd packages/backend
node dist/server.js
```

## Step 2: Make It Accessible

The backend URL needs to be reachable by all developers. Options:

| Setup | URL | Notes |
|-------|-----|-------|
| Local dev | `http://localhost:3000` | Single machine, testing only |
| Internal network | `http://hive.internal:3000` | LAN access, no auth needed |
| Reverse proxy | `https://hive.company.com` | TLS termination via nginx/Caddy |
| Cloud VM | `https://hive.company.com` | AWS/GCP/Azure with Docker |

For production, put the backend behind a reverse proxy with TLS. The backend itself has no built-in TLS — it expects the proxy to handle that.

## Step 3: Onboard Developers

Share these instructions with your team:

```bash
# 1. Install the Claude Code plugin
claude plugin install open-hive

# 2. Open any Claude Code session and run:
/hive setup
```

The `/hive setup` command:
1. Asks for the backend URL (the one you deployed)
2. Auto-detects git email via `git config user.email`
3. Asks for display name (defaults to `git config user.name`)
4. Optionally asks for team name
5. Writes config to `~/.open-hive.yaml`
6. Tests the connection

After setup, the plugin works automatically. No commands to remember, no workflow changes.

### What Developers See

On session start, the plugin shows:
- Who else is active in the same repo and what they're working on
- Recent work in the repo from the last 48 hours
- Any active collisions involving their session
- Unread agent mail (collision alerts, coordination messages)
- Context from their last session (via local nerve state)

When collisions are detected mid-session:
- `[Open Hive !!!]` — critical (same file)
- `[Open Hive !!]` — warning (same directory)
- `[Open Hive !]` — info (semantic overlap)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `DB_TYPE` | `sqlite` | Database type (`sqlite` or `postgres`) |
| `DATABASE_URL` | `./data/hive.db` | Database path or connection string |
| `COLLISION_SCOPE` | `org` | `repo` (same repo only) or `org` (cross-repo) |
| `SEMANTIC_KEYWORDS` | `true` | Enable L3a keyword overlap detection |
| `SEMANTIC_EMBEDDINGS` | `false` | Enable L3b embedding similarity (requires skill) |
| `SEMANTIC_LLM` | `false` | Enable L3c LLM-based analysis (requires skill) |
| `HEARTBEAT_INTERVAL` | `30` | Seconds between stale session cleanup sweeps |
| `IDLE_TIMEOUT` | `300` | Seconds of inactivity before a session is auto-ended |
| `ALERT_MIN_SEVERITY` | `info` | Minimum severity for webhook alerts (`info`, `warning`, `critical`) |
| `WEBHOOK_URLS` | (empty) | Comma-separated webhook URLs for alert delivery |
| `IDENTITY_PROVIDER` | `passthrough` | Authentication provider (passthrough trusts self-reported identity) |
| `DECAY_ENABLED` | `true` | Enable signal decay (older signals lose weight) |
| `DECAY_HALF_LIFE` | `86400` | Default signal half-life in seconds (24h) |
| `DECAY_FLOOR` | `0.01` | Minimum decay weight (signals never reach zero) |

## Session Management

The backend automatically cleans up stale sessions. If a developer's Claude Code crashes or they close their terminal without ending the session, the cleanup sweep marks it as ended after `IDLE_TIMEOUT` seconds of inactivity.

The plugin also handles crash recovery locally: the nerve state persists the active session to disk on every hook invocation, so if a session crashes, the next session start auto-snapshots the stale session as "interrupted" before beginning fresh.

## Authentication

By default, the backend uses `PassthroughIdentityProvider` which trusts self-reported identity. This is acceptable for self-hosted internal deployments where the network itself provides access control.

For production deployments with external access, install an OAuth skill:
- GitHub OAuth skill
- GitLab OAuth skill
- Azure DevOps OAuth skill

These provide `IIdentityProvider` implementations with real token validation.

## Notifications

The built-in `AlertDispatcher` delivers collision events to registered `IAlertSink` adapters. Configure `WEBHOOK_URLS` for raw JSON webhook delivery, or install a notification skill for formatted alerts:
- Slack skill (Block Kit formatting)
- Teams skill (Adaptive Cards)
- Discord skill (Embed formatting)

## Tech Stack

- **Runtime:** Node.js 22+ (uses built-in `node:sqlite`)
- **Backend:** Fastify v5, TypeScript, Pino logging
- **Database:** SQLite with WAL mode (zero external deps)
- **Plugin:** Claude Code hooks API, tsx
- **Build:** Turborepo, TypeScript
- **Testing:** Node.js test runner (182 tests across 4 scenario tests + unit tests)
- **Deploy:** Docker (multi-stage Alpine build)

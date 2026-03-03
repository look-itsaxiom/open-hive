# Open Hive

**Developer collision detection for AI-assisted teams.**

Open Hive passively tracks what each developer (and their AI agent) is working on, detects overlapping work in real-time, and alerts before conflicts escalate. Self-hosted, zero-config for developers, and designed to stay out of the way.

```
Developer A: "Refactoring the auth middleware"
Developer B: "Updating login flow error handling"
                    |
              Open Hive detects
           semantic overlap (L3a)
                    |
            Both developers get
          an inline collision alert
```

## Why

When multiple developers (or AI coding agents) work on the same codebase simultaneously, they inevitably step on each other's toes. Merge conflicts are the symptom — the real problem is that nobody knew they were working in the same area until it was too late.

Open Hive solves this by treating developer intent as a first-class signal. Every prompt, every file touch, every directory traversal is captured and compared against the rest of the team in real-time.

## How It Works

### Three Levels of Collision Detection

| Level | Type | Severity | How It Works |
|-------|------|----------|--------------|
| **L1** | File | `critical` | Two sessions modifying the same file. Zero false positives. |
| **L2** | Directory | `warning` | Two sessions modifying files in the same directory. Natural proxy for "area of code." |
| **L3a** | Semantic | `info` | Keyword extraction from developer prompts + Jaccard similarity (threshold: 0.3). Free, no API calls. |

L3b (embedding similarity) and L3c (LLM comparison) are designed but not yet enabled — the architecture supports plugging them in when needed.

### Collision Scope

Configurable per deployment:
- **`repo`** — only detect collisions within the same repository
- **`org`** — detect collisions across all repositories (default)

## Architecture

```
┌─────────────────────┐     ┌─────────────────────┐
│  Developer A        │     │  Developer B        │
│  Claude Code        │     │  Claude Code        │
│  + Open Hive Plugin │     │  + Open Hive Plugin │
└────────┬────────────┘     └────────┬────────────┘
         │  hooks fire passively      │
         │  on every prompt/edit      │
         ▼                            ▼
┌─────────────────────────────────────────────────┐
│              Open Hive Backend                  │
│         Fastify + SQLite (Docker)               │
│                                                 │
│  ┌───────────┐  ┌──────────┐  ┌──────────────┐ │
│  │ Sessions  │  │ Signals  │  │  Collision   │ │
│  │ Registry  │  │  Store   │  │   Engine     │ │
│  └───────────┘  └──────────┘  └──────────────┘ │
└─────────────────────────────────────────────────┘
```

### Monorepo Structure

```
open-hive/
├── packages/
│   ├── backend/      # Fastify API server + collision engine
│   ├── plugin/       # Claude Code plugin (hooks, commands, client)
│   └── shared/       # TypeScript types and API contracts
├── docker-compose.yaml
└── turbo.json
```

## Quick Start

### 1. Start the Backend

```bash
git clone https://github.com/look-itsaxiom/open-hive.git
cd open-hive
docker compose up -d
```

The backend starts on `http://localhost:3000` with a SQLite database persisted to a Docker volume.

### 2. Install the Plugin

```bash
# From your project directory
claude plugin install open-hive
```

### 3. Run Setup

In any Claude Code session:

```
/hive setup
```

This prompts for your backend URL and identity, then saves config to `~/.open-hive.yaml`:

```yaml
backend_url: http://localhost:3000
identity:
  email: you@company.com
  display_name: Your Name
team: engineering
```

That's it. The plugin hooks fire passively — no commands to remember, no workflow changes.

## What the Plugin Does

The plugin registers six hooks that run automatically during your Claude Code session:

| Hook | When | What It Does |
|------|------|--------------|
| `SessionStart` | Session opens | Registers you with the backend, receives active collision state |
| `UserPromptSubmit` | Every prompt | Captures your intent, checks for semantic overlap with teammates |
| `PreToolUse` | Before Write/Edit | Checks if someone else is modifying the same file |
| `PostToolUse` | After Write/Edit | Records which files you touched |
| `PreCompact` | Before context compaction | Injects active session awareness into compressed context |
| `SessionEnd` | Session closes | Deregisters your session |

**Design principle:** Hooks never block. All backend calls have 3-second timeouts and gracefully fall through if the backend is unreachable. If the backend is down, your dev experience is unchanged.

### Commands

| Command | Description |
|---------|-------------|
| `/hive setup` | Configure backend URL and identity |
| `/hive status` | Show your active session and any collisions |
| `/hive who` | List all active developers and what they're working on |
| `/hive history` | View recent activity signals for the current repo |

## API Reference

### Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/sessions/register` | Register a session, get active collisions |
| `POST` | `/api/sessions/heartbeat` | Keep a session alive |
| `POST` | `/api/sessions/end` | End a session |
| `GET` | `/api/sessions/active` | List active sessions (filter by `?repo=`) |

### Signals

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/signals/intent` | Send developer intent, get semantic collisions |
| `POST` | `/api/signals/activity` | Record file read/modify activity |

### Collisions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/conflicts/check` | Check a file for active conflicts |
| `POST` | `/api/conflicts/resolve` | Mark a collision as resolved |

### History & Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/history` | Query recent signals (filter by file, area, repo) |
| `GET` | `/api/health` | Server health check |

## Configuration

### Backend (Environment Variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `DB_TYPE` | `sqlite` | Database type (`sqlite` or `postgres`) |
| `DATABASE_URL` | `/app/data/hive.db` | Database path or connection string |
| `COLLISION_SCOPE` | `org` | Collision scope (`repo` or `org`) |
| `SEMANTIC_KEYWORDS` | `true` | Enable L3a keyword overlap detection |
| `SEMANTIC_EMBEDDINGS` | `false` | Enable L3b embedding similarity |
| `SEMANTIC_LLM` | `false` | Enable L3c LLM comparison |

### Client (`~/.open-hive.yaml`)

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

## Development

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Development mode (watch)
npm run dev

# Run tests
npm run test

# Run backend unit tests directly
cd packages/backend
node --import tsx --test src/**/*.test.ts
```

### Running Locally (without Docker)

```bash
npm install
npm run build
cd packages/backend
node dist/server.js
# Backend starts on http://localhost:3000
```

### Try It Out

With the backend running, walk through a collision scenario:

```bash
# Register two developers
curl -X POST http://localhost:3000/api/sessions/register \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"dev-a","developer_email":"alice@team.com","developer_name":"Alice","repo":"my-app","project_path":"/code/my-app"}'

curl -X POST http://localhost:3000/api/sessions/register \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"dev-b","developer_email":"bob@team.com","developer_name":"Bob","repo":"my-app","project_path":"/code/my-app"}'

# Alice modifies a file
curl -X POST http://localhost:3000/api/signals/activity \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"dev-a","file_path":"src/auth/login.ts","type":"file_modify"}'

# Bob modifies the same file — collision detected!
curl -X POST http://localhost:3000/api/signals/activity \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"dev-b","file_path":"src/auth/login.ts","type":"file_modify"}'
# Response includes: "severity": "critical"

# Check who's working on what
curl http://localhost:3000/api/sessions/active?repo=my-app

# Clean up
curl -X POST http://localhost:3000/api/sessions/end \
  -H 'Content-Type: application/json' -d '{"session_id":"dev-a"}'
curl -X POST http://localhost:3000/api/sessions/end \
  -H 'Content-Type: application/json' -d '{"session_id":"dev-b"}'
```

### Tech Stack

- **Runtime:** Node.js 22+ (uses built-in `node:sqlite`)
- **Backend:** Fastify v5, TypeScript, Pino logging
- **Database:** SQLite with WAL mode (zero external deps)
- **Plugin:** Claude Code hooks API, tsx
- **Build:** Turborepo, TypeScript
- **Testing:** Node.js test runner (26 unit tests)
- **Deploy:** Docker (multi-stage Alpine build)

## Roadmap

- [x] Three-level collision detection (L1 file, L2 directory, L3a semantic)
- [x] Claude Code plugin (6 hooks, 4 commands)
- [x] Docker deployment
- [x] Session heartbeat + idle timeout
- [x] Input validation + error handling
- [x] Unit test suite (26 tests)
- [ ] Web dashboard (active sessions + collision visualization)
- [ ] MCP server (expose `hive_*` tools directly to Claude)
- [ ] Webhook notifications (Slack, Teams)
- [ ] L3b embedding similarity (cosine distance)
- [ ] L3c LLM-based semantic comparison
- [ ] Git provider OAuth (GitHub, Azure DevOps, GitLab)
- [ ] PostgreSQL adapter
- [ ] API authentication

## License

MIT

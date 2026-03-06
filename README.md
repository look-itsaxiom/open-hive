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

L3b (embedding similarity) and L3c (LLM comparison) are available as installable skills — add them when your team needs deeper semantic analysis.

### Collision Scope

Configurable per deployment:
- **`repo`** — only detect collisions within the same repository
- **`org`** — detect collisions across all repositories (default)

## Design Philosophy

Open Hive is a **coordination layer**, not an integration platform. The core codebase defines *what* the hive delivers — collision detection, alerts, identity, storage, semantic analysis — as **generic, cross-org interfaces (ports)**. Specific implementations for particular tools and services (Slack, OAuth, PostgreSQL, etc.) are delivered as **skills (adapters)** that plug into those ports.

This mirrors the hive metaphor: the **hive is the structure** — the honeycomb cells, the architecture, the protocols. The **bees are the implementations** — they plug into the structure and do the specific work for a particular colony.

### Core Ports (built into the codebase)

| Port | Interface | Responsibility |
|------|-----------|----------------|
| **Storage** | `IHiveStore` | Persist sessions, signals, and collisions |
| **Alerts** | `IAlertSink` | Route collision notifications to the right people |
| **Identity** | `IIdentityProvider` | Authenticate developers and resolve team membership |
| **Semantic Analysis** | `ISemanticAnalyzer` | Compare developer intents for overlap (L3b, L3c) |

### Skill Adapters (plugged in per deployment)

| Port | Example Skills |
|------|---------------|
| Storage | PostgreSQL, MySQL |
| Alerts | Slack, Teams, Discord, PagerDuty, email |
| Identity | GitHub OAuth, GitLab OAuth, Azure DevOps OAuth, LDAP, SAML |
| Semantic Analysis | OpenAI Embeddings, Ollama Embeddings, LLM Comparison |

**The rule:** If it's about *what Open Hive does*, it belongs in the core. If it's about *how a particular org implements it*, it's a skill.

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
│                                                 │
│  ┌─────────────────────────────────────────────┐│
│  │              Core Ports                     ││
│  │  IHiveStore · IAlertSink · IIdentityProvider││
│  │           ISemanticAnalyzer                 ││
│  └─────────────────────────────────────────────┘│
│         ▲          ▲           ▲                │
│         │          │           │                │
│    ┌────┴───┐ ┌────┴───┐ ┌────┴────┐           │
│    │ Skills │ │ Skills │ │ Skills  │           │
│    │(adaptr)│ │(adaptr)│ │(adaptr) │           │
│    └────────┘ └────────┘ └─────────┘           │
└─────────────────────────────────────────────────┘
```

### Monorepo Structure

```
open-hive/
├── packages/
│   ├── backend/      # Fastify API server + collision engine
│   ├── plugin/       # Claude Code plugin (hooks, commands, client)
│   └── shared/       # TypeScript types and API contracts
├── skills/           # 12 integration skills (see Skills Library below)
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

## Skills Library

Open Hive uses a **skills-based extensibility model**. Instead of shipping every integration as built-in code, each capability is a self-contained `SKILL.md` that teaches Claude Code how to add it to your installation. Run a skill, and Claude modifies your backend with the integration, tests, and configuration — tailored to your setup.

### Available Skills

| Skill | Category | What It Adds |
|-------|----------|--------------|
| **[Slack](skills/add-slack/)** | Notifications | Block Kit webhook alerts with severity filtering |
| **[Teams](skills/add-teams/)** | Notifications | Adaptive Card webhook alerts |
| **[Discord](skills/add-discord/)** | Notifications | Discord embed webhook alerts |
| **[GitHub OAuth](skills/add-github-oauth/)** | Auth | GitHub OAuth flow, org/team discovery, JWT sessions |
| **[GitLab OAuth](skills/add-gitlab-oauth/)** | Auth | GitLab OAuth flow, self-hosted support |
| **[Azure DevOps OAuth](skills/add-azure-devops-oauth/)** | Auth | Microsoft Entra ID OAuth, token refresh |
| **[PostgreSQL](skills/add-postgres/)** | Storage | Swap SQLite for PostgreSQL with migrations |
| **[Web Dashboard](skills/add-dashboard/)** | UI | Embedded htmx dashboard for sessions and collisions |
| **[MCP Server](skills/add-mcp-server/)** | Plugin | 6 `hive_*` MCP tools for direct Claude integration |
| **[L3b Embeddings](skills/add-embedding-l3b/)** | Detection | Cosine similarity via OpenAI/Ollama embeddings |
| **[L3c LLM](skills/add-llm-l3c/)** | Detection | LLM-based semantic overlap analysis |
| **[Build Your Own](skills/build-skill/)** | Meta | Guide for creating custom integration skills |

### Using a Skill

Each skill is a step-by-step guide. Point Claude at it and it handles the rest:

```
Read skills/add-slack/SKILL.md and apply it to this project.
```

Claude will create the formatter, add environment config, wire it into the server, write tests, and verify the build. See [`skills/README.md`](skills/README.md) for details.

### Extension Points (Core Ports)

Skills plug into four core ports defined in the backend:

| Port | Interface | Example Skills |
|------|-----------|----------------|
| **Alerts** | `IAlertSink` | Slack, Teams, Discord |
| **Identity** | `IIdentityProvider` | GitHub OAuth, GitLab OAuth, Azure DevOps OAuth |
| **Storage** | `IHiveStore` | PostgreSQL |
| **Semantic Analysis** | `ISemanticAnalyzer` | L3b Embeddings, L3c LLM |

## Configuration

### Backend (Environment Variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `DB_TYPE` | `sqlite` | Database type (`sqlite` or `postgres`) |
| `DATABASE_URL` | `/app/data/hive.db` | Database path or connection string |
| `COLLISION_SCOPE` | `org` | Collision scope (`repo` or `org`) |
| `SEMANTIC_KEYWORDS` | `true` | Enable L3a keyword overlap detection |
| `SEMANTIC_EMBEDDINGS` | `false` | Enable L3b embedding similarity (requires skill) |
| `SEMANTIC_LLM` | `false` | Enable L3c LLM comparison (requires skill) |
| `WEBHOOK_URLS` | — | Comma-separated webhook URLs for generic notifications |
| `WEBHOOK_MIN_SEVERITY` | `info` | Minimum severity for generic webhooks |

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
- **Testing:** Node.js test runner (40 unit tests)
- **Deploy:** Docker (multi-stage Alpine build)

## Roadmap

### Phase 1 — MVP (complete)
- [x] Three-level collision detection (L1 file, L2 directory, L3a semantic)
- [x] Claude Code plugin (6 hooks, 4 commands)
- [x] Docker deployment
- [x] Session heartbeat + idle timeout
- [x] Input validation + error handling
- [x] Unit test suite (40 tests)
- [x] Store adapter interface (`IHiveStore`)
- [x] Skills library (12 integration skills)

### Phase 2 — Core Ports (next)
- [ ] **M1: Define Core Ports** — `IAlertSink`, `IIdentityProvider`, `ISemanticAnalyzer` interfaces in `@open-hive/shared`
- [ ] **M2: Refactor to Ports** — Migrate `NotificationDispatcher` → `IAlertSink`, `authenticate` → `IIdentityProvider`, wire `ISemanticAnalyzer` into `CollisionEngine`
- [ ] **M3: Skill Contract Update** — Update all 12 skills to target port interfaces, update build-skill guide with port authoring patterns
- [ ] **M4: L3b/L3c Engine Integration** — Wire `ISemanticAnalyzer` into `CollisionEngine` so L3b/L3c are first-class detection tiers, not bolt-ons

### Phase 3 — Ecosystem
- [ ] Claude Code marketplace publication
- [ ] Community-contributed skills
- [ ] Skill validation / conformance tests

## License

MIT

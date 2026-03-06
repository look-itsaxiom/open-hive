# Architecture Overview

Open Hive is a developer collision detection system for AI-assisted teams. It passively tracks what each developer (and their AI agent) is working on, detects overlapping work in real-time, and alerts before conflicts escalate.

## Why

When multiple developers (or AI coding agents) work on the same codebase simultaneously, they inevitably step on each other's toes. Merge conflicts are the symptom -- the real problem is that nobody knew they were working in the same area until it was too late.

Open Hive solves this by treating developer intent as a first-class signal. Every prompt, every file touch, every directory traversal is captured and compared against the rest of the team in real-time.

## System Architecture

```
+-----------------------+     +-----------------------+
|  Developer A          |     |  Developer B          |
|  Claude Code          |     |  Claude Code          |
|  + Open Hive Plugin   |     |  + Open Hive Plugin   |
+--------+--------------+     +--------+--------------+
         |  hooks fire passively       |
         |  on every prompt/edit       |
         v                             v
+-------------------------------------------------+
|              Open Hive Backend                   |
|         Fastify + SQLite (Docker)                |
|                                                  |
|  +-----------+  +----------+  +--------------+   |
|  | Sessions  |  | Signals  |  |  Collision   |   |
|  | Registry  |  |  Store   |  |   Engine     |   |
|  +-----------+  +----------+  +--------------+   |
|                                                  |
|  +----------------------------------------------+|
|  |              Core Ports                       ||
|  |  IHiveStore . IAlertSink . IIdentityProvider  ||
|  |           ISemanticAnalyzer                   ||
|  +----------------------------------------------+|
|         ^          ^           ^                  |
|         |          |           |                  |
|    +--------+ +--------+ +---------+             |
|    | Skills | | Skills | | Skills  |             |
|    |(adaptr)| |(adaptr)| |(adaptr) |             |
|    +--------+ +--------+ +---------+             |
+-------------------------------------------------+
```

## Data Flow

1. **Developer opens Claude Code** -- `SessionStart` hook registers the session with the backend
2. **Developer types a prompt** -- `UserPromptSubmit` hook sends the prompt text as an intent signal; backend extracts keywords and checks for semantic overlap with other active sessions and recent historical intents
3. **Claude writes/edits a file** -- `PreToolUse` hook checks if anyone else is working on that file; `PostToolUse` hook records the file modification
4. **Collision detected** -- Backend creates a collision record, fires webhooks, and returns the collision to the plugin; plugin injects an alert into the Claude Code session
5. **Session ends** -- `SessionEnd` hook deregisters the session

## Monorepo Structure

```
open-hive/
+-- packages/
|   +-- backend/      # Fastify API server + collision engine
|   +-- plugin/       # Claude Code plugin (hooks, commands, client)
|   +-- shared/       # TypeScript types and API contracts
+-- skills/           # 12 integration skills (see skills catalog)
+-- docker-compose.yaml
+-- turbo.json
```

### packages/backend

The Fastify HTTP server. Contains:
- **Routes:** 4 route modules (sessions, signals, conflicts, history) plus health check
- **Services:** `CollisionEngine` (L1/L2/L3 detection with tier-ordered `ISemanticAnalyzer[]`), `AlertDispatcher` + `GenericWebhookSink` (alert delivery), `KeywordAnalyzer` (L3a), `PassthroughIdentityProvider` (default auth)
- **Wiring:** `PortRegistry` bundles all port implementations; passed to routes at startup
- **Database:** SQLite via `node:sqlite` with WAL mode, wrapped by `IHiveStore` interface
- **Middleware:** `createAuthMiddleware(provider)` delegates to the configured `IIdentityProvider`

### packages/plugin

The Claude Code plugin. Contains:
- **Hooks handler:** 6 hooks (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PreCompact, SessionEnd)
- **Client:** HTTP client for the backend API with 3-second timeouts
- **Config:** Reads `~/.open-hive.yaml`
- **Commands:** 4 slash commands (/hive setup, status, who, history)

### packages/shared

Shared TypeScript types used by both backend and plugin:
- **Models:** `Session`, `Signal`, `Collision`, `TrackedRepo` and their associated types
- **API types:** Request/response interfaces for all endpoints
- **Config types:** `HiveBackendConfig`, `HiveClientConfig`
- **Port interfaces:** `IHiveStore`, `IAlertSink`, `IIdentityProvider`, `ISemanticAnalyzer` and their associated types (`AlertEvent`, `AlertParticipant`, `DeveloperIdentity`, `AuthContext`, `SemanticMatch`, `HistoricalIntent`)

### skills/

12 self-contained skill directories, each with a `SKILL.md` that guides Claude through implementing the integration. See [skills catalog](../reference/skills-catalog.md).

## Database Schema

Four tables, auto-created on startup:

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `sessions` | Active and ended developer sessions | `session_id`, `developer_email`, `repo`, `status`, `intent`, `files_touched`, `areas` |
| `signals` | Individual captured actions | `signal_id`, `session_id`, `type`, `content`, `file_path` |
| `collisions` | Detected overlaps between sessions | `collision_id`, `session_ids` (JSON), `type`, `severity`, `resolved` |
| `tracked_repos` | Repositories known to the system | `repo_id`, `name`, `provider` |

Indexes on `sessions.status`, `sessions.repo`, `signals.session_id`, `signals.file_path`, and `collisions.resolved`.

## Tech Stack

- **Runtime:** Node.js 22+ (uses built-in `node:sqlite`)
- **Backend:** Fastify v5, TypeScript, Pino logging
- **Database:** SQLite with WAL mode (zero external deps)
- **Plugin:** Claude Code hooks API, tsx
- **Build:** Turborepo, TypeScript
- **Testing:** Node.js test runner (66 unit tests)
- **Deploy:** Docker (multi-stage Alpine build)

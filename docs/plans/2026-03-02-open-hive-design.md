# Open Hive — Design Document

**Date:** 2026-03-02
**Author:** Chase Skibeness
**Status:** Approved

---

## Problem

Developers using AI coding tools move so fast they collide — duplicating work, building conflicting implementations, wasting time and money. No existing tool detects these collisions in real-time. Process-based solutions (standups, RFCs, digests) are too slow at AI-assisted velocity.

**Evidence:**
- 4 developer collisions in 7 days at Tapcheck
- 3 other Tapcheck engineers independently tried to solve this same problem in Feb 2026
- Anthropic's 2026 Agentic Coding Trends Report identifies multi-agent coordination as a top strategic priority but offers no tooling
- No existing tool in the Claude Code ecosystem addresses this (confirmed via awesome-claude-code survey)

## Solution

**Open Hive** is a developer coordination system that passively captures developer intent and activity, detects work collisions across a team, and alerts before conflicts escalate.

It ships as:
1. **Claude Code Plugin** — hooks capture activity, MCP server exposes query tools, commands provide manual access
2. **Self-hosted Backend** — Docker container running Node.js + SQLite (Postgres optional), tracks sessions, runs collision detection, dispatches notifications
3. **Web Dashboard** — embedded in the backend container, shows live sessions, collisions, history
4. **Git Provider Integration** — OAuth (primary) + PAT (fallback) for repo discovery

## Architecture

```
Developer Machines                       Org Infrastructure
┌──────────────────────┐                ┌─────────────────────────┐
│ Claude Code          │                │ Open Hive Backend       │
│ ┌──────────────────┐ │    HTTPS       │ (Docker)                │
│ │ Open Hive Plugin │─┼───────────────▶│                         │
│ │  Hooks (passive) │ │                │ Session Tracker         │
│ │  MCP (active)    │ │◀───────────────│ Collision Engine        │
│ │  Commands        │ │  systemMessage │ Notification Dispatcher │
│ │  Skills          │ │  + webhook     │ Git Provider (OAuth)    │
│ └──────────────────┘ │                │ Web Dashboard           │
└──────────────────────┘                └─────────────────────────┘
```

## Plugin Components

### Hooks — Passive Telemetry

All hooks implemented in TypeScript via `@mizunashi_mana/claude-code-hook-sdk`.

| Hook Event | Matcher | Purpose | Blocking |
|------------|---------|---------|----------|
| SessionStart | `*` | Register session, receive collision state | No |
| UserPromptSubmit | `*` | Capture developer intent | No |
| PreToolUse | `Write\|Edit` | Check for file-level conflicts before modification | Semi (2-3s timeout, falls through) |
| PostToolUse | `Write\|Edit` | Record file modifications | No |
| SessionEnd | `*` | Deregister session | No |
| PreCompact | `*` | Inject collision state for context preservation | No |

**Design principle:** Hooks never block the developer. All backend calls have aggressive timeouts. If the backend is down, hooks exit cleanly.

### MCP Server — Active Query Interface

Local stdio server bundled with plugin. Provides Claude with tools:

- `hive_check_conflicts(file_path, repo?)` — check for active conflicts
- `hive_list_active(repo?, team?)` — list active sessions
- `hive_broadcast_intent(description)` — explicitly declare work intent
- `hive_get_history(file_path?, area?, since?)` — recent activity
- `hive_resolve_collision(collision_id)` — acknowledge a collision

### Commands

- `/hive setup` — interactive first-time configuration
- `/hive status` — current sessions, collisions, your activity
- `/hive who` — who's working on what right now
- `/hive history` — recent activity in current repo/area

### Skill — collision-awareness

Auto-triggers when collision data is injected. Teaches Claude:
- How to present collision warnings naturally
- When to proactively check for conflicts before major edits
- How to help resolve collisions
- Severity interpretation (CRITICAL / WARNING / INFO)

## Collision Detection

### Three Levels

**Level 1 — File (deterministic):**
Two sessions modifying the same file = CRITICAL. Instant, zero false positives.

**Level 2 — Directory (deterministic):**
Two sessions modifying files in the same directory tree = WARNING. Natural proxy for "area of code."

**Level 3 — Semantic (tiered, configurable):**
Three sub-tiers, each optional. Runs as a filter funnel — cheap/fast first, expensive/accurate only when needed:

| Tier | Method | Cost | Accuracy |
|------|--------|------|----------|
| 3a | Keyword/tag extraction + overlap | Free | Moderate |
| 3b | Embedding similarity (cosine) | Low | Good |
| 3c | LLM comparison | Higher | Best |

Keywords filter obvious non-matches. Embeddings catch fuzzy similarity. LLM fires only for ambiguous cases.

### Scope

Configurable per deployment: repository-scoped, team-scoped, or organization-wide. Default: organization-wide.

## Backend

### Tech Stack

- **Runtime:** Node.js (TypeScript)
- **Database:** SQLite via better-sqlite3 (default), PostgreSQL optional
- **Data layer:** Repository pattern with adapter interface (swap SQLite ↔ Postgres)
- **Web framework:** Fastify or Express
- **Dashboard:** Embedded web UI (tech TBD — htmx or small SPA)
- **Deployment:** Docker container, docker-compose for setup

### API Endpoints

```
POST /api/sessions/register        Register new session
POST /api/sessions/heartbeat       Session still active
POST /api/sessions/end             Session ended
POST /api/signals/intent           Developer intent captured
POST /api/signals/activity         File modification recorded
GET  /api/conflicts/check          Check for conflicts
GET  /api/sessions/active          List active sessions
GET  /api/history                  Recent activity
POST /api/conflicts/resolve        Mark collision resolved
GET  /api/dashboard/*              Web dashboard
POST /api/admin/setup              Backend setup wizard
```

### Data Model

**Session:**
```
session_id, developer_id, developer_email, developer_name,
repo, project_path, started_at, last_activity, status,
intent, files_touched[], files_explored[], areas[]
```

**Signal:**
```
signal_id, session_id, timestamp,
type (prompt | file_modify | file_read | search | explicit),
content, semantic_area, confidence
```

**Collision:**
```
collision_id, session_ids[], type (file | directory | semantic),
severity (critical | warning | info), details,
detected_at, resolved, resolved_by
```

### Notification Dispatch

On collision detection:
1. **Inline:** Return collision data in API response → plugin injects as systemMessage
2. **Webhook:** POST to configured URLs (Slack, Teams, custom)

## Git Provider Integration

- **OAuth** (primary) — GitHub Apps, Azure DevOps, GitLab OAuth
- **PAT** (fallback) — simpler setup, shorter-lived
- **Self-registration** (fallback) — first session from a repo auto-registers it

Used for: repo discovery, org structure, file structure indexing, PR/branch context.

## Identity

- **Git email** auto-detected from local git config
- **Display name** configurable in `~/.open-hive.yaml`
- **Backend registration** on first session

## Setup

### Backend (Admin)

```bash
docker compose up -d
# Open dashboard → setup wizard
# Configure: git provider, scope, semantic tiers, webhooks, teams
```

### Developer

```bash
claude plugin install open-hive
# /hive setup in Claude Code
# Auto-detects git email, prompts for backend URL + team
# Saves to ~/.open-hive.yaml
```

### Config File

```yaml
# ~/.open-hive.yaml
backend_url: https://hive.internal.company.com
identity:
  email: chase@tapcheck.com
  display_name: Chase S.
team: engineering
notifications:
  inline: true
  webhook_url: null
```

## Monorepo Structure

```
open-hive/
├── packages/
│   ├── plugin/              # Claude Code plugin
│   │   ├── .claude-plugin/
│   │   ├── hooks/
│   │   ├── commands/
│   │   ├── skills/
│   │   ├── agents/
│   │   ├── .mcp.json
│   │   └── src/             # TS hook handlers, MCP server, API client
│   ├── backend/             # API server
│   │   ├── src/
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── dashboard/           # Web UI
│   │   └── src/
│   └── shared/              # Shared types and models
│       └── src/
├── docker-compose.yaml
├── package.json             # Workspace root
├── turbo.json
└── tsconfig.base.json
```

## Testing Strategy

1. **Multi-session simulation** — multiple Claude Code instances with different identities working in same repo
2. **Backend simulation scripts** — `simulate.ts` creates fake sessions/signals to test collision detection at scale
3. **Plugin dry-run mode** — hooks log intended actions without hitting backend
4. **Integration test suite** — Docker backend + scripted hook inputs, assert collision detection and notification

## Competitive Landscape

| Tool | What It Does | Gap |
|------|-------------|-----|
| Zooid | Pub/sub for AI agents | Infrastructure only, no collision detection |
| Claude Squad | Multi-agent session management | Local only, no cross-developer awareness |
| claude-tmux/esp | Session monitoring | Local observation, no coordination |
| Git (merge conflicts) | Post-hoc conflict detection | Too late — after work is done |
| Standups/RFCs | Process-based coordination | Too slow at AI-assisted velocity |
| **Open Hive** | **Intent-aware collision prevention** | **This is the gap** |

## Open Questions (Deferred to Implementation)

- Dashboard tech choice (htmx vs React/Solid)
- Embedding model selection for semantic tier 3b
- LLM provider/model for semantic tier 3c
- Heartbeat interval for session liveness
- Signal debouncing strategy for high-frequency Read/Grep hooks
- Rate limiting strategy for backend API

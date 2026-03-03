# Open Hive — Skills-Based Architecture

**Date:** 2026-03-03
**Author:** Chase Skibeness
**Status:** Draft

---

## Problem

Open Hive's original roadmap contains ~10 pending milestones: OAuth providers, webhook integrations, PostgreSQL adapter, web dashboard, embedding models, LLM comparison, MCP server. Building all of these as first-party features creates:

1. **Maintenance burden** — every integration must be updated, tested, and supported forever
2. **Feature bloat** — most users need 2-3 integrations, not all of them
3. **Community bottleneck** — every new integration requires a core PR, review, and merge
4. **Documentation sprawl** — each feature needs setup guides, config reference, troubleshooting

The nanoclaw methodology offers a radically different approach: **distribute Claude Code skills, not integration code.**

## Insight

Claude Code skills are instruction files that teach Claude how to transform a codebase. Instead of building a Slack webhook integration into the backend, we write a `SKILL.md` file that teaches Claude how to add Slack webhooks to a user's Open Hive installation.

The skill IS the documentation, the implementation guide, and the installer — all in one file that Claude reads and executes.

## Architecture: Three Components

### 1. `open-hive` — User Plugin (Anthropic Marketplace)

The lightweight client that every developer installs. This is what goes on the Anthropic Claude Code marketplace.

**What it contains:**
- 6 hooks (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, SessionEnd, PreCompact)
- 4 commands (`/hive setup`, `/hive status`, `/hive who`, `/hive history`)
- 1 skill (collision-awareness — teaches Claude how to interpret collision warnings)
- HTTP client with 3-second timeouts and graceful degradation

**What it does NOT contain:**
- Backend code
- Admin capabilities
- Installation or configuration of the backend

**Install path:**
```bash
claude plugin install open-hive
# In Claude Code:
/hive setup
# → prompts for backend URL, auto-detects git email, saves ~/.open-hive.yaml
```

**Marketplace listing (`marketplace.json`):**
```json
{
  "name": "open-hive",
  "version": "0.2.0",
  "description": "Developer collision detection — know what your team is working on before you collide",
  "source": "./packages/plugin"
}
```

### 2. `open-hive-admin` — Admin Plugin (Separate Install)

The admin toolkit for whoever deploys and maintains the Open Hive backend. Contains skills that transform the backend source code.

**What it contains:**
- Skills that add capabilities to the backend (one per integration)
- A meta skill (`/hive build-skill`) for creating new integration skills
- Admin commands for backend management

**What it does NOT contain:**
- Hooks (admins don't need collision detection on the backend repo)
- The backend source itself (that's in the main open-hive repo)

**Install path:**
```bash
# Admin clones the open-hive repo (has the backend source)
git clone https://github.com/look-itsaxiom/open-hive.git
cd open-hive

# Admin installs the admin plugin
claude plugin install open-hive-admin

# Run skills to configure their instance
/hive add-slack
/hive add-github-oauth
/hive add-postgres

# Rebuild and deploy
npm run build
docker compose up -d --build
```

**Skills library (initial):**

| Skill | What It Does |
|-------|-------------|
| `/hive add-slack` | Adds Slack Block Kit webhook formatting + incoming webhook config |
| `/hive add-teams` | Adds Microsoft Teams Adaptive Card webhook formatting |
| `/hive add-discord` | Adds Discord embed webhook formatting |
| `/hive add-github-oauth` | Adds GitHub OAuth flow: app registration, org/team discovery, token exchange, session auth |
| `/hive add-gitlab-oauth` | Adds GitLab OAuth: app registration, group/project discovery, token exchange |
| `/hive add-azure-devops-oauth` | Adds Azure DevOps OAuth: app registration, org/project discovery |
| `/hive add-postgres` | Swaps SQLite store for PostgreSQL: connection pooling, migrations, env config |
| `/hive add-dashboard` | Adds embedded web UI: active sessions view, collision timeline, session detail |
| `/hive add-embedding-l3b` | Adds L3b embedding similarity: provider config, cosine distance, threshold tuning |
| `/hive add-llm-l3c` | Adds L3c LLM comparison: provider config, prompt template, confidence scoring |
| `/hive add-mcp-server` | Adds MCP server to the plugin: `hive_*` tools exposed directly to Claude |
| `/hive build-skill` | Meta-skill: teaches Claude how to write a new Open Hive integration skill |

### 3. `/hive build-skill` — The Flywheel

The meta-skill that makes the whole system self-extending. When someone wants an integration that doesn't exist yet, they run `/hive build-skill` and Claude scaffolds a new skill using the documented extension points.

**What it provides to Claude:**
- Extension point catalog (where to hook into the backend)
- Skill template (standard SKILL.md structure)
- Testing conventions (what tests to add)
- Manifest format (declares what the skill modifies)

**Example interaction:**
```
User: /hive build-skill
Claude: What integration do you want to add to Open Hive?
User: I want PagerDuty alerts for critical collisions
Claude: I'll create a skill that:
  1. Adds a PagerDuty notification formatter to the webhook system
  2. Adds PAGERDUTY_ROUTING_KEY to env config
  3. Adds severity-based routing (only critical → PagerDuty)
  4. Adds tests for the formatter

  [Writes skills/add-pagerduty/SKILL.md]

  You can now run /hive add-pagerduty to install this integration,
  or PR the skill back to the open-hive repo for others to use.
```

## Extension Points

The backend must expose clean, documented interfaces that skills can hook into. These are the seams where Claude inserts new functionality.

### Notification Formatters

The core backend ships a **generic webhook emitter**. When a collision is detected, it POSTs a standardized JSON payload to configured URLs:

```typescript
// Core: always ships
interface WebhookPayload {
  type: 'collision_detected' | 'collision_resolved';
  severity: CollisionSeverity;
  collision: Collision;
  sessions: Pick<Session, 'developer_name' | 'developer_email' | 'repo' | 'intent'>[];
  timestamp: string;
}
```

Integration skills add **formatters** that transform this payload for specific platforms:

```typescript
// Extension point: skills/add-slack adds this
interface NotificationFormatter {
  name: string;
  format(payload: WebhookPayload): { url: string; body: unknown; headers?: Record<string, string> };
  shouldFire(payload: WebhookPayload): boolean; // severity filtering
}
```

The skill teaches Claude to:
1. Create a new formatter file in `src/notifications/`
2. Register it in the notification dispatcher
3. Add env vars for the platform-specific config
4. Add tests

### Auth Adapters

Core ships with session-ID-based auth (what exists today — plugin sends `session_id`, backend trusts it). OAuth skills add real authentication:

```typescript
// Extension point: skills/add-github-oauth adds this
interface AuthAdapter {
  name: string;
  // OAuth flow
  getAuthUrl(state: string): string;
  exchangeCode(code: string): Promise<AuthToken>;
  // Org discovery
  discoverOrgs(token: AuthToken): Promise<Org[]>;
  discoverRepos(token: AuthToken, org: string): Promise<Repo[]>;
  // Session validation
  validateSession(token: string): Promise<DeveloperIdentity | null>;
}
```

The skill teaches Claude to:
1. Add passport strategy (or raw OAuth flow)
2. Add auth routes (`/auth/github/callback`, etc.)
3. Add token storage and refresh
4. Wire session registration to require auth
5. Add org/team management admin routes
6. Add env vars for client ID/secret

### Store Adapters

Core ships with SQLite (via `node:sqlite`). The PostgreSQL skill swaps the storage layer:

```typescript
// Extension point: already partially exists in HiveStore
interface StoreAdapter {
  // Sessions
  createSession(data: CreateSessionData): Promise<Session>;
  getSession(id: string): Promise<Session | null>;
  getActiveSessions(repo?: string): Promise<Session[]>;
  // ... same interface, different implementation
}
```

The skill teaches Claude to:
1. Add `pg` dependency
2. Create a PostgreSQL store implementation
3. Add migration scripts
4. Update `env.ts` to handle `DATABASE_URL` for Postgres
5. Update Docker Compose with a `postgres` service
6. Add connection pooling config

### Collision Tiers

Core ships with L1 (file), L2 (directory), L3a (keyword Jaccard). Skills add higher tiers:

```typescript
// Extension point: skills/add-embedding-l3b adds this
interface SemanticAnalyzer {
  name: string;
  tier: 'l3b' | 'l3c';
  analyze(intentA: string, intentB: string): Promise<{ score: number; details: string }>;
}
```

The skill teaches Claude to:
1. Add embedding provider client (OpenAI, local model, etc.)
2. Implement the analyzer interface
3. Wire it into the collision engine's semantic pipeline
4. Add env vars for provider config
5. Add tests with known-similar and known-different intents

## Skill Anatomy

Every skill follows a standard structure:

```
skills/add-slack/
├── SKILL.md          # The skill itself — Claude reads this
└── tests/            # Optional: test fixtures or expected outputs
    └── slack-formatter.test.ts.template
```

### SKILL.md Structure

```markdown
---
name: add-slack
description: Add Slack webhook notifications for collision alerts
category: notification
requires: [generic-webhooks]  # core feature this depends on
modifies:
  - packages/backend/src/notifications/  # adds slack-formatter.ts
  - packages/backend/src/env.ts          # adds SLACK_WEBHOOK_URL
  - packages/backend/src/server.ts       # registers formatter
  - docker-compose.yaml                  # adds env var
  - .env.example                         # adds env var
tests:
  - packages/backend/src/notifications/slack-formatter.test.ts
---

# Add Slack Notifications to Open Hive

## Prerequisites
- Open Hive backend source cloned locally
- `npm install` completed
- A Slack incoming webhook URL (create at https://api.slack.com/messaging/webhooks)

## What This Skill Does

Adds a Slack notification formatter that converts Open Hive collision
alerts into Slack Block Kit messages. Critical collisions get a red
sidebar, warnings get yellow, info gets blue.

## Implementation Steps

### Step 1: Create the Slack formatter

Create `packages/backend/src/notifications/slack-formatter.ts`:

[detailed code with explanation of each section]

### Step 2: Register the formatter

In `packages/backend/src/server.ts`, import and register:

[specific edit instructions with before/after context]

### Step 3: Add environment configuration

In `packages/backend/src/env.ts`, add to loadConfig():

[specific edit with context]

### Step 4: Update Docker Compose

[specific edit]

### Step 5: Add tests

Create `packages/backend/src/notifications/slack-formatter.test.ts`:

[complete test file]

### Step 6: Verify

Run: `npm run build && npm test`

Expected: all existing tests pass + new Slack formatter tests pass.

## Configuration

After running this skill:

```bash
# Set your Slack webhook URL
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T.../B.../xxx

# Optional: filter by severity (default: all)
SLACK_MIN_SEVERITY=warning  # only warning + critical
```
```

## What the Core Must Ship

For this architecture to work, the core backend needs clean extension points. Here's what must exist before skills can build on top:

### Already Done (current state)
- Collision engine (L1, L2, L3a)
- Session tracking with heartbeat
- Signal recording
- SQLite store
- Error handling + input validation
- 26 unit tests

### Must Add to Core
1. **Generic webhook emitter** — fires standardized `WebhookPayload` to configured URLs on collision detection. Fire-and-forget, 5-second timeout, configurable severity filter. This is the foundation that all notification skills build on.
2. **Notification dispatcher interface** — pluggable formatter registry so skills can register platform-specific formatters without modifying core dispatch logic.
3. **Auth middleware placeholder** — optional `authenticate` middleware on API routes. Default: pass-through (current behavior). Skills swap in real auth.
4. **Store adapter interface** — formalize the current `HiveStore` class into an interface so the PostgreSQL skill can provide an alternate implementation.

### Must NOT Add to Core
- Any specific platform integration (Slack, Teams, Discord)
- Any specific OAuth provider (GitHub, GitLab, Azure)
- PostgreSQL driver or connection code
- Embedding or LLM provider clients
- Web dashboard framework

## Repo Structure (After)

```
open-hive/
├── packages/
│   ├── backend/                    # Core backend (lean)
│   │   ├── src/
│   │   │   ├── db/
│   │   │   │   ├── store.ts        # StoreAdapter interface + SQLite impl
│   │   │   │   └── sqlite.ts
│   │   │   ├── services/
│   │   │   │   ├── collision-engine.ts
│   │   │   │   └── notification-dispatcher.ts  # NEW: generic webhook + formatter registry
│   │   │   ├── middleware/
│   │   │   │   └── auth.ts         # NEW: pass-through placeholder, skills replace
│   │   │   ├── routes/
│   │   │   ├── env.ts
│   │   │   └── server.ts
│   │   └── Dockerfile
│   ├── plugin/                     # User plugin (marketplace)
│   │   ├── .claude-plugin/
│   │   ├── hooks/
│   │   ├── commands/
│   │   ├── skills/collision-awareness/
│   │   └── src/
│   └── shared/                     # TypeScript types
│       └── src/
├── skills/                         # Admin skills library (NEW)
│   ├── add-slack/SKILL.md
│   ├── add-teams/SKILL.md
│   ├── add-discord/SKILL.md
│   ├── add-github-oauth/SKILL.md
│   ├── add-gitlab-oauth/SKILL.md
│   ├── add-azure-devops-oauth/SKILL.md
│   ├── add-postgres/SKILL.md
│   ├── add-dashboard/SKILL.md
│   ├── add-embedding-l3b/SKILL.md
│   ├── add-llm-l3c/SKILL.md
│   ├── add-mcp-server/SKILL.md
│   └── build-skill/SKILL.md        # Meta-skill
├── admin-plugin/                   # Admin plugin package (NEW)
│   ├── .claude-plugin/plugin.json
│   ├── commands/
│   │   └── admin.md                # /hive admin — management commands
│   └── skills/ → ../skills/        # Symlink or copy of skills/
├── docker-compose.yaml
├── marketplace.json                # Points to packages/plugin
├── package.json
└── turbo.json
```

## Distribution

### User Plugin (Marketplace)
```
claude plugin install open-hive
```
Installs `packages/plugin/` — hooks, commands, collision-awareness skill. Zero backend knowledge.

### Admin Plugin
Two options (decided during implementation):

**Option A: Same repo, separate marketplace entry**
```
claude plugin install open-hive-admin
```
`marketplace.json` points to `admin-plugin/`. Admin must also have the repo cloned for skills to modify.

**Option B: Skills live in repo, no separate plugin**
Admin clones the repo, reads `skills/README.md`, and runs skills directly by pointing Claude at the SKILL.md files. No plugin install needed — the skills are just markdown files.

**Recommendation: Option B.** The admin already has the repo cloned (they're deploying the backend). A separate plugin adds ceremony without value. The skills work as standalone markdown that Claude reads and follows.

## Marketplace Strategy

### Phase 1: Ship User Plugin
- Publish `open-hive` to Claude Code marketplace
- README focuses on: install → setup → collision detection works automatically
- Backend deployment is a prerequisite (Docker one-liner)

### Phase 2: Skills Library
- Ship initial skill set (Slack, GitHub OAuth, PostgreSQL — the most-requested)
- `skills/README.md` explains the pattern
- Each skill is self-contained and tested

### Phase 3: Community
- `/hive build-skill` meta-skill enables anyone to create new integrations
- PRs to `skills/` directory have a low review bar (it's a markdown file, not core code)
- Community builds integrations for platforms we never anticipated

## Reddit Narrative

The story for Reddit:

> **I built collision detection for Claude Code Agent Teams**
>
> When multiple Claude Code sessions work on the same codebase, they step on each other's toes. Open Hive passively detects overlapping work before it becomes a merge conflict.
>
> Three levels of detection:
> - L1: Same file (critical)
> - L2: Same directory (warning)
> - L3: Semantic overlap via keyword analysis (info)
>
> But here's the interesting part: instead of building a monolith with every possible integration, we made the extensions Claude Code skills. Want Slack notifications? Run `/hive add-slack` and Claude adds it to your instance. Want GitHub OAuth? `/hive add-github-oauth`. Want PagerDuty? Run `/hive build-skill` and Claude creates the skill for you.
>
> Skills are the documentation, the implementation guide, and the installer — all in one file.
>
> Self-hosted, open source, zero-config for developers.
>
> [GitHub] [Marketplace] [Demo]

## Implementation Sequence

1. **Core extension points** — notification dispatcher, auth middleware, store interface
2. **Generic webhook emitter** — core ships with fire-and-forget POST
3. **First three skills** — Slack, GitHub OAuth, PostgreSQL (proves the pattern)
4. **Build-skill meta-skill** — enables community contributions
5. **Marketplace publication** — user plugin goes live
6. **Reddit post** — with working demo, skills library, and marketplace listing

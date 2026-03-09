# Open Hive Admin Plugin — Design

**Date:** 2026-03-09
**Author:** Chase Skibeness
**Status:** Approved
**Hotfix:** v1.3.2

---

## Problem

Open Hive has two intended audiences:
1. **Developers** — install the `open-hive` plugin, run `/hive setup`, get collision detection
2. **Admins** — deploy the backend, configure integrations (Slack, OAuth, Postgres, etc.)

The developer plugin exists (`packages/plugin/`). The admin plugin does not. The 12 skill files in `skills/` contain complete installation instructions for every integration, but there's no plugin to expose them as commands. An admin currently has to manually point Claude at a SKILL.md file.

This was always planned as a two-plugin model (see `docs/plans/2026-03-03-skills-architecture-design.md`), but the admin plugin was never built.

## Solution

Build `packages/admin-plugin/` — a Claude Code plugin with 4 commands and 1 skill that wraps the existing skills directory.

## Architecture

```
packages/admin-plugin/
├── .claude-plugin/
│   └── plugin.json
├── commands/
│   ├── setup.md        # /hive-admin setup — deploy + configure backend
│   ├── install.md      # /hive-admin install <skill-name> — apply a skill
│   ├── list.md         # /hive-admin list — show available skills
│   └── status.md       # /hive-admin status — show what's installed + health
└── skills/
    └── admin-awareness/
        └── SKILL.md    # background skill: port architecture + skill application patterns
```

### Commands

#### `/hive-admin setup`

First-run deployment wizard for the backend.

1. Checks prerequisites (Docker, Node.js 22+, npm)
2. Walks admin through `.env` configuration (port, host, webhook URLs)
3. Runs `npm install && npm run build`
4. Starts backend via `docker compose up -d` or direct `node`
5. Verifies health endpoint responds
6. Prints backend URL for developers

#### `/hive-admin install <skill-name>`

Applies a skill to the backend source code.

1. Takes skill name as argument (e.g., `add-slack`, `add-postgres`)
2. Resolves to `skills/<skill-name>/SKILL.md` relative to repo root
3. Reads the SKILL.md and follows its implementation steps
4. Runs `npm run build && npm test` to verify
5. Reminds admin to restart/redeploy

#### `/hive-admin list`

Shows available skills by scanning `skills/` directory.

1. Reads frontmatter from each SKILL.md (name, description, category, port)
2. Presents grouped by category (notification, auth, store, collision-tier)
3. Indicates which are already installed (by checking server.ts imports)

#### `/hive-admin status`

Shows current backend configuration state.

1. Reads `packages/backend/src/server.ts` for non-default port implementations
2. Reads `.env` for configured integrations
3. Calls health endpoint if backend is running
4. Reports: store type, identity provider, registered analyzers, alert sinks, nerve count

### Skills

#### `admin-awareness`

Background skill that auto-triggers when Claude detects admin work on backend code.

- Teaches the 5-port architecture (IHiveStore, IIdentityProvider, ISemanticAnalyzer, IAlertSink, INerveRegistry)
- Teaches PortRegistry wiring in server.ts
- Ensures backward compatibility when applying skills
- Ensures `npm run build && npm test` after every modification

## Design Decisions

1. **No hooks.** Admin plugin is a toolbox, not a background process.
2. **Skills stay at `skills/` (repo root).** Referenced by relative path. No duplication.
3. **`install` command is the bridge.** Turns "read this SKILL.md" into a one-liner.
4. **Namespace separation.** `/hive` = developer. `/hive-admin` = admin. Coexist on same machine.
5. **`setup` is opinionated.** Docker deployment by default, manual mode as fallback.
6. **4 commands, scales to N skills.** Adding a skill to `skills/` makes it available via `/hive-admin install` with zero admin plugin changes.

## Relationship to Developer Plugin

| Aspect | Developer (`open-hive`) | Admin (`open-hive-admin`) |
|--------|------------------------|--------------------------|
| Location | `packages/plugin/` | `packages/admin-plugin/` |
| Audience | Every developer on the team | Whoever deploys/maintains the backend |
| Hooks | 7 (SessionStart → PreCompact) | 0 |
| Commands | 4 (`/hive setup/status/who/history`) | 4 (`/hive-admin setup/install/list/status`) |
| Skills | 1 (collision-awareness) | 1 (admin-awareness) |
| Requires backend | Yes (connects to it) | Yes (modifies its source) |
| Install | `claude plugin install open-hive` | `claude plugin install open-hive-admin` |

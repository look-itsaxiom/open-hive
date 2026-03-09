# Admin Plugin Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build `packages/admin-plugin/` — a Claude Code plugin with 4 commands and 1 skill that lets admins deploy and configure Open Hive backends via `/hive-admin` commands.

**Architecture:** Pure markdown plugin (no TypeScript, no build step). 4 command files tell Claude what to do. 1 skill file teaches Claude the port architecture. The `install` command reads skill files from the existing `skills/` directory at repo root.

**Tech Stack:** Claude Code plugin format (plugin.json + markdown commands + markdown skills). No runtime dependencies.

---

### Task 1: Create plugin manifest

**Files:**
- Create: `packages/admin-plugin/.claude-plugin/plugin.json`

**Step 1: Create the directory and plugin.json**

```json
{
  "name": "open-hive-admin",
  "version": "0.1.0",
  "description": "Admin toolkit for deploying and configuring an Open Hive backend — install integrations, manage ports, monitor health",
  "author": {
    "name": "Chase Skibeness",
    "url": "https://github.com/look-itsaxiom"
  },
  "repository": "https://github.com/look-itsaxiom/open-hive",
  "license": "MIT",
  "keywords": ["coordination", "admin", "deployment", "skills", "integrations"]
}
```

**Step 2: Verify the plugin manifest is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('packages/admin-plugin/.claude-plugin/plugin.json','utf8')); console.log('valid')"`
Expected: `valid`

**Step 3: Commit**

```bash
git add packages/admin-plugin/.claude-plugin/plugin.json
git commit -m "feat(admin-plugin): add plugin manifest"
```

---

### Task 2: Create `/hive-admin setup` command

**Files:**
- Create: `packages/admin-plugin/commands/setup.md`

**Step 1: Write the setup command**

This command walks an admin through first-time backend deployment. It needs broad tool access because it will install deps, configure env, build, and start the server.

```markdown
---
name: setup
description: Deploy and configure an Open Hive backend instance — prerequisites, env config, build, and start
allowed-tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "AskUserQuestion"]
---

Deploy and configure an Open Hive backend for your organization.

## Prerequisites Check

1. Verify you are in the open-hive repo root (look for `packages/backend/` and `turbo.json`)
2. Check Node.js version: `node --version` (must be 22+)
3. Check npm is available: `npm --version`
4. Check Docker is available (optional): `docker --version && docker compose version`

If any required tool is missing, tell the admin what to install and stop.

## Step 1: Install dependencies

Run `npm install` at the repo root. This installs all workspace packages (shared, backend, plugin).

## Step 2: Configure environment

Check if `packages/backend/.env` exists. If not, copy from `.env.example`:

```bash
cp packages/backend/.env.example packages/backend/.env
```

Walk the admin through each configuration section:

1. **Port** — `PORT` (default 3333). Ask if they want a different port.
2. **Alert webhooks** — `ALERT_WEBHOOK_URLS`. Ask if they have a Slack/Teams/Discord webhook URL to add now (can be done later via `/hive-admin install`).
3. **Session timeouts** — `SESSION_IDLE_TIMEOUT_SECONDS` (default 3600). Explain this controls when idle sessions auto-end.
4. **Decay settings** — `DECAY_HALF_LIFE_HOURS` (default 24). Explain that signal relevance decays over time.

For any setting the admin wants to leave as default, skip it.

## Step 3: Build

Run:
```bash
npm run build
```

Verify it succeeds with 0 errors.

## Step 4: Run tests

Run:
```bash
npm test
```

Verify all tests pass.

## Step 5: Start the backend

Ask the admin: **"Docker or direct Node?"**

**If Docker:**
```bash
docker compose up -d --build
```

**If direct Node:**
```bash
cd packages/backend && node dist/server.js
```

## Step 6: Verify health

Call the health endpoint:
```bash
curl http://localhost:<PORT>/api/health
```

Expected response: `{"status":"ok","version":"0.3.0","active_nerves":0}`

## Step 7: Next steps

Tell the admin:
- **Backend URL:** `http://localhost:<PORT>` (or their network-accessible URL)
- **Developers connect with:** `claude plugin install open-hive` then `/hive setup`
- **Add integrations with:** `/hive-admin install add-slack`, `/hive-admin install add-github-oauth`, etc.
- **See available integrations:** `/hive-admin list`
```

**Step 2: Commit**

```bash
git add packages/admin-plugin/commands/setup.md
git commit -m "feat(admin-plugin): add /hive-admin setup command"
```

---

### Task 3: Create `/hive-admin install` command

**Files:**
- Create: `packages/admin-plugin/commands/install.md`

**Step 1: Write the install command**

This is the core command — it reads a SKILL.md and executes its steps. It needs broad tool access since skills create files, edit code, and run builds.

```markdown
---
name: install
description: "Install an Open Hive integration skill — e.g., /hive-admin install add-slack"
args: "<skill-name>"
allowed-tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "AskUserQuestion"]
---

Install an Open Hive integration skill by name.

## Arguments

The first argument is the skill name (e.g., `add-slack`, `add-postgres`, `add-github-oauth`).

## Process

1. **Resolve the skill file.** The skill lives at `skills/<skill-name>/SKILL.md` relative to the repo root. Read this file.

2. **If the file doesn't exist**, list available skills by scanning `skills/*/SKILL.md` and show the admin what's available.

3. **Read the SKILL.md frontmatter** to understand what the skill modifies, what it requires, and what tests it adds.

4. **Check prerequisites.** If the skill lists `requires:` packages, check if they're already installed. If not, they'll be installed in the first step.

5. **Execute each implementation step** in the SKILL.md, in order. Follow the instructions exactly — create files, edit existing files, install dependencies, register in PortRegistry.

6. **After all steps are complete**, run the verification:
   ```bash
   npm run build && npm test
   ```

7. **If build or tests fail**, diagnose the issue and fix it. Do not leave the backend in a broken state.

8. **Remind the admin** to restart/redeploy the backend for changes to take effect:
   - Docker: `docker compose up -d --build`
   - Direct: restart the Node process

9. **Show the Configuration section** from the SKILL.md so the admin knows which environment variables to set.
```

**Step 2: Commit**

```bash
git add packages/admin-plugin/commands/install.md
git commit -m "feat(admin-plugin): add /hive-admin install command"
```

---

### Task 4: Create `/hive-admin list` command

**Files:**
- Create: `packages/admin-plugin/commands/list.md`

**Step 1: Write the list command**

```markdown
---
name: list
description: Show all available Open Hive integration skills
allowed-tools: ["Read", "Bash", "Glob"]
---

List all available Open Hive integration skills.

## Process

1. Find the repo root by looking for `turbo.json` or `packages/backend/`.

2. Scan for all skill files: `skills/*/SKILL.md`

3. Read the YAML frontmatter from each SKILL.md to extract:
   - `name` — the skill name
   - `description` — what it does
   - `category` — notification, auth, store, collision-tier, etc.
   - `port` — which port interface it implements

4. Present as a table grouped by category:

   **Notification Skills (IAlertSink)**
   | Skill | Description |
   |-------|-------------|
   | `add-slack` | Add Slack webhook notifications for collision alerts |
   | `add-teams` | ... |
   | `add-discord` | ... |

   **Auth Skills (IIdentityProvider)**
   | ... | ... |

   ...and so on for each category.

5. Show install instructions: `Run /hive-admin install <skill-name> to install any skill.`

6. If `build-skill` is in the list, mention: `Run /hive-admin install build-skill for a guide on creating your own custom skills.`
```

**Step 2: Commit**

```bash
git add packages/admin-plugin/commands/list.md
git commit -m "feat(admin-plugin): add /hive-admin list command"
```

---

### Task 5: Create `/hive-admin status` command

**Files:**
- Create: `packages/admin-plugin/commands/status.md`

**Step 1: Write the status command**

```markdown
---
name: status
description: Show Open Hive backend configuration — installed skills, port implementations, and health
allowed-tools: ["Read", "Bash", "Glob", "Grep"]
---

Show the current configuration state of the Open Hive backend.

## Process

### 1. Detect installed integrations

Read `packages/backend/src/server.ts` and check which non-default implementations are wired:

- **Store:** Look for imports other than `HiveStore` / `createSQLiteDB`. If `PostgresStore` is imported, report "PostgreSQL". Otherwise "SQLite (default)".
- **Identity:** Look for imports other than `PassthroughIdentityProvider`. If an OAuth provider is imported, report its name. Otherwise "Passthrough (no auth)".
- **Analyzers:** Look for imports other than `KeywordAnalyzer`. Report each registered analyzer (e.g., "KeywordAnalyzer (L3a)", "EmbeddingAnalyzer (L3b)", "LLMAnalyzer (L3c)").
- **Alert sinks:** Look for imports other than `GenericWebhookSink`. Report each registered sink (e.g., "SlackAlertSink", "TeamsAlertSink").
- **Decay:** Always present (core service). Report half-life from env config.

### 2. Check environment

Read `packages/backend/.env` (if it exists) and report configured values:
- PORT
- DB_TYPE / DATABASE_URL
- ALERT_WEBHOOK_URLS (how many configured)
- AUTH_ENABLED
- SEMANTIC_EMBEDDINGS / SEMANTIC_LLM
- DECAY_HALF_LIFE_HOURS

### 3. Check backend health (if running)

Try to call the health endpoint:
```bash
curl -s http://localhost:${PORT:-3333}/api/health
```

If reachable, report:
- Status: running / unreachable
- Version
- Active nerves count

### 4. Present summary

Format as a clean status report:

```
Open Hive Backend Status
========================
Health:     running (v0.3.0) | 3 active nerves
Store:      SQLite (default)
Identity:   Passthrough (no auth)
Analyzers:  KeywordAnalyzer (L3a)
Alerts:     GenericWebhookSink (1 URL configured)
Decay:      24h half-life

Installed Skills: none
Available Skills: 12 (run /hive-admin list to see them)
```
```

**Step 2: Commit**

```bash
git add packages/admin-plugin/commands/status.md
git commit -m "feat(admin-plugin): add /hive-admin status command"
```

---

### Task 6: Create `admin-awareness` skill

**Files:**
- Create: `packages/admin-plugin/skills/admin-awareness/SKILL.md`

**Step 1: Write the admin-awareness skill**

This is a background skill — it auto-triggers when Claude detects the admin is working on backend configuration. It teaches Claude the architecture so it can intelligently apply skills.

```markdown
---
name: admin-awareness
description: >
  Use when the admin is modifying Open Hive backend code, applying integration skills,
  or asking about the backend architecture, port system, or available integrations.
---

# Open Hive Admin Awareness

You are helping an admin configure an Open Hive backend. Here's what you need to know:

## Architecture: Five Ports

Open Hive uses hexagonal architecture. All extension points are TypeScript interfaces in `packages/shared/src/ports.ts`. The backend creates a `PortRegistry` at startup that wires everything together.

```typescript
interface PortRegistry {
  store: IHiveStore;            // where data lives (sessions, signals, collisions, mail, nerves)
  identity: IIdentityProvider;  // who is making requests
  analyzers: ISemanticAnalyzer[]; // how intents are compared (L3a → L3b → L3c)
  alerts: AlertDispatcher;      // where collision alerts go (holds IAlertSink[])
  decay: DecayService;          // signal/mail weight decay over time
  nerves: INerveRegistry;       // connected nerve registration and discovery
}
```

## Defaults (what ships out of the box)

| Port | Default Implementation | What It Does |
|------|----------------------|--------------|
| `IHiveStore` | `HiveStore` (SQLite via `node:sqlite`) | Zero-dep persistence, good for <50 devs |
| `IIdentityProvider` | `PassthroughIdentityProvider` | Trusts self-reported identity, no auth |
| `ISemanticAnalyzer` | `KeywordAnalyzer` (L3a) | Jaccard keyword overlap, free and fast |
| `IAlertSink` | `GenericWebhookSink` | Raw JSON POST to configured URLs |
| `INerveRegistry` | `HiveStore` (same object) | SQLite-backed nerve registration |
| `DecayService` | Core service | Exponential decay with configurable half-life |

## Skills extend ports

Skills in `skills/` are Markdown instruction files. Each skill teaches you (Claude) how to add a new port implementation. The admin runs `/hive-admin install <skill-name>` and you follow the SKILL.md step by step.

## Rules when applying skills

1. **Always import port interfaces from `@open-hive/shared`**, never from backend-internal modules.
2. **Registration goes through `PortRegistry`** in `packages/backend/src/server.ts`.
3. **Backward compatibility is mandatory.** New features are opt-in via env vars. Default code path must remain unchanged.
4. **Run `npm run build && npm test` after every change.** Never leave the backend in a broken state.
5. **TypeScript strict mode.** No `any`, no `@ts-ignore`.
6. **Use `nanoid` for ID generation** (already a project dependency).
7. **Idempotent nerve operations.** `registerNerve()` should upsert (update if agent_id exists).
8. **Mail addressing includes developer_email.** When implementing `createMail()`, always resolve `to_developer_email` from `to_session_id` so mail survives session restarts.

## Key file locations

- **Port interfaces:** `packages/shared/src/ports.ts`
- **Models:** `packages/shared/src/models.ts`
- **PortRegistry:** `packages/backend/src/port-registry.ts`
- **Server wiring:** `packages/backend/src/server.ts`
- **SQLite schema:** `packages/backend/src/db/sqlite.ts`
- **Store implementation:** `packages/backend/src/db/store.ts`
- **Config loading:** `packages/backend/src/env.ts`
- **Skills directory:** `skills/` (repo root)
```

**Step 2: Commit**

```bash
git add packages/admin-plugin/skills/admin-awareness/SKILL.md
git commit -m "feat(admin-plugin): add admin-awareness skill"
```

---

### Task 7: Update skills/README.md for admin plugin

**Files:**
- Modify: `skills/README.md`

**Step 1: Update the "How to use a skill" section**

Replace the manual process with the admin plugin workflow. The current section (lines 72-76) says to manually ask Claude to read the SKILL.md. Update it to reference `/hive-admin install`:

Find:
```markdown
## How to use a skill

1. Open a Claude Code session in the Open Hive repo.
2. Ask Claude to apply a skill: _"Apply the add-slack skill"_ or _"Follow the instructions in skills/add-slack/SKILL.md to add Slack notifications."_
3. Claude reads the SKILL.md and executes each step: creating files, editing existing files, and running the verification command.
4. Set the required environment variables (documented in the skill's Configuration section) and restart the backend.
```

Replace with:
```markdown
## How to use a skill

### With the admin plugin (recommended)

1. Install the admin plugin: `claude plugin install open-hive-admin`
2. List available skills: `/hive-admin list`
3. Install a skill: `/hive-admin install add-slack`
4. Set the required environment variables and restart the backend.

### Without the admin plugin

1. Open a Claude Code session in the Open Hive repo.
2. Ask Claude to apply a skill: _"Apply the add-slack skill"_ or _"Follow the instructions in skills/add-slack/SKILL.md."_
3. Claude reads the SKILL.md and executes each step.
4. Set the required environment variables and restart the backend.
```

**Step 2: Update the PortRegistry section to include Phase 3 ports**

The current README (line 20-25) shows only 4 ports. Update to include decay and nerves:

Find:
```
PortRegistry {
  store:      IHiveStore          — where data lives
  identity:   IIdentityProvider   — who is making requests
  analyzers:  ISemanticAnalyzer[] — how intents are compared
  alerts:     AlertDispatcher     — where alerts go (holds IAlertSink[])
}
```

Replace with:
```
PortRegistry {
  store:      IHiveStore          — where data lives (sessions, signals, collisions, mail)
  identity:   IIdentityProvider   — who is making requests
  analyzers:  ISemanticAnalyzer[] — how intents are compared
  alerts:     AlertDispatcher     — where alerts go (holds IAlertSink[])
  decay:      DecayService        — signal/mail weight decay over time
  nerves:     INerveRegistry      — connected nerve registration and discovery
}
```

**Step 3: Update the extension points table to include INerveRegistry**

Find:
```markdown
| Port | Category | Purpose | Example Skills |
|------|----------|---------|---------------|
| `IAlertSink` | notification | Send collision alerts | Slack, Teams, Discord |
| `IIdentityProvider` | auth | Authenticate developers | GitHub OAuth, GitLab OAuth |
| `ISemanticAnalyzer` | collision-tier | Compare developer intents | Embeddings (L3b), LLM (L3c) |
| `IHiveStore` | store | Persist data | PostgreSQL |
```

Replace with:
```markdown
| Port | Category | Purpose | Example Skills |
|------|----------|---------|---------------|
| `IAlertSink` | notification | Send collision alerts | Slack, Teams, Discord |
| `IIdentityProvider` | auth | Authenticate developers | GitHub OAuth, GitLab OAuth |
| `ISemanticAnalyzer` | collision-tier | Compare developer intents | Embeddings (L3b), LLM (L3c) |
| `IHiveStore` + `INerveRegistry` | store | Persist data + manage nerves | PostgreSQL |
```

**Step 4: Commit**

```bash
git add skills/README.md
git commit -m "docs: update skills README for admin plugin and Phase 3 ports"
```

---

### Task 8: Final verification and squash commit

**Step 1: Verify plugin structure**

```bash
find packages/admin-plugin -type f | sort
```

Expected:
```
packages/admin-plugin/.claude-plugin/plugin.json
packages/admin-plugin/commands/install.md
packages/admin-plugin/commands/list.md
packages/admin-plugin/commands/setup.md
packages/admin-plugin/commands/status.md
packages/admin-plugin/skills/admin-awareness/SKILL.md
```

**Step 2: Verify backend still builds and tests pass**

```bash
npm run build && npm test
```

Expected: 0 errors, 0 warnings, all tests pass (the admin plugin has no TypeScript to build — it's pure markdown).

**Step 3: Tag the hotfix**

This is v1.3.2. After merging to main:
```bash
git tag -a v1.3.2 -m "v1.3.2: admin plugin — /hive-admin setup, install, list, status"
```

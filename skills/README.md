# Open Hive Skills

Skills are self-contained integration guides that teach Claude how to extend an Open Hive installation. Each skill lives in its own directory under `skills/` and contains a `SKILL.md` file with step-by-step instructions.

## What is a skill?

A skill is **not** a plugin or executable code. It is a structured Markdown document that provides Claude with everything needed to add an integration to the Open Hive backend:

- Which files to create and which existing files to modify
- Complete source code for new modules
- Before/after diffs for existing files
- A test suite to verify the integration works
- Configuration reference for the new environment variables

## Architecture: Port-Based Extensions

Open Hive uses a hexagonal (ports & adapters) architecture. All extension points are defined as TypeScript interfaces (ports) in `@open-hive/shared`. At startup, the backend creates a `PortRegistry` that wires all adapters together:

```
PortRegistry {
  store:      IHiveStore          — where data lives
  identity:   IIdentityProvider   — who is making requests
  analyzers:  ISemanticAnalyzer[] — how intents are compared
  alerts:     AlertDispatcher     — where alerts go (holds IAlertSink[])
}
```

Each skill targets one of these four ports. See `skills/build-skill/SKILL.md` for the complete guide on creating new skills.

## Directory structure

```
skills/
  README.md                    # This file
  build-skill/SKILL.md         # Meta-guide: how to create new skills
  add-slack/SKILL.md           # Slack alert sink (IAlertSink)
  add-teams/SKILL.md           # Teams alert sink (IAlertSink)
  add-discord/SKILL.md         # Discord alert sink (IAlertSink)
  add-github-oauth/SKILL.md    # GitHub OAuth (IIdentityProvider)
  add-gitlab-oauth/SKILL.md    # GitLab OAuth (IIdentityProvider)
  add-azure-devops-oauth/SKILL.md  # Azure DevOps OAuth (IIdentityProvider)
  add-embedding-l3b/SKILL.md   # Embedding analyzer (ISemanticAnalyzer)
  add-llm-l3c/SKILL.md         # LLM analyzer (ISemanticAnalyzer)
  add-postgres/SKILL.md         # PostgreSQL store (IHiveStore)
  add-dashboard/SKILL.md        # Web dashboard (consumes PortRegistry)
  add-mcp-server/SKILL.md       # MCP server (consumes backend API)
```

## SKILL.md format

Every `SKILL.md` starts with YAML frontmatter:

```yaml
---
name: add-slack
description: Add Slack webhook notifications for collision alerts
category: notification
port: IAlertSink
requires: []
modifies:
  - packages/backend/src/services/slack-alert-sink.ts
  - packages/backend/src/server.ts
tests:
  - packages/backend/src/services/slack-alert-sink.test.ts
---
```

The body contains numbered steps with complete code blocks, exact file paths, and before/after context for edits.

## How to use a skill

1. Open a Claude Code session in the Open Hive repo.
2. Ask Claude to apply a skill: _"Apply the add-slack skill"_ or _"Follow the instructions in skills/add-slack/SKILL.md to add Slack notifications."_
3. Claude reads the SKILL.md and executes each step: creating files, editing existing files, and running the verification command.
4. Set the required environment variables (documented in the skill's Configuration section) and restart the backend.

## Writing a new skill

When creating a new integration skill:

1. Create a directory: `skills/add-<name>/`
2. Write `SKILL.md` with the frontmatter schema shown above.
3. Include **complete** code blocks -- do not use placeholders or `// TODO` comments.
4. Show before/after context for every file edit.
5. Always include a test file that covers the core functionality.
6. End with a Configuration section documenting every new environment variable.
7. All port interfaces must be imported from `@open-hive/shared`.
8. Registration must go through the `PortRegistry` in `server.ts`.

See `skills/build-skill/SKILL.md` for the complete guide with templates for each port type.

## Extension points

Skills implement one of four port interfaces from `@open-hive/shared`:

| Port | Category | Purpose | Example Skills |
|------|----------|---------|---------------|
| `IAlertSink` | notification | Send collision alerts | Slack, Teams, Discord |
| `IIdentityProvider` | auth | Authenticate developers | GitHub OAuth, GitLab OAuth |
| `ISemanticAnalyzer` | collision-tier | Compare developer intents | Embeddings (L3b), LLM (L3c) |
| `IHiveStore` | store | Persist data | PostgreSQL |

Each adapter is registered via the `PortRegistry` at startup. See the `build-skill` meta-guide for implementation templates and registration patterns.

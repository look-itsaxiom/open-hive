# Open Hive Skills

Skills are self-contained integration guides that teach Claude how to extend an Open Hive installation. Each skill lives in its own directory under `skills/` and contains a `SKILL.md` file with step-by-step instructions.

## What is a skill?

A skill is **not** a plugin or executable code. It is a structured Markdown document that provides Claude with everything needed to add an integration to the Open Hive backend:

- Which files to create and which existing files to modify
- Complete source code for new modules
- Before/after diffs for existing files
- A test suite to verify the integration works
- Configuration reference for the new environment variables

## Directory structure

```
skills/
  README.md              # This file
  add-slack/
    SKILL.md             # Slack webhook integration guide
  add-discord/
    SKILL.md             # (future) Discord integration guide
  add-pagerduty/
    SKILL.md             # (future) PagerDuty integration guide
```

Each skill directory contains exactly one `SKILL.md`. Supporting files (example configs, screenshots) may be added alongside it if needed.

## SKILL.md format

Every `SKILL.md` starts with YAML frontmatter:

```yaml
---
name: add-slack                        # Unique skill identifier
description: Add Slack webhook notifications for collision alerts
category: notification                 # Category for discovery
requires: []                           # Other skills that must be applied first
modifies:                              # Files this skill creates or edits
  - packages/backend/src/notifications/slack-formatter.ts
  - packages/backend/src/env.ts
  - packages/backend/src/server.ts
  - .env.example
tests:                                 # Test files this skill creates
  - packages/backend/src/notifications/slack-formatter.test.ts
---
```

The body contains numbered steps with complete code blocks, exact file paths, and before/after context for edits. The goal is that Claude can follow each step mechanically without needing to search the codebase for context.

## How to use a skill

1. Open a Claude Code session in the Open Hive repo.
2. Ask Claude to apply a skill: _"Apply the add-slack skill"_ or _"Follow the instructions in skills/add-slack/SKILL.md to add Slack notifications."_
3. Claude reads the SKILL.md and executes each step: creating files, editing existing files, and running the verification command.
4. Set the required environment variables (documented in the skill's Configuration section) and restart the backend.

## Writing a new skill

When creating a new integration skill:

1. Create a directory: `skills/add-<name>/`
2. Write `SKILL.md` with the frontmatter schema shown above.
3. Include **complete** code blocks -- do not use placeholders or `// TODO` comments. The code in the skill should compile and pass tests as written.
4. Show before/after context for every file edit so Claude can locate the exact insertion point.
5. Always include a test file that covers the core functionality.
6. End with a Configuration section documenting every new environment variable.
7. Use the existing `NotificationFormatter` interface for notification integrations -- it provides the `format()` / `shouldFire()` / `name` contract that the `NotificationDispatcher` expects.

## Extension points

Skills for notification integrations should implement the `NotificationFormatter` interface exported from `packages/backend/src/services/notification-dispatcher.ts`:

```typescript
interface NotificationFormatter {
  name: string;
  format(payload: WebhookPayload): { url: string; body: unknown; headers?: Record<string, string> };
  shouldFire(payload: WebhookPayload): boolean;
}
```

The formatter is registered with `dispatcher.registerFormatter()` in `server.ts`, conditionally gated on the presence of the integration's webhook URL environment variable.

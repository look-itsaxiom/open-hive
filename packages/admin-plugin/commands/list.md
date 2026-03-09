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

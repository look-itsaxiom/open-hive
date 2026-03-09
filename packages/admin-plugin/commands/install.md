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

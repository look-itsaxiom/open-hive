---
name: admin-setup
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

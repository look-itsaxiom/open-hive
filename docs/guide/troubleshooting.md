# Troubleshooting

Common issues and solutions for Open Hive.

## Backend Issues

### Backend won't start

**Symptom:** `docker compose up` fails or the container exits immediately.

**Check:**
- Ensure Docker is running: `docker info`
- Check container logs: `docker compose logs open-hive`
- Verify port 3000 is not already in use: `lsof -i :3000` (macOS/Linux) or `netstat -ano | findstr :3000` (Windows)
- If port 3000 is taken, change `PORT` in your `docker-compose.yaml`

### Health check fails

**Symptom:** `curl http://localhost:3000/api/health` returns connection refused.

**Check:**
- Container is running: `docker compose ps`
- Port mapping is correct in `docker-compose.yaml`
- If running without Docker, ensure `node dist/server.js` is running in `packages/backend`

### Database errors

**Symptom:** 500 errors from the API, SQLite-related messages in logs.

**Check:**
- Ensure the data directory is writable
- The Docker volume `hive-data` should persist data across restarts
- If running locally, ensure `./data/` directory exists relative to the backend

## Plugin Issues

### Plugin not firing hooks

**Symptom:** No collision alerts, `/hive status` shows no session.

**Check:**
- Plugin is installed: `claude plugin list`
- Config exists at `~/.open-hive.yaml` with correct `backend_url`
- Backend is reachable from your machine
- Run `/hive setup` to reconfigure

### "Session not found" errors

**Symptom:** API calls return 404 with "Session not found."

**Cause:** Sessions expire after `IDLE_TIMEOUT` seconds (default: 300 = 5 minutes) of inactivity. The plugin sends heartbeats automatically, but if the backend was restarted or the session timed out, a new session is created on the next `SessionStart` hook.

### Collision alerts not appearing

**Symptom:** Two developers are editing the same files but no alerts show up.

**Check:**
- Both developers have the plugin installed and configured
- Both are pointing to the same backend URL
- Both are using the same repo name (derived from the working directory basename)
- `COLLISION_SCOPE` is set appropriately (`repo` for same-repo only, `org` for cross-repo)

## Semantic Detection Issues

### L3a (keyword) not detecting overlaps

**Symptom:** Developers with similar prompts don't get semantic collision alerts.

**Check:**
- `SEMANTIC_KEYWORDS` is set to `true` (default)
- The Jaccard similarity threshold is 0.3 -- prompts need meaningful keyword overlap
- Common programming verbs (fix, add, update, refactor, etc.) are filtered as stop words
- Keywords must be longer than 2 characters

### L3b/L3c not working

**Symptom:** Embedding or LLM-based detection is not triggering.

**Check:**
- The corresponding skill has been installed
- `SEMANTIC_EMBEDDINGS=true` (for L3b) or `SEMANTIC_LLM=true` (for L3c)
- Required API keys are set (`EMBEDDINGS_API_KEY`, `LLM_API_KEY`)
- Provider is configured (`EMBEDDINGS_PROVIDER`, `LLM_PROVIDER`)

## Webhook/Notification Issues

### Webhooks not firing

**Symptom:** No notifications arriving at configured webhook URLs.

**Check:**
- `WEBHOOK_URLS` environment variable contains your URL(s), comma-separated
- `WEBHOOK_MIN_SEVERITY` is set to the appropriate level (default: `info`)
- The webhook URL is reachable from the backend container
- Webhooks are fire-and-forget with a 5-second timeout -- check if the receiving service is slow

### Formatted notifications (Slack/Teams/Discord) not working

**Symptom:** Generic webhooks work but skill-specific formatting doesn't.

**Check:**
- The notification skill was installed correctly
- The formatter is registered in `server.ts`
- Skill-specific environment variables are set (e.g., `SLACK_WEBHOOK_URL`)

## Build Issues

### TypeScript build fails

```bash
npm run build
```

**Check:**
- Node.js 22+ is installed (required for built-in `node:sqlite`)
- All dependencies are installed: `npm install`
- Clear build cache: `npx turbo clean && npm run build`

### Tests failing

```bash
npm run test
```

**Check:**
- Build first: `npm run build`
- Run backend tests directly for detailed output:
  ```bash
  cd packages/backend
  node --import tsx --test src/**/*.test.ts
  ```

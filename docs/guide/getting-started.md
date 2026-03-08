# Getting Started

Get Open Hive running in under five minutes.

## Prerequisites

- Docker (for the backend)
- Claude Code (for the plugin)
- Node.js 22+ (if running without Docker)

## 1. Start the Backend

```bash
git clone https://github.com/look-itsaxiom/open-hive.git
cd open-hive
docker compose up -d
```

The backend starts on `http://localhost:3000` with a SQLite database persisted to a Docker volume.

Verify it's running:

```bash
curl http://localhost:3000/api/health
# {"status":"ok","version":"0.3.0","active_nerves":0}
```

## 2. Install the Plugin

```bash
claude plugin install open-hive
```

## 3. Run Setup

In any Claude Code session:

```
/hive setup
```

This prompts for your backend URL and identity, then saves config to `~/.open-hive.yaml`:

```yaml
backend_url: http://localhost:3000
identity:
  email: you@company.com
  display_name: Your Name
team: engineering
```

That's it. The plugin hooks fire passively — no commands to remember, no workflow changes. When a teammate is working on the same files or has overlapping intent, you'll see an inline alert.

## Try It Out

With the backend running, walk through a collision scenario:

```bash
# Register two developers
curl -X POST http://localhost:3000/api/sessions/register \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"dev-a","developer_email":"alice@team.com","developer_name":"Alice","repo":"my-app","project_path":"/code/my-app"}'

curl -X POST http://localhost:3000/api/sessions/register \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"dev-b","developer_email":"bob@team.com","developer_name":"Bob","repo":"my-app","project_path":"/code/my-app"}'

# Alice modifies a file
curl -X POST http://localhost:3000/api/signals/activity \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"dev-a","file_path":"src/auth/login.ts","type":"file_modify"}'

# Bob modifies the same file — collision detected!
curl -X POST http://localhost:3000/api/signals/activity \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"dev-b","file_path":"src/auth/login.ts","type":"file_modify"}'
# Response includes: "severity": "critical"

# Check who's working on what
curl http://localhost:3000/api/sessions/active?repo=my-app

# Check for agent mail (auto-generated collision alerts)
curl http://localhost:3000/api/mail/check?session_id=dev-b
```

## Useful Commands

Once the plugin is installed, these commands are available in Claude Code:

| Command | Description |
|---------|-------------|
| `/hive setup` | Configure backend URL and identity |
| `/hive status` | Show your active session and any collisions |
| `/hive who` | List all active developers in the current repo |
| `/hive history` | View recent activity signals |

## Development Setup (without Docker)

```bash
npm install
npm run build
cd packages/backend
node dist/server.js
# Backend starts on http://localhost:3000
```

### Dev Commands

```bash
npm install           # Install dependencies
npm run build         # Build all packages
npm run dev           # Development mode (watch)
npm run test          # Run full test suite (182 tests)
```

## Next Steps

- [Plugin usage and commands](./plugin-usage.md)
- [Admin setup and deployment](./admin-setup.md)
- [Full API reference](../reference/api.md)

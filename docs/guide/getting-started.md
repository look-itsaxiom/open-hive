# Getting Started

Get Open Hive running in under five minutes.

## Prerequisites

- Docker (for the backend)
- Claude Code (for the plugin)

## 1. Start the Backend

```bash
git clone https://github.com/look-itsaxiom/open-hive.git
cd open-hive
docker compose up -d
```

The backend starts on `http://localhost:3000` with a SQLite database persisted to a Docker volume.

## 2. Install the Plugin

```bash
# From your project directory
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

That's it. The plugin hooks fire passively -- no commands to remember, no workflow changes.

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

# Bob modifies the same file -- collision detected!
curl -X POST http://localhost:3000/api/signals/activity \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"dev-b","file_path":"src/auth/login.ts","type":"file_modify"}'
# Response includes: "severity": "critical"

# Check who's working on what
curl http://localhost:3000/api/sessions/active?repo=my-app

# Clean up
curl -X POST http://localhost:3000/api/sessions/end \
  -H 'Content-Type: application/json' -d '{"session_id":"dev-a"}'
curl -X POST http://localhost:3000/api/sessions/end \
  -H 'Content-Type: application/json' -d '{"session_id":"dev-b"}'
```

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
# Install dependencies
npm install

# Build all packages
npm run build

# Development mode (watch)
npm run dev

# Run tests
npm run test

# Run backend unit tests directly
cd packages/backend
node --import tsx --test src/**/*.test.ts
```

## Next Steps

- [Plugin usage and commands](./plugin-usage.md)
- [Admin setup and deployment](./admin-setup.md)
- [Full API reference](../reference/api.md)

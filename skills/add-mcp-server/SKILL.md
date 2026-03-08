---
name: add-mcp-server
description: Add an MCP stdio server to the Open Hive plugin, exposing hive_* tools directly to Claude
category: plugin
requires:
  - "@modelcontextprotocol/sdk"
modifies:
  - packages/plugin/src/client/hive-client.ts (add getHistory, resolveCollision, checkMail, sendMail, listNerves methods)
  - packages/plugin/src/mcp/server.ts (new -- MCP server with 9 tools)
  - packages/plugin/src/mcp/index.ts (new -- entry point)
  - packages/plugin/.claude-plugin/plugin.json (add mcpServers)
tests:
  - packages/plugin/src/mcp/server.test.ts
---

# add-mcp-server

Adds an MCP (Model Context Protocol) stdio server to the Open Hive plugin, exposing `hive_*` tools that Claude can call directly. The existing hooks provide passive collision detection (injecting system messages when collisions are detected), but the MCP server gives Claude active query capabilities -- it can proactively check for conflicts, list who is working on what, broadcast intent, review activity history, manage agent mail, and query the nerve registry without waiting for a hook to fire.

## Prerequisites

- Open Hive plugin installed and configured (`~/.open-hive.yaml` with `backend_url` set)
- Open Hive backend running (the MCP tools call the backend API via `HiveClient`)
- Node.js and npm

## What This Skill Does

- **Extends `HiveClient`** with methods for history, collisions, agent mail, and nerve registry
- **Creates `packages/plugin/src/mcp/server.ts`** -- an MCP stdio server that registers 9 tools, each delegating to `HiveClient`
- **Creates `packages/plugin/src/mcp/index.ts`** -- the entry point that loads config and starts the server
- **Updates `packages/plugin/.claude-plugin/plugin.json`** -- registers the MCP server so Claude Code discovers it automatically
- **Creates `packages/plugin/src/mcp/server.test.ts`** -- 15 tests covering all tool handlers, error handling, and edge cases

The MCP server accesses the backend through `HiveClient`, which calls the backend's REST API. The backend routes use `PortRegistry` to access `registry.store`, `registry.nerves`, and other services. The MCP server does not directly interact with ports -- it is a consumer of the backend API.

## Implementation Steps

### Step 1: Install the MCP SDK

```bash
cd packages/plugin && npm install @modelcontextprotocol/sdk
```

### Step 2: Extend HiveClient with missing methods

Add the following methods to `packages/plugin/src/client/hive-client.ts`. The backend types used by these methods are imported from `@open-hive/shared`:

```typescript
import type {
  HistoryRequest, HistoryResponse,
  ResolveCollisionRequest,
  SendMailRequest, SendMailResponse,
  CheckMailResponse,
} from '@open-hive/shared';
```

New methods:

```typescript
// History
async getHistory(repo: string, limit?: number): Promise<HistoryResponse | null> { ... }

// Collision resolution
async resolveCollision(collision_id: string, resolved_by: string): Promise<boolean> { ... }

// Agent Mail
async checkMail(session_id: string): Promise<CheckMailResponse | null> { ... }
async sendMail(mail: SendMailRequest): Promise<SendMailResponse | null> { ... }

// Nerve Registry
async listNerves(nerve_type?: string): Promise<{ nerves: Nerve[] } | null> { ... }
```

### Step 3: Create the MCP server

Create `packages/plugin/src/mcp/server.ts` with 9 tools:

| Tool | Purpose | Backend API |
|------|---------|-------------|
| `hive_check_conflicts` | Check if a file has active conflicts | `GET /api/conflicts/check` |
| `hive_list_active` | List all active developer sessions | `GET /api/sessions/active` |
| `hive_broadcast_intent` | Declare what you plan to work on | `POST /api/signals/rich` |
| `hive_get_history` | Get recent activity signals | `GET /api/history` |
| `hive_resolve_collision` | Mark a collision as resolved | `POST /api/collisions/resolve` |
| `hive_who` | Human-readable summary of active work | `GET /api/sessions/active` |
| `hive_check_mail` | Check for unread agent mail | `GET /api/mail/check` |
| `hive_send_mail` | Send mail to another developer/context | `POST /api/mail/send` |
| `hive_list_nerves` | List connected nerves | `GET /api/nerves/active` |

### Step 4: Create the entry point

Create `packages/plugin/src/mcp/index.ts` that loads config from `~/.open-hive.yaml` and starts the MCP stdio server.

### Step 5: Register the MCP server in plugin.json

```json
{
  "mcpServers": {
    "open-hive": {
      "command": "npx",
      "args": ["tsx", "src/mcp/index.ts"],
      "cwd": "packages/plugin"
    }
  }
}
```

### Step 6: Add tests

Create `packages/plugin/src/mcp/server.test.ts` with 15 tests covering all 9 tool handlers, including backend-unreachable error cases and mail/nerve-specific scenarios.

Test groups:
1. **Core tools (6 tests):** check_conflicts, list_active, broadcast_intent, get_history, resolve_collision, who
2. **Mail tools (4 tests):** check_mail returns unread, check_mail empty, send_mail success, send_mail validation
3. **Nerve tools (2 tests):** list_nerves all, list_nerves filtered by type
4. **Error handling (3 tests):** backend unreachable, invalid tool params, missing config

## Verify

```bash
cd packages/plugin && npm run build && npm test
```

Confirm:
- [ ] Build succeeds with no type errors
- [ ] All existing tests still pass
- [ ] New MCP server tests pass (15 tests)
- [ ] Manual smoke test: `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | npx tsx src/mcp/index.ts` lists 9 tools
- [ ] `hive_check_mail` returns unread mail for the session
- [ ] `hive_send_mail` delivers mail to another developer
- [ ] `hive_list_nerves` shows connected nerves

## Configuration

The MCP server reads its configuration from `~/.open-hive.yaml`:

```yaml
backend_url: http://localhost:3333

identity:
  email: you@example.com
  display_name: Your Name
```

No additional environment variables are needed. The `backend_url` is required for the MCP server to start.

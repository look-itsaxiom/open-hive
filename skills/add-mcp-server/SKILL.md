---
name: add-mcp-server
description: Add an MCP stdio server to the Open Hive plugin, exposing hive_* tools directly to Claude
category: plugin
requires:
  - "@modelcontextprotocol/sdk"
modifies:
  - packages/plugin/src/client/hive-client.ts (add getHistory, resolveCollision methods)
  - packages/plugin/src/mcp/server.ts (new -- MCP server with 6 tools)
  - packages/plugin/src/mcp/index.ts (new -- entry point)
  - packages/plugin/.claude-plugin/plugin.json (add mcpServers)
tests:
  - packages/plugin/src/mcp/server.test.ts
---

# add-mcp-server

Adds an MCP (Model Context Protocol) stdio server to the Open Hive plugin, exposing `hive_*` tools that Claude can call directly. The existing hooks provide passive collision detection (injecting system messages when collisions are detected), but the MCP server gives Claude active query capabilities -- it can proactively check for conflicts, list who is working on what, broadcast intent, and review activity history without waiting for a hook to fire.

## Prerequisites

- Open Hive plugin installed and configured (`~/.open-hive.yaml` with `backend_url` set)
- Open Hive backend running (the MCP tools call the backend API via `HiveClient`)
- Node.js and npm

## What This Skill Does

- **Extends `HiveClient`** with two missing methods (`getHistory`, `resolveCollision`) needed by the MCP tools
- **Creates `packages/plugin/src/mcp/server.ts`** -- an MCP stdio server that registers 6 tools, each delegating to `HiveClient`
- **Creates `packages/plugin/src/mcp/index.ts`** -- the entry point that loads config and starts the server
- **Updates `packages/plugin/.claude-plugin/plugin.json`** -- registers the MCP server so Claude Code discovers it automatically
- **Creates `packages/plugin/src/mcp/server.test.ts`** -- 11 tests covering tool handlers, error handling, and edge cases

The MCP server accesses the backend through `HiveClient`, which calls the backend's REST API. The backend routes use `PortRegistry` to access `registry.store` and other services. The MCP server does not directly interact with ports -- it is a consumer of the backend API.

## Implementation Steps

### Step 1: Install the MCP SDK

```bash
cd packages/plugin && npm install @modelcontextprotocol/sdk
```

### Step 2: Extend HiveClient with missing methods

Add `getHistory` and `resolveCollision` to `packages/plugin/src/client/hive-client.ts`. The backend types used by these methods are imported from `@open-hive/shared`:

```typescript
import type {
  HistoryRequest, HistoryResponse,
  ResolveCollisionRequest,
} from '@open-hive/shared';
```

### Step 3: Create the MCP server

Create `packages/plugin/src/mcp/server.ts` with 6 tools:

| Tool | Purpose |
|------|---------|
| `hive_check_conflicts` | Check if a file has active conflicts |
| `hive_list_active` | List all active developer sessions |
| `hive_broadcast_intent` | Declare what you plan to work on |
| `hive_get_history` | Get recent activity signals |
| `hive_resolve_collision` | Mark a collision as resolved |
| `hive_who` | Human-readable summary of active work |

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

Create `packages/plugin/src/mcp/server.test.ts` with 11 tests covering all tool handlers, including backend-unreachable error cases.

## Verify

```bash
cd packages/plugin && npm run build && npm test
```

Confirm:
- [ ] Build succeeds with no type errors
- [ ] All existing tests still pass
- [ ] New MCP server tests pass (11 tests)
- [ ] Manual smoke test: `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | npx tsx src/mcp/index.ts` lists 6 tools

## Configuration

The MCP server reads its configuration from `~/.open-hive.yaml`:

```yaml
backend_url: http://localhost:3333

identity:
  email: you@example.com
  display_name: Your Name
```

No additional environment variables are needed. The `backend_url` is required for the MCP server to start.

---
name: add-mcp-server
description: Add an MCP stdio server to the Open Hive plugin, exposing hive_* tools directly to Claude
category: plugin
requires:
  - "@modelcontextprotocol/sdk"
modifies:
  - packages/plugin/src/client/hive-client.ts (add getHistory, resolveCollision methods)
  - packages/plugin/src/mcp/server.ts (new — MCP server with 6 tools)
  - packages/plugin/src/mcp/index.ts (new — entry point)
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

## Implementation Steps

### Step 1: Install the MCP SDK

```bash
cd packages/plugin && npm install @modelcontextprotocol/sdk
```

### Step 2: Extend HiveClient with missing methods

The MCP tools need `getHistory` and `resolveCollision`, which the backend supports but `HiveClient` does not yet expose. Add these methods to `packages/plugin/src/client/hive-client.ts`:

```typescript
import type {
  RegisterSessionRequest, RegisterSessionResponse,
  IntentSignalRequest, IntentSignalResponse,
  ActivitySignalRequest, ActivitySignalResponse,
  CheckConflictsResponse,
  EndSessionRequest,
  HistoryRequest, HistoryResponse,
  ResolveCollisionRequest,
  ListActiveResponse,
} from '@open-hive/shared';

export class HiveClient {
  constructor(private baseUrl: string) {}

  async registerSession(req: RegisterSessionRequest): Promise<RegisterSessionResponse | null> {
    return this.post('/api/sessions/register', req);
  }

  async endSession(req: EndSessionRequest): Promise<void> {
    await this.post('/api/sessions/end', req);
  }

  async sendIntent(req: IntentSignalRequest): Promise<IntentSignalResponse | null> {
    return this.post('/api/signals/intent', req);
  }

  async sendActivity(req: ActivitySignalRequest): Promise<ActivitySignalResponse | null> {
    return this.post('/api/signals/activity', req);
  }

  async checkConflicts(session_id: string, file_path: string, repo?: string): Promise<CheckConflictsResponse | null> {
    const params = new URLSearchParams({ session_id, file_path });
    if (repo) params.set('repo', repo);
    return this.get(`/api/conflicts/check?${params}`);
  }

  async listActive(repo?: string): Promise<ListActiveResponse | null> {
    const params = repo ? `?repo=${encodeURIComponent(repo)}` : '';
    return this.get(`/api/sessions/active${params}`);
  }

  async getHistory(opts: HistoryRequest): Promise<HistoryResponse | null> {
    const params = new URLSearchParams();
    if (opts.file_path) params.set('file_path', opts.file_path);
    if (opts.area) params.set('area', opts.area);
    if (opts.repo) params.set('repo', opts.repo);
    if (opts.since) params.set('since', opts.since);
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return this.get(`/api/history${qs ? `?${qs}` : ''}`);
  }

  async resolveCollision(collision_id: string, resolved_by: string): Promise<{ ok: boolean } | null> {
    return this.post('/api/conflicts/resolve', { collision_id, resolved_by } satisfies ResolveCollisionRequest);
  }

  async heartbeat(session_id: string): Promise<void> {
    await this.post('/api/sessions/heartbeat', { session_id });
  }

  private async post<T>(path: string, body: unknown): Promise<T | null> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return null;
      return res.json() as Promise<T>;
    } catch {
      return null; // Backend unreachable — never block the developer
    }
  }

  private async get<T>(path: string): Promise<T | null> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return null;
      return res.json() as Promise<T>;
    } catch {
      return null;
    }
  }
}
```

### Step 3: Create the MCP server

Create `packages/plugin/src/mcp/server.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { HiveClient } from '../client/hive-client.js';

/**
 * Creates an MCP server instance with all hive_* tools registered.
 * Accepts a HiveClient and an identity (email + display_name) for
 * operations that require developer attribution.
 */
export function createHiveMcpServer(
  client: HiveClient,
  identity: { email: string; display_name: string },
): McpServer {
  const server = new McpServer({
    name: 'open-hive',
    version: '0.1.0',
  });

  // ── hive_check_conflicts ──────────────────────────────────────────
  server.tool(
    'hive_check_conflicts',
    `Check whether a file or directory has active conflicts with other developer sessions.

Use this BEFORE starting work on a file to see if anyone else is modifying it.
Returns collision details and a list of nearby sessions working in the same repo.

Example: hive_check_conflicts({ file_path: "src/auth.ts" })`,
    {
      file_path: z.string().describe('Absolute or repo-relative path to check for conflicts'),
      repo: z.string().optional().describe('Repository name to scope the check (defaults to current repo)'),
    },
    async ({ file_path, repo }) => {
      // session_id is not available in MCP context — use identity email as a stable identifier
      const session_id = `mcp-${identity.email}`;
      const result = await client.checkConflicts(session_id, file_path, repo);

      if (!result) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: 'Backend unreachable. The Open Hive server may be down.' }),
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    },
  );

  // ── hive_list_active ──────────────────────────────────────────────
  server.tool(
    'hive_list_active',
    `List all active developer sessions, optionally filtered by repository.

Use this to understand who is currently working and what they are doing.
Each session includes the developer's name, intent, files touched, and areas of focus.

Example: hive_list_active({ repo: "my-app" })`,
    {
      repo: z.string().optional().describe('Filter sessions to this repository'),
      team: z.string().optional().describe('Filter sessions to this team (not yet implemented in backend)'),
    },
    async ({ repo }) => {
      const result = await client.listActive(repo);

      if (!result) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: 'Backend unreachable. The Open Hive server may be down.' }),
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    },
  );

  // ── hive_broadcast_intent ─────────────────────────────────────────
  server.tool(
    'hive_broadcast_intent',
    `Explicitly declare what you are about to work on so other developers can see it.

Use this at the START of a task to broadcast your intent to the team.
The backend will check for semantic collisions and return any that are detected.
This is different from the passive hook — use this when you want to proactively
announce a specific plan of action.

Example: hive_broadcast_intent({ description: "Refactoring the auth middleware to use JWT" })`,
    {
      description: z.string().describe('A clear description of what you intend to work on'),
    },
    async ({ description }) => {
      const session_id = `mcp-${identity.email}`;
      const result = await client.sendIntent({
        session_id,
        content: description,
        type: 'explicit',
      });

      if (!result) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: 'Backend unreachable. The Open Hive server may be down.' }),
          }],
          isError: true,
        };
      }

      const collisionSummary = result.collisions.length > 0
        ? `Detected ${result.collisions.length} potential collision(s).`
        : 'No collisions detected. You are clear to proceed.';

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            ok: result.ok,
            summary: collisionSummary,
            collisions: result.collisions,
          }, null, 2),
        }],
      };
    },
  );

  // ── hive_get_history ──────────────────────────────────────────────
  server.tool(
    'hive_get_history',
    `Retrieve recent activity signals and session history.

Use this to see what has been happening in a repo, on a specific file, or in a
particular area. Useful for understanding recent changes before starting work.
Returns both the raw signals and the sessions that generated them.

Example: hive_get_history({ file_path: "src/db/store.ts", limit: 10 })`,
    {
      file_path: z.string().optional().describe('Filter history to this file path'),
      area: z.string().optional().describe('Filter history to this area/directory'),
      repo: z.string().optional().describe('Filter history to this repository'),
      since: z.string().optional().describe('ISO 8601 timestamp — only return signals after this time'),
      limit: z.number().int().positive().optional().describe('Maximum number of signals to return (default: 20)'),
    },
    async ({ file_path, area, repo, since, limit }) => {
      const result = await client.getHistory({
        file_path,
        area,
        repo,
        since,
        limit: limit ?? 20,
      });

      if (!result) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: 'Backend unreachable. The Open Hive server may be down.' }),
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    },
  );

  // ── hive_resolve_collision ────────────────────────────────────────
  server.tool(
    'hive_resolve_collision',
    `Mark a collision as resolved. Use this after coordinating with the other developer
or after confirming that the conflict no longer applies (e.g., one developer finished
their work or the files no longer overlap).

You need the collision_id, which you can get from hive_check_conflicts or hive_list_active.

Example: hive_resolve_collision({ collision_id: "col-abc123" })`,
    {
      collision_id: z.string().describe('The ID of the collision to mark as resolved'),
    },
    async ({ collision_id }) => {
      const result = await client.resolveCollision(collision_id, identity.display_name);

      if (!result) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: 'Backend unreachable or collision not found.' }),
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            ok: true,
            message: `Collision ${collision_id} resolved by ${identity.display_name}.`,
          }, null, 2),
        }],
      };
    },
  );

  // ── hive_who ──────────────────────────────────────────────────────
  server.tool(
    'hive_who',
    `Get a human-readable summary of who is working on what right now.

This is a convenience wrapper around hive_list_active that formats the output
as a readable summary instead of raw JSON. Use this when you want a quick
overview of team activity.

Example: hive_who({})`,
    {},
    async () => {
      const result = await client.listActive();

      if (!result) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: 'Backend unreachable. The Open Hive server may be down.' }),
          }],
          isError: true,
        };
      }

      if (result.sessions.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: 'No active sessions. Nobody is currently working.',
          }],
        };
      }

      const lines = result.sessions.map(s => {
        const intent = s.intent ?? 'no intent declared';
        const areas = s.areas.length > 0 ? s.areas.join(', ') : 'no areas yet';
        const files = s.files_touched.length > 0
          ? `${s.files_touched.length} file(s): ${s.files_touched.slice(0, 5).join(', ')}${s.files_touched.length > 5 ? '...' : ''}`
          : 'no files touched yet';
        return `- ${s.developer_name} (${s.repo}): ${intent}\n  Areas: ${areas}\n  Files: ${files}\n  Status: ${s.status}, last active: ${s.last_activity}`;
      });

      return {
        content: [{
          type: 'text' as const,
          text: `Active sessions (${result.sessions.length}):\n\n${lines.join('\n\n')}`,
        }],
      };
    },
  );

  return server;
}
```

### Step 4: Create the entry point

Create `packages/plugin/src/mcp/index.ts`:

```typescript
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadClientConfig } from '../config/config.js';
import { HiveClient } from '../client/hive-client.js';
import { createHiveMcpServer } from './server.js';

async function main() {
  const config = loadClientConfig();

  if (!config || !config.backend_url) {
    process.stderr.write(
      'open-hive MCP: No backend_url configured in ~/.open-hive.yaml. MCP server cannot start.\n',
    );
    process.exit(1);
  }

  const client = new HiveClient(config.backend_url);
  const server = createHiveMcpServer(client, config.identity);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is reserved for MCP JSON-RPC)
  process.stderr.write(
    `open-hive MCP: Server started (backend: ${config.backend_url})\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`open-hive MCP: Fatal error: ${err}\n`);
  process.exit(1);
});
```

### Step 5: Register the MCP server in plugin.json

Update `packages/plugin/.claude-plugin/plugin.json` to include the `mcpServers` field:

```json
{
  "name": "open-hive",
  "version": "0.1.0",
  "description": "Developer collision detection — know what your team is working on before you collide",
  "author": {
    "name": "Chase Skibeness",
    "url": "https://github.com/cskibeness"
  },
  "repository": "https://github.com/cskibeness/open-hive",
  "license": "MIT",
  "keywords": ["coordination", "team", "collision-detection", "awareness"],
  "mcpServers": {
    "open-hive": {
      "command": "npx",
      "args": ["tsx", "src/mcp/index.ts"],
      "cwd": "packages/plugin"
    }
  }
}
```

## Tests

Create `packages/plugin/src/mcp/server.test.ts`:

```typescript
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHiveMcpServer } from './server.js';
import { HiveClient } from '../client/hive-client.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  CheckConflictsResponse,
  ListActiveResponse,
  IntentSignalResponse,
  HistoryResponse,
  Session,
} from '@open-hive/shared';

// ── Test Helpers ────────────────────────────────────────────────────

const TEST_IDENTITY = { email: 'test@example.com', display_name: 'Test Dev' };

/**
 * Fake HiveClient that returns controllable responses.
 * Each method can be overridden per-test via the `overrides` map.
 */
class FakeHiveClient extends HiveClient {
  overrides: Record<string, unknown> = {};

  constructor() {
    super('http://fake:9999');
  }

  override async checkConflicts(): Promise<CheckConflictsResponse | null> {
    if (this.overrides['checkConflicts'] === null) return null;
    return (this.overrides['checkConflicts'] as CheckConflictsResponse) ?? {
      has_conflicts: false,
      collisions: [],
      nearby_sessions: [],
    };
  }

  override async listActive(): Promise<ListActiveResponse | null> {
    if (this.overrides['listActive'] === null) return null;
    return (this.overrides['listActive'] as ListActiveResponse) ?? {
      sessions: [],
    };
  }

  override async sendIntent(): Promise<IntentSignalResponse | null> {
    if (this.overrides['sendIntent'] === null) return null;
    return (this.overrides['sendIntent'] as IntentSignalResponse) ?? {
      ok: true,
      collisions: [],
    };
  }

  override async getHistory(): Promise<HistoryResponse | null> {
    if (this.overrides['getHistory'] === null) return null;
    return (this.overrides['getHistory'] as HistoryResponse) ?? {
      signals: [],
      sessions: [],
    };
  }

  override async resolveCollision(): Promise<{ ok: boolean } | null> {
    if (this.overrides['resolveCollision'] === null) return null;
    return (this.overrides['resolveCollision'] as { ok: boolean }) ?? { ok: true };
  }
}

function makeSession(overrides?: Partial<Session>): Session {
  return {
    session_id: 'sess-1',
    developer_email: 'alice@test.com',
    developer_name: 'Alice',
    repo: 'my-repo',
    project_path: '/home/alice/my-repo',
    started_at: '2026-03-01T10:00:00Z',
    last_activity: '2026-03-01T10:05:00Z',
    status: 'active',
    intent: 'Refactoring auth module',
    files_touched: ['src/auth.ts', 'src/middleware.ts'],
    areas: ['src/'],
    ...overrides,
  };
}

/**
 * Invokes a tool handler on the McpServer.
 *
 * The McpServer stores tool handlers internally. We access them via the
 * private _registeredTools map. This is a test-only pattern — production
 * code always goes through the MCP transport.
 */
async function callTool(
  server: McpServer,
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  // McpServer exposes tool handlers via the callTool method on the internal server
  // We use the public server.tool() registration, so we need to go through the
  // internal handler. Access the underlying Server instance.
  const internalServer = (server as unknown as { _server: {
    callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
  } })._server;

  // If direct _server access doesn't work, fall back to using the tool registry
  if (internalServer?.callTool) {
    return internalServer.callTool({ name: toolName, arguments: args }) as Promise<{
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    }>;
  }

  // Alternative: access the tool map directly from McpServer
  const toolMap = (server as unknown as {
    _registeredTools: Map<string, {
      callback: (args: Record<string, unknown>) => Promise<unknown>;
    }>;
  })._registeredTools;

  const tool = toolMap.get(toolName);
  if (!tool) throw new Error(`Tool not found: ${toolName}`);
  return tool.callback(args) as Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  }>;
}

// ── Tests ───────────────────────────────────────────────────────────

describe('MCP Server — hive_check_conflicts', () => {
  let fakeClient: FakeHiveClient;
  let server: McpServer;

  beforeEach(() => {
    fakeClient = new FakeHiveClient();
    server = createHiveMcpServer(fakeClient, TEST_IDENTITY);
  });

  it('returns no conflicts when none exist', async () => {
    const result = await callTool(server, 'hive_check_conflicts', { file_path: 'src/app.ts' });
    assert.equal(result.isError, undefined);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.has_conflicts, false);
    assert.deepEqual(parsed.collisions, []);
  });

  it('returns error when backend is unreachable', async () => {
    fakeClient.overrides['checkConflicts'] = null;
    const result = await callTool(server, 'hive_check_conflicts', { file_path: 'src/app.ts' });
    assert.equal(result.isError, true);
    const parsed = JSON.parse(result.content[0].text);
    assert.ok(parsed.error.includes('Backend unreachable'));
  });
});

describe('MCP Server — hive_list_active', () => {
  let fakeClient: FakeHiveClient;
  let server: McpServer;

  beforeEach(() => {
    fakeClient = new FakeHiveClient();
    server = createHiveMcpServer(fakeClient, TEST_IDENTITY);
  });

  it('returns empty sessions list when nobody is active', async () => {
    const result = await callTool(server, 'hive_list_active', {});
    assert.equal(result.isError, undefined);
    const parsed = JSON.parse(result.content[0].text);
    assert.deepEqual(parsed.sessions, []);
  });

  it('returns active sessions with details', async () => {
    fakeClient.overrides['listActive'] = {
      sessions: [makeSession()],
    };
    const result = await callTool(server, 'hive_list_active', {});
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.sessions.length, 1);
    assert.equal(parsed.sessions[0].developer_name, 'Alice');
  });
});

describe('MCP Server — hive_broadcast_intent', () => {
  let fakeClient: FakeHiveClient;
  let server: McpServer;

  beforeEach(() => {
    fakeClient = new FakeHiveClient();
    server = createHiveMcpServer(fakeClient, TEST_IDENTITY);
  });

  it('broadcasts intent and returns no collisions', async () => {
    const result = await callTool(server, 'hive_broadcast_intent', {
      description: 'Adding new payment endpoint',
    });
    assert.equal(result.isError, undefined);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.ok, true);
    assert.ok(parsed.summary.includes('No collisions'));
  });

  it('returns collision summary when collisions are detected', async () => {
    fakeClient.overrides['sendIntent'] = {
      ok: true,
      collisions: [{
        collision_id: 'col-1',
        session_ids: ['sess-a', 'sess-b'],
        type: 'semantic',
        severity: 'warning',
        details: 'Both sessions working on payment logic',
        detected_at: '2026-03-01T10:00:00Z',
        resolved: false,
        resolved_by: null,
      }],
    };
    const result = await callTool(server, 'hive_broadcast_intent', {
      description: 'Adding new payment endpoint',
    });
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.collisions.length, 1);
    assert.ok(parsed.summary.includes('1 potential collision'));
  });

  it('returns error when backend is unreachable', async () => {
    fakeClient.overrides['sendIntent'] = null;
    const result = await callTool(server, 'hive_broadcast_intent', {
      description: 'something',
    });
    assert.equal(result.isError, true);
  });
});

describe('MCP Server — hive_get_history', () => {
  let fakeClient: FakeHiveClient;
  let server: McpServer;

  beforeEach(() => {
    fakeClient = new FakeHiveClient();
    server = createHiveMcpServer(fakeClient, TEST_IDENTITY);
  });

  it('returns empty history when no signals exist', async () => {
    const result = await callTool(server, 'hive_get_history', {});
    assert.equal(result.isError, undefined);
    const parsed = JSON.parse(result.content[0].text);
    assert.deepEqual(parsed.signals, []);
    assert.deepEqual(parsed.sessions, []);
  });

  it('returns error when backend is unreachable', async () => {
    fakeClient.overrides['getHistory'] = null;
    const result = await callTool(server, 'hive_get_history', {});
    assert.equal(result.isError, true);
  });
});

describe('MCP Server — hive_resolve_collision', () => {
  let fakeClient: FakeHiveClient;
  let server: McpServer;

  beforeEach(() => {
    fakeClient = new FakeHiveClient();
    server = createHiveMcpServer(fakeClient, TEST_IDENTITY);
  });

  it('resolves a collision and returns success', async () => {
    const result = await callTool(server, 'hive_resolve_collision', {
      collision_id: 'col-abc',
    });
    assert.equal(result.isError, undefined);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.ok, true);
    assert.ok(parsed.message.includes('col-abc'));
    assert.ok(parsed.message.includes('Test Dev'));
  });

  it('returns error when backend is unreachable', async () => {
    fakeClient.overrides['resolveCollision'] = null;
    const result = await callTool(server, 'hive_resolve_collision', {
      collision_id: 'col-abc',
    });
    assert.equal(result.isError, true);
  });
});

describe('MCP Server — hive_who', () => {
  let fakeClient: FakeHiveClient;
  let server: McpServer;

  beforeEach(() => {
    fakeClient = new FakeHiveClient();
    server = createHiveMcpServer(fakeClient, TEST_IDENTITY);
  });

  it('returns readable message when nobody is active', async () => {
    const result = await callTool(server, 'hive_who', {});
    assert.equal(result.isError, undefined);
    assert.ok(result.content[0].text.includes('No active sessions'));
  });

  it('returns formatted summary of active sessions', async () => {
    fakeClient.overrides['listActive'] = {
      sessions: [
        makeSession(),
        makeSession({
          session_id: 'sess-2',
          developer_name: 'Bob',
          developer_email: 'bob@test.com',
          intent: 'Writing tests',
          files_touched: ['test/auth.test.ts'],
          areas: ['test/'],
        }),
      ],
    };
    const result = await callTool(server, 'hive_who', {});
    const text = result.content[0].text;
    assert.ok(text.includes('Active sessions (2)'));
    assert.ok(text.includes('Alice'));
    assert.ok(text.includes('Bob'));
    assert.ok(text.includes('Refactoring auth module'));
    assert.ok(text.includes('Writing tests'));
  });
});
```

## Verify

```bash
cd packages/plugin && npm run build && npm test
```

Confirm:
- [ ] Build succeeds with no type errors
- [ ] All existing tests still pass
- [ ] New MCP server tests pass (11 tests across 6 tool describe blocks)
- [ ] Without `~/.open-hive.yaml`, the MCP server exits with a clear error message (backward compat -- hooks still work independently)
- [ ] Manual smoke test: run `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | npx tsx src/mcp/index.ts` from `packages/plugin/` and confirm 6 tools are listed in the response

## Configuration

The MCP server reads its configuration from `~/.open-hive.yaml`, the same file the hooks already use. No additional environment variables are needed. The minimum required configuration:

```yaml
backend_url: http://localhost:3333

identity:
  email: you@example.com
  display_name: Your Name
```

The `backend_url` is required for the MCP server to start. If the file is missing or `backend_url` is empty, the server exits with an error message to stderr (stdout is reserved for MCP JSON-RPC protocol).

## Tool Reference

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `hive_check_conflicts` | Check if a file/directory has active conflicts | Before starting work on a file |
| `hive_list_active` | List all active developer sessions | To see raw session data for a repo |
| `hive_broadcast_intent` | Declare what you plan to work on | At the start of a task, to proactively announce intent |
| `hive_get_history` | Get recent activity signals | To understand recent changes before starting work |
| `hive_resolve_collision` | Mark a collision as resolved | After coordinating with the other developer |
| `hive_who` | Human-readable summary of active work | Quick overview of team activity |

## Architecture Notes

The MCP server is a **thin adapter layer** between the MCP protocol and the existing `HiveClient`. Each tool handler:

1. Validates input via Zod schemas (handled by the MCP SDK)
2. Calls the appropriate `HiveClient` method
3. Returns the result as JSON text content, or sets `isError: true` if the backend is unreachable

The `HiveClient` already has a 3-second timeout and returns `null` on failure, so the MCP tools never hang even if the backend is down. This matches the existing "never block the developer" design principle from the hooks.

The MCP server does not maintain its own session with the backend. For operations that require a `session_id` (like `checkConflicts` and `sendIntent`), it uses a synthetic ID derived from the developer's email (`mcp-<email>`). This is acceptable because these tools are for active querying, not for session lifecycle management (which the hooks handle).

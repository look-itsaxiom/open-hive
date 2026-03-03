---
name: add-dashboard
description: Embedded web dashboard showing active sessions, collisions, and recent activity via htmx + Handlebars
category: ui
requires:
  - "@fastify/static"
  - "@fastify/view"
  - handlebars
modifies:
  - packages/backend/src/dashboard/routes.ts (new)
  - packages/backend/src/dashboard/views/layout.hbs (new)
  - packages/backend/src/dashboard/views/index.hbs (new)
  - packages/backend/src/dashboard/views/sessions.hbs (new)
  - packages/backend/src/dashboard/views/collisions.hbs (new)
  - packages/backend/src/dashboard/views/partials/session-card.hbs (new)
  - packages/backend/src/dashboard/views/partials/collision-row.hbs (new)
  - packages/backend/src/server.ts (register view engine + dashboard routes)
  - packages/backend/src/dashboard/dashboard.test.ts (new)
tests:
  - packages/backend/src/dashboard/dashboard.test.ts
---

# add-dashboard

Adds an embedded web dashboard to the Open Hive backend for monitoring active developer sessions, collision alerts, and recent activity in real time. Uses htmx for live updates (polling every 5 seconds) and Handlebars for server-rendered HTML -- no SPA framework, no build step, no frontend dependencies beyond a CDN script tag.

## Prerequisites

- Open Hive backend source code (`packages/backend/`)
- npm installed

## What This Skill Does

- Creates `packages/backend/src/dashboard/routes.ts` -- Fastify route handlers for the dashboard pages and JSON API endpoints
- Creates `packages/backend/src/dashboard/views/layout.hbs` -- base HTML layout with htmx CDN link and dark-theme CSS
- Creates `packages/backend/src/dashboard/views/index.hbs` -- main dashboard with session cards, collision alerts, and auto-refresh
- Creates `packages/backend/src/dashboard/views/sessions.hbs` -- detailed active sessions view
- Creates `packages/backend/src/dashboard/views/collisions.hbs` -- collision timeline with severity badges and resolve action
- Creates `packages/backend/src/dashboard/views/partials/session-card.hbs` -- reusable session card partial
- Creates `packages/backend/src/dashboard/views/partials/collision-row.hbs` -- reusable collision row partial
- Creates `packages/backend/src/dashboard/dashboard.test.ts` -- 10 tests for dashboard routes
- Modifies `packages/backend/src/server.ts` -- registers the view engine and dashboard routes (gated by `DASHBOARD_ENABLED` env var)

## Implementation Steps

### Step 1: Install dependencies

```bash
cd packages/backend && npm install @fastify/static @fastify/view handlebars
```

### Step 2: Create the Handlebars partials

Create `packages/backend/src/dashboard/views/partials/session-card.hbs`:

```handlebars
<div class="card session-card">
  <div class="card-header">
    <span class="developer-name">{{developer_name}}</span>
    <span class="badge badge-{{status}}">{{status}}</span>
  </div>
  <div class="card-body">
    <div class="meta-row">
      <span class="label">Repo</span>
      <span class="value">{{repo}}</span>
    </div>
    {{#if intent}}
    <div class="meta-row">
      <span class="label">Intent</span>
      <span class="value intent-text">{{intent}}</span>
    </div>
    {{/if}}
    <div class="meta-row">
      <span class="label">Files</span>
      <span class="value">{{files_touched.length}} touched</span>
    </div>
    <div class="meta-row">
      <span class="label">Active since</span>
      <span class="value">{{started_at}}</span>
    </div>
    <div class="meta-row">
      <span class="label">Last activity</span>
      <span class="value">{{last_activity}}</span>
    </div>
  </div>
</div>
```

Create `packages/backend/src/dashboard/views/partials/collision-row.hbs`:

```handlebars
<tr class="collision-row severity-{{severity}}">
  <td>
    <span class="badge badge-{{severity}}">{{severity}}</span>
  </td>
  <td class="collision-type">{{type}}</td>
  <td class="collision-details">{{details}}</td>
  <td class="collision-developers">{{developers}}</td>
  <td class="collision-time">{{detected_at}}</td>
  <td>
    {{#if resolved}}
      <span class="badge badge-resolved">Resolved</span>
    {{else}}
      <form method="POST" action="/dashboard/api/collisions/resolve"
            hx-post="/dashboard/api/collisions/resolve"
            hx-target="#collisions-table"
            hx-swap="outerHTML">
        <input type="hidden" name="collision_id" value="{{collision_id}}" />
        <button type="submit" class="btn btn-resolve">Resolve</button>
      </form>
    {{/if}}
  </td>
</tr>
```

### Step 3: Create the Handlebars views

Create `packages/backend/src/dashboard/views/layout.hbs`:

```handlebars
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{title}} - Open Hive Dashboard</title>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg-primary: #0d1117;
      --bg-secondary: #161b22;
      --bg-tertiary: #21262d;
      --border: #30363d;
      --text-primary: #e6edf3;
      --text-secondary: #8b949e;
      --text-muted: #6e7681;
      --accent-blue: #58a6ff;
      --accent-green: #3fb950;
      --accent-yellow: #d29922;
      --accent-red: #f85149;
      --accent-purple: #bc8cff;
      --severity-critical: #f85149;
      --severity-warning: #d29922;
      --severity-info: #58a6ff;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.5;
      min-height: 100vh;
    }

    .navbar {
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      padding: 0.75rem 1.5rem;
      display: flex;
      align-items: center;
      gap: 2rem;
    }

    .navbar-brand {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--text-primary);
      text-decoration: none;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .navbar-brand .hive-icon {
      color: var(--accent-yellow);
    }

    .nav-links {
      display: flex;
      gap: 1rem;
      list-style: none;
    }

    .nav-links a {
      color: var(--text-secondary);
      text-decoration: none;
      padding: 0.375rem 0.75rem;
      border-radius: 6px;
      font-size: 0.875rem;
      transition: color 0.15s, background 0.15s;
    }

    .nav-links a:hover,
    .nav-links a.active {
      color: var(--text-primary);
      background: var(--bg-tertiary);
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 1.5rem;
    }

    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 1.5rem;
    }

    .stats-bar {
      display: flex;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }

    .stat-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem 1.25rem;
      flex: 1;
    }

    .stat-card .stat-value {
      font-size: 2rem;
      font-weight: 700;
      line-height: 1.2;
    }

    .stat-card .stat-label {
      font-size: 0.8125rem;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .stat-card.critical .stat-value { color: var(--severity-critical); }
    .stat-card.warning .stat-value { color: var(--severity-warning); }
    .stat-card.active .stat-value { color: var(--accent-green); }

    .section { margin-bottom: 2rem; }

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }

    .section-title {
      font-size: 1.125rem;
      font-weight: 600;
    }

    .card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }

    .session-card {
      margin-bottom: 0.75rem;
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--border);
      background: var(--bg-tertiary);
    }

    .developer-name {
      font-weight: 600;
      font-size: 0.9375rem;
    }

    .card-body {
      padding: 0.75rem 1rem;
    }

    .meta-row {
      display: flex;
      gap: 0.75rem;
      padding: 0.25rem 0;
      font-size: 0.8125rem;
    }

    .meta-row .label {
      color: var(--text-secondary);
      min-width: 90px;
      flex-shrink: 0;
    }

    .meta-row .value {
      color: var(--text-primary);
      word-break: break-word;
    }

    .intent-text {
      color: var(--accent-purple);
      font-style: italic;
    }

    .badge {
      display: inline-block;
      padding: 0.125rem 0.5rem;
      border-radius: 10px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .badge-active { background: rgba(63, 185, 80, 0.15); color: var(--accent-green); }
    .badge-idle { background: rgba(210, 153, 34, 0.15); color: var(--accent-yellow); }
    .badge-ended { background: rgba(139, 148, 158, 0.15); color: var(--text-secondary); }
    .badge-critical { background: rgba(248, 81, 73, 0.15); color: var(--severity-critical); }
    .badge-warning { background: rgba(210, 153, 34, 0.15); color: var(--severity-warning); }
    .badge-info { background: rgba(88, 166, 255, 0.15); color: var(--severity-info); }
    .badge-resolved { background: rgba(63, 185, 80, 0.15); color: var(--accent-green); }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    thead th {
      text-align: left;
      padding: 0.625rem 1rem;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary);
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border);
    }

    tbody td {
      padding: 0.625rem 1rem;
      font-size: 0.8125rem;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }

    tbody tr:last-child td { border-bottom: none; }

    .collision-details { max-width: 350px; word-break: break-word; }

    .severity-critical { border-left: 3px solid var(--severity-critical); }
    .severity-warning { border-left: 3px solid var(--severity-warning); }
    .severity-info { border-left: 3px solid var(--severity-info); }

    .btn {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid var(--border);
      transition: background 0.15s, border-color 0.15s;
    }

    .btn-resolve {
      background: transparent;
      color: var(--accent-green);
      border-color: var(--accent-green);
    }

    .btn-resolve:hover {
      background: rgba(63, 185, 80, 0.15);
    }

    .session-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 0.75rem;
    }

    .empty-state {
      text-align: center;
      padding: 3rem 1rem;
      color: var(--text-muted);
      font-size: 0.875rem;
    }

    .pulse-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent-green);
      margin-right: 0.375rem;
      animation: pulse 2s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .htmx-indicator {
      display: none;
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    .htmx-request .htmx-indicator { display: inline; }
  </style>
</head>
<body>
  <nav class="navbar">
    <a href="/dashboard" class="navbar-brand">
      <span class="hive-icon">&#x2B21;</span> Open Hive
    </a>
    <ul class="nav-links">
      <li><a href="/dashboard" class="{{#if isIndex}}active{{/if}}">Overview</a></li>
      <li><a href="/dashboard/sessions" class="{{#if isSessions}}active{{/if}}">Sessions</a></li>
      <li><a href="/dashboard/collisions" class="{{#if isCollisions}}active{{/if}}">Collisions</a></li>
    </ul>
  </nav>
  <div class="container">
    {{{body}}}
  </div>
</body>
</html>
```

Create `packages/backend/src/dashboard/views/index.hbs`:

```handlebars
<h1><span class="pulse-dot"></span> Dashboard</h1>

<div class="stats-bar"
     hx-get="/dashboard/api/stats"
     hx-trigger="every 5s"
     hx-swap="outerHTML">
  <div class="stat-card active">
    <div class="stat-value">{{sessionCount}}</div>
    <div class="stat-label">Active Sessions</div>
  </div>
  <div class="stat-card critical">
    <div class="stat-value">{{criticalCount}}</div>
    <div class="stat-label">Critical Collisions</div>
  </div>
  <div class="stat-card warning">
    <div class="stat-value">{{warningCount}}</div>
    <div class="stat-label">Warnings</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">{{totalCollisionCount}}</div>
    <div class="stat-label">Total Active Collisions</div>
  </div>
</div>

<div class="section">
  <div class="section-header">
    <span class="section-title">Active Sessions</span>
    <span class="htmx-indicator">Updating...</span>
  </div>
  <div class="session-grid"
       hx-get="/dashboard/api/sessions"
       hx-trigger="every 5s"
       hx-swap="innerHTML">
    {{#if sessions.length}}
      {{#each sessions}}
        {{> session-card this}}
      {{/each}}
    {{else}}
      <div class="empty-state">No active sessions</div>
    {{/if}}
  </div>
</div>

<div class="section">
  <div class="section-header">
    <span class="section-title">Active Collisions</span>
  </div>
  <div class="card">
    <table>
      <thead>
        <tr>
          <th>Severity</th>
          <th>Type</th>
          <th>Details</th>
          <th>Developers</th>
          <th>Detected</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody id="collisions-table"
             hx-get="/dashboard/api/collisions"
             hx-trigger="every 5s"
             hx-swap="innerHTML">
        {{#if collisions.length}}
          {{#each collisions}}
            {{> collision-row this}}
          {{/each}}
        {{else}}
          <tr><td colspan="6" class="empty-state">No active collisions</td></tr>
        {{/if}}
      </tbody>
    </table>
  </div>
</div>
```

Create `packages/backend/src/dashboard/views/sessions.hbs`:

```handlebars
<h1>Active Sessions</h1>

<div class="session-grid"
     hx-get="/dashboard/api/sessions"
     hx-trigger="every 5s"
     hx-swap="innerHTML">
  {{#if sessions.length}}
    {{#each sessions}}
      {{> session-card this}}
    {{/each}}
  {{else}}
    <div class="empty-state">No active sessions</div>
  {{/if}}
</div>
```

Create `packages/backend/src/dashboard/views/collisions.hbs`:

```handlebars
<h1>Collisions</h1>

<div class="card">
  <table>
    <thead>
      <tr>
        <th>Severity</th>
        <th>Type</th>
        <th>Details</th>
        <th>Developers</th>
        <th>Detected</th>
        <th>Action</th>
      </tr>
    </thead>
    <tbody id="collisions-table"
           hx-get="/dashboard/api/collisions"
           hx-trigger="every 5s"
           hx-swap="innerHTML">
      {{#if collisions.length}}
        {{#each collisions}}
          {{> collision-row this}}
        {{/each}}
      {{else}}
        <tr><td colspan="6" class="empty-state">No active collisions</td></tr>
      {{/if}}
    </tbody>
  </table>
</div>
```

### Step 4: Create the dashboard routes

Create `packages/backend/src/dashboard/routes.ts`:

```typescript
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { IHiveStore } from '../db/store.js';
import type { Session, Collision } from '@open-hive/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Resolve a collision's session_ids to developer names via the store. */
async function collisionWithDevelopers(
  collision: Collision,
  store: IHiveStore,
): Promise<Collision & { developers: string }> {
  const sessions = await Promise.all(
    collision.session_ids.map((id) => store.getSession(id)),
  );
  const developers = sessions
    .filter(Boolean)
    .map((s) => (s as Session).developer_name)
    .join(', ');
  return { ...collision, developers };
}

export function dashboardRoutes(app: FastifyInstance, store: IHiveStore): void {
  // --- HTML pages ---

  app.get('/dashboard', async (_req, reply) => {
    const sessions = await store.getActiveSessions();
    const collisions = await store.getActiveCollisions();

    const enrichedCollisions = await Promise.all(
      collisions.map((c) => collisionWithDevelopers(c, store)),
    );

    const criticalCount = collisions.filter(
      (c) => c.severity === 'critical',
    ).length;
    const warningCount = collisions.filter(
      (c) => c.severity === 'warning',
    ).length;

    return reply.viewAsync('index.hbs', {
      title: 'Overview',
      isIndex: true,
      sessions,
      collisions: enrichedCollisions,
      sessionCount: sessions.length,
      criticalCount,
      warningCount,
      totalCollisionCount: collisions.length,
    });
  });

  app.get('/dashboard/sessions', async (_req, reply) => {
    const sessions = await store.getActiveSessions();
    return reply.viewAsync('sessions.hbs', {
      title: 'Sessions',
      isSessions: true,
      sessions,
    });
  });

  app.get('/dashboard/collisions', async (_req, reply) => {
    const collisions = await store.getActiveCollisions();
    const enrichedCollisions = await Promise.all(
      collisions.map((c) => collisionWithDevelopers(c, store)),
    );
    return reply.viewAsync('collisions.hbs', {
      title: 'Collisions',
      isCollisions: true,
      collisions: enrichedCollisions,
    });
  });

  // --- JSON / partial endpoints for htmx ---

  app.get('/dashboard/api/sessions', async (_req, reply) => {
    const sessions = await store.getActiveSessions();
    reply.header('Content-Type', 'application/json');
    return { sessions };
  });

  app.get('/dashboard/api/collisions', async (_req, reply) => {
    const collisions = await store.getActiveCollisions();
    const enrichedCollisions = await Promise.all(
      collisions.map((c) => collisionWithDevelopers(c, store)),
    );
    reply.header('Content-Type', 'application/json');
    return { collisions: enrichedCollisions };
  });

  app.get('/dashboard/api/stats', async (_req, reply) => {
    const sessions = await store.getActiveSessions();
    const collisions = await store.getActiveCollisions();
    reply.header('Content-Type', 'application/json');
    return {
      sessionCount: sessions.length,
      criticalCount: collisions.filter((c) => c.severity === 'critical').length,
      warningCount: collisions.filter((c) => c.severity === 'warning').length,
      totalCollisionCount: collisions.length,
    };
  });

  app.post<{ Body: { collision_id: string } }>(
    '/dashboard/api/collisions/resolve',
    async (req, reply) => {
      const { collision_id } = req.body ?? {};
      if (!collision_id) {
        return reply
          .status(400)
          .send({ ok: false, error: 'Missing collision_id' });
      }
      await store.resolveCollision(collision_id, 'dashboard-user');
      reply.header('Content-Type', 'application/json');
      return { ok: true };
    },
  );
}

/** Returns the absolute path to the views directory (for @fastify/view). */
export function getViewsRoot(): string {
  return path.join(__dirname, 'views');
}
```

### Step 5: Wire into server.ts

Add to `packages/backend/src/server.ts`. The changes are:

1. Add imports at the top of the file:

```typescript
import fastifyView from '@fastify/view';
import Handlebars from 'handlebars';
import { dashboardRoutes, getViewsRoot } from './dashboard/routes.js';
```

2. After the `await app.register(cors, ...)` line, add the view engine registration and dashboard routes. The dashboard routes must be registered **before** the `preHandler` auth hook so they are not gated by authentication (the dashboard is a read-only monitoring UI):

Replace the existing server.ts with this updated version. The key changes are marked with `// DASHBOARD:` comments:

```typescript
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyView from '@fastify/view';           // DASHBOARD: view engine
import Handlebars from 'handlebars';                // DASHBOARD: template engine
import { loadConfig } from './env.js';
import { createStore } from './db/index.js';
import { CollisionEngine } from './services/collision-engine.js';
import { NotificationDispatcher } from './services/notification-dispatcher.js';
import { authenticate } from './middleware/auth.js';
import { sessionRoutes } from './routes/sessions.js';
import { signalRoutes } from './routes/signals.js';
import { conflictRoutes } from './routes/conflicts.js';
import { historyRoutes } from './routes/history.js';
import { dashboardRoutes, getViewsRoot } from './dashboard/routes.js';  // DASHBOARD

const config = loadConfig();
const store = createStore(config);
const engine = new CollisionEngine(store, config);
const dispatcher = new NotificationDispatcher(config.webhooks.urls);

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

// DASHBOARD: Register view engine + routes before auth hook
const dashboardEnabled = process.env.DASHBOARD_ENABLED !== 'false';
if (dashboardEnabled) {
  await app.register(fastifyView, {
    engine: { handlebars: Handlebars },
    root: getViewsRoot(),
    layout: 'layout.hbs',
    options: {
      partials: {
        'session-card': 'partials/session-card.hbs',
        'collision-row': 'partials/collision-row.hbs',
      },
    },
  });
  dashboardRoutes(app, store);
}

app.addHook('preHandler', authenticate);

app.get('/api/health', async () => ({ status: 'ok', version: '0.2.0' }));

sessionRoutes(app, store, engine, dispatcher);
signalRoutes(app, store, engine, dispatcher);
conflictRoutes(app, store, engine, dispatcher);
historyRoutes(app, store);

// Periodic cleanup of stale sessions
const cleanupIntervalMs = config.session.heartbeat_interval_seconds * 1000;
setInterval(async () => {
  try {
    const cleaned = await store.cleanupStaleSessions(config.session.idle_timeout_seconds);
    if (cleaned.length > 0) {
      app.log.info({ count: cleaned.length, session_ids: cleaned }, 'Cleaned up stale sessions');
    }
  } catch (err) {
    app.log.error({ err }, 'Failed to cleanup stale sessions');
  }
}, cleanupIntervalMs);

await app.listen({ port: config.port, host: '0.0.0.0' });
app.log.info(`Open Hive backend listening on port ${config.port}`);
```

### Step 6: Create the tests

Create `packages/backend/src/dashboard/dashboard.test.ts`:

```typescript
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyView from '@fastify/view';
import Handlebars from 'handlebars';
import { DatabaseSync } from 'node:sqlite';
import { HiveStore } from '../db/store.js';
import { dashboardRoutes, getViewsRoot } from './routes.js';

function createTestDB(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE sessions (
      session_id TEXT PRIMARY KEY,
      developer_email TEXT NOT NULL,
      developer_name TEXT NOT NULL,
      repo TEXT NOT NULL,
      project_path TEXT NOT NULL,
      started_at TEXT NOT NULL,
      last_activity TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      intent TEXT,
      files_touched TEXT NOT NULL DEFAULT '[]',
      areas TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE signals (
      signal_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(session_id),
      timestamp TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      file_path TEXT,
      semantic_area TEXT
    );
    CREATE TABLE collisions (
      collision_id TEXT PRIMARY KEY,
      session_ids TEXT NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      details TEXT NOT NULL,
      detected_at TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      resolved_by TEXT
    );
  `);
  return db;
}

async function buildApp(store: HiveStore): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(fastifyView, {
    engine: { handlebars: Handlebars },
    root: getViewsRoot(),
    layout: 'layout.hbs',
    options: {
      partials: {
        'session-card': 'partials/session-card.hbs',
        'collision-row': 'partials/collision-row.hbs',
      },
    },
  });

  dashboardRoutes(app, store);
  await app.ready();
  return app;
}

describe('Dashboard routes', () => {
  let db: DatabaseSync;
  let store: HiveStore;
  let app: FastifyInstance;

  before(async () => {
    db = createTestDB();
    store = new HiveStore(db);
    app = await buildApp(store);
  });

  after(async () => {
    await app.close();
    db.close();
  });

  // --- HTML page tests ---

  it('GET /dashboard returns 200 with HTML content', async () => {
    const res = await app.inject({ method: 'GET', url: '/dashboard' });
    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-type']?.toString().includes('text/html'));
    assert.ok(res.body.includes('Open Hive'));
    assert.ok(res.body.includes('Dashboard'));
  });

  it('GET /dashboard/sessions returns 200 with HTML content', async () => {
    const res = await app.inject({ method: 'GET', url: '/dashboard/sessions' });
    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-type']?.toString().includes('text/html'));
    assert.ok(res.body.includes('Active Sessions'));
  });

  it('GET /dashboard/collisions returns 200 with HTML content', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/collisions',
    });
    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-type']?.toString().includes('text/html'));
    assert.ok(res.body.includes('Collisions'));
  });

  // --- JSON API tests ---

  it('GET /dashboard/api/sessions returns JSON with sessions array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/api/sessions',
    });
    assert.equal(res.statusCode, 200);
    assert.ok(
      res.headers['content-type']?.toString().includes('application/json'),
    );
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body.sessions));
  });

  it('GET /dashboard/api/collisions returns JSON with collisions array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/api/collisions',
    });
    assert.equal(res.statusCode, 200);
    assert.ok(
      res.headers['content-type']?.toString().includes('application/json'),
    );
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body.collisions));
  });

  it('GET /dashboard/api/stats returns session and collision counts', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/api/stats',
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(typeof body.sessionCount, 'number');
    assert.equal(typeof body.criticalCount, 'number');
    assert.equal(typeof body.warningCount, 'number');
    assert.equal(typeof body.totalCollisionCount, 'number');
  });

  // --- Data integration tests ---

  it('dashboard shows active session data after session is created', async () => {
    await store.createSession({
      session_id: 'dash-test-sess-1',
      developer_email: 'alice@example.com',
      developer_name: 'Alice',
      repo: 'my-repo',
      project_path: '/projects/my-repo',
      started_at: new Date().toISOString(),
      intent: 'Refactoring auth module',
    });

    const res = await app.inject({ method: 'GET', url: '/dashboard' });
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.includes('Alice'));
    assert.ok(res.body.includes('my-repo'));
  });

  it('API sessions endpoint returns created session', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/api/sessions',
    });
    const body = JSON.parse(res.body);
    assert.ok(body.sessions.length >= 1);
    const alice = body.sessions.find(
      (s: { developer_name: string }) => s.developer_name === 'Alice',
    );
    assert.ok(alice);
    assert.equal(alice.repo, 'my-repo');
  });

  it('collision appears on dashboard after creation', async () => {
    await store.createCollision({
      session_ids: ['dash-test-sess-1', 'dash-test-sess-2'],
      type: 'file',
      severity: 'critical',
      details: 'Both editing src/auth.ts',
      detected_at: new Date().toISOString(),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/api/collisions',
    });
    const body = JSON.parse(res.body);
    assert.ok(body.collisions.length >= 1);
    const col = body.collisions.find(
      (c: { details: string }) => c.details === 'Both editing src/auth.ts',
    );
    assert.ok(col);
    assert.equal(col.severity, 'critical');
  });

  it('POST /dashboard/api/collisions/resolve resolves a collision', async () => {
    // Create a collision to resolve
    const collision = await store.createCollision({
      session_ids: ['dash-test-sess-1'],
      type: 'directory',
      severity: 'warning',
      details: 'Both working in src/routes/',
      detected_at: new Date().toISOString(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/dashboard/api/collisions/resolve',
      payload: { collision_id: collision.collision_id },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);

    // Verify it no longer appears in active collisions
    const checkRes = await app.inject({
      method: 'GET',
      url: '/dashboard/api/collisions',
    });
    const checkBody = JSON.parse(checkRes.body);
    const found = checkBody.collisions.find(
      (c: { collision_id: string }) =>
        c.collision_id === collision.collision_id,
    );
    assert.equal(found, undefined);
  });
});
```

## Verify

```bash
cd packages/backend && npm run build && npm test
```

Confirm:
- [ ] Build succeeds with no type errors
- [ ] All existing tests still pass
- [ ] Dashboard tests pass (10 tests)
- [ ] With `DASHBOARD_ENABLED` unset or `true`, visiting `http://localhost:3000/dashboard` shows the dark-themed dashboard
- [ ] With `DASHBOARD_ENABLED=false`, `/dashboard` returns 404 (routes not registered)
- [ ] Session cards auto-refresh every 5 seconds (watch the network tab for htmx requests to `/dashboard/api/sessions`)
- [ ] Creating a session via the API (`POST /api/sessions/register`) makes it appear on the dashboard within 5 seconds
- [ ] Collision severity badges show correct colors (red for critical, yellow for warning, blue for info)

## Configuration

Add to `.env.example`:

```bash
# Dashboard — embedded web UI for monitoring sessions and collisions
# Set to "false" to disable the dashboard entirely. Default: true (enabled).
DASHBOARD_ENABLED=true
```

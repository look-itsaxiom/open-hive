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

- Creates dashboard route handlers, Handlebars views, and partials
- Creates dashboard tests (10 tests)
- Modifies `packages/backend/src/server.ts` to register the view engine and dashboard routes (gated by `DASHBOARD_ENABLED` env var)

The dashboard consumes data from the `PortRegistry`. It accesses `registry.store` to read sessions and collisions -- it does not implement any port interface itself.

## Implementation Steps

### Step 1: Install dependencies

```bash
cd packages/backend && npm install @fastify/static @fastify/view handlebars
```

### Step 2: Create Handlebars views and partials

Create the view templates in `packages/backend/src/dashboard/views/`:
- `layout.hbs` -- base HTML layout with htmx CDN link and dark-theme CSS
- `index.hbs` -- main dashboard with session cards, collision alerts, and auto-refresh
- `sessions.hbs` -- detailed active sessions view
- `collisions.hbs` -- collision timeline with severity badges and resolve action
- `partials/session-card.hbs` -- reusable session card partial
- `partials/collision-row.hbs` -- reusable collision row partial

### Step 3: Create the dashboard routes

Create `packages/backend/src/dashboard/routes.ts`. The dashboard routes access the store through the `PortRegistry`:

```typescript
import type { FastifyInstance } from 'fastify';
import type { IHiveStore } from '@open-hive/shared';
import type { Session, Collision } from '@open-hive/shared';

export function dashboardRoutes(app: FastifyInstance, store: IHiveStore): void {
  // HTML pages: /dashboard, /dashboard/sessions, /dashboard/collisions
  // JSON API: /dashboard/api/sessions, /dashboard/api/collisions, /dashboard/api/stats
  // Action: POST /dashboard/api/collisions/resolve
}
```

Note: The `store` parameter is typed as `IHiveStore` from `@open-hive/shared`. In `server.ts`, pass `registry.store`:

```typescript
import { dashboardRoutes } from './dashboard/routes.js';

if (dashboardEnabled) {
  dashboardRoutes(app, registry.store);
}
```

### Step 4: Wire into server.ts

Register the view engine and dashboard routes before the auth hook:

```typescript
import fastifyView from '@fastify/view';
import Handlebars from 'handlebars';
import { dashboardRoutes, getViewsRoot } from './dashboard/routes.js';

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
  dashboardRoutes(app, registry.store);
}
```

### Step 5: Create tests

Create `packages/backend/src/dashboard/dashboard.test.ts` with 10 tests covering HTML page rendering, JSON API endpoints, and data integration.

## Verify

```bash
cd packages/backend && npm run build && npm test
```

Confirm:
- [ ] Build succeeds with no type errors
- [ ] All existing tests still pass
- [ ] Dashboard tests pass (10 tests)
- [ ] With `DASHBOARD_ENABLED` unset or `true`, visiting `http://localhost:3000/dashboard` shows the dark-themed dashboard
- [ ] With `DASHBOARD_ENABLED=false`, `/dashboard` returns 404

## Configuration

Add to `.env.example`:

```bash
# Dashboard — embedded web UI for monitoring sessions and collisions
# Set to "false" to disable the dashboard entirely. Default: true (enabled).
DASHBOARD_ENABLED=true
```

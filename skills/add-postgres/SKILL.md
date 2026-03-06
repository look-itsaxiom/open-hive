---
name: add-postgres
description: Replace the default SQLite store with PostgreSQL using pg connection pooling
category: store
port: IHiveStore
requires:
  - pg
  - "@types/pg"
modifies:
  - packages/backend/src/db/postgres.ts (new)
  - packages/backend/src/db/postgres-store.ts (new)
  - packages/backend/src/db/index.ts (update createStore factory)
  - packages/backend/src/db/migrate-postgres.ts (new)
  - packages/backend/src/env.ts (DATABASE_URL for postgres)
  - packages/backend/src/server.ts (pass store to PortRegistry)
  - docker-compose.yaml (add postgres service)
tests:
  - packages/backend/src/db/postgres-store.test.ts
---

# add-postgres

Swaps the default SQLite store for PostgreSQL. All `IHiveStore` methods are reimplemented on top of a `pg` connection pool with parameterized queries, JSON columns for array fields, and automatic table creation on startup. The existing SQLite path remains the default -- PostgreSQL is opt-in via `DB_TYPE=postgres`.

## Prerequisites

- Open Hive backend source checked out (`packages/backend/` exists)
- npm installed
- A PostgreSQL 14+ server accessible from the backend (local, Docker, or remote)
- A database already created (e.g., `CREATE DATABASE openhive;`)

## What This Skill Does

- **Creates `packages/backend/src/db/postgres-store.ts`** -- full `IHiveStore` implementation (from `@open-hive/shared`) with 12 methods using `pg` parameterized queries
- **Creates `packages/backend/src/db/postgres.ts`** -- connection pool setup, table creation SQL, index creation
- **Creates `packages/backend/src/db/migrate-postgres.ts`** -- migration script that copies data from SQLite to PostgreSQL
- **Creates `packages/backend/src/db/postgres-store.test.ts`** -- 15 tests covering all store methods
- **Updates `packages/backend/src/db/index.ts`** -- `createStore` factory routes `postgres` type to `PostgresStore`
- **Updates `docker-compose.yaml`** -- adds a `postgres` service and links it to the backend

## Implementation Steps

### Step 1: Install dependencies

```bash
cd packages/backend && npm install pg @types/pg
```

### Step 2: Create the PostgreSQL connection module

Create `packages/backend/src/db/postgres.ts` with connection pool setup and automatic table creation.

### Step 3: Create the PostgresStore implementation

Create `packages/backend/src/db/postgres-store.ts`:

```typescript
import type {
  Session, Signal, Collision, CollisionSeverity, CollisionType,
  SignalType, SessionStatus,
} from '@open-hive/shared';
import type { IHiveStore } from '@open-hive/shared';

export class PostgresStore implements IHiveStore {
  constructor(private pool: pg.Pool) {}

  // All 12 IHiveStore methods implemented with pg parameterized queries
  // See full implementation in the skill body
  // ...
}
```

**Important**: The `IHiveStore` interface is imported from `@open-hive/shared`, not from `../db/store.js`. This ensures the PostgresStore conforms to the canonical port definition.

### Step 4: Update the createStore factory

Replace the contents of `packages/backend/src/db/index.ts`:

```typescript
import type { IHiveStore } from '@open-hive/shared';
import type { HiveBackendConfig } from '@open-hive/shared';

export async function createStore(config: HiveBackendConfig): Promise<IHiveStore> {
  if (config.database.type === 'postgres') {
    const { createPostgresPool } = await import('./postgres.js');
    const { PostgresStore } = await import('./postgres-store.js');
    const conn = await createPostgresPool(config.database.url);
    return new PostgresStore(conn.pool);
  }
  const { createSQLiteDB } = await import('./sqlite.js');
  const { HiveStore } = await import('./store.js');
  const db = createSQLiteDB(config.database.url);
  return new HiveStore(db);
}
```

### Step 5: Register store via PortRegistry

In `packages/backend/src/server.ts`, the store is passed to the `PortRegistry`:

```typescript
const store = await createStore(config);

const registry: PortRegistry = {
  store,
  identity,
  analyzers,
  alerts,
};
```

The `PortRegistry` holds the `IHiveStore` instance and provides it to all routes and services. Whether the store is SQLite or PostgreSQL is transparent to the rest of the system.

### Step 6: Write tests

Create `packages/backend/src/db/postgres-store.test.ts` with 15 tests across sessions, signals, and collisions. Tests are skipped when `TEST_POSTGRES_URL` is not set.

```typescript
import type { IHiveStore } from '@open-hive/shared';

// Tests use the IHiveStore interface from @open-hive/shared
// to verify conformance
```

## Verify

```bash
npm run build && npm test
```

Confirm:
- [ ] Build succeeds with no type errors (`npm run build`)
- [ ] All existing SQLite tests still pass (`npm test`)
- [ ] PostgreSQL tests pass when `TEST_POSTGRES_URL` is set
- [ ] PostgreSQL tests are skipped (not failing) when `TEST_POSTGRES_URL` is unset
- [ ] Server starts with `DB_TYPE=sqlite` (default path unchanged)
- [ ] Server starts with `DB_TYPE=postgres DATABASE_URL=postgresql://openhive:openhive@localhost:5432/openhive`

## Configuration

Add to `.env.example`:

```bash
# Database backend: sqlite (default) or postgres
DB_TYPE=sqlite

# Database connection.
# For sqlite: file path (e.g., ./data/hive.db)
# For postgres: connection string (e.g., postgresql://user:pass@localhost:5432/openhive)
DATABASE_URL=./data/hive.db

# PostgreSQL test database (only needed for running postgres-store tests)
# TEST_POSTGRES_URL=postgresql://openhive:openhive@localhost:5433/openhive_test
```

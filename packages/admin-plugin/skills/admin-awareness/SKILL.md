---
name: admin-awareness
description: >
  Use when the admin is modifying Open Hive backend code, applying integration skills,
  or asking about the backend architecture, port system, or available integrations.
---

# Open Hive Admin Awareness

You are helping an admin configure an Open Hive backend. Here's what you need to know:

## Architecture: Five Ports

Open Hive uses hexagonal architecture. All extension points are TypeScript interfaces in `packages/shared/src/ports.ts`. The backend creates a `PortRegistry` at startup that wires everything together.

```typescript
interface PortRegistry {
  store: IHiveStore;            // where data lives (sessions, signals, collisions, mail, nerves)
  identity: IIdentityProvider;  // who is making requests
  analyzers: ISemanticAnalyzer[]; // how intents are compared (L3a -> L3b -> L3c)
  alerts: AlertDispatcher;      // where collision alerts go (holds IAlertSink[])
  decay: DecayService;          // signal/mail weight decay over time
  nerves: INerveRegistry;       // connected nerve registration and discovery
}
```

## Defaults (what ships out of the box)

| Port | Default Implementation | What It Does |
|------|----------------------|--------------|
| `IHiveStore` | `HiveStore` (SQLite via `node:sqlite`) | Zero-dep persistence, good for <50 devs |
| `IIdentityProvider` | `PassthroughIdentityProvider` | Trusts self-reported identity, no auth |
| `ISemanticAnalyzer` | `KeywordAnalyzer` (L3a) | Jaccard keyword overlap, free and fast |
| `IAlertSink` | `GenericWebhookSink` | Raw JSON POST to configured URLs |
| `INerveRegistry` | `HiveStore` (same object) | SQLite-backed nerve registration |
| `DecayService` | Core service | Exponential decay with configurable half-life |

## Skills extend ports

Skills in `skills/` are Markdown instruction files. Each skill teaches you (Claude) how to add a new port implementation. The admin runs `/hive-admin install <skill-name>` and you follow the SKILL.md step by step.

## Rules when applying skills

1. **Always import port interfaces from `@open-hive/shared`**, never from backend-internal modules.
2. **Registration goes through `PortRegistry`** in `packages/backend/src/server.ts`.
3. **Backward compatibility is mandatory.** New features are opt-in via env vars. Default code path must remain unchanged.
4. **Run `npm run build && npm test` after every change.** Never leave the backend in a broken state.
5. **TypeScript strict mode.** No `any`, no `@ts-ignore`.
6. **Use `nanoid` for ID generation** (already a project dependency).
7. **Idempotent nerve operations.** `registerNerve()` should upsert (update if agent_id exists).
8. **Mail addressing includes developer_email.** When implementing `createMail()`, always resolve `to_developer_email` from `to_session_id` so mail survives session restarts.

## Key file locations

- **Port interfaces:** `packages/shared/src/ports.ts`
- **Models:** `packages/shared/src/models.ts`
- **PortRegistry:** `packages/backend/src/port-registry.ts`
- **Server wiring:** `packages/backend/src/server.ts`
- **SQLite schema:** `packages/backend/src/db/sqlite.ts`
- **Store implementation:** `packages/backend/src/db/store.ts`
- **Config loading:** `packages/backend/src/env.ts`
- **Skills directory:** `skills/` (repo root)

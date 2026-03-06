# Hexagonal Architecture: Ports and Adapters

Open Hive follows a ports-and-adapters (hexagonal) architecture. The core codebase defines *what* the system does through generic interfaces (ports), while specific implementations for tools and services are delivered as skills (adapters).

## The Hive Metaphor

The **hive is the structure** -- the honeycomb cells, the architecture, the protocols. The **bees are the implementations** -- they plug into the structure and do the specific work for a particular colony.

## Design Philosophy

Open Hive is a **coordination layer**, not an integration platform. The core concerns are:

- Collision detection
- Alert routing
- Identity resolution
- Semantic analysis
- Session and signal storage

Each concern is expressed as a port interface. The default implementations are minimal (SQLite storage, passthrough auth, keyword-only semantics, generic webhooks). Skills replace or augment these defaults for production deployments.

## The Rule

If it's about *what Open Hive does*, it belongs in the core. If it's about *how a particular org implements it*, it's a skill.

## Core Ports

| Port | Interface | Responsibility | Default Implementation |
|------|-----------|----------------|----------------------|
| **Storage** | `IHiveStore` | Persist sessions, signals, collisions | SQLite via `node:sqlite` |
| **Alerts** | `IAlertSink` | Route collision notifications | `GenericWebhookSink` (raw JSON POST via `AlertDispatcher`) |
| **Identity** | `IIdentityProvider` | Authenticate developers, resolve teams | `PassthroughIdentityProvider` (accept all) |
| **Semantic Analysis** | `ISemanticAnalyzer` | Compare developer intents for overlap | `KeywordAnalyzer` (L3a: keyword extraction + Jaccard similarity) |

See [port interfaces](../reference/ports.md) for the full TypeScript interface definitions.

## Skill Adapters

Skills are the adapters that plug into ports:

| Port | Example Skills |
|------|---------------|
| Storage | PostgreSQL, MySQL |
| Alerts | Slack, Teams, Discord, PagerDuty, email |
| Identity | GitHub OAuth, GitLab OAuth, Azure DevOps OAuth, LDAP, SAML |
| Semantic Analysis | OpenAI Embeddings, Ollama Embeddings, LLM Comparison |

## How Skills Wire In

Each skill is a `SKILL.md` file that instructs Claude Code to:

1. Create implementation source files in the backend (implementing `IAlertSink`, `IIdentityProvider`, `ISemanticAnalyzer`, or `IHiveStore`)
2. Add environment variables to `packages/backend/src/env.ts`
3. Register the adapter in `packages/backend/src/server.ts` via the `PortRegistry`
4. Write tests
5. Verify the build

The skill pattern keeps the core codebase clean. No vendor-specific code lives in the main source tree -- it's added per-deployment by the skill instructions.

## Architecture Diagram

```
+--------------------------------------------------+
|                  Open Hive Core                   |
|                                                   |
|  +------------+  +----------+  +--------------+   |
|  |  Sessions  |  | Signals  |  |  Collision   |   |
|  |  Registry  |  |  Store   |  |   Engine     |   |
|  +-----+------+  +----+-----+  +------+-------+   |
|        |              |               |            |
|  +-----v--------------v---------------v--------+  |
|  |              Core Ports                      |  |
|  |  IHiveStore . IAlertSink . IIdentityProvider |  |
|  |            ISemanticAnalyzer                 |  |
|  +------^-----------^-----------^---------------+  |
|         |           |           |                  |
+---------+-----------+-----------+------------------+
          |           |           |
    +-----+---+ +-----+---+ +----+----+
    | SQLite  | | Webhook | | Pass-   |
    | (default| | (default| | through |
    |  store) | |  alert) | | (auth)  |
    +---------+ +---------+ +---------+
          |           |           |
    +-----+---+ +-----+---+ +----+----+
    | Postgres| | Slack   | | GitHub  |
    | (skill) | | (skill) | | OAuth   |
    +---------+ +---------+ | (skill) |
                            +---------+
```

## Phase 2 Status

All Phase 2 milestones are complete:

- **M1:** Defined `IHiveStore`, `IAlertSink`, `IIdentityProvider`, `ISemanticAnalyzer` interfaces in `@open-hive/shared` (with `AlertEvent`, `DeveloperIdentity`, `AuthContext`, `SemanticMatch`)
- **M2:** Refactored to `PortRegistry`, `AlertDispatcher`, `GenericWebhookSink`, `KeywordAnalyzer`, `PassthroughIdentityProvider`; replaced `NotificationDispatcher`/`NotificationFormatter`
- **M3:** Updated all 12 skills to target port interfaces
- **M4:** Wired `ISemanticAnalyzer[]` into `CollisionEngine` with tier-ordered execution (L3a, L3b, L3c), severity mapping, 66 tests

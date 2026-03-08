# Open Hive

**Developer coordination layer for AI-assisted teams.**

Open Hive passively tracks what each developer (and their AI agent) is working on, detects overlapping work in real-time, and coordinates before conflicts escalate. Self-hosted, zero-config for developers, and designed to stay out of the way.

```
Developer A: "Refactoring the auth middleware"
Developer B: "Updating login flow error handling"
                    |
              Open Hive detects
           semantic overlap (L3a)
                    |
            Both developers get
          an inline collision alert
         + agent mail for coordination
```

## How It Works

Each developer's Claude Code plugin is a **nerve** — it senses what the developer is doing and reports to the **hive** (the backend). The hive detects collisions, generates agent mail, and coordinates work across the org. The nerve also maintains local state between sessions so it can send richer signals on check-in.

**The hive knows the org. The nerve knows its human.**

## Three Levels of Collision Detection

| Level | Type | Severity | How It Works |
|-------|------|----------|--------------|
| **L1** | File | `critical` | Two sessions modifying the same file |
| **L2** | Directory | `warning` | Two sessions working in the same directory |
| **L3a** | Semantic | `info` | Keyword overlap from developer prompts (Jaccard >= 0.3) |

L3b (embeddings) and L3c (LLM) are available as installable [skills](docs/reference/skills-catalog.md).

## Quick Start

### Admin: Deploy the Backend

```bash
git clone https://github.com/look-itsaxiom/open-hive.git
cd open-hive
docker compose up -d
```

The backend starts on `http://localhost:3000` with a SQLite database persisted to a Docker volume. Share this URL with your team.

### Developers: Install the Plugin

```bash
claude plugin install open-hive
```

Then in any Claude Code session:

```
/hive setup
```

That's it. The plugin auto-detects your git identity, connects to the backend, and starts working. No workflow changes required.

[Full getting started guide](docs/guide/getting-started.md) | [Admin setup guide](docs/guide/admin-setup.md)

## Architecture

```
open-hive/
├── packages/
│   ├── backend/      # Fastify API + collision engine + agent mail + nerves
│   ├── plugin/       # Claude Code plugin (hooks, commands, nerve state)
│   └── shared/       # TypeScript types, API contracts, port interfaces
├── skills/           # Integration skills (Slack, OAuth, Postgres, etc.)
├── docker-compose.yaml
└── turbo.json
```

Open Hive follows a [hexagonal (ports-and-adapters) architecture](docs/architecture/hexagonal-ports.md). The core defines four ports — Storage, Alerts, Identity, and Semantic Analysis — and [skills](docs/reference/skills-catalog.md) provide concrete adapters for each.

### Key Concepts

- **Session** — A developer's Claude Code session, tracked from open to close
- **Signal** — Activity events (file edits, intent declarations, blockers) with decay-weighted relevance
- **Collision** — Detected overlap between sessions (file, directory, or semantic)
- **Agent Mail** — Async messages between developer agents (collision alerts, coordination, pheromone trails)
- **Nerve** — A registered Claude Code plugin instance with its developer's identity
- **Nerve State** — Local JSON persistence (`~/.open-hive/nerve-state.json`) giving the plugin memory between sessions

## Documentation

| Section | Contents |
|---------|----------|
| **[Getting Started](docs/guide/getting-started.md)** | Install, configure, first collision |
| **[Admin Setup](docs/guide/admin-setup.md)** | Deployment, Docker, env vars, org rollout |
| **[Plugin Usage](docs/guide/plugin-usage.md)** | 7 hooks, 4 commands, nerve state |
| **[API Reference](docs/reference/api.md)** | All endpoints and data models |
| **[Configuration](docs/reference/config.md)** | Backend env vars + client YAML |
| **[Port Interfaces](docs/reference/ports.md)** | IHiveStore, IAlertSink, IIdentityProvider, ISemanticAnalyzer |
| **[Skills Catalog](docs/reference/skills-catalog.md)** | Integration skills |
| **[Collision Detection](docs/architecture/collision-detection.md)** | L1/L2/L3 deep dive |
| **[Skill Authoring](docs/guide/skill-authoring.md)** | Create custom skills |

## Roadmap

### Phase 1 — MVP (complete)
- [x] Three-level collision detection (L1 file, L2 directory, L3a semantic)
- [x] Claude Code plugin (hooks + commands)
- [x] Docker deployment with SQLite
- [x] Session heartbeat + idle timeout cleanup

### Phase 2 — Core Ports (complete)
- [x] Hexagonal port interfaces (IHiveStore, IAlertSink, IIdentityProvider, ISemanticAnalyzer)
- [x] PortRegistry dependency injection
- [x] Tier-ordered semantic analysis (L3a/L3b/L3c pipeline)

### Phase 3 — Agent Infrastructure (complete)
- [x] Signal decay (exponential half-life, type-specific overrides)
- [x] Rich signal types (intent_declared, blocker_hit, outcome_achieved)
- [x] Agent mail (session-to-session, context-addressed pheromone trails)
- [x] Nerve registry (agent cards, heartbeat, auto-registration from sessions)
- [x] Nerve state persistence (cross-session local memory, crash recovery)
- [x] Developer-level mail delivery (survives session ID changes)
- [x] Scenario test suite (Alice's Morning, Crash Recovery, Orphaned Mail, Solo Developer)
- [x] 182 tests across backend + plugin

### Phase 4 — Production Readiness
- [ ] Claude Code marketplace publication
- [ ] Real-world dogfooding
- [ ] OAuth identity providers (via skills)
- [ ] Notification sinks (Slack, Teams, Discord via skills)

## Development

```bash
npm install && npm run build    # Build all packages
npm run dev                     # Watch mode
npm run test                    # Run full test suite (182 tests)
```

### Running Tests

```bash
# All backend tests (unit + scenario)
cd packages/backend && npm test

# Plugin nerve state tests
cd packages/plugin && npx tsx --test src/nerve/nerve-state.test.ts src/nerve/nerve-state-lifecycle.test.ts
```

## License

MIT

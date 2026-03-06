# Open Hive

**Developer collision detection for AI-assisted teams.**

Open Hive passively tracks what each developer (and their AI agent) is working on, detects overlapping work in real-time, and alerts before conflicts escalate. Self-hosted, zero-config for developers, and designed to stay out of the way.

```
Developer A: "Refactoring the auth middleware"
Developer B: "Updating login flow error handling"
                    |
              Open Hive detects
           semantic overlap (L3a)
                    |
            Both developers get
          an inline collision alert
```

## Three Levels of Collision Detection

| Level | Type | Severity | How It Works |
|-------|------|----------|--------------|
| **L1** | File | `critical` | Two sessions modifying the same file |
| **L2** | Directory | `warning` | Two sessions working in the same directory |
| **L3a** | Semantic | `info` | Keyword overlap from developer prompts (Jaccard >= 0.3) |

L3b (embeddings) and L3c (LLM) are available as installable [skills](docs/reference/skills-catalog.md).

## Quick Start

```bash
git clone https://github.com/look-itsaxiom/open-hive.git
cd open-hive
docker compose up -d
```

```bash
claude plugin install open-hive
```

```
/hive setup
```

That's it. [Full getting started guide](docs/guide/getting-started.md).

## Architecture

```
open-hive/
├── packages/
│   ├── backend/      # Fastify API server + collision engine
│   ├── plugin/       # Claude Code plugin (hooks, commands, client)
│   └── shared/       # TypeScript types and API contracts
├── skills/           # 12 integration skills
├── docker-compose.yaml
└── turbo.json
```

Open Hive follows a [hexagonal (ports-and-adapters) architecture](docs/architecture/hexagonal-ports.md). The core defines four ports — Storage, Alerts, Identity, and Semantic Analysis — and [skills](docs/reference/skills-catalog.md) provide concrete adapters for each.

## Documentation

| Section | Contents |
|---------|----------|
| **[Getting Started](docs/guide/getting-started.md)** | Install, configure, first collision |
| **[Admin Setup](docs/guide/admin-setup.md)** | Deployment, Docker, env vars |
| **[Plugin Usage](docs/guide/plugin-usage.md)** | 6 hooks, 4 commands, client config |
| **[API Reference](docs/reference/api.md)** | All endpoints and data models |
| **[Configuration](docs/reference/config.md)** | Backend env vars + client YAML |
| **[Port Interfaces](docs/reference/ports.md)** | IHiveStore, IAlertSink, IIdentityProvider, ISemanticAnalyzer |
| **[Skills Catalog](docs/reference/skills-catalog.md)** | 12 integration skills |
| **[Collision Detection](docs/architecture/collision-detection.md)** | L1/L2/L3 deep dive |
| **[Skill Authoring](docs/guide/skill-authoring.md)** | Create custom skills |
| **[Troubleshooting](docs/guide/troubleshooting.md)** | Common issues |

## Roadmap

### Phase 1 — MVP (complete)
- [x] Three-level collision detection (L1 file, L2 directory, L3a semantic)
- [x] Claude Code plugin (6 hooks, 4 commands)
- [x] Docker deployment
- [x] Session heartbeat + idle timeout
- [x] Input validation + error handling
- [x] Unit test suite (40 tests)
- [x] Store adapter interface (`IHiveStore`)
- [x] Skills library (12 integration skills)

### Phase 2 — Core Ports (next)
- [ ] M1: Define core port interfaces
- [ ] M2: Refactor to ports
- [ ] M3: Skill contract update
- [ ] M4: L3b/L3c engine integration
- [x] M5: Documentation decomposition

### Phase 3 — Ecosystem
- [ ] Claude Code marketplace publication
- [ ] Community-contributed skills
- [ ] Skill validation / conformance tests

## Development

```bash
npm install && npm run build    # Build all packages
npm run dev                     # Watch mode
npm run test                    # Run test suite
```

## License

MIT

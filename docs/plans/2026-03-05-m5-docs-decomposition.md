# M5: Documentation Decomposition — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Decompose the monolithic README.md into a structured `docs/` directory that serves as the official documentation project for Open Hive — covering both internal work planning docs and user-facing documentation for admins and plugin users.

**Architecture:** Create a `docs/` directory with clear separation between user-facing guides (admin setup, plugin usage, skill authoring) and internal project docs (plans, architecture decisions). The README becomes a concise landing page that links into the docs. Documentation follows a progressive disclosure pattern: quick start → guides → reference → internals.

**Tech Stack:** Markdown, directory structure

**Dependencies:** M1 should be merged (port interfaces documented). Can run in parallel with M2-M4 since it's docs-only.

**Branch:** `feature/m5-docs-decomposition` → PR to `develop`

---

## Task 1: Create documentation directory structure

**Step 1: Create the directory tree**

```bash
mkdir -p docs/guide
mkdir -p docs/reference
mkdir -p docs/architecture
mkdir -p docs/plans  # already exists
```

Target structure:
```
docs/
├── guide/                    # User-facing guides (progressive disclosure)
│   ├── getting-started.md    # Quick start for new users
│   ├── admin-setup.md        # Backend deployment and configuration
│   ├── plugin-usage.md       # Plugin installation and daily usage
│   ├── skill-authoring.md    # How to create custom skills
│   └── troubleshooting.md    # Common issues and solutions
├── reference/                # Technical reference (exhaustive)
│   ├── api.md                # Full API endpoint reference
│   ├── config.md             # All configuration options
│   ├── ports.md              # Port interface reference (IHiveStore, IAlertSink, etc.)
│   └── skills-catalog.md     # Catalog of all available skills
├── architecture/             # Internal architecture docs
│   ├── overview.md           # System architecture and design philosophy
│   ├── collision-detection.md # How collision detection works (L1/L2/L3)
│   └── hexagonal-ports.md    # The ports-and-adapters pattern
├── plans/                    # Implementation plans (already exists)
│   ├── 2026-03-02-*.md
│   └── 2026-03-05-*.md
└── README.md                 # Docs index / navigation page
```

**Step 2: Commit empty structure**

```bash
git add docs/
git commit -m "docs: create documentation directory structure"
```

---

## Task 2: Extract "Getting Started" guide

**Files:**
- Create: `docs/guide/getting-started.md`

**Step 1: Write the guide**

Extract from README's "Quick Start" section. Expand with:
- Prerequisites (Node 22+, Docker, Claude Code)
- Step-by-step backend setup
- Plugin installation
- First run walkthrough (`/hive setup`, `/hive status`)
- The "Try It Out" curl walkthrough (currently in README)

Content should be self-contained — a new user reads only this file and gets running.

**Step 2: Commit**

```bash
git add docs/guide/getting-started.md
git commit -m "docs: extract getting started guide from README"
```

---

## Task 3: Extract "Admin Setup" guide

**Files:**
- Create: `docs/guide/admin-setup.md`

**Step 1: Write the guide**

Cover everything an admin needs to deploy and configure Open Hive:
- Docker deployment (compose file walkthrough)
- Running without Docker
- Environment variables (all of them, with defaults and descriptions)
- SQLite vs PostgreSQL (when to switch, how)
- Collision scope configuration (repo vs org)
- Webhook/alert configuration
- Session timeout tuning
- Security considerations (no auth by default, how to add it)
- Upgrading

Source material: README's "Configuration" section, `env.ts`, `docker-compose.yaml`, `config.ts`.

**Step 2: Commit**

```bash
git add docs/guide/admin-setup.md
git commit -m "docs: extract admin setup guide"
```

---

## Task 4: Extract "Plugin Usage" guide

**Files:**
- Create: `docs/guide/plugin-usage.md`

**Step 1: Write the guide**

Cover daily developer experience:
- What the plugin does (6 hooks explained in plain language)
- Commands: `/hive setup`, `/hive status`, `/hive who`, `/hive history`
- What collision alerts look like in your session
- The "never blocks" principle (3s timeouts, graceful fallthrough)
- Client config (`~/.open-hive.yaml`) explained
- Working with teams
- FAQ: "Will this slow me down?", "What if the backend is down?"

Source material: README's "What the Plugin Does" and "Commands" sections, `handler.ts`, `config.ts`.

**Step 2: Commit**

```bash
git add docs/guide/plugin-usage.md
git commit -m "docs: extract plugin usage guide"
```

---

## Task 5: Extract "Skill Authoring" guide

**Files:**
- Create: `docs/guide/skill-authoring.md`

**Step 1: Write the guide**

This is the external-facing version of the build-skill meta skill. Cover:
- What skills are and why they exist
- The four ports (with brief descriptions)
- How to pick which port to implement
- Anatomy of a SKILL.md file
- Step-by-step: creating a custom notification sink
- Testing your skill
- Contributing skills back

Source material: README's "Skills Library" section, `skills/build-skill/SKILL.md`, port interfaces from M1.

**Step 2: Commit**

```bash
git add docs/guide/skill-authoring.md
git commit -m "docs: create skill authoring guide"
```

---

## Task 6: Create API reference

**Files:**
- Create: `docs/reference/api.md`

**Step 1: Write the reference**

Full API documentation with:
- Every endpoint (method, path, description)
- Request body schema (with TypeScript types from `shared/api.ts`)
- Response body schema
- Example curl commands
- Error responses
- Authentication header (when identity provider is configured)

Source material: README's "API Reference" section, all route files, `shared/api.ts`.

**Step 2: Commit**

```bash
git add docs/reference/api.md
git commit -m "docs: create API reference"
```

---

## Task 7: Create configuration reference

**Files:**
- Create: `docs/reference/config.md`

**Step 1: Write the reference**

Two sections:
1. **Backend configuration** — every environment variable, its type, default, and description
2. **Client configuration** — `~/.open-hive.yaml` schema with all fields explained

Source material: `env.ts`, `shared/config.ts`, README configuration tables.

**Step 2: Commit**

```bash
git add docs/reference/config.md
git commit -m "docs: create configuration reference"
```

---

## Task 8: Create port interface reference

**Files:**
- Create: `docs/reference/ports.md`

**Step 1: Write the reference**

Document all four port interfaces:
- `IHiveStore` — methods, parameters, return types, behavioral contract
- `IAlertSink` — interface, AlertEvent type, implementation expectations
- `IIdentityProvider` — interface, AuthContext, DeveloperIdentity
- `ISemanticAnalyzer` — interface, SemanticMatch, tier system

Each port gets: TypeScript interface, description of each method, example implementation, registration pattern.

Source material: `shared/src/ports.ts` (from M1).

**Step 2: Commit**

```bash
git add docs/reference/ports.md
git commit -m "docs: create port interface reference"
```

---

## Task 9: Create skills catalog

**Files:**
- Create: `docs/reference/skills-catalog.md`

**Step 1: Write the catalog**

Table of all 12 skills with:
- Name and category
- Which port it implements
- What it adds
- Prerequisites
- Link to the SKILL.md file

Source material: README's skills table, individual SKILL.md files.

**Step 2: Commit**

```bash
git add docs/reference/skills-catalog.md
git commit -m "docs: create skills catalog reference"
```

---

## Task 10: Create architecture docs

**Files:**
- Create: `docs/architecture/overview.md`
- Create: `docs/architecture/collision-detection.md`
- Create: `docs/architecture/hexagonal-ports.md`

**Step 1: Write architecture overview**

System-level view: monorepo structure, backend/plugin/shared packages, data flow diagram, deployment topology.

**Step 2: Write collision detection deep-dive**

How L1/L2/L3 work in detail. The data model (sessions, signals, collisions). Threshold values. Historical detection. Deduplication logic.

**Step 3: Write hexagonal ports doc**

The design philosophy, why ports-and-adapters, the four ports, how skills plug in, the PortRegistry, how to extend.

Source material: README's "Design Philosophy" and "Architecture" sections, `collision-engine.ts`, `port-registry.ts`.

**Step 4: Commit**

```bash
git add docs/architecture/
git commit -m "docs: create architecture documentation"
```

---

## Task 11: Create docs index

**Files:**
- Create: `docs/README.md`

**Step 1: Write the docs index**

Navigation page for the docs directory:

```markdown
# Open Hive Documentation

## Guides
- [Getting Started](guide/getting-started.md) — Set up Open Hive in 5 minutes
- [Admin Setup](guide/admin-setup.md) — Deploy and configure the backend
- [Plugin Usage](guide/plugin-usage.md) — Daily developer workflow
- [Skill Authoring](guide/skill-authoring.md) — Create custom integrations
- [Troubleshooting](guide/troubleshooting.md) — Common issues and solutions

## Reference
- [API](reference/api.md) — Full REST API documentation
- [Configuration](reference/config.md) — All backend and client config options
- [Port Interfaces](reference/ports.md) — IHiveStore, IAlertSink, IIdentityProvider, ISemanticAnalyzer
- [Skills Catalog](reference/skills-catalog.md) — All available integration skills

## Architecture
- [Overview](architecture/overview.md) — System architecture and data flow
- [Collision Detection](architecture/collision-detection.md) — How L1/L2/L3 detection works
- [Hexagonal Ports](architecture/hexagonal-ports.md) — The ports-and-adapters design pattern

## Project
- [Implementation Plans](plans/) — Detailed plans for upcoming work
```

**Step 2: Commit**

```bash
git add docs/README.md
git commit -m "docs: create documentation index"
```

---

## Task 12: Slim down README.md

**Files:**
- Modify: `README.md`

**Step 1: Rewrite README as a landing page**

Keep:
- Project title and one-paragraph description
- The collision detection example (the "wow" moment)
- The "Why" section (2 paragraphs)
- Architecture diagram (simplified)
- Quick Start (condensed to 3 commands + link to full guide)
- Link grid to docs

Remove (now in docs):
- Detailed "How It Works" tables
- Full API reference table
- Complete configuration tables
- Skills library details
- Development section
- Full roadmap (move to docs or CHANGELOG)

Target: README is under 150 lines. Everything else lives in `docs/`.

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: slim README to landing page, link to docs/"
```

---

## Task 13: Final verification and PR

**Step 1: Verify all internal links work**

Check that every `[link](path)` in docs resolves to an actual file.

**Step 2: Push and create PR**

```bash
git push -u origin feature/m5-docs-decomposition
gh pr create --base develop --title "docs: decompose README into structured documentation (M5)" --body "$(cat <<'EOF'
## Summary
- Create `docs/` structure: guide/, reference/, architecture/, plans/
- Extract 5 user-facing guides from README
- Create 4 reference documents (API, config, ports, skills catalog)
- Create 3 architecture documents
- Add docs index (docs/README.md)
- Slim README to a concise landing page (<150 lines)

## Context
Phase 2, Milestone 5. Documentation is now a proper project with
separate audiences: new users (getting started), admins (setup/config),
plugin users (daily workflow), and skill authors (extension development).

Closes: #<M5_ISSUE_NUMBER>

## Test plan
- [ ] All internal links resolve
- [ ] README is under 150 lines
- [ ] Every section of old README is preserved somewhere in docs/
- [ ] docs/README.md links to all documents
EOF
)"
```

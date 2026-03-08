# Phase 3 Design: From Collision Detector to Coordination Layer

> Phase 2 gave us hexagonal architecture. Phase 3 makes it think.

## What We're Building

Open Hive evolves from a collision detection tool into organizational coordination
infrastructure — a living consciousness that maintains awareness of all work across an
org, communicates through a network of nerves, and coordinates via signals and directives
so humans can focus on judgment.

Open Workshop is the blueprint. It already solved project awareness, department dispatch,
agent teams, and skill-based extensibility at the single-developer scale. Phase 3 takes
those patterns to org scale inside Open Hive's infrastructure — following Open Workshop's
lead, not modifying it.

**The product definition:** Open Hive is ERP software where AI is the point of contact
for coordinating work across an organization.

## The Conceptual Model

### Consciousness

A centralized, living state machine that maintains a relational model of organizational
work: who, what, where, when, and how it all relates. It does real processing — reasoning
about relationships between signals, detecting drift from reality, deciding what's
relevant to whom — and can offload work to connected agents via their declared
capabilities. Think Open Workshop's project meta files, but networked across an
organization.

The consciousness is not a routing machine. It maintains state, processes information,
and makes decisions. Offloading to agents keeps the tax light (target: <10-15% of any
agent's usage window) but the intelligence lives in the consciousness.

### Nerves

Bidirectional data channels between the consciousness and the outside world. A nerve is
not the tool — it's the connection. Teams bot, Claude Code, Jira bot are what's on the
other end of a nerve. Each nerve carries signals inbound and directives outbound.

### Signals & Directives

The data flowing through nerves. Signals are inbound — what's happening. Directives are
outbound — what needs to happen.

What's on the other end of the nerve determines the communication mechanism:
- **Agent Mail** — when the nerve connects two AI agents (session-to-session coordination)
- **Human-facing tools** (Teams, Slack, Claude Code) — when the nerve connects AI to a
  human through their existing tool
- **MCP Elicitation** — when the consciousness needs structured input from a human
  (schema-defined, client-agnostic)

### Agent Mail

Persistent, asynchronous messages between agents that survive session boundaries. Both
the consciousness and individual agents can create mail. When one agent discovers
something relevant to another's work, it leaves a message. The receiving agent picks it
up on next check-in.

Messages decay over time if not reinforced — the pheromone trail fades.

### Decay

Weighted relevance, not hard deletion. Fresh signals are strong; stale ones fade but
remain queryable. Important patterns consolidate from hot working memory into cold
long-term memory (embeddings / semantic store).

Decay also represents the threat: when bad signal is accepted or when no signal arrives,
the consciousness drifts from reality. Both are failure modes the system must detect
and handle.

### Registration

Two-sided process:

**Server-side (admin):** An admin uses the admin plugin's skill files to graft a new
port onto the consciousness. The AI guides the admin through defining what signals the
port accepts and what directives it can send for that nerve type. This is the ClawCraft
pattern — AI-teachable onboarding via skill files.

**Client-side (nerve):** The tool registers itself against that port, declaring where
to send its signals and where to accept directives from.

## Protocol Foundations

### Adopted from A2A

The A2A protocol (Google, Linux Foundation) provides proven patterns for agent
communication. We adopt:

- **JSON-RPC 2.0 over HTTP** — simple, well-tooled wire format
- **Agent Cards** — identity + capability declaration at a well-known path. Two-tier
  model: public card for general capabilities, authenticated extended card for
  org-internal capabilities
- **`contextId`** — groups related work across sessions and time boundaries. Maps to
  workstreams, initiatives, projects
- **Task state machine** — `working`, `input-required`, `completed`, `failed`,
  `canceled`, `rejected`. The `input-required` state is how the consciousness signals
  "I need a human decision"
- **Push notifications with auth** — reliable async delivery when the other side is
  offline, with retry policy and webhook authentication

### Added Beyond A2A

A2A is point-to-point. Our system is hub-and-spoke with the consciousness at center.
We add:

- **Shared state** — the consciousness maintains organizational state that all nerves
  contribute to and read from. Not peer-to-peer bilateral communication.
- **Broadcast / pub-sub** — Zooid pattern for efficient one-to-many event distribution.
  The consciousness publishes; nerves subscribe to relevant channels. Supports WebSocket,
  webhooks, HTTP polling.
- **Authority model** — agent cards declare capabilities. Registration declares human
  client and scope. Combined: "I can do X, on behalf of Human Y, with scope Z."
- **Conflict resolution** — to be determined through experimentation. This is the
  hardest unsolved problem (the multi-principal coordination challenge).

### AI-to-Human Communication

We do not build custom human-facing UI. The landscape already has:
- **Platform-native UI** — Teams Adaptive Cards, Slack Block Kit, Claude Code CLI
- **MCP Elicitation** — schema-defined structured input requests during tool execution
- **A2UI** (Google) — declarative agent-generated UI if richer interfaces are needed later

Our job is the **routing intelligence** — knowing which human to ask, through which
tool, and when. The consciousness decides; the nerve delivers.

## Storage Architecture

Three-tier memory model — "cheap and deep, hot and cold":

### Hot (Working Memory)
Current state in a fast store (SQLite WAL, Redis, or in-memory). What's happening right
now. Fast reads, fast writes, no conflict overhead. This is what the consciousness
references for real-time awareness.

### Warm (Structured History)
Relational database for queryable history. What happened, who did what, relationships
between work streams. Queryable but not real-time. Signals move from hot to warm as
they age.

### Cold (Long-Term Memory)
Embeddings and semantic memory (mem0, vector DB). Long-term organizational knowledge
and consolidated patterns. "This area causes problems every sprint." "These two teams'
work always overlaps." The meaningful patterns extracted from warm data. This is where
the consciousness builds deep organizational understanding.

Signals arrive hot, get processed into warm, and meaningful patterns consolidate into
cold. The consciousness reads across all three tiers depending on what it needs.

## Architecture Continuity

Phase 2's hexagonal ports ARE the nerve endpoints. Phase 3 extends, doesn't replace:

| Phase 2 Port | Phase 3 Role |
|---|---|
| `IHiveStore` | Consciousness state persistence (extends to tiered storage) |
| `IAlertSink` | Directive delivery — motor nerve output |
| `IIdentityProvider` | Nerve registration + authority model |
| `ISemanticAnalyzer` | Consciousness processing — reasoning about relationships |

The concept-as-core, implementation-as-skill pattern from Phase 2 IS the nerve model.
Admin skill files graft new ports (server-side registration). Client tools register
against those ports (client-side registration).

## Scope

### In Scope (Phase 3)
- Consciousness state model (tiered storage)
- Signal/directive protocol (A2A-informed)
- Nerve registration (two-sided: admin skill + client API)
- Agent mail (persistent, decaying, bidirectional)
- Signal decay (weighted relevance across storage tiers)
- Pub/sub broadcast (Zooid pattern)
- Claude Code nerve (existing, extended)
- Open Workshop nerve pattern (reference architecture, not modification)

### Out of Scope (Future)
- PM tool nerves (Jira, Linear)
- Communication nerves (Teams, Slack)
- Full organizational intelligence (Level 4 — requires knowledge layer)
- Custom human-facing UI

### Experimental (Learned Through Iteration)
- Storage tier technology choices
- Protocol format specifics (Zod-checked JSON, YAML, natural language, HTTP-style)
- Decay curves and half-lives per signal type
- Relevance filtering algorithms
- Conflict resolution strategies
- Consciousness processing boundaries (what it does vs. what it offloads)

## Design Principles

1. **Concept as core, implementation as skill** — the hive defines generic concepts;
   skill files teach specific implementations
2. **AI as representative, never replacement** — every agent represents a human's
   stake. The human retains all judgment.
3. **Coordinate through the environment** — stigmergy over direct messaging. The shared
   state IS the coordination mechanism.
4. **Protect the shared medium above all** — the consciousness is more valuable than
   any individual participant
5. **Design for emergence** — set conditions, don't dictate outcomes. Simple local
   rules produce complex global behavior.
6. **Trust through structure, not intention** — the protocol enforces cooperation, not
   goodwill
7. **Natural language in, logical state changes out** — AI converts human intent into
   tool-mediated state mutations on the consciousness

---

*This design captures the conceptual model validated through brainstorming on 2026-03-08.
Implementation requires experimentation — each milestone validates assumptions and feeds
learning into the next.*

# Open Hive — Vision Document

## What Is Open Hive?

Open Hive is organizational coordination infrastructure for the AI age.

It is a living, centralized awareness of all work happening across an organization — maintained by the AI agents that are already doing that work. Every agent tool an organization uses (coding assistants, project management bots, communication bots, CI/CD pipelines) can register with the hive as a **nerve** — reporting what it sees and carrying out coordination actions it's already capable of.

The hive doesn't do the work. It doesn't replace any tool. It maintains the **shared understanding** of what's happening, who's doing it, and how it all relates — then makes that understanding available to every connected agent so they can better serve their human clients.

**In plain terms:** Open Hive is ERP software where AI is the point of contact for coordinating work across an organization.

## Why Does This Need to Exist?

AI agent tools have multiplied human output but not human coordination capacity. A developer can run three Claude Code instances, but they're still the single point of coordination — manually distributing work, manually preventing overlap, manually integrating results. At the organizational level, this is worse: every team's agents work in isolation, duplicating effort, missing dependencies, and drifting apart.

Human communication is the bottleneck. Not because humans are slow at thinking, but because they're spending coordination energy on things that should be automatic: "what is everyone working on," "has anyone touched this area," "is this work blocked by something I don't know about."

If agent-to-agent coordination handles the *what* and *where* at machine speed, humans are freed to communicate about the things that actually matter: vision, priorities, tradeoffs, judgment.

## Core Principles

### AI as Representative, Never Replacement
Every agent in the hive represents a human's stake in the organization's work. The agent has authority to coordinate on behalf of its client. The human retains all judgment and decision-making. The hive surfaces, connects, and facilitates — humans judge and decide.

### Coordinate Through the Environment
Agents don't need to talk directly to each other. They read from and write to the hive — a shared environment. Like ants leaving pheromone trails: each agent's activity modifies the shared state, and other agents adapt based on what they find. Coordination is emergent from the environment, not from direct messaging.

### The Hive Is the Most Valuable Thing
The shared coordination surface is more valuable than any individual participant. Like a coral reef — the environment itself produces value that no individual could create alone. Protecting the integrity, accuracy, and availability of the hive is the highest priority.

### Concept as Core, Implementation as Skill
The hive defines generic organizational concepts: awareness, alerts, identity, analysis, signal intake, motor action. Specific implementations for particular tools and services are delivered as skill files — AI-teachable instructions that onboard new nerve types without changing the core. This is the hexagonal architecture principle applied at the product level.

### Designed for Emergence
The hive sets conditions for coordination. It doesn't dictate outcomes. Simple local rules (report what you see, read what's relevant, decay stale information) produce complex global behavior. No single coordinator. No central planner. The intelligence is emergent from the network.

## The Brain Model

### Consciousness (The Hive Backend)
A centralized, living state machine that maintains an organizational model of work. It knows:
- **Who** — registered agents, their human clients, teams, roles
- **What** — active work streams, intents, outcomes, blockers
- **Where** — repos, services, areas of activity
- **When** — what's fresh, what's stale (signal decay)
- **How it relates** — connections between work streams, overlaps, dependencies, gaps

This is not a flat database of events. It's a relational understanding that gets richer with every signal. The hive processes incoming data to maintain an accurate model of organizational reality — altering its internal state to reflect what's actually happening, not just logging what was reported.

### Sensory Nerves (Inbound)
Agents and tools that report what they see to the hive. Each nerve type has its own signal format but contributes to the same shared understanding:
- A coding agent reports intent, file activity, and outcomes
- A project management tool reports ticket state, assignments, and blockers
- A CI/CD pipeline reports build results and deployment state
- An orchestration system reports project state and milestone progress

### Motor Nerves (Outbound)
Agents and tools that can take action when the hive identifies a need. The hive doesn't learn how to do these things — it asks the right nerve to do what it's already good at:
- A communication bot can create group chats and send messages
- A project management bot can create tickets and update assignments
- A coding agent can inject context into its human's session
- A documentation bot can update shared knowledge

### The Pheromone Trail (Agent Mail)
Persistent, asynchronous messages between agents that survive session boundaries. When one agent discovers something relevant to another agent's work, it leaves a trail. The receiving agent picks it up on its next check-in. Messages decay over time — the trail fades if not reinforced. This is how coordination happens across time zones, work schedules, and different tools.

### Nerve Registration
Any agent or tool can join the hive by following the registration protocol:
- Declare identity: who is this agent, who is its human client
- Declare capabilities: what sensory data can it provide, what motor actions can it perform
- Skill files define the specifics — the onboarding mechanism for new nerve types

## Adjacent Capabilities the Hive Needs

Open Hive doesn't exist in isolation. For the full vision to work, several adjacent capabilities must exist — whether built into the hive, contributed by third parties, or evolved from other systems:

**Orchestration.** Something needs to track projects, milestones, and work distribution at a level above individual agent sessions. This is the kind of system that would register as a sensory+motor nerve — reporting project state in, receiving coordination instructions out. *(The author's personal project Open Workshop explores this pattern as a Claude Code plugin that coordinates across multiple projects.)*

**AI-teachable onboarding.** New nerve types need a way to learn the hive protocol without custom integration code. Skill files — AI-readable instructions that teach an agent how to interact with a system — are the pattern. *(The author's ClawCraft.ai project is a proof of concept for this methodology: onboarding AI to foreign systems via exposed skill files. This pattern is already embedded in Open Hive's Phase 2 architecture.)*

**Organizational knowledge.** The hive knows what's happening *now*. But effective coordination also requires knowing what the org *knows* — domain expertise, historical decisions, institutional memory. A living, embedding-based knowledge system would feed long-term context into the hive's real-time awareness. *(The author's Millennium / Ask Axiom projects explore how a centralized, living knowledgebase can provide organizational memory to AI systems.)*

These are not components of Open Hive. They are characteristics of the broader problem space. Any organization deploying the hive will need solutions in these areas — whether they build them, buy them, or evolve them from existing tools.

## The Spectrum of Ambition

These capabilities build on each other:

**Level 1 — Awareness (current):** The hive knows who's working where. Detects collisions. Agents check in and report activity. *This exists today.*

**Level 2 — Rich Signals:** The hive ingests richer data — intents, outcomes, blockers, dependencies — from multiple nerve types. Signals decay. The hive returns relevance-filtered context, not just collision alerts. *This is Phase 3.*

**Level 3 — The Hive Prompts:** The hive has enough context to identify what it needs from humans. It surfaces connections, suggests coordination, creates channels. It asks rather than waits to be told. *This requires Level 2's data richness.*

**Level 4 — Organizational Intelligence:** The hive understands the entire org — domain, people, strengths, relationships, history. It knows why this person should work on this thing and how their contribution creates value. *This requires Millennium/Ask Axiom feeding in.*

**The architecture doesn't change across levels.** The ports, the nerve model, the skill file onboarding, the signal store with decay — these are invariant. What changes is the richness of the data flowing through the system and the sophistication of the hive's processing.

## What Open Hive Is Not

- **Not a project management tool.** It doesn't own tickets, sprints, or backlogs. It coordinates with tools that do.
- **Not an agent framework.** It doesn't run agents or manage their lifecycle. It coordinates between agents that already exist.
- **Not a replacement for human communication.** It handles coordination overhead so human communication can focus on judgment, vision, and relationships.
- **Not a surveillance system.** Agents report on behalf of their human clients. The human client controls what their agent shares. Organizational policies govern the hive, same as any enterprise system.
- **Not a single vendor's product.** The nerve protocol is open. Any agent harness, any tool, any AI can register. The hive is vendor-agnostic infrastructure.

## Open Questions

1. **Processing capability.** The hive needs to reason about relationships between signals — not just store and query them. What does this processing layer look like? Specialized models? Rules engine? LLM-powered reasoning? Hybrid?

2. **The trust model.** When agents represent different humans with potentially competing priorities, how does the hive handle conflicting signals? What prevents gaming or information hoarding?

3. **Scope boundaries.** Where does the hive end? One team? One org? A consortium of orgs? The trust model changes dramatically at each boundary.

4. **Signal-to-noise.** As more nerve types connect and signal volume grows, how does the hive maintain a useful signal-to-noise ratio? The relevance filtering becomes the hardest technical problem.

5. **Adoption path.** This vision is large. What's the minimum viable hive that delivers enough value that orgs adopt it — and each new nerve type adds value rather than complexity?

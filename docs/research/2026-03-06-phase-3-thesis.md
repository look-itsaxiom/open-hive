# Open Hive — Phase 3 Thesis

> This is not a plan. It's a bet. Something to stare at, argue with, and sleep on.

## The Problem Statement

Human communication is the bottleneck of the AI age.

AI coding agents can multiply output 3x, 10x, 50x. But the input is still 1x — one human typing into one terminal, being the switchboard for every decision, every assignment, every "go do this." During a 2-3 hour hackathon at Tapcheck, every team hit the same wall: their humans couldn't coordinate fast enough to keep their AI tools fed and aligned. One developer was literally typing into three laptops simultaneously — solo-heroing the planning, then manually distributing work, then trying to keep three parallel streams from drifting apart, then putting it all back together.

The agents weren't the bottleneck. The human coordination layer was.

## What Open Hive Is Today (Post Phase 2)

A collision detection layer for AI-assisted dev teams:
- Sessions, signals, collision detection (L1 file, L2 directory, L3a/L3b/L3c semantic)
- Hexagonal architecture with four ports (Storage, Alerts, Identity, Semantic Analysis)
- Claude Code plugin that passively tracks developer activity
- 77 tests, CI pipeline, Docker deployment

It answers one question: **"Is someone else working where I'm working?"**

That's necessary. But it's the fire alarm, not the building code.

## The Ecosystem

Open Hive is one layer of a stack that's been forming across multiple projects:

| Layer | Project | Question |
|-------|---------|----------|
| Knowledge | Millennium / Ask Axiom | What does the org *know*? |
| Skill | ClawCraft.ai | What can agents *do*? |
| Awareness | Open Hive | What is everyone *doing*? |
| Orchestration | Open Workshop | What *should* we do? |

**Core principle: AI as representative, never replacement.** Every agent represents a human's stake in the organization's work. The agent acts with authority from its client (the human). Agents coordinate human work — they don't replace humans in the org structure.

**The communication thesis:** If A2A communication handles the *what* and *where* at machine speed, humans are freed to communicate about the things that actually matter: vision, priorities, tradeoffs, judgment. A2A handles coordination. Humans handle judgment.

## What The Research Found

### The Landscape (A2A Protocols)
- MCP (agent-to-tool) and A2A (agent-to-agent) are the emerging transport layers under the Linux Foundation
- Every major coding agent shipped multi-agent in Feb 2026 (Claude Code, Codex, Gemini, Windsurf)
- All implementations are proprietary. No cross-vendor coordination exists.
- **The gap: nobody owns the codebase-aware coordination layer**

### Executive Coordination Patterns
- The most effective coordination mechanisms achieve alignment WITHOUT synchronous human overhead
- Commander's intent: give the *why*, not the *how*. Enable autonomous action under uncertainty
- Delegation of *outcomes* not *tasks* is what scales
- Coordination through artifacts (RFCs, dashboards, golden paths) beats coordination through meetings

### Work Distribution Frameworks
- Seven universal coordination primitives (from military, biology, distributed systems): local rules → global behavior, information encoding, information decay, threshold activation, positive/negative feedback, emergent coherence
- **Stigmergy** — coordination through shared environment modification, not direct communication. Ants don't talk to each other. They modify the trail and others react.
- **Event sourcing is digital stigmergy** — a shared immutable log decouples actors in time and space
- **Commander's intent + autonomy** appears in military (Auftragstaktik), biology (motor cortex specifies goals not muscles), and software (OKRs cascade outcomes not tasks)

### Swarm Intelligence Mechanisms
- Bees: waggle dance encodes distance/direction/quality. Task allocation via response thresholds — no central assignment. The queen is a chemical beacon, not a manager.
- Ants: pheromone trail self-organizes into optimal paths. Trails *decay* — stale information evaporates. Positive feedback amplifies success, evaporation corrects errors.
- The minimal rule set for swarm coordination: write traces, read traces, threshold response, amplify success, let stale info decay, no central coordinator needed
- **The "every bee has a different beekeeper" problem has no biological analog.** Biology's swarms serve a single genetic interest. Our system has agents serving different humans. This is fundamentally new — the multi-principal coordination layer must be invented.

### Metaframework Core (Tapcheck Internal)
- Coherence is not a feature — it's the continuous work of staying aligned against entropy
- Make the context field EXPLICIT and agents operating within it naturally converge
- The MOC (Map of Context) as integration root — everything real must be reachable from here
- Validation gates: linked → validated → confirmed (human approval) before integration
- Buffer as externalized working memory that persists across sessions
- **Key insight: when patterns are implicit, changes can't propagate. When patterns are explicit, parallel workers can work independently and the field structure aligns their outputs.**

### Symbiotic Swarms and Fiction
Biology DOES solve multi-principal cooperation. Five structural patterns:
- **Mutual lock-in** — neither party survives alone (leaf-cutter ants + fungus, 50M years)
- **Shared medium as enforcer** — the network itself enforces cooperation; cheaters get cut off (mycorrhizal networks)
- **Reputation and audience effects** — public coordination surfaces enforce honest behavior (cleaner fish stations)
- **Complementary asymmetry** — participants contribute different capabilities, don't compete (mixed-species flocks)
- **Collective byproducts** — the coordination surface itself produces value no individual could create (coral reefs)

From fiction:
- **The Culture** — AI Minds don't replace humans, they create conditions for humans to thrive. Coordination through shared abundance.
- **The Tines** — inter-swarm diplomacy. When pack members get mixed, identity gets complicated. Our "different beekeeper" problem in fiction form.

**Critical design principle: protect the shared medium above all.** The hive itself — the coordination surface — is the most valuable thing. More valuable than any individual participant. If the medium degrades, everything collapses.

## The Four Options (A Spectrum)

These emerged from brainstorming and form an incremental spectrum:

### Option 1: Agent as Representative
Each human has an agent representative. Agents interact through the hive on behalf of their human's stakes. Coordination is emergent through protocol. Directives are set by an orchestrating monarch.

*This is the conventional path. Most shippable. Risk: becomes another PM tool with AI chrome.*

### Option 2: Humans Shape the Hive
Decouple from strict human-agent 1:1 binding. The AI becomes a "hive mind" — a shared environment that humans participate in manipulating. Humans supply directives and context; the AI moves in a direction. The hive has its own coherent state that's smarter than any individual contributor.

*Like a wiki with agency. Metaframework's "context field" concept lives here.*

### Option 3: The Hive Prompts Humans
Flip communication direction. The hive, having consumed project state and organizational context, prompts humans for what it needs. "Alice, Bob's auth work is stalled, you have relevant context, can you help?" Humans are orchestrated for judgment calls the AI can't make.

*Radical inversion. Requires deep organizational understanding (Option 4's foundation).*

### Option 4: Organizational Awareness
The AI understands the entire org — domain, people, strengths, relationships, history. It doesn't just track work; it understands WHY this person should work on THIS thing and HOW their contribution creates value.

*The full vision. Requires Millennium/Ask Axiom's knowledge layer feeding in.*

### The Insight: These Build On Each Other

```
Option 1  →  Option 2  →  Option 3  →  Option 4
Agent as     Humans       Hive         Organizational
rep          shape hive   prompts      awareness
                          humans
   ↑             ↑            ↑            ↑
Open Hive    + metafw    + context     + Millennium
today        context       sufficient    knowledge
             field         to ask        feeds in
```

**Architect the primitives for 4. Ship the surface of 1.**

The seven coordination primitives (signal store, decay, thresholds, feedback loops, stigmergy) don't change across options. What changes is what information flows through them and who initiates action.

## The Bet

**Open Hive becomes the stigmergic coordination surface for AI coding agents across an organization.**

Not a chat room for agents. Not a project management tool. **The pheromone trail.**

Agents (representing their human clients) write traces as they work — intent, files touched, areas, outcomes. Other agents read those traces and adapt — avoid collisions, pick up related work, stay coherent. Coordination is emergent from the shared environment, not from direct messaging or central assignment.

The hive is:
- **Vendor-agnostic** — Claude Code, Codex, Gemini, whatever. Register a session, follow the protocol.
- **Stigmergic** — coordination through shared state modification, not direct agent-to-agent communication
- **Decaying** — stale signals fade. The hive reflects current reality, not historical accumulation.
- **Multi-principal** — every agent serves a different human. Trust, attribution, and consent are first-class.
- **Emergent** — no central coordinator. Coherence comes from the primitives, not from a brain.

## What's Still Unknown

1. **The multi-principal problem.** Biology doesn't solve this — all swarm examples serve a single genetic interest. How do agents representing different humans (with potentially competing priorities) achieve cooperation through shared infrastructure? What prevents defection, free-riding, or information hoarding?

2. **The monarch question.** Option 1 mentions an "orchestrating monarch." Is there a leadership role in the hive? The queen bee isn't a manager — she's a chemical beacon that aligns the colony. Is there an equivalent in the digital hive? Is it the product owner? The CTO? An AI?

3. **The boundary problem.** Where does the hive end? One repo? One org? Multiple orgs? Open source projects with thousands of contributors? The scope changes the trust model completely.

4. **The information density problem.** Bees can only sense nearby pheromones. Digital agents can read the ENTIRE hive state. Does that help or hurt? Does full observability enable better coordination or cause information overload?

5. **Is this actually helpful?** We have a compelling theory and strong analogies. But does a team of 10 developers with AI agents actually coordinate better through stigmergic hive state than through Slack and Jira? The only way to know is to build it and test it.

## The Architectural Model (Post-Shower Clarity)

### The Brain Analogy

Open Hive is not a database with an API. It's a **living model of organizational work** — a giant state machine whose parts are managed by agentic AI to continually align, achieve cohesion, and perform action based on state change via reason rather than hard-coded pathways.

| Brain Concept | Open Hive Equivalent |
|---------------|---------------------|
| Consciousness / Awareness | The hive's internal state — who, what, where, why, how it all relates |
| Sensory nerves (afferent) | Inbound signals — agents reporting activity, intent, outcomes, blockers |
| Motor nerves (efferent) | Outbound instructions — alerts, context injections, coordination nudges |
| Internal state management | Processing incoming signals to update the model of reality — understanding relationships and implications, not just storing rows |
| Nerve endpoints | Different integration types — Claude Code plugin, Open Workshop adapter, CI/CD webhooks, Jira sync, etc. |

### The v1 → v2 Shift

**v1 (current):** Claude Code is both the nerve AND the brain. It sends data up, gets data back, processes it, decides what to do. The hive is dumb storage. Every instance independently reasons about organizational state. 15 agents = 15 redundant brains, 0 shared understanding.

**v2 (target):** The hive IS the brain. Each connected agent is a nerve that both sends sensory data AND carries out motor instructions. The hive receives, processes, and distributes information. Agents perform actions based on the hive's processed understanding, not their own independent reasoning about raw data.

### Distributed Consciousness (The Cost Insight)

The hive doesn't run on one massive always-on model. It runs on the **distributed compute of all agents already connected to it.**

Each Claude Code instance (or any connected agent) donates a small slice of its reasoning capacity to hive maintenance as part of its normal operation. When an agent checks in:
1. It reports its local sensory data (what it sees)
2. It does a small unit of hive processing (update a piece of the shared understanding)
3. It receives back a processed, reasoned view of relevant organizational context
4. It carries out any motor instructions (alerts, context sharing, coordination)

```
v1: 15 agents × (full brain each) = 15 redundant brains, massive individual cost
v2: 15 agents × (small hive contribution) = 1 shared brain, distributed cost
```

15 Claude Code instances each using 15% of their capacity for hive work is vastly cheaper than one massive model maintaining the entire organizational consciousness. And it scales naturally — more agents = smarter hive, paid for by the agents themselves.

This is exactly how biological swarms work. No individual bee maintains the colony's intelligence. The intelligence is a byproduct of every bee doing its local job.

### What the Hive Maintains (Internal State)

The hive's consciousness is a continuously-updated model of:
- **Who** — registered agents, their human clients, teams, roles
- **What** — active work streams, declared intents, files/areas being modified
- **Where** — which repos, services, areas of the codebase are active
- **When** — temporal awareness: what's fresh, what's stale (signal decay)
- **Why** — organizational goals, project context (fed from Millennium/Ask Axiom)
- **How it relates** — connections between work streams, dependencies, overlaps, gaps

This isn't a flat table of sessions. It's a **relational understanding** that gets richer with every signal and every agent's processing contribution.

### Richer Nerve Types (Beyond Claude Code)

The current hive has one nerve type: Claude Code plugin. The v2 hive needs many:
- **Coding agents** (Claude Code, Codex, Gemini, Windsurf) — intent, file activity, semantic overlap
- **Project management** (Jira, Linear, GitHub Issues) — ticket state, assignments, blockers
- **CI/CD** (GitHub Actions, Azure Pipelines) — build results, deployment state
- **Communication** (Slack, Teams) — decisions made, questions asked
- **Knowledge** (Millennium/Ask Axiom) — organizational memory, domain expertise

Each nerve type has its own signal format but writes to the same hive state. The hive's processing layer understands how a Jira ticket moving to "Done" relates to a Claude Code session that was working on that ticket's files.

### Richer Motor Output (Beyond Collision Alerts)

v1 motor output: "You're colliding with Bob on auth.ts."

v2 motor output:
- "Alice finished the auth refactor yesterday — here's the context you need"
- "This work overlaps with JIRA-1234 which is assigned to Charlie's team"
- "Three people have touched this area in the last week — here's the current state"
- "Your intent matches an open RFC — read it before proceeding"
- "This area has no test coverage — consider that before modifying"

The hive doesn't just detect collisions. It **surfaces relevant organizational context** that no individual agent would have on its own.

## How the Ecosystem Plugs In

Open Workshop doesn't need to BECOME Open Hive. It needs to SPEAK HIVE.

- **Open Workshop** → registers as a nerve. Reports project state, milestone progress, team allocation. Receives organizational context back. Becomes aware of other teams' work.
- **ClawCraft** → defines HOW new nerve types onboard. The skill file spec teaches any agent system how to register, what signals to emit, what data to consume. The universal adapter.
- **Millennium / Ask Axiom** → feeds organizational knowledge INTO the hive. Not a nerve (it doesn't do work) but a knowledge source. The hive's long-term memory vs the nerves' real-time sensory data.

The protocol — "speaking hive" — is the key deliverable. It defines:
- How agents register (identity, capabilities, human client)
- What signals they emit (and in what format)
- What processing they contribute (hive maintenance work units)
- What context they receive back (and how to use it)

## Phase 3 Scope — From Collision Detector to Coordination Layer

### What We're Building
Evolve Open Hive from a collision detection tool into an organizational coordination layer. The hive becomes a living state machine that maintains awareness of all registered work, processes signals from multiple nerve types, and returns enriched context to agents.

### M1: Richer Signal Taxonomy
Expand the signal types beyond `file_modify` / `file_read` / `prompt`:
- `intent_declared` — what the agent's human wants to accomplish
- `outcome_achieved` — work completed, merged, deployed
- `blocker_hit` — something is stuck
- `context_needed` — agent doesn't have enough information to proceed
- `dependency_discovered` — this work depends on something else
- `state_report` — periodic snapshot of current work state (from Open Workshop)

### M2: Signal Decay + Temporal Awareness
Signals have a half-life. Fresh signals are strong; stale ones fade. The hive's internal state reflects *current* reality, not historical accumulation. Configurable per signal type — an active collision decays slower than a completed intent.

### M3: Relevance-Filtered Check-In
When an agent checks in, the hive doesn't just return collisions. It returns: "here's what changed across the org that's relevant to YOUR work." This requires the hive to understand relationships between work streams — which is where the processing layer begins.

### M4: Agent Mail (Pheromone Trail)
Persistent inter-agent messages that survive session boundaries. When Bob's Claude Code detects a potential overlap with Alice's project, it can leave a message that Alice's Claude Code picks up on next check-in. Asynchronous. Decaying. The digital pheromone trail.

### M5: Nerve Registration Protocol
Define "speaking hive" — the contract for any agent or tool to connect:
- Register: identity, human client, capabilities (sensory and/or motor)
- Emit: standardized signal format
- Consume: relevance-filtered context
- Capability declaration via skill files (ClawCraft pattern)

### M6: Second Nerve Type
Build one more nerve beyond Claude Code. Open Workshop is the natural candidate — it already tracks projects and coordinates work. Making it hive-aware validates the protocol with a fundamentally different agent type and proves the nerve model works.

### Future (not Phase 3)
- Motor nerve dispatch (hive instructs external tools to take action)
- PM tool ingestion (Jira/Linear as sensory nerves)
- Communication nerve (Teams/Slack bot as sensory + motor)
- Hive processing layer with specialized models for reasoning about organizational state
- HiveDrone pattern for orchestrating motor actions across nerve types

---

## The Concrete Scenario (Alice's Morning)

This scenario grounds the entire vision in a real workday:

1. Alice opens Claude Code. The open-hive plugin checks in — reviews yesterday's work via local Open Workshop state, reports current state to the hive backend with a timestamp.

2. The hive returns what's changed across the org that's relevant to Alice: Charlie (her PM) finished the PRD edits she was waiting on — that work is ready to pick up. AND Bob (engineer, different department) started planning something that overlaps with Alice's Project Y — he may reach out to coordinate.

3. Claude Code shows a summary dashboard: "Charlie's PRD is ready. Bob may have overlapping work on Project Y. What should we work on first?"

4. Alice asks about Bob's work. Claude Code queries the hive and finds that Bob's agent left **Agent Mail** — a persistent message (pheromone trail) detailing the problem space Bob discussed with his Claude Code before it was flagged as a possible collision.

5. Alice and Claude brainstorm how Project Y could solve Bob's problem.

6. Alice decides she'd rather talk to Bob directly. Claude Code tells the hive.

7. The hive dispatches an instruction to the org's **Teams bot** (already registered as a motor nerve) to create a group chat between Alice and Bob with the relevant context. The conversation is tracked back to the hive for resolution.

**Every decision point is human.** Alice decides what to work on. Alice decides to talk to Bob directly vs. leaving a message. The hive surfaces, connects, and facilitates. Humans judge and decide.

### What This Scenario Requires

| Capability | Status |
|-----------|--------|
| Agent check-in with state report | Exists (Open Hive signals API) |
| Local work state tracking | Exists (Open Workshop) |
| "What changed that's relevant to me" query | NEW — relevance-filtered org changes |
| PM tool state ingestion | NEW — Jira/Linear nerve type |
| Cross-project semantic overlap detection | Partially exists — needs to work across project registries |
| Agent Mail (persistent inter-agent messages) | NEW — pheromone trail that survives session boundaries |
| Summary dashboard in Claude Code | Plugin UI enhancement |
| Hive context query about another agent's work | Partially exists (history endpoint) |
| Motor nerve dispatch (tell Teams bot to act) | NEW — hive instructs registered motor nerves |
| Conversation tracking back to hive | NEW — communication nerve ingests external conversations |

### The Nerve Model

**The hive doesn't build integrations. It coordinates existing ones.**

Orgs already have bots, tools, and AI systems. Each one registers with the hive as a nerve:

| Existing Org Tool | Registers As | Sensory (inbound) | Motor (outbound) |
|-------------------|-------------|-------------------|-------------------|
| Claude Code | Coding nerve | Intent, file activity, outcomes | Context injection, collision alerts |
| Teams/Slack bot | Communication nerve | Conversation summaries, decisions | Create chats, send messages, post updates |
| Jira/Linear bot | Project nerve | Ticket state changes, assignments | Create tickets, update status, assign work |
| CI/CD pipeline | Build nerve | Build results, deploy status | Trigger builds, gate deployments |
| Open Workshop | Orchestration nerve | Project state, milestone progress | Work distribution, priority updates |

Each nerve is a specialist. The hive knows what each nerve can do via **skill files** (ClawCraft pattern). The hive doesn't know the Teams API — it knows "the Teams nerve can create group chats, here's the signal format to request one."

### The Product Definition

**Open Hive is ERP software where AI is the point of contact for coordinating work across an organization.**

SAP and Oracle coordinate resources through forms and workflows that humans navigate. Open Hive coordinates resources through AI agents that humans talk to. The AI doesn't replace the human in the org structure — it represents them, surfaces relevant context, connects related work, and facilitates coordination at machine speed so humans can focus on judgment.

## Ten Design Principles (from symbiotic swarms research)

1. **Coordinate through the environment, not direct negotiation** — stigmergy over messaging
2. **Embrace asymmetry** — participants contribute different things, and that's the strength
3. **Trust through structure, not intention** — the protocol enforces cooperation, not goodwill
4. **Protect the shared medium above all** — the hive is more valuable than any participant
5. **The protocol shapes the participants** — how you communicate changes how you think (Arrival)
6. **Maintain diversity** — monocultures collapse; diverse contributors create resilient systems
7. **Build in intermediary roles** — mycorrhizal fungi, cleaner fish; some actors exist to connect others
8. **Design for emergence, not command** — set conditions, don't dictate outcomes
9. **Plan for incomprehension** — not all participants will understand each other fully (Solaris)
10. **Vertical transmission for value alignment** — culture, onboarding, and shared context propagate values better than rules

---

*This document captures the state of thinking as of 2026-03-06. It is a thesis, not a spec. All six research documents are complete.*

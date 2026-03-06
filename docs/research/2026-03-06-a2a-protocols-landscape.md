# Agent-to-Agent Communication: Protocol Landscape Research

**Date:** 2026-03-06
**Status:** Foundational research for product vision
**Field velocity:** Extremely high -- major shifts occurred in the two-week window of Feb 2026 alone

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Existing A2A / Multi-Agent Protocols](#1-existing-a2a--multi-agent-protocols)
3. [Message Formats and Shared State](#2-message-formats-and-shared-state)
4. [Agent Identity and Trust](#3-agent-identity-and-trust)
5. [Real-World Multi-Agent Deployments](#4-real-world-multi-agent-deployments)
6. [The Open Question: Standards Convergence](#5-the-open-question-standards-convergence)
7. [Protocol Comparison Matrix](#6-protocol-comparison-matrix)
8. [Implications for Coding Agents](#7-implications-for-coding-agents)
9. [Sources](#sources)

---

## Executive Summary

The multi-agent communication landscape in early 2026 is rapidly consolidating around two complementary protocols under the Linux Foundation's Agentic AI Foundation (AAIF):

- **MCP (Model Context Protocol)** -- vertical: how an agent connects to tools, data, and APIs
- **A2A (Agent-to-Agent Protocol)** -- horizontal: how agents communicate with each other

These are not competitors. MCP standardizes capability access; A2A standardizes agent collaboration. Together they form an emerging two-layer stack. IBM's ACP (Agent Communication Protocol) has merged into A2A. NIST launched the AI Agent Standards Initiative in February 2026. AGENTS.md provides a third layer: project-specific context for coding agents.

Meanwhile, the frameworks (AutoGen/Microsoft Agent Framework, LangGraph, CrewAI, OpenAI Agents SDK) are converging on similar patterns but remain runtime-specific. No universal "agent runtime" exists. The protocol layer (MCP + A2A) is the point of convergence.

For coding agents specifically, February 2026 was the inflection point: Claude Code Agent Teams, Windsurf parallel agents, Grok Build (8 agents), Codex CLI, and Devin all shipped multi-agent in the same two-week window. Git worktrees are the de facto isolation primitive. There is no standard protocol for coding agents to coordinate -- they all use proprietary implementations.

---

## 1. Existing A2A / Multi-Agent Protocols

### 1.1 Google's A2A (Agent-to-Agent Protocol)

**What it is:** An open protocol for communication and interoperability between opaque agentic applications. Launched April 2025, now under the Linux Foundation.

**What it defines:**
- **Discovery:** Agent Cards -- JSON metadata documents published at `/.well-known/agent.json` describing identity, capabilities, skills, endpoint, and auth requirements
- **Communication:** JSON-RPC 2.0 over HTTP, with SSE (Server-Sent Events) for streaming
- **Task lifecycle:** Tasks are the fundamental work unit, identified by unique ID, progressing through defined states
- **Message format:** Messages have a role ("user" or "agent") and contain one or more Parts (text, data, files)
- **Streaming:** SSE with each data field containing a complete JSON-RPC 2.0 Response object
- **Security:** Agent Cards include authentication requirements; recent updates add signed security cards and gRPC support

**What it doesn't define:**
- Agent internal architecture or reasoning
- Shared memory or state between agents (agents are treated as opaque)
- How agents use tools (that's MCP's domain)
- Trust hierarchies beyond authentication

**Adoption status:** Production-ready. 50+ technology partners (Atlassian, Salesforce, SAP, ServiceNow, PayPal, etc.). Under Linux Foundation governance. IBM's ACP merged into A2A. Python SDK available, gRPC support added.

**Relevance to coding agents:** A2A could enable coding agents from different vendors to delegate subtasks to each other (e.g., Claude Code delegating a security review to a specialized agent). The Agent Card discovery mechanism is directly applicable.

### 1.2 Anthropic's MCP (Model Context Protocol)

**What it is:** An open standard for connecting AI models to tools, data sources, and APIs. Released November 2024, donated to AAIF December 2025.

**What it defines:**
- **Tool integration:** Standardized way for an agent to discover and invoke tools
- **Resource access:** How agents read from data sources
- **Prompts:** Reusable prompt templates
- **Transport:** stdio and HTTP+SSE transports
- **Capability negotiation:** Client-server capability handshake

**What it doesn't define:**
- Agent-to-agent communication (that's A2A's domain)
- Task delegation between agents
- Agent identity or trust
- Shared state management

**Adoption status:** Industry standard. 10,000+ public MCP servers. Adopted by ChatGPT, Cursor, Gemini, VS Code, Copilot. 97 million monthly SDK downloads (Dec 2025). The de facto winner for model-to-tool connectivity.

**Relevance to coding agents:** MCP is already how coding agents (Claude Code, Cursor, etc.) connect to file systems, Git, databases, and external APIs. It's the plumbing layer, not the coordination layer.

### 1.3 Microsoft AutoGen / Agent Framework

**What it is:** Originally AutoGen v0.4 (2025), now converging with Semantic Kernel into the unified "Microsoft Agent Framework" targeting GA by Q1 2026.

**What it defines:**
- **Agent abstractions:** Typed agents with async message passing
- **Communication:** Event-driven, distributed architecture using Microsoft Orleans
- **Orchestration patterns:** Graph-based workflows for multi-agent coordination
- **State management:** Session-based state management with middleware and telemetry
- **Cross-language:** Python and .NET support

**What it doesn't define:**
- A wire protocol for cross-vendor agent communication
- Agent discovery (agents must be registered within the same runtime)
- Trust or identity beyond the runtime

**Adoption status:** AutoGen and Semantic Kernel are in maintenance mode. Microsoft Agent Framework targeting 1.0 GA by end of Q1 2026. Production-oriented but Microsoft-ecosystem-centric.

**Relevance to coding agents:** Relevant for .NET/enterprise shops building internal multi-agent systems. Not a protocol standard -- it's a runtime framework.

### 1.4 LangGraph (LangChain)

**What it is:** A graph-based orchestration framework for multi-agent systems. Part of the LangChain ecosystem.

**What it defines:**
- **State graph:** Agents are nodes in a graph; edges define control flow
- **Shared state:** Centralized state object that all nodes can read/write
- **Patterns:** Scatter-gather, pipeline parallelism, reflection loops, supervisor, swarm
- **Conditional routing:** State-based conditional edges for dynamic flow
- **Human-in-the-loop:** Pause/resume at any node for human review
- **Persistence:** Checkpoint-based state persistence

**What it doesn't define:**
- Cross-runtime communication
- Agent discovery
- Trust or identity

**Adoption status:** Production. A2A endpoint support via LangChain server. Becoming the go-to for Python-based multi-agent orchestration. Active community.

**Relevance to coding agents:** Good for building internal multi-agent coding workflows (e.g., plan -> code -> review -> test pipeline). Not a protocol for inter-vendor coordination.

### 1.5 CrewAI

**What it is:** A role-based multi-agent orchestration framework emphasizing team metaphors.

**What it defines:**
- **Crews:** Autonomous teams where agents have defined roles, goals, and backstories
- **Flows:** Event-driven production architecture for enterprise deployments
- **Task execution:** Sequential, parallel, and conditional processing
- **Delegation:** Agents can delegate to other agents within the crew
- **Memory:** Short-term, long-term, and entity memory for agents

**What it doesn't define:**
- Cross-framework communication
- Wire protocol
- Agent discovery beyond the crew
- Trust or identity

**Adoption status:** Production. Widely adopted. Lowest barrier to entry for multi-agent prototyping. Independent of LangChain.

**Relevance to coding agents:** Good for rapid prototyping of coding agent teams (reviewer, coder, tester roles). Not a protocol for cross-vendor coordination.

### 1.6 OpenAI Agents SDK (successor to Swarm)

**What it is:** Production-ready evolution of OpenAI Swarm. Released March 2025.

**What it defines:**
- **Five primitives:** Agents, Handoffs, Guardrails, Sessions, Tracing
- **Handoffs:** Full conversation transfer between agents (not agent-as-tool)
- **Guardrails:** Input/output validation for safety
- **Tracing:** Built-in observability
- **Provider-agnostic:** Documented paths for non-OpenAI models

**What it doesn't define:**
- Wire protocol for external agent communication
- Agent discovery
- Trust beyond the runtime
- Shared state beyond conversation history

**Adoption status:** Production. 19k+ GitHub stars. Python and TypeScript SDKs. Temporal integration for durable execution.

**Note on Swarm:** The original Swarm (Oct 2024) was explicitly educational/experimental. OpenAI never supported it for production. It's been fully superseded.

**Relevance to coding agents:** The Handoff primitive is directly relevant -- it's how Codex CLI agents transfer tasks. But it's OpenAI-ecosystem-specific.

### 1.7 FIPA (Foundation for Intelligent Physical Agents) -- Historical Context

**What it was:** A 1996-era Swiss nonprofit that defined standards for agent platforms and communication. IEEE-backed. Based on speech act theory.

**Why it matters historically:**
- Defined Agent Communication Language (ACL) based on speech acts (inform, request, propose, etc.)
- Defined agent platform architecture (Directory Facilitator, Agent Management System)
- Implemented in JADE (Java Agent DEvelopment Framework)

**Why it failed:**
1. **Interoperability never materialized** -- platforms claimed FIPA compliance but couldn't actually interoperate
2. **Ontology complexity** -- maintaining shared ontologies across agent systems was unsustainable at scale
3. **Semantic specification was too rigid** -- using mental state (beliefs, desires, intentions) to define message semantics didn't map to practical systems
4. **Too academic** -- commercial interest evaporated as the agent hype cycle of the early 2000s ended
5. **Wrong abstraction level** -- tried to standardize agent internals, not just the wire protocol

**Lesson for today:** A2A learned from FIPA. A2A treats agents as opaque (no internal state specification), uses standard web technologies (HTTP, JSON-RPC), and focuses on the minimum viable wire protocol rather than agent architecture.

---

## 2. Message Formats and Shared State

### 2.1 How Existing Systems Share Context

| System | Context Sharing Model | Shared State Mechanism |
|--------|----------------------|----------------------|
| **A2A** | Message passing (opaque agents) | No shared state -- agents exchange messages with Parts |
| **MCP** | Tool invocation results | Server maintains resources; client reads them |
| **AutoGen/Agent Framework** | Async messages + shared blackboard | Orleans-based distributed state |
| **LangGraph** | Centralized state graph | Single state object all nodes read/write |
| **CrewAI** | Role-based delegation + memory | Short/long-term/entity memory stores |
| **OpenAI Agents SDK** | Conversation handoff | Conversation history transferred on handoff |
| **Claude Code Agent Teams** | Mailbox system + shared task list | JSON files on disk per agent |

### 2.2 What a "Message" Looks Like

**A2A Message:**
```json
{
  "jsonrpc": "2.0",
  "id": "msg-001",
  "method": "message/send",
  "params": {
    "message": {
      "role": "user",
      "parts": [
        {"kind": "text", "text": "Review this pull request"},
        {"kind": "data", "data": {"pr_url": "https://..."}}
      ]
    }
  }
}
```

**MCP Tool Call:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "read_file",
    "arguments": {"path": "/src/main.py"}
  }
}
```

**LangGraph:** State is a Python dict/TypedDict passed between nodes. Messages are function calls with the state object.

**CrewAI:** Tasks are Python objects with description, expected_output, and agent assignment. Inter-agent communication happens through the framework runtime.

**Claude Code Agent Teams:** JSON files at `~/.claude/{teamName}/inboxes/{agentName}.json` -- each agent polls its inbox file for new messages from teammates.

### 2.3 Shared State Patterns

Three dominant patterns have emerged:

1. **Blackboard Pattern** -- A shared knowledge base that agents read from and write to asynchronously. Used by LangGraph (state graph), Claude Code Agent Teams (shared task list), and academic multi-agent systems. Benefits: decoupled agents, consistent view of progress. Drawbacks: potential for conflicts, requires coordination on writes.

2. **Event Log / Stream** -- An immutable append-only log that agents consume. Used by AutoGen (Orleans events), Confluent's event-driven multi-agent patterns. Benefits: replayable, auditable, natural ordering. Drawbacks: eventual consistency, growing log size.

3. **Direct Message Passing** -- Peer-to-peer communication without shared state. Used by A2A, OpenAI Agents SDK (handoffs). Benefits: simplicity, clear ownership. Drawbacks: no global view of system state, harder to debug.

### 2.4 Agent Discovery

| System | Discovery Mechanism |
|--------|-------------------|
| **A2A** | Agent Cards at `/.well-known/agent.json` -- HTTP-based, similar to `.well-known` patterns |
| **MCP** | Server capability negotiation during connection handshake |
| **AutoGen** | Runtime registry (agents registered at startup) |
| **LangGraph** | Compile-time graph definition |
| **CrewAI** | Crew definition (agents defined at crew creation) |
| **OpenAI Agents SDK** | Code-level handoff definitions |

A2A's Agent Card approach is the only one designed for cross-vendor, runtime-independent discovery.

---

## 3. Agent Identity and Trust

### 3.1 Current State of Agent Identity

This is the least mature area of the stack. Key developments in 2025-2026:

**Microsoft Entra Agent ID (Build 2025):** Every agent created with Copilot Studio or Azure AI Foundry automatically gets an identity object in the tenant directory. Agents become first-class identity principals alongside users and service accounts.

**Amazon Bedrock AgentCore Identity:** Centralized agent identity management with SigV4, OAuth 2.0 flows, and API key support for AWS and third-party service integration.

**A2A Agent Cards:** Include authentication requirements (OAuth, API keys) but don't define the identity model itself. Agent Cards can now be cryptographically signed.

**Agentic JWT (A-JWT):** An emerging research protocol (arxiv 2509.13597) that embeds an agent's identity as a hash of its prompt, tools, and configuration into a JWT. Uses per-agent proof-of-possession keys to prevent replay and impersonation.

### 3.2 Trust Models

| Approach | Who Uses It | How It Works |
|----------|------------|-------------|
| **OAuth 2.0 client credentials** | Azure, AWS, A2A | Agent authenticates as a service principal |
| **JWT with agent claims** | Research, Keycloak 26.5 | JWT carries agent identity, capabilities, and delegation chain |
| **Signed Agent Cards** | A2A (recent) | Agent's capability manifest is cryptographically signed |
| **Identity chaining (RFC 7523 + RFC 8693)** | Cross-domain scenarios | JWT Authorization Grant + Token Exchange for multi-domain delegation |
| **Runtime trust** | CrewAI, LangGraph, AutoGen | Implicit trust -- all agents in the same runtime are trusted |

### 3.3 Open Gaps in Trust

- **No standard for "this agent represents this user"** -- delegation semantics are undefined across protocols
- **No capability-based trust** -- "I trust you to read files but not deploy code" doesn't exist at the protocol level
- **No reputation system** -- there's no way for agents to build or verify trust over time
- **Output verification** -- no standard way to verify an agent's output is correct, unmodified, or within scope
- **The "confused deputy" problem** -- an agent acting on behalf of a user could be manipulated by another agent's output

### 3.4 Identity Standardization Efforts

The OpenID Foundation published "Identity Management for Agentic AI" (October 2025). Keycloak 26.5 (January 2026) added JWT Authorization Grant and Identity Chaining. NIST's AI Agent Standards Initiative (February 2026) includes agent security as one of three pillars.

---

## 4. Real-World Multi-Agent Deployments

### 4.1 Enterprise Production Status

The numbers are sobering:
- **62%** of enterprises are experimenting with agentic AI
- **Only 14%** have production-ready implementations
- **40%** of multi-agent pilots fail within 6 months of production deployment
- **>40%** of agentic AI projects predicted to be cancelled by end of 2027 (Gartner)
- **64%** of companies with >$1B revenue have lost >$1M to AI failures

### 4.2 Common Failure Modes

1. **Data completeness** -- Agents deployed on structured data alone see only ~20% of the picture. They act with high confidence at scale, compounding damage.
2. **Governance gaps** -- Agents given power to act without rules to act by. No guardrails on scope or escalation.
3. **Legacy system integration** -- APIs and data pipelines can't support modern agent execution demands. Bottlenecks kill throughput.
4. **Coordination complexity** -- Clean multi-agent architecture quickly becomes a complex web of dependencies. What works in pilot (50-500 queries) breaks in production (10k-100k daily).
5. **Observability** -- 86% of organizations report no visibility into AI data flows. Shadow AI (estimated 1,200 unofficial AI apps per enterprise) makes this worse.
6. **Pilot-to-production gap** -- Controlled pilot conditions mask edge cases, concurrency issues, and real business stakes.

### 4.3 Coding Agents That Coordinate

**February 2026 was the inflection point.** In the same two-week window:

| Tool | Multi-Agent Capability | Architecture |
|------|----------------------|-------------|
| **Claude Code Agent Teams** | Lead + teammates with mailbox system | JSON file-based message passing, git worktrees, shared task list with dependency tracking |
| **Windsurf Wave 13** | 5 parallel Cascade agents | Git worktrees, side-by-side panes, dedicated terminal profiles |
| **Grok Build** | 8 parallel agents + Arena Mode | Parallel exploration; Arena Mode has agents compete on same problem, best solution wins |
| **OpenAI Codex CLI** | Agents SDK integration | Handoff-based delegation |
| **Devin** | Parallel sessions | Sandboxed cloud environments, each with own IDE/browser/terminal |

**Key observations:**
- Git worktrees are the universal isolation primitive for coding agents
- No cross-vendor coordination exists -- you can't have Claude Code delegate to Devin
- Each tool uses proprietary coordination (file-based mailboxes, internal APIs, etc.)
- The "multi" in multi-agent currently means "multiple instances of the same agent," not "different agents cooperating"

### 4.4 IDE Multi-Agent Support

- **GitHub Copilot Workspace:** Agent-based system with specialized AI agents for different tasks (planning, coding, reviewing). Not multi-agent in the cross-vendor sense.
- **Cursor:** Emphasizes developer control with AI assistance. No explicit multi-agent support; single-agent with tool use.
- **Windsurf:** 5 parallel Cascade agents as of Wave 13. Git worktree integration. Closest to true multi-agent among IDEs.
- **Augment Code (Intent):** Spec-driven agent approach, different architecture from Windsurf's parallel model.

---

## 5. The Open Question: Standards Convergence

### 5.1 Is There an Emerging Standard?

**Yes, but it's a stack, not a single protocol.**

The Agentic AI Foundation (AAIF), formed December 2025 under the Linux Foundation, houses the emerging standard stack:

| Layer | Standard | Owner | Status |
|-------|---------|-------|--------|
| **Agent-to-Tool** | MCP | AAIF (Anthropic origin) | Production. Industry standard. |
| **Agent-to-Agent** | A2A | AAIF (Google origin, ACP merged in) | Production. 50+ partners. |
| **Agent Context** | AGENTS.md | AAIF (originally by community) | Adopted by 20k+ repos. |
| **Agent Runtime** | goose | AAIF (Block origin) | Open source, local-first. |

Additional standardization:
- **NIST AI Agent Standards Initiative** (Feb 2026): Three pillars -- industry standards, open-source protocols, agent security research
- **OpenID Foundation**: Identity Management for Agentic AI (Oct 2025)
- **Domain-specific:** UCP (Universal Commerce Protocol) for agentic commerce, co-developed by Google, Shopify, and 20+ retail/payment partners

### 5.2 What a Universal Agent Interaction Protocol Needs

Based on everything in this research, a complete agent interaction protocol stack must define:

**Layer 1 -- Discovery:**
- How do agents find each other? (A2A Agent Cards solve this)
- What capabilities does an agent advertise? (A2A Agent Cards)
- How does capability information stay current? (Partially solved)

**Layer 2 -- Communication:**
- Wire format for messages (A2A: JSON-RPC 2.0 over HTTP)
- Streaming for long-running tasks (A2A: SSE)
- Multimodal content (A2A: Parts with text, data, files)

**Layer 3 -- Task Management:**
- Task lifecycle (A2A: created -> working -> completed/failed)
- Task delegation and handoff
- Progress reporting and cancellation

**Layer 4 -- Identity and Trust:**
- Agent authentication (OAuth 2.0, partially solved)
- Delegation chains ("this agent acts on behalf of this user") -- UNSOLVED
- Capability-based authorization ("this agent can read but not write") -- UNSOLVED
- Output verification and attestation -- UNSOLVED

**Layer 5 -- State and Context:**
- How agents share working context (no standard)
- Shared artifacts (files, data) -- ad hoc today
- Conflict resolution when agents modify the same resources -- UNSOLVED

**Layer 6 -- Observability:**
- Distributed tracing across agent interactions
- Audit logging
- Cost attribution

### 5.3 Minimum Viable Protocol for Two Coding Agents on the Same Codebase

Based on current practice (Claude Code Agent Teams, Windsurf, community patterns), the minimum viable protocol requires:

1. **Isolation:** Git worktrees -- each agent gets its own branch and working directory. This is non-negotiable; it's the only proven approach.

2. **Task assignment:** A shared task list with:
   - Task ID, description, status (pending/active/done/failed)
   - Dependency declarations (task B depends on task A)
   - File scope (which files/directories this task touches)

3. **Communication:** A mailbox or message queue per agent:
   - Structured messages (not free-form text)
   - At minimum: task_complete, task_failed, need_info, file_conflict notifications

4. **Conflict detection:** Awareness of file overlap:
   - Before starting: check if another agent's active task touches the same files
   - At merge time: Git handles structural conflicts, but semantic conflicts need agent review

5. **Merge protocol:** How completed work reunifies:
   - Each agent commits to its own branch
   - Lead agent or human reviews and merges
   - Failed branches can be discarded trivially

**What's notably absent from today's implementations:**
- No cross-vendor coordination (Claude Code can't talk to Codex)
- No semantic conflict detection (only Git-level merge conflicts)
- No shared understanding of codebase architecture (each agent starts from scratch or reads AGENTS.md)
- No cost/token budgeting across agents

---

## 6. Protocol Comparison Matrix

| Dimension | A2A | MCP | AutoGen/MAF | LangGraph | CrewAI | OpenAI Agents SDK | FIPA |
|-----------|-----|-----|-------------|-----------|--------|-------------------|------|
| **Communication** | Yes (JSON-RPC) | Tool calls only | Async messages | State graph | Delegation | Handoffs | ACL |
| **Discovery** | Agent Cards | Capability negotiation | Runtime registry | Compile-time | Crew definition | Code-level | Directory Facilitator |
| **Trust/Identity** | OAuth + signed cards | None | None | None | None | None | None (theoretical) |
| **Shared State** | None (opaque) | Resources | Orleans state | Central state | Agent memory | Conversation | Blackboard |
| **Wire Protocol** | HTTP + JSON-RPC | stdio/HTTP+SSE | Internal | Internal | Internal | Internal | IIOP/HTTP |
| **Cross-Vendor** | Yes | Yes | No | No | No | No | Theoretically |
| **Streaming** | SSE | SSE | Events | N/A | N/A | N/A | N/A |
| **Governance** | Linux Foundation | Linux Foundation | Microsoft | LangChain | CrewAI Inc | OpenAI | IEEE (defunct) |
| **Status** | Production | Production | Pre-GA | Production | Production | Production | Abandoned |

---

## 7. Implications for Coding Agents

### What Exists Today
- MCP is the standard for tool access (file read/write, git, APIs)
- A2A is the standard for agent-to-agent messaging
- AGENTS.md is the standard for project-specific agent context
- Git worktrees are the de facto isolation mechanism
- All coding agent multi-agent implementations are proprietary

### What's Missing
1. **A coding-agent-specific coordination protocol** -- something between A2A (too generic) and Claude Code Agent Teams (too proprietary)
2. **Cross-vendor agent delegation** -- "Claude Code, delegate this security review to Snyk's agent" doesn't exist
3. **Semantic conflict awareness** -- knowing that two agents are modifying related logic even if they're in different files
4. **Shared architectural understanding** -- agents need a common model of the codebase beyond AGENTS.md
5. **Token/cost coordination** -- no way to budget across parallel agents
6. **Standardized merge protocol** -- how to reconcile work from multiple agents

### The Opportunity
The gap between "protocols that exist" (MCP, A2A) and "what coding agents actually need" is where innovation is possible. A system that:
- Uses MCP for tool access
- Uses A2A for agent-to-agent messaging
- Adds a codebase-aware coordination layer on top
- Implements conflict detection beyond Git merge conflicts
- Provides cross-vendor agent delegation

...would be novel and valuable. No one has built this yet.

---

## Sources

### A2A Protocol
- [Announcing the Agent2Agent Protocol (A2A) - Google Developers Blog](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)
- [What Is Agent2Agent (A2A) Protocol? | IBM](https://www.ibm.com/think/topics/agent2agent-protocol)
- [Agent2Agent Protocol Getting an Upgrade | Google Cloud Blog](https://cloud.google.com/blog/products/ai-machine-learning/agent2agent-protocol-is-getting-an-upgrade)
- [A2A Protocol Specification](https://a2a-protocol.org/latest/specification/)
- [Linux Foundation Launches A2A Protocol Project](https://www.linuxfoundation.org/press/linux-foundation-launches-the-agent2agent-protocol-project-to-enable-secure-intelligent-communication-between-ai-agents)
- [GitHub - a2aproject/A2A](https://github.com/a2aproject/A2A)

### MCP
- [Introducing the Model Context Protocol - Anthropic](https://www.anthropic.com/news/model-context-protocol)
- [MCP Specification (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25)
- [Donating MCP and Establishing AAIF - Anthropic](https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation)
- [Why the Model Context Protocol Won - The New Stack](https://thenewstack.io/why-the-model-context-protocol-won/)
- [A Year of MCP: From Internal Experiment to Industry Standard](https://www.pento.ai/blog/a-year-of-mcp-2025-review)

### MCP vs A2A
- [MCP vs A2A: Protocols for Multi-Agent Collaboration 2026](https://onereach.ai/blog/guide-choosing-mcp-vs-a2a-protocols/)
- [A2A vs MCP: Two Complementary Protocols - Logto](https://blog.logto.io/a2a-mcp)
- [MCP vs A2A - Auth0](https://auth0.com/blog/mcp-vs-a2a/)
- [MCP vs A2A - Descope](https://www.descope.com/blog/post/mcp-vs-a2a)

### Microsoft AutoGen / Agent Framework
- [Microsoft Agent Framework Overview](https://learn.microsoft.com/en-us/agent-framework/overview/agent-framework-overview)
- [AutoGen and Semantic Kernel Convergence](https://cloudsummit.eu/blog/microsoft-agent-framework-production-ready-convergence-autogen-semantic-kernel/)
- [GitHub - microsoft/autogen](https://github.com/microsoft/autogen)

### OpenAI Agents SDK
- [OpenAI Agents SDK Documentation](https://openai.github.io/openai-agents-python/)
- [Handoffs - OpenAI Agents SDK](https://openai.github.io/openai-agents-python/handoffs/)
- [OpenAI Agents SDK + Temporal](https://temporal.io/blog/announcing-openai-agents-sdk-integration)

### CrewAI
- [CrewAI - The Leading Multi-Agent Platform](https://crewai.com/)
- [CrewAI Framework 2025 Complete Review](https://latenode.com/blog/ai-frameworks-technical-infrastructure/crewai-framework/crewai-framework-2025-complete-review-of-the-open-source-multi-agent-ai-platform)
- [LangGraph vs CrewAI vs AutoGen: 2026 Guide](https://dev.to/pockit_tools/langgraph-vs-crewai-vs-autogen-the-complete-multi-agent-ai-orchestration-guide-for-2026-2d63)

### LangGraph
- [LangGraph Multi-Agent Orchestration Guide](https://latenode.com/blog/ai-frameworks-technical-infrastructure/langgraph-multi-agent-orchestration/langgraph-multi-agent-orchestration-complete-framework-guide-architecture-analysis-2025)
- [LangGraph: Agent Orchestration Framework](https://www.langchain.com/langgraph)
- [Benchmarking Multi-Agent Architectures - LangChain Blog](https://blog.langchain.com/benchmarking-multi-agent-architectures/)

### FIPA
- [Foundation for Intelligent Physical Agents - Wikipedia](https://en.wikipedia.org/wiki/Foundation_for_Intelligent_Physical_Agents)
- [FIPA Agent Communication Language - SmythOS](https://smythos.com/developers/agent-development/fipa-agent-communication-language/)

### Agent Identity and Trust
- [Zero-Trust Agents: Identity and Access in Multi-Agent Workflows - Microsoft](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/zero-trust-agents-adding-identity-and-access-to-multi-agent-workflows/4427790)
- [Amazon Bedrock AgentCore Identity](https://aws.amazon.com/blogs/machine-learning/introducing-amazon-bedrock-agentcore-identity-securing-agentic-ai-at-scale/)
- [Agentic JWT: Secure Delegation Protocol - arXiv](https://arxiv.org/html/2509.13597v1)
- [JWTs for AI Agents: Non-Human Identities](https://securityboulevard.com/2025/11/jwts-for-ai-agents-authenticating-non-human-identities/)
- [Identity Management for Agentic AI - OpenID Foundation](https://openid.net/wp-content/uploads/2025/10/Identity-Management-for-Agentic-AI.pdf)

### Enterprise Deployments and Failures
- [Why Agentic AI Projects Fail: #1 Enterprise Problem in 2026](https://www.ampcome.com/post/why-agentic-ai-projects-fail)
- [7 Ways Multi-Agent AI Fails in Production](https://www.techaheadcorp.com/blog/ways-multi-agent-ai-fails-in-production/)
- [AI Agent ROI in 2026: Avoiding the 40% Failure Rate](https://www.companyofagents.ai/blog/en/ai-agent-roi-failure-2026-guide)
- [Agentic AI Strategy - Deloitte](https://www.deloitte.com/us/en/insights/topics/technology-management/tech-trends/2026/agentic-ai-strategy.html)

### Coding Agent Coordination
- [Claude Code Agent Teams Documentation](https://code.claude.com/docs/en/agent-teams)
- [Building Agent Teams in OpenCode](https://dev.to/uenyioha/porting-claude-codes-agent-teams-to-opencode-4hol)
- [Swarming the Codebase with Claude Code Agents](https://blog.heliomedeiros.com/posts/2025-11-23-swarming-with-worktree/)
- [Git Worktrees for AI Coding](https://dev.to/mashrulhaque/git-worktrees-for-ai-coding-run-multiple-agents-in-parallel-3pgb)
- [Windsurf Wave 13: Parallel Agents](https://byteiota.com/windsurf-wave-13-free-swe-1-5-parallel-agents-escalate-ai-ide-war/)
- [xAI Testing Parallel Agents for Grok Build](https://www.eonmsk.com/2026/02/16/xai-is-testing-parallel-agents-and-arena-mode-for-grok-build/)

### Standards and Governance
- [AAIF Formation Announcement - Linux Foundation](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation)
- [OpenAI Co-founds AAIF](https://openai.com/index/agentic-ai-foundation/)
- [NIST AI Agent Standards Initiative](https://www.nist.gov/news-events/news/2026/02/announcing-ai-agent-standards-initiative-interoperable-and-secure)
- [AGENTS.md](https://agents.md/)
- [AGENTS.md - GitHub](https://github.com/agentsmd/agents.md)

### Shared State and Architecture Patterns
- [Four Design Patterns for Event-Driven Multi-Agent Systems - Confluent](https://www.confluent.io/blog/event-driven-multi-agent-systems/)
- [Blackboard Pattern for Multi-Agent Systems](https://medium.com/@dp2580/building-intelligent-multi-agent-systems-with-mcps-and-the-blackboard-pattern-to-build-systems-a454705d5672)
- [IBM ACP - Agent Communication Protocol](https://www.ibm.com/think/topics/agent-communication-protocol)

### Commerce and Domain Protocols
- [Universal Commerce Protocol (UCP)](https://ucp.dev/)
- [UCP vs MCP vs A2A Comparison](https://www.ekamoira.com/blog/ucp-vs-mcp-vs-a2a-which-ai-commerce-protocol-should-you-adopt-in-2026-complete-comparison-decision-matrix)

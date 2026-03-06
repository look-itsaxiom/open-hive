# Skills Catalog

Open Hive ships 12 integration skills. Each skill is a self-contained `SKILL.md` that guides Claude Code through implementing the integration.

## Using a Skill

Point Claude at the skill file:

```
Read skills/add-slack/SKILL.md and apply it to this project.
```

Claude creates the source files, adds configuration, wires into the server, writes tests, and verifies the build. See [`skills/README.md`](../../skills/README.md) for details.

## Available Skills

| Skill | Category | Port | What It Adds |
|-------|----------|------|--------------|
| **[Slack](../../skills/add-slack/)** | Notifications | Alerts | Block Kit webhook alerts with severity filtering |
| **[Teams](../../skills/add-teams/)** | Notifications | Alerts | Adaptive Card webhook alerts |
| **[Discord](../../skills/add-discord/)** | Notifications | Alerts | Discord embed webhook alerts |
| **[GitHub OAuth](../../skills/add-github-oauth/)** | Auth | Identity | GitHub OAuth flow, org/team discovery, JWT sessions |
| **[GitLab OAuth](../../skills/add-gitlab-oauth/)** | Auth | Identity | GitLab OAuth flow, self-hosted support |
| **[Azure DevOps OAuth](../../skills/add-azure-devops-oauth/)** | Auth | Identity | Microsoft Entra ID OAuth, token refresh |
| **[PostgreSQL](../../skills/add-postgres/)** | Storage | Storage | Swap SQLite for PostgreSQL with migrations |
| **[Web Dashboard](../../skills/add-dashboard/)** | UI | -- | Embedded htmx dashboard for sessions and collisions |
| **[MCP Server](../../skills/add-mcp-server/)** | Plugin | -- | 6 `hive_*` MCP tools for direct Claude integration |
| **[L3b Embeddings](../../skills/add-embedding-l3b/)** | Detection | Semantic Analysis | Cosine similarity via OpenAI/Ollama embeddings |
| **[L3c LLM](../../skills/add-llm-l3c/)** | Detection | Semantic Analysis | LLM-based semantic overlap analysis |
| **[Build Your Own](../../skills/build-skill/)** | Meta | -- | Guide for creating custom integration skills |

## Skills by Port

### Alerts (`IAlertSink`)

- **Slack** -- Block Kit formatted webhook with severity-based colors and filtering
- **Teams** -- Adaptive Card formatted webhook
- **Discord** -- Discord embed formatted webhook

### Identity (`IIdentityProvider`)

- **GitHub OAuth** -- Full OAuth 2.0 flow with org/team discovery and JWT session tokens
- **GitLab OAuth** -- OAuth flow with self-hosted GitLab support
- **Azure DevOps OAuth** -- Microsoft Entra ID OAuth with token refresh

### Storage (`IHiveStore`)

- **PostgreSQL** -- Replaces SQLite with PostgreSQL, includes schema migrations

### Semantic Analysis (`ISemanticAnalyzer`)

- **L3b Embeddings** -- Adds embedding-based cosine similarity for intent comparison
- **L3c LLM** -- Adds LLM-based semantic overlap analysis

### Other

- **Web Dashboard** -- htmx-based UI for viewing sessions and collisions
- **MCP Server** -- Exposes Open Hive functionality as MCP tools
- **Build Your Own** -- Template and guide for authoring new skills

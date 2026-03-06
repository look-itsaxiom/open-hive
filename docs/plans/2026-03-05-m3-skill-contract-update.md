# M3: Skill Contract Update — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update all 12 skills and the build-skill meta guide to target the port interfaces from M1. After this milestone, every skill knows it's implementing a specific port and follows a consistent registration pattern.

**Architecture:** Each skill already contains a `SKILL.md` that instructs Claude how to add an integration. The changes are to the skill documentation, not to runtime code. Skills must reference the correct port interface, show how to implement it, and demonstrate registration via `PortRegistry`.

**Tech Stack:** Markdown (SKILL.md files), TypeScript examples within skills

**Dependencies:** M1 must be merged (interfaces exist). M2 should be merged (PortRegistry exists) but skills can be updated to reference the target interfaces even if M2 is in-flight.

**Branch:** `feature/m3-skill-contract-update` → PR to `develop`

---

## Task 1: Update notification skills (Slack, Teams, Discord)

**Files:**
- Modify: `skills/add-slack/SKILL.md`
- Modify: `skills/add-teams/SKILL.md`
- Modify: `skills/add-discord/SKILL.md`

For each notification skill, apply these changes:

**Step 1: Update the interface reference**

Replace any reference to `NotificationFormatter` with `IAlertSink`. Update the implementation template in each SKILL.md:

Old pattern (in all three skills):
```typescript
import type { NotificationFormatter, WebhookPayload } from '../services/notification-dispatcher.js';

export const slackFormatter: NotificationFormatter = {
  name: 'slack',
  shouldFire(payload: WebhookPayload): boolean { ... },
  format(payload: WebhookPayload) { return { url, body, headers }; },
};
```

New pattern:
```typescript
import type { IAlertSink, AlertEvent } from '@open-hive/shared';

export class SlackAlertSink implements IAlertSink {
  readonly name = 'slack';

  constructor(private webhookUrl: string, private minSeverity: CollisionSeverity = 'info') {}

  shouldFire(event: AlertEvent): boolean {
    // Severity filtering + any Slack-specific logic
  }

  async deliver(event: AlertEvent): Promise<void> {
    // Format as Block Kit payload and POST to webhookUrl
  }
}
```

**Step 2: Update the registration instructions**

Old: `dispatcher.registerFormatter(slackFormatter);`

New: In `server.ts` after PortRegistry creation:
```typescript
import { SlackAlertSink } from './services/slack-alert-sink.js';

// In PortRegistry construction or after:
if (process.env.SLACK_WEBHOOK_URL) {
  registry.alerts.registerSink(
    new SlackAlertSink(process.env.SLACK_WEBHOOK_URL, config.alerts.min_severity)
  );
}
```

**Step 3: Update the test template**

Update test examples to create `AlertEvent` objects instead of `WebhookPayload`, and test `shouldFire` + `deliver` instead of `format`.

**Step 4: Commit**

```bash
git add skills/add-slack/SKILL.md skills/add-teams/SKILL.md skills/add-discord/SKILL.md
git commit -m "docs: update notification skills to target IAlertSink port"
```

---

## Task 2: Update auth skills (GitHub OAuth, GitLab OAuth, Azure DevOps OAuth)

**Files:**
- Modify: `skills/add-github-oauth/SKILL.md`
- Modify: `skills/add-gitlab-oauth/SKILL.md`
- Modify: `skills/add-azure-devops-oauth/SKILL.md`

For each auth skill:

**Step 1: Update the interface reference**

Old pattern:
```typescript
// Replace authenticate/requireAuth in middleware/auth.ts
export async function authenticate(request, reply) {
  // Validate OAuth token...
}
```

New pattern:
```typescript
import type { IIdentityProvider, AuthContext, DeveloperIdentity } from '@open-hive/shared';

export class GitHubOAuthProvider implements IIdentityProvider {
  readonly name = 'github-oauth';
  readonly requiresAuth = true;

  async authenticate(context: AuthContext): Promise<DeveloperIdentity | null> {
    const token = extractBearerToken(context.headers);
    if (!token) return null;

    // Validate with GitHub API, resolve user profile
    const user = await this.validateToken(token);
    if (!user) return null;

    return {
      email: user.email,
      display_name: user.name ?? user.login,
      org: user.org,
      teams: user.teams,
    };
  }
}
```

**Step 2: Update registration instructions**

Old: Replace the `authenticate` function in `middleware/auth.ts`

New: In `server.ts`, pass to PortRegistry:
```typescript
import { GitHubOAuthProvider } from './services/github-oauth-provider.js';

const registry = new PortRegistry({
  store,
  identity: new GitHubOAuthProvider({ clientId: '...', clientSecret: '...' }),
  // ...
});
```

**Step 3: Commit**

```bash
git add skills/add-github-oauth/SKILL.md skills/add-gitlab-oauth/SKILL.md skills/add-azure-devops-oauth/SKILL.md
git commit -m "docs: update auth skills to target IIdentityProvider port"
```

---

## Task 3: Update semantic analysis skills (L3b Embeddings, L3c LLM)

**Files:**
- Modify: `skills/add-embedding-l3b/SKILL.md`
- Modify: `skills/add-llm-l3c/SKILL.md`

**Step 1: Update L3b skill to implement ISemanticAnalyzer**

Old pattern: Modify `CollisionEngine` directly to add embedding comparison logic.

New pattern:
```typescript
import type { ISemanticAnalyzer, SemanticMatch } from '@open-hive/shared';

export class EmbeddingAnalyzer implements ISemanticAnalyzer {
  readonly name = 'openai-embeddings';
  readonly tier = 'L3b' as const;

  constructor(private provider: string, private apiKey: string, private threshold = 0.75) {}

  async compare(intentA: string, intentB: string): Promise<SemanticMatch | null> {
    const [embA, embB] = await Promise.all([
      this.embed(intentA),
      this.embed(intentB),
    ]);
    const score = cosineSimilarity(embA, embB);
    if (score < this.threshold) return null;

    return {
      score,
      tier: 'L3b',
      explanation: `Embedding similarity: ${(score * 100).toFixed(0)}%`,
    };
  }
}
```

Registration:
```typescript
const registry = new PortRegistry({
  store,
  identity: new PassthroughIdentityProvider(),
  analyzers: [
    new KeywordAnalyzer(),      // L3a — always first, free
    ...(config.collision.semantic.embeddings_enabled
      ? [new EmbeddingAnalyzer(config.collision.semantic.embeddings_provider!, config.collision.semantic.embeddings_api_key!)]
      : []),
  ],
});
```

**Step 2: Apply same pattern to L3c skill**

```typescript
export class LLMAnalyzer implements ISemanticAnalyzer {
  readonly name = 'llm-comparison';
  readonly tier = 'L3c' as const;
  // ...
}
```

**Step 3: Commit**

```bash
git add skills/add-embedding-l3b/SKILL.md skills/add-llm-l3c/SKILL.md
git commit -m "docs: update semantic analysis skills to target ISemanticAnalyzer port"
```

---

## Task 4: Update storage skill (PostgreSQL)

**Files:**
- Modify: `skills/add-postgres/SKILL.md`

**Step 1: Update interface reference**

The PostgreSQL skill already targets `IHiveStore` conceptually. Update the import path:

Old: `import type { IHiveStore } from '../db/store.js';`
New: `import type { IHiveStore } from '@open-hive/shared';`

Update registration:
```typescript
import { PostgresStore } from './services/postgres-store.js';

const store = config.database.type === 'postgres'
  ? new PostgresStore(config.database.url)
  : createSQLiteStore(config.database.url);

const registry = new PortRegistry({ store, ... });
```

**Step 2: Commit**

```bash
git add skills/add-postgres/SKILL.md
git commit -m "docs: update postgres skill to import IHiveStore from shared"
```

---

## Task 5: Update remaining skills (Dashboard, MCP Server)

**Files:**
- Modify: `skills/add-dashboard/SKILL.md`
- Modify: `skills/add-mcp-server/SKILL.md`

These skills don't implement a port directly but consume data from the store. Update them to reference `PortRegistry` for accessing the store and other services.

**Step 1: Update dashboard skill**

The dashboard reads sessions and collisions. Update it to access `registry.store` instead of a direct `store` import.

**Step 2: Update MCP server skill**

The MCP tools call store methods. Update to reference `@open-hive/shared` types and `registry.store`.

**Step 3: Commit**

```bash
git add skills/add-dashboard/SKILL.md skills/add-mcp-server/SKILL.md
git commit -m "docs: update dashboard and MCP skills to use PortRegistry"
```

---

## Task 6: Update build-skill meta guide

**Files:**
- Modify: `skills/build-skill/SKILL.md`

**Step 1: Rewrite the "Creating a Custom Skill" guide**

This is the most important skill to update — it teaches skill authors how to build integrations. Update it to:

1. Explain the four ports (Storage, Alerts, Identity, Semantic Analysis)
2. Show how to pick which port to implement
3. Provide a template for each port type
4. Show the registration pattern via PortRegistry
5. Include the conformance test pattern (implement interface, register, verify)

Add a decision tree:
```
Is your skill about...
  ...where to send collision alerts? → implement IAlertSink
  ...how to authenticate developers? → implement IIdentityProvider
  ...how to compare developer intents? → implement ISemanticAnalyzer
  ...where to store data? → implement IHiveStore
  ...something else? → you may need a new port (open a discussion)
```

**Step 2: Commit**

```bash
git add skills/build-skill/SKILL.md
git commit -m "docs: rewrite build-skill guide for port-based architecture"
```

---

## Task 7: Final verification and PR

**Step 1: Verify all skill files are well-formed**

Review each modified SKILL.md for consistency: all reference `@open-hive/shared` imports, all show `PortRegistry` registration, all include updated test templates.

**Step 2: Push and create PR**

```bash
git push -u origin feature/m3-skill-contract-update
gh pr create --base develop --title "docs: update all skills to target port interfaces (M3)" --body "$(cat <<'EOF'
## Summary
- Update Slack, Teams, Discord skills → target `IAlertSink`
- Update GitHub, GitLab, Azure DevOps OAuth skills → target `IIdentityProvider`
- Update L3b Embeddings, L3c LLM skills → target `ISemanticAnalyzer`
- Update PostgreSQL skill → import `IHiveStore` from shared
- Update Dashboard, MCP Server skills → use `PortRegistry`
- Rewrite build-skill meta guide for port-based architecture

## Context
Phase 2, Milestone 3. All skills now document how to implement
a specific port interface and register via PortRegistry.

Depends on: #<M1_ISSUE_NUMBER>, #<M2_ISSUE_NUMBER>
Closes: #<M3_ISSUE_NUMBER>

## Test plan
- [ ] All SKILL.md files reference `@open-hive/shared` types
- [ ] All SKILL.md files show PortRegistry registration
- [ ] Build-skill guide covers all four port types
- [ ] No references to deprecated `NotificationFormatter` or `NotificationDispatcher`
EOF
)"
```

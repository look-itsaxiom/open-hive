# Collision Detection Deep Dive

Open Hive detects developer collisions at three levels, each with increasing semantic depth.

## Detection Levels

| Level | Type | Severity | How It Works |
|-------|------|----------|--------------|
| **L1** | File | `critical` | Two sessions modifying the same file. Zero false positives. |
| **L2** | Directory | `warning` | Two sessions modifying files in the same directory. Natural proxy for "area of code." |
| **L3a** | Semantic (keywords) | `info` | Keyword extraction from developer prompts + Jaccard similarity (threshold: 0.3). Free, no API calls. |
| **L3b** | Semantic (embeddings) | -- | Cosine similarity via OpenAI/Ollama embeddings. Requires skill installation. |
| **L3c** | Semantic (LLM) | -- | LLM-based semantic overlap analysis. Requires skill installation. |

## Collision Scope

Configurable per deployment via `COLLISION_SCOPE`:

- **`repo`** -- only detect collisions within the same repository
- **`org`** -- detect collisions across all repositories (default)

## L1: File Collision

Triggered when two sessions both modify the same file path.

**Implementation** (`CollisionEngine.checkFileCollision`):
1. Get all active sessions (filtered by scope)
2. For each other session, check if `files_touched` includes the target file
3. If match found and no existing collision exists for this pair+file, create a `critical` collision
4. Deduplication: existing collisions for the same pair and file are returned instead of creating duplicates

**Trigger points:**
- `POST /api/signals/activity` with `type: "file_modify"`
- `GET /api/conflicts/check`

## L2: Directory Collision

Triggered when two sessions modify files in the same directory.

**Implementation** (also in `checkFileCollision`):
1. Extract the directory from the file path using `dirname()`
2. For each other session, extract directories from their `files_touched`
3. If any directory matches and no existing collision exists, create a `warning` collision
4. L2 checks only run if L1 did not match (a file collision is more specific)

## L3a: Keyword Semantic Collision

Triggered when two developers' prompts share significant keyword overlap.

**Implementation** (`CollisionEngine.checkIntentCollision`):
1. Extract keywords from the intent text (lowercase, remove punctuation, filter stop words, filter words <= 2 chars)
2. For each other active session with an intent, compute Jaccard similarity
3. Jaccard = |intersection| / |union| of keyword sets
4. If score >= 0.3, create an `info` collision

**Stop words:** Common English words plus programming verbs (`fix`, `add`, `update`, `change`, `make`, `get`, `set`, `use`, `implement`, `create`, `remove`, `delete`, `refactor`, `improve`). These are filtered out to reduce false positives.

**Keyword extraction:**
```
"Refactoring the auth middleware for JWT validation"
  -> keywords: {"auth", "middleware", "jwt", "validation"}

"Updating login flow error handling"
  -> keywords: {"login", "flow", "error", "handling"}
```

## Historical Collision Detection

In addition to live session comparison, the `checkHistoricalIntentCollision` method compares a developer's current intent against recent intents from ended sessions (last 7 days).

**Implementation:**
1. Fetch recent intents (up to 200) from the signal store
2. Deduplicate by session -- keep only the most recent intent per session
3. Filter out currently active sessions (those are handled by live detection)
4. For each historical intent, compute Jaccard similarity
5. If score >= 0.3, create a `warning` severity collision (higher than live L3a `info` because historical overlap may indicate uncoordinated rework)

Historical collisions include the developer name and time since the original work in the details string.

## Collision Lifecycle

1. **Detection** -- Collision is created in the database with `resolved: false`
2. **Notification** -- `NotificationDispatcher` sends webhooks (if configured)
3. **Alert** -- Plugin receives the collision and injects a system message
4. **Resolution** -- `POST /api/conflicts/resolve` marks the collision as resolved

## Collision Data Model

```typescript
interface Collision {
  collision_id: string;      // nanoid
  session_ids: string[];     // the two (or more) sessions involved
  type: 'file' | 'directory' | 'semantic';
  severity: 'critical' | 'warning' | 'info';
  details: string;           // human-readable description
  detected_at: string;       // ISO 8601
  resolved: boolean;
  resolved_by: string | null;
}
```

## L3b and L3c (Skill-Based)

L3b (embedding similarity) and L3c (LLM comparison) are available as installable skills:

- **[L3b Embeddings](../../skills/add-embedding-l3b/)** -- Cosine similarity via OpenAI or Ollama embeddings
- **[L3c LLM](../../skills/add-llm-l3c/)** -- LLM-based semantic overlap analysis

These require `SEMANTIC_EMBEDDINGS=true` or `SEMANTIC_LLM=true` and appropriate API keys. See [config reference](../reference/config.md).

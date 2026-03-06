---
name: add-embedding-l3b
description: Add L3b embedding-based semantic collision detection using cosine similarity between developer intents
category: collision-tier
port: ISemanticAnalyzer
requires:
  - (none -- uses native fetch for API calls, node:crypto for hashing)
modifies:
  - packages/backend/src/services/embedding-analyzer.ts (new)
  - packages/backend/src/services/embedding-cache.ts (new)
  - packages/backend/src/db/sqlite.ts (modify -- add embedding_cache table)
  - packages/backend/src/env.ts (modify -- add EMBEDDINGS_* config vars)
  - packages/backend/src/server.ts (modify -- register analyzer in PortRegistry)
tests:
  - packages/backend/src/services/embedding-analyzer.test.ts
  - packages/backend/src/services/embedding-cache.test.ts
---

# add-embedding-l3b

Adds L3b embedding-based semantic collision detection to the collision engine. When two developers describe intents that are semantically similar (even if they use completely different words), this tier catches the overlap by computing cosine similarity between vector embeddings. This fills the gap between L3a keyword overlap (which misses synonyms) and L3c LLM analysis (which is slow and expensive).

## Prerequisites

- Open Hive backend source checked out and buildable (`npm run build` passes)
- One of the following embedding providers:
  - **OpenAI**: An API key with access to the embeddings endpoint (text-embedding-3-small)
  - **Ollama**: A local Ollama instance running with `nomic-embed-text` pulled (`ollama pull nomic-embed-text`)

## What This Skill Does

- Creates an `EmbeddingAnalyzer` class that implements the `ISemanticAnalyzer` port interface from `@open-hive/shared`.
- The analyzer compares developer intents using cosine similarity of vector embeddings.
- Returns a `SemanticMatch` with `tier: 'L3b'` when similarity exceeds the configured threshold.
- Includes an embedding cache to avoid redundant API calls.
- Registers in the `PortRegistry` as part of the `analyzers` array.

---

## Step 1: Create the Embedding Analyzer

Create `packages/backend/src/services/embedding-analyzer.ts`:

```typescript
import type { ISemanticAnalyzer, SemanticMatch } from '@open-hive/shared';

export interface EmbeddingAnalyzerConfig {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  threshold: number;
}

export class EmbeddingAnalyzer implements ISemanticAnalyzer {
  readonly name: string;
  readonly tier = 'L3b' as const;

  constructor(private config: EmbeddingAnalyzerConfig) {
    this.name = `${config.provider}-embeddings`;
  }

  async compare(a: string, b: string): Promise<SemanticMatch | null> {
    const [embA, embB] = await Promise.all([
      this.embed(a),
      this.embed(b),
    ]);
    const score = cosineSimilarity(embA, embB);
    if (score < this.config.threshold) return null;

    return {
      score,
      tier: 'L3b',
      explanation: `Embedding similarity: ${(score * 100).toFixed(0)}%`,
    };
  }

  private async embed(text: string): Promise<number[]> {
    // Provider-specific embedding logic
    // Uses native fetch to call OpenAI, Ollama, or other embedding APIs
    if (this.config.provider === 'openai') {
      return this.embedOpenAI(text);
    }
    if (this.config.provider === 'ollama') {
      return this.embedOllama(text);
    }
    throw new Error(`Unsupported embedding provider: ${this.config.provider}`);
  }

  private async embedOpenAI(text: string): Promise<number[]> {
    const baseUrl = this.config.baseUrl ?? 'https://api.openai.com/v1';
    const model = this.config.model ?? 'text-embedding-3-small';
    const res = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({ input: text, model }),
    });
    if (!res.ok) throw new Error(`OpenAI embeddings error: ${res.status}`);
    const data = await res.json() as { data: Array<{ embedding: number[] }> };
    return data.data[0].embedding;
  }

  private async embedOllama(text: string): Promise<number[]> {
    const baseUrl = this.config.baseUrl ?? 'http://localhost:11434';
    const model = this.config.model ?? 'nomic-embed-text';
    const res = await fetch(`${baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text }),
    });
    if (!res.ok) throw new Error(`Ollama embeddings error: ${res.status}`);
    const data = await res.json() as { embedding: number[] };
    return data.embedding;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}
```

---

## Step 2: Register in PortRegistry

In `packages/backend/src/server.ts`, add the embedding analyzer to the analyzers array:

```typescript
import { EmbeddingAnalyzer } from './services/embedding-analyzer.js';
import { KeywordAnalyzer } from './services/keyword-analyzer.js';

const analyzers: ISemanticAnalyzer[] = [
  new KeywordAnalyzer(),      // L3a — always first, free
  ...(config.collision.semantic.embeddings_enabled
    ? [new EmbeddingAnalyzer({
        provider: config.collision.semantic.embeddings_provider!,
        apiKey: config.collision.semantic.embeddings_api_key,
        threshold: 0.75,
      })]
    : []),
];

const registry: PortRegistry = {
  store,
  identity,
  analyzers,
  alerts,
};
```

The collision engine iterates through `registry.analyzers` in order. L3a runs first (free, fast). If L3b is registered, it runs next using embedding similarity. First match per session pair wins.

---

## Step 3: Add Tests

Create `packages/backend/src/services/embedding-analyzer.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EmbeddingAnalyzer } from './embedding-analyzer.js';

describe('EmbeddingAnalyzer', () => {
  it('has tier L3b', () => {
    const analyzer = new EmbeddingAnalyzer({
      provider: 'openai',
      apiKey: 'test',
      threshold: 0.75,
    });
    assert.equal(analyzer.tier, 'L3b');
    assert.equal(analyzer.name, 'openai-embeddings');
  });

  it('has correct name based on provider', () => {
    const analyzer = new EmbeddingAnalyzer({
      provider: 'ollama',
      threshold: 0.75,
    });
    assert.equal(analyzer.name, 'ollama-embeddings');
  });
});
```

---

## Step 4: Verify

```bash
npm run build && npm test
```

Confirm:
- [ ] Build succeeds with no type errors
- [ ] All existing tests still pass
- [ ] New embedding analyzer tests pass
- [ ] With `SEMANTIC_EMBEDDINGS=false` (default), the analyzer is not registered (backward compat)
- [ ] Manual test: set `SEMANTIC_EMBEDDINGS=true`, `EMBEDDINGS_PROVIDER=ollama`, start Ollama with `nomic-embed-text`, create two sessions with semantically similar intents, verify the collision details include embedding similarity

## Configuration

Add to `.env.example`:

```bash
# ─── L3b: Embedding-based semantic collision detection ────
SEMANTIC_EMBEDDINGS=false
EMBEDDINGS_PROVIDER=        # openai | ollama
EMBEDDINGS_API_KEY=         # Required for OpenAI, not needed for Ollama
# EMBEDDINGS_BASE_URL=      # Optional: override the API base URL
# EMBEDDINGS_MODEL=         # Optional: override the model name
```

### Provider examples

**OpenAI**:
```bash
SEMANTIC_EMBEDDINGS=true
EMBEDDINGS_PROVIDER=openai
EMBEDDINGS_API_KEY=sk-...
```

**Ollama (free, local)**:
```bash
SEMANTIC_EMBEDDINGS=true
EMBEDDINGS_PROVIDER=ollama
```

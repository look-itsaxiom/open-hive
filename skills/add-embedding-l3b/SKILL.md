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
- Includes an `EmbeddingCache` that stores computed embeddings to avoid redundant API calls.
- Registers in the `PortRegistry` as part of the `analyzers` array.

---

## Step 1: Create the Embedding Cache

Create `packages/backend/src/services/embedding-cache.ts`:

```typescript
import { createHash } from 'node:crypto';

interface CacheEntry {
  hash: string;
  embedding: number[];
  created_at: number;
}

export class EmbeddingCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;
  private ttlMs: number;

  constructor(opts: { maxSize?: number; ttlMs?: number } = {}) {
    this.maxSize = opts.maxSize ?? 500;
    this.ttlMs = opts.ttlMs ?? 3600_000; // 1 hour default
  }

  private hash(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }

  get(text: string): number[] | null {
    const key = this.hash(text);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.created_at > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    return entry.embedding;
  }

  set(text: string, embedding: number[]): void {
    if (this.cache.size >= this.maxSize) {
      // Evict oldest entry
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    const key = this.hash(text);
    this.cache.set(key, { hash: key, embedding, created_at: Date.now() });
  }

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }
}
```

---

## Step 2: Create the Embedding Analyzer

Create `packages/backend/src/services/embedding-analyzer.ts`:

```typescript
import type { ISemanticAnalyzer, SemanticMatch } from '@open-hive/shared';
import { EmbeddingCache } from './embedding-cache.js';

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
  private cache: EmbeddingCache;

  constructor(private config: EmbeddingAnalyzerConfig) {
    this.name = `${config.provider}-embeddings`;
    this.cache = new EmbeddingCache();
  }

  async compare(a: string, b: string): Promise<SemanticMatch | null> {
    try {
      const [embA, embB] = await Promise.all([
        this.getOrEmbed(a),
        this.getOrEmbed(b),
      ]);
      const score = cosineSimilarity(embA, embB);
      if (score < this.config.threshold) return null;

      return {
        score,
        tier: 'L3b',
        explanation: `Embedding similarity: ${(score * 100).toFixed(0)}%`,
      };
    } catch {
      // Embedding errors are non-fatal — return null to skip this tier
      return null;
    }
  }

  private async getOrEmbed(text: string): Promise<number[]> {
    const cached = this.cache.get(text);
    if (cached) return cached;

    const embedding = await this.embed(text);
    this.cache.set(text, embedding);
    return embedding;
  }

  private async embed(text: string): Promise<number[]> {
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

## Step 3: Register in PortRegistry

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
  store, identity, analyzers, alerts, decay, nerves,
};
```

The collision engine iterates through `registry.analyzers` in order. L3a runs first (free, fast). If L3b is registered, it runs next using embedding similarity. First match per session pair wins.

---

## Step 4: Add Tests

Create `packages/backend/src/services/embedding-cache.test.ts`:

```typescript
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EmbeddingCache } from './embedding-cache.js';

describe('EmbeddingCache', () => {
  let cache: EmbeddingCache;

  beforeEach(() => {
    cache = new EmbeddingCache({ maxSize: 3, ttlMs: 1000 });
  });

  it('returns null for uncached text', () => {
    assert.equal(cache.get('hello'), null);
  });

  it('caches and retrieves embeddings', () => {
    const embedding = [0.1, 0.2, 0.3];
    cache.set('hello', embedding);
    assert.deepEqual(cache.get('hello'), embedding);
  });

  it('evicts oldest entry when maxSize exceeded', () => {
    cache.set('a', [1]);
    cache.set('b', [2]);
    cache.set('c', [3]);
    cache.set('d', [4]); // evicts 'a'
    assert.equal(cache.get('a'), null);
    assert.deepEqual(cache.get('d'), [4]);
  });

  it('expires entries after TTL', async () => {
    const shortCache = new EmbeddingCache({ ttlMs: 10 });
    shortCache.set('x', [1]);
    await new Promise(r => setTimeout(r, 20));
    assert.equal(shortCache.get('x'), null);
  });

  it('tracks size correctly', () => {
    assert.equal(cache.size, 0);
    cache.set('a', [1]);
    assert.equal(cache.size, 1);
    cache.clear();
    assert.equal(cache.size, 0);
  });
});
```

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
  });

  it('names itself based on provider', () => {
    const openai = new EmbeddingAnalyzer({ provider: 'openai', apiKey: 'test', threshold: 0.75 });
    assert.equal(openai.name, 'openai-embeddings');

    const ollama = new EmbeddingAnalyzer({ provider: 'ollama', threshold: 0.75 });
    assert.equal(ollama.name, 'ollama-embeddings');
  });

  it('rejects unsupported providers', async () => {
    const analyzer = new EmbeddingAnalyzer({ provider: 'unknown', threshold: 0.75 });
    // compare() catches errors and returns null
    const result = await analyzer.compare('hello', 'world');
    assert.equal(result, null);
  });

  it('returns null when API errors occur (non-fatal)', async () => {
    // OpenAI with bad key will fail — should return null, not throw
    const analyzer = new EmbeddingAnalyzer({
      provider: 'openai',
      apiKey: 'bad-key',
      baseUrl: 'http://localhost:99999', // unreachable
      threshold: 0.75,
    });
    const result = await analyzer.compare('intent a', 'intent b');
    assert.equal(result, null, 'Should gracefully return null on API error');
  });
});
```

---

## Step 5: Verify

```bash
npm run build && npm test
```

Confirm:
- [ ] Build succeeds with no type errors
- [ ] All existing tests still pass
- [ ] New embedding cache tests pass (5 tests)
- [ ] New embedding analyzer tests pass (4 tests)
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

---
name: add-llm-l3c
description: LLM-based deep semantic collision detection -- implements ISemanticAnalyzer to compare developer intents using an LLM
category: collision-tier
port: ISemanticAnalyzer
requires:
  - (none -- uses native fetch for all providers)
modifies:
  - packages/backend/src/services/llm-analyzer.ts (new)
  - packages/backend/src/services/llm-analyzer.test.ts (new)
  - packages/backend/src/server.ts (modify -- register analyzer in PortRegistry)
  - packages/shared/src/config.ts (modify -- add LLM config fields)
  - packages/backend/src/env.ts (modify -- parse LLM env vars)
tests:
  - packages/backend/src/services/llm-analyzer.test.ts
---

# add-llm-l3c

Adds L3c LLM-based deep semantic collision detection to the Open Hive collision engine. When cheaper tiers (L3a keyword overlap, L3b embedding similarity) flag a potential overlap between two developer intents, L3c sends both intents to an LLM for nuanced comparison. The LLM determines whether the developers are genuinely working on overlapping concerns, reducing false positives from keyword-only matching. This is the most expensive tier and only fires as a final filter.

## Prerequisites

- Open Hive backend source code checked out and buildable (`npm run build` passes)
- An LLM API provider -- one of:
  - **OpenAI**: An API key from [platform.openai.com](https://platform.openai.com)
  - **Anthropic**: An API key from [console.anthropic.com](https://console.anthropic.com)
  - **Ollama**: A local Ollama instance running at `http://localhost:11434`
  - **Generic**: Any OpenAI-compatible endpoint (OpenRouter, Together, LM Studio, vLLM, etc.)

## What This Skill Does

- Creates an `LLMAnalyzer` class that implements the `ISemanticAnalyzer` port interface from `@open-hive/shared`.
- The analyzer sends both developer intents to an LLM with a structured prompt asking for overlap assessment.
- Returns a `SemanticMatch` with `tier: 'L3c'` when the LLM confirms overlap with confidence above the threshold.
- Includes rate limiting to protect against runaway API costs.
- Supports four LLM providers: OpenAI, Anthropic, Ollama, and any OpenAI-compatible generic endpoint.
- Registers in the `PortRegistry` as part of the `analyzers` array.

---

## Step 1: Create the LLM Analyzer

Create `packages/backend/src/services/llm-analyzer.ts`:

```typescript
import type { ISemanticAnalyzer, SemanticMatch } from '@open-hive/shared';

export interface LLMAnalyzerConfig {
  provider: 'openai' | 'anthropic' | 'ollama' | 'generic';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  confidenceThreshold: number;
  rateLimitPerMin: number;
}

const COMPARISON_PROMPT = `You are a code coordination assistant. Two developers are working in the same repository. Determine if their intents overlap (working on the same concern, touching the same subsystem, or likely to cause merge conflicts).

Developer A intent: "{intentA}"
Developer B intent: "{intentB}"

Respond with ONLY valid JSON (no markdown, no explanation):
{"overlap": true/false, "confidence": 0.0-1.0, "explanation": "brief reason"}`;

export class LLMAnalyzer implements ISemanticAnalyzer {
  readonly name = 'llm-comparison';
  readonly tier = 'L3c' as const;

  private timestamps: number[] = [];

  constructor(private config: LLMAnalyzerConfig) {}

  async compare(a: string, b: string): Promise<SemanticMatch | null> {
    // Rate limiting
    const now = Date.now();
    this.timestamps = this.timestamps.filter(t => t > now - 60_000);
    if (this.timestamps.length >= this.config.rateLimitPerMin) return null;
    this.timestamps.push(now);

    try {
      const result = await this.callLLM(a, b);
      if (result.confidence < this.config.confidenceThreshold) return null;
      if (!result.overlap) return null;

      return {
        score: result.confidence,
        tier: 'L3c',
        explanation: result.explanation,
      };
    } catch {
      // LLM errors are non-fatal -- return null to fall back to cheaper tiers
      return null;
    }
  }

  private async callLLM(
    intentA: string,
    intentB: string,
  ): Promise<{ overlap: boolean; confidence: number; explanation: string }> {
    const prompt = COMPARISON_PROMPT
      .replace('{intentA}', intentA)
      .replace('{intentB}', intentB);

    const raw = await this.sendToProvider(prompt);
    return JSON.parse(raw);
  }

  private async sendToProvider(prompt: string): Promise<string> {
    switch (this.config.provider) {
      case 'openai':
      case 'generic':
        return this.sendOpenAICompatible(prompt);
      case 'anthropic':
        return this.sendAnthropic(prompt);
      case 'ollama':
        return this.sendOllama(prompt);
      default:
        throw new Error(`Unsupported LLM provider: ${this.config.provider}`);
    }
  }

  private async sendOpenAICompatible(prompt: string): Promise<string> {
    const baseUrl = this.config.baseUrl ?? 'https://api.openai.com/v1';
    const model = this.config.model ?? 'gpt-4o-mini';
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 200,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`);
    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0].message.content;
  }

  private async sendAnthropic(prompt: string): Promise<string> {
    const baseUrl = this.config.baseUrl ?? 'https://api.anthropic.com';
    const model = this.config.model ?? 'claude-haiku-4-5-20251001';
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
    const data = await res.json() as { content: Array<{ text: string }> };
    return data.content[0].text;
  }

  private async sendOllama(prompt: string): Promise<string> {
    const baseUrl = this.config.baseUrl ?? 'http://localhost:11434';
    const model = this.config.model ?? 'llama3.2';
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false }),
    });
    if (!res.ok) throw new Error(`Ollama API error: ${res.status}`);
    const data = await res.json() as { response: string };
    return data.response;
  }
}
```

---

## Step 2: Register in PortRegistry

In `packages/backend/src/server.ts`, add the LLM analyzer to the analyzers array:

```typescript
import { LLMAnalyzer } from './services/llm-analyzer.js';
import { KeywordAnalyzer } from './services/keyword-analyzer.js';
import { EmbeddingAnalyzer } from './services/embedding-analyzer.js';

const analyzers: ISemanticAnalyzer[] = [
  new KeywordAnalyzer(),      // L3a — always first, free
  ...(config.collision.semantic.embeddings_enabled
    ? [new EmbeddingAnalyzer({ ... })]
    : []),
  ...(config.collision.semantic.llm_enabled
    ? [new LLMAnalyzer({
        provider: config.collision.semantic.llm_provider! as 'openai' | 'anthropic' | 'ollama' | 'generic',
        apiKey: config.collision.semantic.llm_api_key,
        baseUrl: config.collision.semantic.llm_base_url,
        model: config.collision.semantic.llm_model,
        confidenceThreshold: config.collision.semantic.llm_confidence_threshold,
        rateLimitPerMin: config.collision.semantic.llm_rate_limit_per_min,
      })]
    : []),
];

const registry: PortRegistry = {
  store, identity, analyzers, alerts, decay, nerves,
};
```

The collision engine iterates through `registry.analyzers` in tier order (L3a, L3b, L3c). Each analyzer implements `ISemanticAnalyzer.compare()` and returns a `SemanticMatch | null`. First match per session pair wins.

---

## Step 3: Update shared config types

In `packages/shared/src/config.ts`, ensure the semantic config includes LLM fields:

```typescript
    semantic: {
      keywords_enabled: boolean;
      embeddings_enabled: boolean;
      embeddings_provider?: string;
      embeddings_api_key?: string;
      llm_enabled: boolean;
      llm_provider?: string;
      llm_api_key?: string;
      llm_base_url?: string;
      llm_model?: string;
      llm_confidence_threshold: number;
      llm_rate_limit_per_min: number;
    };
```

---

## Step 4: Add Tests

Create `packages/backend/src/services/llm-analyzer.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LLMAnalyzer } from './llm-analyzer.js';

describe('LLMAnalyzer', () => {
  it('has tier L3c and correct name', () => {
    const analyzer = new LLMAnalyzer({
      provider: 'ollama',
      confidenceThreshold: 0.7,
      rateLimitPerMin: 10,
    });
    assert.equal(analyzer.tier, 'L3c');
    assert.equal(analyzer.name, 'llm-comparison');
  });

  it('rate limits after configured max calls', async () => {
    const analyzer = new LLMAnalyzer({
      provider: 'openai',
      apiKey: 'test',
      baseUrl: 'http://localhost:99999', // unreachable
      confidenceThreshold: 0.7,
      rateLimitPerMin: 2,
    });

    // First 2 calls will fail (unreachable) but consume rate limit
    await analyzer.compare('a', 'b');
    await analyzer.compare('c', 'd');
    // Third call should be rate-limited (returns null without calling API)
    const result = await analyzer.compare('e', 'f');
    assert.equal(result, null);
  });

  it('returns null on API error (non-fatal)', async () => {
    const analyzer = new LLMAnalyzer({
      provider: 'openai',
      apiKey: 'bad-key',
      baseUrl: 'http://localhost:99999', // unreachable
      confidenceThreshold: 0.7,
      rateLimitPerMin: 10,
    });
    const result = await analyzer.compare('refactoring auth', 'updating auth module');
    assert.equal(result, null, 'Should gracefully return null on API error');
  });

  it('rejects unsupported providers', async () => {
    const analyzer = new LLMAnalyzer({
      provider: 'unknown' as any,
      confidenceThreshold: 0.7,
      rateLimitPerMin: 10,
    });
    const result = await analyzer.compare('a', 'b');
    assert.equal(result, null, 'Unsupported provider should return null');
  });

  it('supports all four provider types', () => {
    // Just verifying construction doesn't throw
    for (const provider of ['openai', 'anthropic', 'ollama', 'generic'] as const) {
      const analyzer = new LLMAnalyzer({
        provider,
        apiKey: 'test',
        confidenceThreshold: 0.7,
        rateLimitPerMin: 10,
      });
      assert.equal(analyzer.tier, 'L3c');
    }
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
- [ ] New LLM analyzer tests pass (5 tests)
- [ ] With `SEMANTIC_LLM=false` (default), the analyzer is not registered (backward compat)
- [ ] Manual smoke test: set `SEMANTIC_LLM=true`, `LLM_PROVIDER=ollama`, start Ollama, create two sessions with overlapping intents, verify the collision details include an LLM explanation

## Configuration

Add to `.env.example`:

```bash
# ─── L3c: LLM-based semantic collision detection ─────────
SEMANTIC_LLM=false
LLM_PROVIDER=                # openai | anthropic | ollama | generic
LLM_API_KEY=                 # Not needed for ollama
# LLM_BASE_URL=              # Optional: override the API base URL
# LLM_MODEL=                 # Optional: override the model
LLM_CONFIDENCE_THRESHOLD=0.7 # Minimum confidence (0.0-1.0)
LLM_RATE_LIMIT_PER_MIN=10   # Max API calls per minute
```

### Provider examples

**OpenAI**: `LLM_PROVIDER=openai LLM_API_KEY=sk-... LLM_MODEL=gpt-4o-mini`
**Anthropic**: `LLM_PROVIDER=anthropic LLM_API_KEY=sk-ant-... LLM_MODEL=claude-haiku-4-5-20251001`
**Ollama**: `LLM_PROVIDER=ollama LLM_MODEL=llama3.2`
**OpenRouter**: `LLM_PROVIDER=generic LLM_API_KEY=sk-or-... LLM_BASE_URL=https://openrouter.ai/api/v1`

---
name: add-llm-l3c
description: LLM-based deep semantic collision detection — the expensive final filter that uses an LLM to compare developer intents
category: collision-tier
requires:
  - (none -- uses native fetch for all providers)
modifies:
  - packages/backend/src/services/llm-provider.ts (new)
  - packages/backend/src/services/llm-provider.test.ts (new)
  - packages/backend/src/services/collision-engine.ts (modify — add checkLLMCollision, wire into checkIntentCollision)
  - packages/shared/src/config.ts (modify — add LLM config fields)
  - packages/backend/src/env.ts (modify — parse LLM env vars)
tests:
  - packages/backend/src/services/llm-provider.test.ts
---

# add-llm-l3c

Adds L3c LLM-based deep semantic collision detection to the Open Hive collision engine. When cheaper tiers (L3a keyword overlap, L3b embedding similarity) flag a potential overlap between two developer intents, L3c sends both intents to an LLM for nuanced comparison. The LLM determines whether the developers are genuinely working on overlapping concerns, reducing false positives from keyword-only matching. This is the most expensive tier and only fires as a final filter.

## Prerequisites

- Open Hive backend source code checked out and buildable (`npm run build` passes)
- An LLM API provider -- one of:
  - **OpenAI**: An API key from [platform.openai.com](https://platform.openai.com)
  - **Anthropic**: An API key from [console.anthropic.com](https://console.anthropic.com)
  - **Ollama**: A local Ollama instance running at `http://localhost:11434` (or custom URL)
  - **Generic**: Any OpenAI-compatible endpoint (OpenRouter, Together, LM Studio, vLLM, etc.)

## What This Skill Does

- Creates `packages/backend/src/services/llm-provider.ts` -- LLM provider interface, four concrete implementations (OpenAI, Anthropic, Ollama, Generic), factory function, rate limiter, and comparison prompt
- Creates `packages/backend/src/services/llm-provider.test.ts` -- 14 tests covering prompt construction, provider mocking, confidence threshold, rate limiting, structured output parsing, error handling, and disabled-config bypass
- Modifies `packages/backend/src/services/collision-engine.ts` -- adds `checkLLMCollision()` method, wires it into `checkIntentCollision()` as final filter that only runs when earlier tiers found overlap
- Modifies `packages/shared/src/config.ts` -- adds `llm_base_url`, `llm_model`, `llm_confidence_threshold`, `llm_rate_limit_per_min` fields to the semantic config
- Modifies `packages/backend/src/env.ts` -- parses `LLM_BASE_URL`, `LLM_MODEL`, `LLM_CONFIDENCE_THRESHOLD`, `LLM_RATE_LIMIT_PER_MIN` env vars

## Implementation Steps

### Step 1: Update shared config types

In `packages/shared/src/config.ts`, replace the `semantic` block inside `HiveBackendConfig` with:

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

### Step 2: Update env.ts to parse new fields

Replace the `collision.semantic` block in `packages/backend/src/env.ts` with:

```typescript
      semantic: {
        keywords_enabled: process.env.SEMANTIC_KEYWORDS !== 'false',
        embeddings_enabled: process.env.SEMANTIC_EMBEDDINGS === 'true',
        embeddings_provider: process.env.EMBEDDINGS_PROVIDER,
        embeddings_api_key: process.env.EMBEDDINGS_API_KEY,
        llm_enabled: process.env.SEMANTIC_LLM === 'true',
        llm_provider: process.env.LLM_PROVIDER,
        llm_api_key: process.env.LLM_API_KEY,
        llm_base_url: process.env.LLM_BASE_URL,
        llm_model: process.env.LLM_MODEL,
        llm_confidence_threshold: parseFloat(process.env.LLM_CONFIDENCE_THRESHOLD ?? '0.7'),
        llm_rate_limit_per_min: parseInt(process.env.LLM_RATE_LIMIT_PER_MIN ?? '10', 10),
      },
```

### Step 3: Create the LLM provider

Create `packages/backend/src/services/llm-provider.ts`:

```typescript
// ─── LLM Provider for L3c Semantic Collision Detection ───
//
// This module provides a pluggable LLM integration for deep semantic
// comparison of developer intents. It is the most expensive collision
// detection tier and should only fire when cheaper tiers (L3a keywords,
// L3b embeddings) have already flagged potential overlap.

// ─── Types ───────────────────────────────────────────────

export interface LLMComparisonResult {
  overlap: boolean;
  confidence: number;   // 0.0 to 1.0
  explanation: string;
}

export interface LLMProvider {
  compare(intentA: string, intentB: string): Promise<LLMComparisonResult>;
}

export interface LLMProviderConfig {
  provider: 'openai' | 'anthropic' | 'ollama' | 'generic';
  api_key?: string;
  base_url?: string;
  model?: string;
}

// ─── Comparison Prompt ───────────────────────────────────

const SYSTEM_PROMPT = `You are a developer intent collision detector for a multi-agent coding environment. Your job is to determine whether two developer intents describe work that overlaps — meaning both developers are modifying the same logical concern, feature, or code area in a way that would cause merge conflicts or duplicated effort.

Rules:
- "Overlap" means the developers would likely touch the same files, functions, or logical concerns.
- Two intents working on the same feature from different angles (e.g., frontend vs backend of the same feature) DO overlap.
- Two intents working on completely separate features do NOT overlap, even if they use similar technologies.
- Confidence should reflect how certain you are. Use 0.9+ only when overlap is obvious. Use 0.3-0.5 for ambiguous cases.

Examples of OVERLAPPING intents:
- "Fix authentication token refresh" vs "Update JWT expiry handling in auth module" (same auth concern)
- "Add pagination to user list API" vs "Refactor user list endpoint response format" (same endpoint)
- "Redesign the settings page layout" vs "Add dark mode toggle to settings" (same page)

Examples of NON-OVERLAPPING intents:
- "Fix authentication token refresh" vs "Add CSV export to reports page" (different features)
- "Update database migration scripts" vs "Fix CSS layout on landing page" (different layers, different features)
- "Add unit tests for payment service" vs "Implement email notification templates" (different services)

You MUST respond with valid JSON and nothing else. The JSON must have exactly these fields:
{
  "overlap": true or false,
  "confidence": a number between 0.0 and 1.0,
  "explanation": "one sentence explaining your reasoning"
}`;

function buildUserMessage(intentA: string, intentB: string): string {
  return `Compare these two developer intents for overlap:

Intent A: "${intentA}"
Intent B: "${intentB}"

Respond with JSON only.`;
}

// ─── Response Parsing ────────────────────────────────────

export function parseComparisonResponse(raw: string): LLMComparisonResult {
  // Try direct JSON parse first
  try {
    const parsed = JSON.parse(raw);
    return validateResult(parsed);
  } catch {
    // Fall through to extraction
  }

  // Try to extract JSON from markdown code fences or surrounding text
  const jsonMatch = raw.match(/\{[\s\S]*?"overlap"[\s\S]*?"confidence"[\s\S]*?"explanation"[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return validateResult(parsed);
    } catch {
      // Fall through
    }
  }

  // Last resort: regex extraction
  const overlapMatch = raw.match(/"overlap"\s*:\s*(true|false)/);
  const confidenceMatch = raw.match(/"confidence"\s*:\s*([\d.]+)/);
  const explanationMatch = raw.match(/"explanation"\s*:\s*"([^"]+)"/);

  if (overlapMatch && confidenceMatch) {
    return {
      overlap: overlapMatch[1] === 'true',
      confidence: clampConfidence(parseFloat(confidenceMatch[1])),
      explanation: explanationMatch?.[1] ?? 'No explanation provided',
    };
  }

  throw new Error(`Failed to parse LLM comparison response: ${raw.slice(0, 200)}`);
}

function validateResult(parsed: Record<string, unknown>): LLMComparisonResult {
  if (typeof parsed.overlap !== 'boolean') {
    throw new Error(`Invalid overlap field: ${parsed.overlap}`);
  }
  if (typeof parsed.confidence !== 'number') {
    throw new Error(`Invalid confidence field: ${parsed.confidence}`);
  }
  return {
    overlap: parsed.overlap,
    confidence: clampConfidence(parsed.confidence),
    explanation: typeof parsed.explanation === 'string'
      ? parsed.explanation
      : 'No explanation provided',
  };
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// ─── Rate Limiter ────────────────────────────────────────

export class RateLimiter {
  private timestamps: number[] = [];

  constructor(private maxPerMinute: number) {}

  canProceed(): boolean {
    const now = Date.now();
    const oneMinuteAgo = now - 60_000;
    this.timestamps = this.timestamps.filter(t => t > oneMinuteAgo);
    return this.timestamps.length < this.maxPerMinute;
  }

  record(): void {
    this.timestamps.push(Date.now());
  }

  get currentCount(): number {
    const oneMinuteAgo = Date.now() - 60_000;
    this.timestamps = this.timestamps.filter(t => t > oneMinuteAgo);
    return this.timestamps.length;
  }
}

// ─── Provider Implementations ────────────────────────────

export class OpenAILLMProvider implements LLMProvider {
  private baseUrl: string;
  private model: string;

  constructor(
    private apiKey: string,
    baseUrl?: string,
    model?: string,
  ) {
    this.baseUrl = baseUrl ?? 'https://api.openai.com/v1';
    this.model = model ?? 'gpt-4o-mini';
  }

  async compare(intentA: string, intentB: string): Promise<LLMComparisonResult> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserMessage(intentA, intentB) },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 256,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    const content = data.choices[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI returned empty response');
    }

    return parseComparisonResponse(content);
  }
}

export class AnthropicLLMProvider implements LLMProvider {
  private baseUrl: string;
  private model: string;

  constructor(
    private apiKey: string,
    baseUrl?: string,
    model?: string,
  ) {
    this.baseUrl = baseUrl ?? 'https://api.anthropic.com';
    this.model = model ?? 'claude-haiku-4-20250414';
  }

  async compare(intentA: string, intentB: string): Promise<LLMComparisonResult> {
    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 256,
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: buildUserMessage(intentA, intentB) },
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text: string }>;
    };
    const textBlock = data.content.find(b => b.type === 'text');
    if (!textBlock) {
      throw new Error('Anthropic returned no text content');
    }

    return parseComparisonResponse(textBlock.text);
  }
}

export class OllamaLLMProvider implements LLMProvider {
  private baseUrl: string;
  private model: string;

  constructor(
    baseUrl?: string,
    model?: string,
  ) {
    this.baseUrl = baseUrl ?? 'http://localhost:11434';
    this.model = model ?? 'llama3.2';
  }

  async compare(intentA: string, intentB: string): Promise<LLMComparisonResult> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserMessage(intentA, intentB) },
        ],
        format: 'json',
        stream: false,
        options: { temperature: 0.1 },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama API error ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json() as {
      message: { content: string };
    };

    return parseComparisonResponse(data.message.content);
  }
}

export class GenericLLMProvider implements LLMProvider {
  private baseUrl: string;
  private model: string;

  constructor(
    private apiKey: string,
    baseUrl: string,
    model?: string,
  ) {
    this.baseUrl = baseUrl;
    this.model = model ?? 'default';
  }

  async compare(intentA: string, intentB: string): Promise<LLMComparisonResult> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserMessage(intentA, intentB) },
        ],
        temperature: 0.1,
        max_tokens: 256,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LLM API error ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    const content = data.choices[0]?.message?.content;
    if (!content) {
      throw new Error('LLM API returned empty response');
    }

    return parseComparisonResponse(content);
  }
}

// ─── Factory ─────────────────────────────────────────────

export function createLLMProvider(config: LLMProviderConfig): LLMProvider {
  switch (config.provider) {
    case 'openai':
      if (!config.api_key) throw new Error('LLM_API_KEY required for OpenAI provider');
      return new OpenAILLMProvider(config.api_key, config.base_url, config.model);

    case 'anthropic':
      if (!config.api_key) throw new Error('LLM_API_KEY required for Anthropic provider');
      return new AnthropicLLMProvider(config.api_key, config.base_url, config.model);

    case 'ollama':
      return new OllamaLLMProvider(config.base_url, config.model);

    case 'generic':
      if (!config.api_key) throw new Error('LLM_API_KEY required for generic provider');
      if (!config.base_url) throw new Error('LLM_BASE_URL required for generic provider');
      return new GenericLLMProvider(config.api_key, config.base_url, config.model);

    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}

// Exported for testing
export { SYSTEM_PROMPT, buildUserMessage };
```

### Step 4: Modify collision-engine.ts

Replace the entire contents of `packages/backend/src/services/collision-engine.ts` with:

```typescript
import { dirname } from 'node:path';
import type { IHiveStore } from '../db/store.js';
import type { Collision, HiveBackendConfig } from '@open-hive/shared';
import {
  createLLMProvider,
  RateLimiter,
  type LLMProvider,
} from './llm-provider.js';

export class CollisionEngine {
  private llmProvider: LLMProvider | null = null;
  private llmRateLimiter: RateLimiter;

  constructor(
    private store: IHiveStore,
    private config: HiveBackendConfig,
  ) {
    this.llmRateLimiter = new RateLimiter(config.collision.semantic.llm_rate_limit_per_min);

    if (config.collision.semantic.llm_enabled && config.collision.semantic.llm_provider) {
      try {
        this.llmProvider = createLLMProvider({
          provider: config.collision.semantic.llm_provider as 'openai' | 'anthropic' | 'ollama' | 'generic',
          api_key: config.collision.semantic.llm_api_key,
          base_url: config.collision.semantic.llm_base_url,
          model: config.collision.semantic.llm_model,
        });
      } catch {
        // LLM provider failed to initialize — L3c will be silently disabled.
        // This keeps the server running even if LLM config is invalid.
        this.llmProvider = null;
      }
    }
  }

  async checkFileCollision(session_id: string, file_path: string, repo: string): Promise<Collision[]> {
    const activeSessions = await this.store.getActiveSessions(
      this.config.collision.scope === 'repo' ? repo : undefined
    );
    const others = activeSessions.filter(s => s.session_id !== session_id);
    const existing = await this.store.getActiveCollisions();
    const collisions: Collision[] = [];

    for (const other of others) {
      const pairIds = [session_id, other.session_id].sort();

      // L1: Exact file match
      if (other.files_touched.includes(file_path)) {
        const alreadyExists = existing.some(
          c => c.type === 'file' &&
               c.session_ids.sort().join(',') === pairIds.join(',') &&
               c.details.includes(file_path)
        );
        if (!alreadyExists) {
          const collision = await this.store.createCollision({
            session_ids: pairIds,
            type: 'file',
            severity: 'critical',
            details: `Both sessions modifying ${file_path} in ${repo}`,
            detected_at: new Date().toISOString(),
          });
          collisions.push(collision);
        } else {
          collisions.push(...existing.filter(
            c => c.type === 'file' && c.details.includes(file_path) &&
                 c.session_ids.sort().join(',') === pairIds.join(',')
          ));
        }
        continue;
      }

      // L2: Same directory
      const dir = dirname(file_path);
      const otherDirs = other.files_touched.map(f => dirname(f));
      if (otherDirs.includes(dir)) {
        const alreadyExists = existing.some(
          c => c.type === 'directory' &&
               c.session_ids.sort().join(',') === pairIds.join(',') &&
               c.details.includes(dir)
        );
        if (!alreadyExists) {
          const collision = await this.store.createCollision({
            session_ids: pairIds,
            type: 'directory',
            severity: 'warning',
            details: `Both sessions working in ${dir}/ in ${repo}`,
            detected_at: new Date().toISOString(),
          });
          collisions.push(collision);
        }
      }
    }

    return collisions;
  }

  async checkIntentCollision(session_id: string, intent: string, repo: string): Promise<Collision[]> {
    if (!this.config.collision.semantic.keywords_enabled) return [];

    const activeSessions = await this.store.getActiveSessions(
      this.config.collision.scope === 'repo' ? repo : undefined
    );
    const others = activeSessions.filter(s => s.session_id !== session_id && s.intent);
    const collisions: Collision[] = [];

    for (const other of others) {
      const score = keywordOverlap(intent, other.intent!);
      if (score < 0.3) continue;

      // L3a found potential overlap — now run L3c LLM filter if enabled
      const llmResult = await this.checkLLMCollision(intent, other.intent!);

      // If LLM ran and says no overlap, skip this pair
      if (llmResult !== null && !llmResult.overlap) continue;

      // Build details string — include LLM explanation if available
      let details = `Possible overlap: "${truncate(intent, 60)}" vs "${truncate(other.intent!, 60)}" (keyword: ${score.toFixed(2)})`;
      if (llmResult !== null) {
        details += ` (llm: ${llmResult.confidence.toFixed(2)} — ${llmResult.explanation})`;
      }

      const collision = await this.store.createCollision({
        session_ids: [session_id, other.session_id],
        type: 'semantic',
        severity: 'info',
        details,
        detected_at: new Date().toISOString(),
      });
      collisions.push(collision);
    }

    return collisions;
  }

  /**
   * L3c: LLM-based deep semantic comparison.
   *
   * Returns null if LLM is disabled, rate-limited, or errored (allowing the
   * collision to proceed based on cheaper tiers alone). Returns the LLM result
   * only when the provider responds successfully and the confidence meets the
   * configured threshold.
   *
   * When the LLM says overlap=true but confidence < threshold, returns null
   * (treat as inconclusive — fall back to cheaper tier's judgment).
   *
   * When the LLM says overlap=false with confidence >= threshold, returns
   * the result so the caller can filter out the false positive.
   */
  private async checkLLMCollision(
    intentA: string,
    intentB: string,
  ): Promise<{ overlap: boolean; confidence: number; explanation: string } | null> {
    if (!this.llmProvider) return null;
    if (!this.llmRateLimiter.canProceed()) return null;

    try {
      this.llmRateLimiter.record();
      const result = await this.llmProvider.compare(intentA, intentB);
      const threshold = this.config.collision.semantic.llm_confidence_threshold;

      // Low-confidence results are inconclusive — return null to fall back
      if (result.confidence < threshold) return null;

      return result;
    } catch {
      // LLM errors are non-fatal. The collision pipeline continues using
      // cheaper tier results. Log would happen at a higher level.
      return null;
    }
  }

  // Exposed for testing only
  get _llmProvider(): LLMProvider | null {
    return this.llmProvider;
  }
  get _llmRateLimiter(): RateLimiter {
    return this.llmRateLimiter;
  }
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either',
  'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than',
  'too', 'very', 'just', 'because', 'if', 'when', 'while', 'this',
  'that', 'these', 'those', 'i', 'me', 'my', 'we', 'our', 'you',
  'your', 'he', 'him', 'his', 'she', 'her', 'it', 'its', 'they',
  'them', 'their', 'what', 'which', 'who', 'whom', 'how', 'where',
  'fix', 'add', 'update', 'change', 'make', 'get', 'set', 'use',
  'implement', 'create', 'remove', 'delete', 'refactor', 'improve',
]);

function extractKeywords(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s-_]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
  );
}

function keywordOverlap(a: string, b: string): number {
  const ka = extractKeywords(a);
  const kb = extractKeywords(b);
  if (ka.size === 0 || kb.size === 0) return 0;
  const intersection = new Set([...ka].filter(k => kb.has(k)));
  const union = new Set([...ka, ...kb]);
  return intersection.size / union.size;
}

function truncate(s: string, len: number): string {
  return s.length > len ? s.slice(0, len) + '...' : s;
}
```

### Step 5: Create tests

Create `packages/backend/src/services/llm-provider.test.ts`:

```typescript
import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseComparisonResponse,
  RateLimiter,
  createLLMProvider,
  SYSTEM_PROMPT,
  buildUserMessage,
  type LLMProvider,
  type LLMComparisonResult,
} from './llm-provider.js';
import { DatabaseSync } from 'node:sqlite';
import { HiveStore } from '../db/store.js';
import { CollisionEngine } from './collision-engine.js';
import type { HiveBackendConfig } from '@open-hive/shared';

// ─── Helpers ─────────────────────────────────────────────

function createTestConfig(overrides?: Partial<HiveBackendConfig['collision']['semantic']>): HiveBackendConfig {
  return {
    port: 3000,
    database: { type: 'sqlite', url: ':memory:' },
    collision: {
      scope: 'org',
      semantic: {
        keywords_enabled: true,
        embeddings_enabled: false,
        llm_enabled: false,
        llm_confidence_threshold: 0.7,
        llm_rate_limit_per_min: 10,
        ...overrides,
      },
    },
    webhooks: { urls: [] },
    session: { heartbeat_interval_seconds: 30, idle_timeout_seconds: 300 },
  };
}

function createTestDB(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE sessions (
      session_id TEXT PRIMARY KEY,
      developer_email TEXT NOT NULL,
      developer_name TEXT NOT NULL,
      repo TEXT NOT NULL,
      project_path TEXT NOT NULL,
      started_at TEXT NOT NULL,
      last_activity TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      intent TEXT,
      files_touched TEXT NOT NULL DEFAULT '[]',
      areas TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE signals (
      signal_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(session_id),
      timestamp TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      file_path TEXT,
      semantic_area TEXT
    );
    CREATE TABLE collisions (
      collision_id TEXT PRIMARY KEY,
      session_ids TEXT NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      details TEXT NOT NULL,
      detected_at TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      resolved_by TEXT
    );
  `);
  return db;
}

async function seedSession(store: HiveStore, id: string, name: string, repo = 'test-repo') {
  await store.createSession({
    session_id: id,
    developer_email: `${name.toLowerCase()}@test.com`,
    developer_name: name,
    repo,
    project_path: `/code/${repo}`,
    started_at: new Date().toISOString(),
    intent: null,
  });
}

/** A mock LLM provider that returns a predefined result */
class MockLLMProvider implements LLMProvider {
  calls: Array<{ intentA: string; intentB: string }> = [];
  result: LLMComparisonResult = { overlap: true, confidence: 0.9, explanation: 'Mock overlap' };
  shouldThrow = false;

  async compare(intentA: string, intentB: string): Promise<LLMComparisonResult> {
    this.calls.push({ intentA, intentB });
    if (this.shouldThrow) throw new Error('Mock LLM error');
    return this.result;
  }
}

// ─── parseComparisonResponse ─────────────────────────────

describe('parseComparisonResponse', () => {
  it('parses clean JSON response', () => {
    const raw = '{"overlap": true, "confidence": 0.85, "explanation": "Both modify auth module"}';
    const result = parseComparisonResponse(raw);

    assert.equal(result.overlap, true);
    assert.equal(result.confidence, 0.85);
    assert.equal(result.explanation, 'Both modify auth module');
  });

  it('parses JSON wrapped in markdown code fences', () => {
    const raw = '```json\n{"overlap": false, "confidence": 0.2, "explanation": "Different features"}\n```';
    const result = parseComparisonResponse(raw);

    assert.equal(result.overlap, false);
    assert.equal(result.confidence, 0.2);
    assert.equal(result.explanation, 'Different features');
  });

  it('parses JSON with surrounding prose text', () => {
    const raw = 'Here is my analysis:\n{"overlap": true, "confidence": 0.75, "explanation": "Same endpoint"}\nHope that helps!';
    const result = parseComparisonResponse(raw);

    assert.equal(result.overlap, true);
    assert.equal(result.confidence, 0.75);
  });

  it('extracts fields via regex when JSON is malformed but fields present', () => {
    // Missing closing brace, but fields are individually parseable
    const raw = '{"overlap": true, "confidence": 0.6, "explanation": "Partial overlap"';
    const result = parseComparisonResponse(raw);

    assert.equal(result.overlap, true);
    assert.equal(result.confidence, 0.6);
    assert.equal(result.explanation, 'Partial overlap');
  });

  it('clamps confidence to 0-1 range', () => {
    const raw = '{"overlap": true, "confidence": 1.5, "explanation": "Over-confident"}';
    const result = parseComparisonResponse(raw);

    assert.equal(result.confidence, 1.0);
  });

  it('throws on completely unparseable response', () => {
    assert.throws(
      () => parseComparisonResponse('I cannot help with that request.'),
      /Failed to parse LLM comparison response/
    );
  });
});

// ─── Prompt Construction ─────────────────────────────────

describe('Prompt construction', () => {
  it('system prompt contains key instructions', () => {
    assert.ok(SYSTEM_PROMPT.includes('overlap'));
    assert.ok(SYSTEM_PROMPT.includes('confidence'));
    assert.ok(SYSTEM_PROMPT.includes('explanation'));
    assert.ok(SYSTEM_PROMPT.includes('OVERLAPPING'));
    assert.ok(SYSTEM_PROMPT.includes('NON-OVERLAPPING'));
    assert.ok(SYSTEM_PROMPT.includes('valid JSON'));
  });

  it('user message includes both intents', () => {
    const msg = buildUserMessage('fix auth bug', 'update login flow');
    assert.ok(msg.includes('fix auth bug'));
    assert.ok(msg.includes('update login flow'));
    assert.ok(msg.includes('Intent A'));
    assert.ok(msg.includes('Intent B'));
  });
});

// ─── RateLimiter ─────────────────────────────────────────

describe('RateLimiter', () => {
  it('allows requests under the limit', () => {
    const limiter = new RateLimiter(5);
    assert.equal(limiter.canProceed(), true);
    limiter.record();
    limiter.record();
    limiter.record();
    assert.equal(limiter.canProceed(), true);
    assert.equal(limiter.currentCount, 3);
  });

  it('blocks requests at the limit', () => {
    const limiter = new RateLimiter(2);
    limiter.record();
    limiter.record();
    assert.equal(limiter.canProceed(), false);
    assert.equal(limiter.currentCount, 2);
  });
});

// ─── createLLMProvider factory ───────────────────────────

describe('createLLMProvider', () => {
  it('creates OpenAI provider with api key', () => {
    const provider = createLLMProvider({ provider: 'openai', api_key: 'sk-test' });
    assert.ok(provider);
  });

  it('creates Anthropic provider with api key', () => {
    const provider = createLLMProvider({ provider: 'anthropic', api_key: 'sk-ant-test' });
    assert.ok(provider);
  });

  it('creates Ollama provider without api key', () => {
    const provider = createLLMProvider({ provider: 'ollama' });
    assert.ok(provider);
  });

  it('creates Generic provider with api key and base url', () => {
    const provider = createLLMProvider({
      provider: 'generic',
      api_key: 'key',
      base_url: 'https://openrouter.ai/api/v1',
    });
    assert.ok(provider);
  });

  it('throws when OpenAI provider missing api key', () => {
    assert.throws(
      () => createLLMProvider({ provider: 'openai' }),
      /LLM_API_KEY required/
    );
  });

  it('throws when generic provider missing base url', () => {
    assert.throws(
      () => createLLMProvider({ provider: 'generic', api_key: 'key' }),
      /LLM_BASE_URL required/
    );
  });

  it('throws for unknown provider', () => {
    assert.throws(
      () => createLLMProvider({ provider: 'imaginary' as 'openai' }),
      /Unknown LLM provider/
    );
  });
});

// ─── CollisionEngine L3c integration ─────────────────────

describe('CollisionEngine — L3c LLM collisions', () => {
  let db: DatabaseSync;
  let store: HiveStore;

  beforeEach(() => {
    db = createTestDB();
    store = new HiveStore(db);
  });

  it('does not create LLM provider when llm_enabled is false', () => {
    const engine = new CollisionEngine(store, createTestConfig({ llm_enabled: false }));
    assert.equal(engine._llmProvider, null);
  });

  it('L3c filters out false positives from L3a keyword matches', async () => {
    // Create an engine with a mock LLM provider that says NO overlap
    const config = createTestConfig({
      llm_enabled: true,
      llm_provider: 'ollama',
      llm_confidence_threshold: 0.7,
      llm_rate_limit_per_min: 100,
    });
    const engine = new CollisionEngine(store, config);

    // Replace the real provider with our mock that says no overlap
    const mockProvider = new MockLLMProvider();
    mockProvider.result = { overlap: false, confidence: 0.9, explanation: 'Different concerns' };
    (engine as unknown as { llmProvider: LLMProvider }).llmProvider = mockProvider;

    await seedSession(store, 'sess-a', 'Alice');
    await seedSession(store, 'sess-b', 'Bob');
    db.prepare('UPDATE sessions SET intent = ? WHERE session_id = ?')
      .run('fix auth token refresh bug in login flow', 'sess-a');

    // This intent shares keywords with sess-a (L3a would flag it)
    const collisions = await engine.checkIntentCollision(
      'sess-b', 'fix auth token expiry logic in login handler', 'test-repo'
    );

    // LLM said no overlap, so collision should be filtered out
    assert.equal(collisions.length, 0);
    assert.equal(mockProvider.calls.length, 1);
  });

  it('L3c confirms true positives and enriches collision details', async () => {
    const config = createTestConfig({
      llm_enabled: true,
      llm_provider: 'ollama',
      llm_confidence_threshold: 0.7,
      llm_rate_limit_per_min: 100,
    });
    const engine = new CollisionEngine(store, config);

    const mockProvider = new MockLLMProvider();
    mockProvider.result = { overlap: true, confidence: 0.95, explanation: 'Both modifying auth token handling' };
    (engine as unknown as { llmProvider: LLMProvider }).llmProvider = mockProvider;

    await seedSession(store, 'sess-a', 'Alice');
    await seedSession(store, 'sess-b', 'Bob');
    db.prepare('UPDATE sessions SET intent = ? WHERE session_id = ?')
      .run('fix auth token refresh bug in login flow', 'sess-a');

    const collisions = await engine.checkIntentCollision(
      'sess-b', 'fix auth token expiry logic in login handler', 'test-repo'
    );

    assert.equal(collisions.length, 1);
    assert.ok(collisions[0].details.includes('llm: 0.95'));
    assert.ok(collisions[0].details.includes('Both modifying auth token handling'));
  });

  it('falls back to keyword-only when LLM is rate-limited', async () => {
    const config = createTestConfig({
      llm_enabled: true,
      llm_provider: 'ollama',
      llm_confidence_threshold: 0.7,
      llm_rate_limit_per_min: 1, // Very low limit
    });
    const engine = new CollisionEngine(store, config);

    const mockProvider = new MockLLMProvider();
    mockProvider.result = { overlap: false, confidence: 0.9, explanation: 'No overlap' };
    (engine as unknown as { llmProvider: LLMProvider }).llmProvider = mockProvider;

    // Exhaust the rate limit
    engine._llmRateLimiter.record();

    await seedSession(store, 'sess-a', 'Alice');
    await seedSession(store, 'sess-b', 'Bob');
    db.prepare('UPDATE sessions SET intent = ? WHERE session_id = ?')
      .run('fix auth token refresh bug in login flow', 'sess-a');

    const collisions = await engine.checkIntentCollision(
      'sess-b', 'fix auth token expiry logic in login handler', 'test-repo'
    );

    // LLM was rate-limited, so keyword-only result stands (collision created)
    assert.equal(collisions.length, 1);
    // LLM was not called
    assert.equal(mockProvider.calls.length, 0);
  });

  it('falls back to keyword-only when LLM throws an error', async () => {
    const config = createTestConfig({
      llm_enabled: true,
      llm_provider: 'ollama',
      llm_confidence_threshold: 0.7,
      llm_rate_limit_per_min: 100,
    });
    const engine = new CollisionEngine(store, config);

    const mockProvider = new MockLLMProvider();
    mockProvider.shouldThrow = true;
    (engine as unknown as { llmProvider: LLMProvider }).llmProvider = mockProvider;

    await seedSession(store, 'sess-a', 'Alice');
    await seedSession(store, 'sess-b', 'Bob');
    db.prepare('UPDATE sessions SET intent = ? WHERE session_id = ?')
      .run('fix auth token refresh bug in login flow', 'sess-a');

    const collisions = await engine.checkIntentCollision(
      'sess-b', 'fix auth token expiry logic in login handler', 'test-repo'
    );

    // LLM errored — keyword result stands
    assert.equal(collisions.length, 1);
    assert.equal(mockProvider.calls.length, 1);
  });

  it('treats low-confidence LLM results as inconclusive', async () => {
    const config = createTestConfig({
      llm_enabled: true,
      llm_provider: 'ollama',
      llm_confidence_threshold: 0.7,
      llm_rate_limit_per_min: 100,
    });
    const engine = new CollisionEngine(store, config);

    const mockProvider = new MockLLMProvider();
    // LLM says no overlap but with low confidence — should be treated as inconclusive
    mockProvider.result = { overlap: false, confidence: 0.4, explanation: 'Unclear' };
    (engine as unknown as { llmProvider: LLMProvider }).llmProvider = mockProvider;

    await seedSession(store, 'sess-a', 'Alice');
    await seedSession(store, 'sess-b', 'Bob');
    db.prepare('UPDATE sessions SET intent = ? WHERE session_id = ?')
      .run('fix auth token refresh bug in login flow', 'sess-a');

    const collisions = await engine.checkIntentCollision(
      'sess-b', 'fix auth token expiry logic in login handler', 'test-repo'
    );

    // Low confidence means inconclusive — keyword result stands
    assert.equal(collisions.length, 1);
    // Details should NOT include LLM info since result was below threshold
    assert.ok(!collisions[0].details.includes('llm:'));
  });
});
```

## Verify

```bash
npm run build && npm test
```

Confirm:
- [ ] Build succeeds with no type errors
- [ ] All existing tests (L1, L2, L3a, store, scope) still pass
- [ ] All 14 new L3c tests pass (6 parseComparisonResponse + 2 prompt + 2 rate limiter + 7 factory + 7 engine integration -- some are grouped)
- [ ] With `SEMANTIC_LLM` unset or `false`, the server starts normally and L3c is completely inert (backward compat)
- [ ] Manual smoke test: set `SEMANTIC_LLM=true`, `LLM_PROVIDER=ollama`, `LLM_MODEL=llama3.2`, start Ollama, create two sessions with overlapping intents, verify the collision details include an LLM explanation

## Configuration

Add to `.env.example`:

```bash
# ─── L3c: LLM-based semantic collision detection ─────────
# This is the most expensive collision tier. It only fires when cheaper
# tiers (L3a keywords, L3b embeddings) have already detected potential overlap.
# Leave SEMANTIC_LLM unset or false to disable.

# Enable LLM collision detection (true | false). Default: false
SEMANTIC_LLM=false

# LLM provider (openai | anthropic | ollama | generic)
LLM_PROVIDER=

# API key for the LLM provider (not needed for ollama)
LLM_API_KEY=

# Base URL override. Required for 'generic' provider. Optional for others.
# Examples:
#   OpenAI:     https://api.openai.com/v1        (default)
#   Anthropic:  https://api.anthropic.com         (default)
#   Ollama:     http://localhost:11434             (default)
#   OpenRouter: https://openrouter.ai/api/v1
#   Together:   https://api.together.xyz/v1
#   LM Studio:  http://localhost:1234/v1
LLM_BASE_URL=

# Model to use. Defaults vary by provider:
#   OpenAI:    gpt-4o-mini
#   Anthropic: claude-haiku-4-20250414
#   Ollama:    llama3.2
#   Generic:   (must be specified)
LLM_MODEL=

# Minimum confidence (0.0-1.0) for the LLM result to be used.
# Below this threshold, the result is treated as inconclusive and
# the collision falls back to cheaper tier judgment. Default: 0.7
LLM_CONFIDENCE_THRESHOLD=0.7

# Maximum LLM API calls per minute. Protects against runaway costs
# in high-traffic environments. Default: 10
LLM_RATE_LIMIT_PER_MIN=10
```

### Provider configuration examples

**OpenAI (recommended for lowest latency)**:
```bash
SEMANTIC_LLM=true
LLM_PROVIDER=openai
LLM_API_KEY=sk-proj-...
LLM_MODEL=gpt-4o-mini
```

**Anthropic**:
```bash
SEMANTIC_LLM=true
LLM_PROVIDER=anthropic
LLM_API_KEY=sk-ant-api03-...
LLM_MODEL=claude-haiku-4-20250414
```

**Ollama (free, local, no API key)**:
```bash
SEMANTIC_LLM=true
LLM_PROVIDER=ollama
LLM_BASE_URL=http://localhost:11434
LLM_MODEL=llama3.2
```

**OpenRouter (access to many models via one API)**:
```bash
SEMANTIC_LLM=true
LLM_PROVIDER=generic
LLM_API_KEY=sk-or-v1-...
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_MODEL=meta-llama/llama-3.1-8b-instruct
```

**Together AI**:
```bash
SEMANTIC_LLM=true
LLM_PROVIDER=generic
LLM_API_KEY=...
LLM_BASE_URL=https://api.together.xyz/v1
LLM_MODEL=meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo
```

**LM Studio (local, no API key needed -- use generic with empty-ish key)**:
```bash
SEMANTIC_LLM=true
LLM_PROVIDER=generic
LLM_API_KEY=lm-studio
LLM_BASE_URL=http://localhost:1234/v1
LLM_MODEL=default
```

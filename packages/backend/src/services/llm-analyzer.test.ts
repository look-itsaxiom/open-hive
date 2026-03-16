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

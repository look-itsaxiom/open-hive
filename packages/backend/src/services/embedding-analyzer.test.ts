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

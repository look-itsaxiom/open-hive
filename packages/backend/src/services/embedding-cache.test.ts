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

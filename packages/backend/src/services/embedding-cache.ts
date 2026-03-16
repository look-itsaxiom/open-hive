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

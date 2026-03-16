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

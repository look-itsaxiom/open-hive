import type { ISemanticAnalyzer, SemanticMatch } from '@open-hive/shared';

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

export function extractKeywords(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s-_]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
  );
}

export function keywordOverlap(a: string, b: string): number {
  const ka = extractKeywords(a);
  const kb = extractKeywords(b);
  if (ka.size === 0 || kb.size === 0) return 0;
  const intersection = new Set([...ka].filter(k => kb.has(k)));
  const union = new Set([...ka, ...kb]);
  return intersection.size / union.size;
}

export class KeywordAnalyzer implements ISemanticAnalyzer {
  readonly name = 'keyword-jaccard';
  readonly tier = 'L3a' as const;

  private threshold: number;

  constructor(threshold = 0.3) {
    this.threshold = threshold;
  }

  async compare(a: string, b: string): Promise<SemanticMatch | null> {
    const score = keywordOverlap(a, b);
    if (score < this.threshold) return null;

    const ka = extractKeywords(a);
    const kb = extractKeywords(b);
    const shared = [...ka].filter(k => kb.has(k));

    return {
      score,
      tier: this.tier,
      explanation: `Keyword overlap (Jaccard ${score.toFixed(2)}): ${shared.join(', ')}`,
    };
  }
}

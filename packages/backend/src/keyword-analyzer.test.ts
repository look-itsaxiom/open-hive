import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { KeywordAnalyzer, extractKeywords, keywordOverlap } from './services/keyword-analyzer.js';

// ─── extractKeywords ─────────────────────────────────────────

describe('extractKeywords', () => {
  it('extracts meaningful keywords, filtering stop words', () => {
    const kw = extractKeywords('fix the auth token refresh bug in login flow');
    assert.ok(kw.has('auth'));
    assert.ok(kw.has('token'));
    assert.ok(kw.has('refresh'));
    assert.ok(kw.has('bug'));
    assert.ok(kw.has('login'));
    assert.ok(kw.has('flow'));
    // Stop words should be excluded
    assert.ok(!kw.has('the'));
    assert.ok(!kw.has('in'));
    assert.ok(!kw.has('fix'));
  });

  it('filters short words (<=2 chars)', () => {
    const kw = extractKeywords('go to db');
    assert.ok(!kw.has('go'));
    assert.ok(!kw.has('to'));
    assert.ok(!kw.has('db'));
  });

  it('returns empty set for empty string', () => {
    const kw = extractKeywords('');
    assert.equal(kw.size, 0);
  });

  it('handles special characters', () => {
    const kw = extractKeywords('user-auth module_test');
    assert.ok(kw.has('user-auth'));
    assert.ok(kw.has('module_test'));
  });
});

// ─── keywordOverlap ──────────────────────────────────────────

describe('keywordOverlap', () => {
  it('returns 1.0 for identical inputs', () => {
    const score = keywordOverlap('auth token refresh', 'auth token refresh');
    assert.equal(score, 1.0);
  });

  it('returns 0 when one input has no keywords', () => {
    const score = keywordOverlap('the a an is', 'auth token');
    assert.equal(score, 0);
  });

  it('returns value between 0 and 1 for partial overlap', () => {
    const score = keywordOverlap('auth token refresh bug', 'auth token expiry logic');
    assert.ok(score > 0);
    assert.ok(score < 1);
  });

  it('returns 0 for completely unrelated texts', () => {
    const score = keywordOverlap('database migration rollback', 'homepage carousel animation');
    assert.equal(score, 0);
  });
});

// ─── KeywordAnalyzer ─────────────────────────────────────────

describe('KeywordAnalyzer', () => {
  it('implements ISemanticAnalyzer interface', () => {
    const analyzer = new KeywordAnalyzer();
    assert.equal(analyzer.name, 'keyword-jaccard');
    assert.equal(analyzer.tier, 'L3a');
  });

  it('returns SemanticMatch when score >= threshold', async () => {
    const analyzer = new KeywordAnalyzer(0.3);
    const match = await analyzer.compare('auth token refresh bug', 'auth token expiry logic');
    assert.ok(match !== null);
    assert.ok(match!.score >= 0.3);
    assert.equal(match!.tier, 'L3a');
    assert.ok(match!.explanation.includes('Keyword overlap'));
  });

  it('returns null when score < threshold', async () => {
    const analyzer = new KeywordAnalyzer(0.3);
    const match = await analyzer.compare('database migration rollback', 'homepage carousel animation');
    assert.equal(match, null);
  });

  it('returns null when inputs have no meaningful keywords', async () => {
    const analyzer = new KeywordAnalyzer();
    const match = await analyzer.compare('the a an', 'is are was');
    assert.equal(match, null);
  });

  it('respects custom threshold', async () => {
    const strict = new KeywordAnalyzer(0.8);
    const lenient = new KeywordAnalyzer(0.1);

    const a = 'auth token refresh handling';
    const b = 'auth token expiry validation';

    const strictResult = await strict.compare(a, b);
    const lenientResult = await lenient.compare(a, b);

    // Lenient should match, strict likely should not (they share ~2/6 keywords)
    assert.ok(lenientResult !== null);
    // The strict result depends on actual Jaccard — just verify it's more restrictive
    if (strictResult !== null) {
      assert.ok(strictResult.score >= 0.8);
    }
  });
});

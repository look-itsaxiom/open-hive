import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DecayService } from './decay-service.js';

describe('DecayService', () => {
  const service = new DecayService({
    enabled: true,
    default_half_life_seconds: 3600, // 1 hour
    type_overrides: { blocker_hit: 7200 }, // 2 hours for blockers
    floor: 0.01,
  });

  it('returns ~1.0 for a brand new signal', () => {
    const now = new Date().toISOString();
    const weight = service.calculateWeight(now, 'file_modify');
    assert.ok(weight > 0.999, `Expected ~1.0, got ${weight}`);
  });

  it('returns ~0.5 after one half-life', () => {
    const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
    const weight = service.calculateWeight(oneHourAgo, 'file_modify');
    assert.ok(weight > 0.49 && weight < 0.51, `Expected ~0.5, got ${weight}`);
  });

  it('respects type-specific half-life overrides', () => {
    const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
    const weight = service.calculateWeight(oneHourAgo, 'blocker_hit');
    // blocker_hit has 2h half-life, so after 1h it should be ~0.707
    assert.ok(weight > 0.69 && weight < 0.72, `Expected ~0.707, got ${weight}`);
  });

  it('never drops below floor', () => {
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const weight = service.calculateWeight(weekAgo, 'file_modify');
    assert.equal(weight, 0.01);
  });

  it('returns 1.0 when decay is disabled', () => {
    const disabled = new DecayService({
      enabled: false,
      default_half_life_seconds: 3600,
      type_overrides: {},
      floor: 0.01,
    });
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    assert.equal(disabled.calculateWeight(weekAgo, 'file_modify'), 1.0);
  });

  it('applies weight to an array of signals and sorts by weighted relevance', () => {
    const signals = [
      { timestamp: new Date(Date.now() - 7200 * 1000).toISOString(), type: 'file_modify' as const },
      { timestamp: new Date(Date.now() - 60 * 1000).toISOString(), type: 'file_modify' as const },
      { timestamp: new Date(Date.now() - 86400 * 1000).toISOString(), type: 'file_modify' as const },
    ];
    const weighted = service.applyDecay(signals);
    // Should be sorted by weight descending (freshest first)
    assert.ok(weighted[0].weight > weighted[1].weight);
    assert.ok(weighted[1].weight > weighted[2].weight);
  });
});

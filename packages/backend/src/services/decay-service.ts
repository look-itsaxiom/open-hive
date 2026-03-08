export interface DecayConfig {
  enabled: boolean;
  default_half_life_seconds: number;
  type_overrides: Partial<Record<string, number>>;
  floor: number;
}

export class DecayService {
  constructor(private config: DecayConfig) {}

  /**
   * Calculate the current weight of a signal based on its age and type.
   * Uses exponential decay: weight = max(floor, 2^(-age/half_life))
   */
  calculateWeight(timestamp: string, type: string): number {
    if (!this.config.enabled) return 1.0;

    const ageSeconds = (Date.now() - new Date(timestamp).getTime()) / 1000;
    if (ageSeconds <= 0) return 1.0;

    const halfLife =
      this.config.type_overrides[type] ?? this.config.default_half_life_seconds;
    const weight = Math.pow(2, -(ageSeconds / halfLife));

    return Math.max(this.config.floor, weight);
  }

  /**
   * Apply decay weights to an array of objects with timestamp + type,
   * returning them sorted by weight descending (most relevant first).
   */
  applyDecay<T extends { timestamp: string; type: string }>(
    items: T[],
  ): (T & { weight: number })[] {
    return items
      .map((item) => ({
        ...item,
        weight: this.calculateWeight(item.timestamp, item.type),
      }))
      .sort((a, b) => b.weight - a.weight);
  }
}

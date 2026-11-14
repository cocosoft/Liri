import {
  STAT_NAMES,
  RARITIES,
  RARITY_FLOOR,
  type StatName,
  type Rarity,
  type CompanionBones,
} from './types';

export interface AttributeDistribution {
  totalSamples: number;
  perStat: Record<StatName, { min: number; max: number; avg: number }>;
  perRarity: Record<Rarity, number>;
  shinyRate: number;
}

export class AttributeSystem {
  generateAttributes(bones: CompanionBones): Record<StatName, number> {
    return { ...bones.stats };
  }

  validateAttributes(attributes: Record<StatName, number>): boolean {
    if (!attributes || typeof attributes !== 'object') return false;
    for (const name of STAT_NAMES) {
      const val = attributes[name];
      if (typeof val !== 'number' || !Number.isFinite(val)) return false;
      if (val < 1 || val > 100) return false;
    }
    return true;
  }

  getAttributeDistribution(samples: CompanionBones[]): AttributeDistribution {
    const perStat = {} as Record<
      StatName,
      { min: number; max: number; avg: number }
    >;
    for (const name of STAT_NAMES) {
      const values = samples
        .map((s) => s.stats[name])
        .filter((v) => v !== undefined);
      perStat[name] = {
        min: Math.min(...values),
        max: Math.max(...values),
        avg: values.reduce((a, b) => a + b, 0) / values.length,
      };
    }

    const perRarity = {} as Record<Rarity, number>;
    for (const r of RARITIES) {
      perRarity[r] = samples.filter((s) => s.rarity === r).length;
    }

    const shinyCount = samples.filter((s) => s.shiny).length;

    return {
      totalSamples: samples.length,
      perStat,
      perRarity,
      shinyRate: samples.length > 0 ? shinyCount / samples.length : 0,
    };
  }
}

export { RARITY_FLOOR };

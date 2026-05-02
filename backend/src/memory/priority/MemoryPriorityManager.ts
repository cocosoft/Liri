export enum PriorityTier {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
  ARCHIVE = 'archive',
}

export interface PriorityConfig {
  criticalThreshold: number;
  highThreshold: number;
  mediumThreshold: number;
  lowThreshold: number;
  autoDowngradeEnabled: boolean;
  downgradeAfterDays: number;
}

export interface MemoryPriority {
  memoryId: string;
  tier: PriorityTier;
  score: number;
  factors: PriorityFactor[];
  assignedAt: number;
  lastUpdated: number;
}

export interface PriorityFactor {
  name: string;
  weight: number;
  value: number;
}

export interface IPriorityManager {
  assignPriority(memoryId: string, factors: PriorityFactor[]): MemoryPriority;
  getPriority(memoryId: string): MemoryPriority | undefined;
  updatePriority(memoryId: string, factors: PriorityFactor[]): MemoryPriority;
  batchAssignPriorities(assignments: { memoryId: string; factors: PriorityFactor[] }[]): MemoryPriority[];
  getMemoriesByTier(tier: PriorityTier): string[];
  getTierDistribution(): Record<PriorityTier, number>;
  recalculateAll(): number;
  clear(): void;
}

const DEFAULT_CONFIG: PriorityConfig = {
  criticalThreshold: 0.9,
  highThreshold: 0.7,
  mediumThreshold: 0.4,
  lowThreshold: 0.2,
  autoDowngradeEnabled: false,
  downgradeAfterDays: 30,
};

export function calculateScore(factors: PriorityFactor[]): number {
  if (factors.length === 0) return 0;
  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  if (totalWeight === 0) return 0;
  const weightedSum = factors.reduce((s, f) => s + f.weight * f.value, 0);
  return Math.min(1, Math.max(0, weightedSum / totalWeight));
}

export function scoreToTier(score: number, config: PriorityConfig = DEFAULT_CONFIG): PriorityTier {
  if (score >= config.criticalThreshold) return PriorityTier.CRITICAL;
  if (score >= config.highThreshold) return PriorityTier.HIGH;
  if (score >= config.mediumThreshold) return PriorityTier.MEDIUM;
  if (score >= config.lowThreshold) return PriorityTier.LOW;
  return PriorityTier.ARCHIVE;
}

export class MemoryPriorityManager implements IPriorityManager {
  private priorities: Map<string, MemoryPriority> = new Map();
  private config: PriorityConfig;

  constructor(config: Partial<PriorityConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  assignPriority(memoryId: string, factors: PriorityFactor[]): MemoryPriority {
    const score = calculateScore(factors);
    const tier = scoreToTier(score, this.config);
    const now = Date.now();
    const priority: MemoryPriority = {
      memoryId,
      tier,
      score,
      factors,
      assignedAt: now,
      lastUpdated: now,
    };
    this.priorities.set(memoryId, priority);
    return priority;
  }

  getPriority(memoryId: string): MemoryPriority | undefined {
    return this.priorities.get(memoryId);
  }

  updatePriority(memoryId: string, factors: PriorityFactor[]): MemoryPriority {
    const existing = this.priorities.get(memoryId);
    const score = calculateScore(factors);
    const tier = scoreToTier(score, this.config);
    const priority: MemoryPriority = {
      memoryId,
      tier,
      score,
      factors,
      assignedAt: existing?.assignedAt ?? Date.now(),
      lastUpdated: Date.now(),
    };
    this.priorities.set(memoryId, priority);
    return priority;
  }

  batchAssignPriorities(assignments: { memoryId: string; factors: PriorityFactor[] }[]): MemoryPriority[] {
    return assignments.map(a => this.assignPriority(a.memoryId, a.factors));
  }

  getMemoriesByTier(tier: PriorityTier): string[] {
    return Array.from(this.priorities.entries())
      .filter(([, p]) => p.tier === tier)
      .map(([id]) => id);
  }

  getTierDistribution(): Record<PriorityTier, number> {
    const dist: Record<string, number> = {};
    for (const t of Object.values(PriorityTier)) {
      dist[t] = 0;
    }
    for (const p of this.priorities.values()) {
      dist[p.tier] = (dist[p.tier] || 0) + 1;
    }
    return dist as Record<PriorityTier, number>;
  }

  recalculateAll(): number {
    let count = 0;
    for (const [id, priority] of this.priorities) {
      const newScore = calculateScore(priority.factors);
      const newTier = scoreToTier(newScore, this.config);
      if (newTier !== priority.tier) {
        priority.tier = newTier;
        priority.score = newScore;
        priority.lastUpdated = Date.now();
        count++;
      }
    }
    return count;
  }

  clear(): void {
    this.priorities.clear();
  }
}

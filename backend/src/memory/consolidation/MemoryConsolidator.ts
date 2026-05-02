export interface MergeCandidate {
  sourceIds: string[];
  targetContent: string;
  mergedTags: string[];
  confidence: number;
  reason: string;
}

export interface ConsolidationResult {
  mergedCount: number;
  removedIds: string[];
  createdId: string;
  spaceSaved: number;
  confidence: number;
}

export interface DedupResult {
  duplicates: string[][];
  totalRemoved: number;
  spaceSaved: number;
}

export interface ConsolidationConfig {
  similarityThreshold: number;
  maxMergeBatch: number;
  minContentLength: number;
  enabled: boolean;
}

export interface IConsolidator {
  findMergeCandidates(memories: { id: string; content: string; tags: string[]; createdAt: number }[]): MergeCandidate[];
  merge(candidate: MergeCandidate): ConsolidationResult;
  findDuplicates(memories: { id: string; content: string; createdAt: number }[]): DedupResult;
  getStats(): ConsolidationStats;
}

export interface ConsolidationStats {
  totalMerged: number;
  totalRemoved: number;
  totalSpaceSaved: number;
  lastMergeTime: number;
}

const DEFAULT_CONFIG: ConsolidationConfig = {
  similarityThreshold: 0.75,
  maxMergeBatch: 10,
  minContentLength: 20,
  enabled: true,
};

function jaccardSimilarity(a: string, b: string): number {
  const aWords = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const bWords = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  if (aWords.size === 0 && bWords.size === 0) return 1;
  if (aWords.size === 0 || bWords.size === 0) return 0;
  let intersection = 0;
  for (const w of aWords) {
    if (bWords.has(w)) intersection++;
  }
  const union = aWords.size + bWords.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export class MemoryConsolidator implements IConsolidator {
  private config: ConsolidationConfig;
  private stats: ConsolidationStats = {
    totalMerged: 0,
    totalRemoved: 0,
    totalSpaceSaved: 0,
    lastMergeTime: 0,
  };

  constructor(config: Partial<ConsolidationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  findMergeCandidates(memories: { id: string; content: string; tags: string[]; createdAt: number }[]): MergeCandidate[] {
    const candidates: MergeCandidate[] = [];
    const processed = new Set<string>();

    for (let i = 0; i < memories.length; i++) {
      if (processed.has(memories[i].id)) continue;
      for (let j = i + 1; j < memories.length; j++) {
        if (processed.has(memories[j].id)) continue;

        const similarity = jaccardSimilarity(memories[i].content, memories[j].content);
        if (similarity >= this.config.similarityThreshold) {
          const older = memories[i].createdAt <= memories[j].createdAt ? memories[i] : memories[j];
          const newer = memories[i].createdAt <= memories[j].createdAt ? memories[j] : memories[i];
          const mergedTags = [...new Set([...older.tags, ...newer.tags])];
          candidates.push({
            sourceIds: [older.id, newer.id],
            targetContent: `${older.content}\n\n${newer.content}`.substring(0, 2000),
            mergedTags,
            confidence: similarity,
            reason: `内容相似度 ${(similarity * 100).toFixed(0)}%`,
          });
          processed.add(older.id);
          processed.add(newer.id);
          break;
        }
      }
      if (candidates.length >= this.config.maxMergeBatch) break;
    }

    return candidates;
  }

  merge(candidate: MergeCandidate): ConsolidationResult {
    const createdId = `merged_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const spaceSaved = candidate.sourceIds.length > 0 ? candidate.sourceIds.length * 100 : 0;

    this.stats.totalMerged++;
    this.stats.totalRemoved += candidate.sourceIds.length;
    this.stats.totalSpaceSaved += spaceSaved;
    this.stats.lastMergeTime = Date.now();

    return {
      mergedCount: candidate.sourceIds.length,
      removedIds: candidate.sourceIds,
      createdId,
      spaceSaved,
      confidence: candidate.confidence,
    };
  }

  findDuplicates(memories: { id: string; content: string; createdAt: number }[]): DedupResult {
    const groups: string[][] = [];
    const processed = new Set<string>();

    for (let i = 0; i < memories.length; i++) {
      if (processed.has(memories[i].id)) continue;
      const group = [memories[i].id];
      processed.add(memories[i].id);
      for (let j = i + 1; j < memories.length; j++) {
        if (processed.has(memories[j].id)) continue;
        const sim = jaccardSimilarity(memories[i].content, memories[j].content);
        if (sim >= this.config.similarityThreshold) {
          group.push(memories[j].id);
          processed.add(memories[j].id);
        }
      }
      if (group.length > 1) groups.push(group);
    }

    const totalRemoved = groups.reduce((s, g) => s + g.length - 1, 0);
    return {
      duplicates: groups,
      totalRemoved,
      spaceSaved: totalRemoved * 100,
    };
  }

  getStats(): ConsolidationStats {
    return { ...this.stats };
  }
}

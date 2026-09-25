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
  findMergeCandidates(
    memories: {
      id: string;
      content: string;
      tags: string[];
      createdAt: number;
    }[]
  ): MergeCandidate[];
  merge(candidate: MergeCandidate): ConsolidationResult;
  findDuplicates(
    memories: { id: string; content: string; createdAt: number }[]
  ): DedupResult;
  /**
   * 分片版全库去重（D2）：每 `chunkPairs` 次比较让出事件循环；**结果与 `findDuplicates` 一致**。
   * 供空闲期维护使用（不在写入热路径调用）。
   */
  findDuplicatesChunked(
    memories: { id: string; content: string; createdAt: number }[],
    chunkPairs?: number
  ): Promise<DedupResult>;
  getStats(): ConsolidationStats;
  setSimilarityFunction(fn: SimilarityFunction): void;
}

/**
 * 相似度计算函数签名
 * 接收两个字符串，返回 [0, 1] 区间的相似度分数
 */
export type SimilarityFunction = (a: string, b: string) => number;

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

/** D2：分片去重每次让出前的比较次数上限（5000 次 ≈ 数十毫秒级同步块） */
const DEFAULT_DEDUP_CHUNK_PAIRS = 5000;

/** Phase 2: CJK bigram tokenizer for Jaccard similarity */
function tokenize(text: string): string[] {
  const lower = text.toLowerCase().trim();
  if (!lower) return [];

  // 检测是否主要为 CJK 文本
  const cjkCount = [...lower].filter((c) =>
    /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(
      c
    )
  ).length;
  const isCJK = cjkCount > lower.length * 0.3;

  if (isCJK) {
    const chars = [...lower];
    // 短文本 (≤3 字符) 用 unigram
    if (chars.length <= 3) {
      return chars;
    }
    // 长文本用 bigram
    const bigrams: string[] = [];
    for (let i = 0; i < chars.length - 1; i++) {
      bigrams.push(chars[i] + chars[i + 1]);
    }
    return bigrams;
  }

  // 非 CJK：保持原单词分词
  return lower.split(/\s+/).filter((w) => w.length > 1);
}

/** Set 级 Jaccard（D2′：预分词后调用，避免每对重复分词） */
function jaccardFromSets(aTokens: Set<string>, bTokens: Set<string>): number {
  if (aTokens.size === 0 && bTokens.size === 0) return 1;
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let intersection = 0;
  for (const w of aTokens) {
    if (bTokens.has(w)) intersection++;
  }
  const union = aTokens.size + bTokens.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** 字符串级 Jaccard（默认相似度函数；自定义/单点调用仍走它） */
function jaccardSimilarity(a: string, b: string): number {
  return jaccardFromSets(new Set(tokenize(a)), new Set(tokenize(b)));
}

export class MemoryConsolidator implements IConsolidator {
  private config: ConsolidationConfig;
  private stats: ConsolidationStats = {
    totalMerged: 0,
    totalRemoved: 0,
    totalSpaceSaved: 0,
    lastMergeTime: 0,
  };
  private similarityFn: SimilarityFunction = jaccardSimilarity;
  /**
   * 相似度函数是否仍为**默认 Jaccard**（D2′ 预分词只在该前提下成立）。
   * `setSimilarityFunction()` 一被调用即置 false ⇒ 退回"逐对调用自定义函数"，语义不变。
   */
  private usingDefaultSimilarity = true;

  constructor(config: Partial<ConsolidationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 替换相似度计算函数
   * 默认为 Jaccard 相似度，可替换为 Levenshtein、余弦相似度等
   * @param fn 相似度计算函数
   */
  setSimilarityFunction(fn: SimilarityFunction): void {
    this.similarityFn = fn;
    // 非默认实现 ⇒ 预分词（D2′）不再适用，退回逐对调用
    this.usingDefaultSimilarity = false;
  }

  findMergeCandidates(
    memories: {
      id: string;
      content: string;
      tags: string[];
      createdAt: number;
    }[]
  ): MergeCandidate[] {
    const candidates: MergeCandidate[] = [];
    const processed = new Set<string>();
    // D2′：预分词一次（仅默认 Jaccard 生效），循环内只做 Set 运算
    const tokenSets = this.buildTokenSets(memories);

    for (let i = 0; i < memories.length; i++) {
      if (processed.has(memories[i].id)) continue;
      for (let j = i + 1; j < memories.length; j++) {
        if (processed.has(memories[j].id)) continue;

        const similarity = this.similarityOf(
          memories[i],
          memories[j],
          tokenSets
        );
        if (similarity >= this.config.similarityThreshold) {
          const older =
            memories[i].createdAt <= memories[j].createdAt
              ? memories[i]
              : memories[j];
          const newer =
            memories[i].createdAt <= memories[j].createdAt
              ? memories[j]
              : memories[i];
          const mergedTags = [...new Set([...older.tags, ...newer.tags])];
          candidates.push({
            sourceIds: [older.id, newer.id],
            targetContent: `${older.content}\n\n${newer.content}`.substring(
              0,
              2000
            ),
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
    const spaceSaved =
      candidate.sourceIds.length > 0 ? candidate.sourceIds.length * 100 : 0;

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

  /**
   * 预分词（D2′）：每条文本**只分词一次**，之后循环内只做 Set 运算。
   *
   * 成本：`tokenize` 内含逐字符正则（`\p{Script=Han}`），n=576 时原实现会重复分词
   * **2 × 165,600 次**（每对都重分词两条），预分词后降为 **576 次**（详见
   * `.trae/specs/memory-dedup-blocking-rootfix.md` §1.1 基线）。
   *
   * 仅当相似度函数仍为**默认 Jaccard** 时可用（自定义函数无法预分词）⇒ 否则返回 `null`。
   */
  private buildTokenSets(
    memories: { id: string; content: string }[]
  ): Map<string, Set<string>> | null {
    if (!this.usingDefaultSimilarity) return null;
    const map = new Map<string, Set<string>>();
    for (const m of memories) {
      if (!map.has(m.id)) map.set(m.id, new Set(tokenize(m.content)));
    }
    return map;
  }

  /** 单对相似度：有预分词走 Set 级；否则退回字符串级（自定义函数/缺项兜底） */
  private similarityOf(
    a: { id: string; content: string },
    b: { id: string; content: string },
    tokenSets: Map<string, Set<string>> | null
  ): number {
    if (tokenSets) {
      const ta = tokenSets.get(a.id);
      const tb = tokenSets.get(b.id);
      if (ta && tb) return jaccardFromSets(ta, tb);
    }
    return this.similarityFn(a.content, b.content);
  }

  /**
   * 去重核心（**单一实现**，D2）：每累积 `chunkPairs` 次比较 `yield` 一次；
   * 最终 `return` 结果。`chunkPairs <= 0` 表示不让出（同步路径）。
   *
   * 同步入口 `findDuplicates` 消费到结束；异步入口 `findDuplicatesChunked`
   * 在每个 chunk 之后 `setImmediate` 让出事件循环（空闲期维护用，不冻结主线程）。
   */
  private *dedupCore(
    memories: { id: string; content: string; createdAt: number }[],
    chunkPairs: number
  ): Generator<number, DedupResult, void> {
    const groups: string[][] = [];
    const processed = new Set<string>();
    const tokenSets = this.buildTokenSets(memories);
    let compared = 0;

    for (let i = 0; i < memories.length; i++) {
      if (processed.has(memories[i].id)) continue;
      const group = [memories[i].id];
      processed.add(memories[i].id);
      for (let j = i + 1; j < memories.length; j++) {
        if (processed.has(memories[j].id)) continue;
        const sim = this.similarityOf(memories[i], memories[j], tokenSets);
        compared++;
        if (sim >= this.config.similarityThreshold) {
          group.push(memories[j].id);
          processed.add(memories[j].id);
        }
        if (chunkPairs > 0 && compared % chunkPairs === 0) yield compared;
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

  findDuplicates(
    memories: { id: string; content: string; createdAt: number }[]
  ): DedupResult {
    const it = this.dedupCore(memories, 0);
    let step = it.next();
    while (!step.done) step = it.next();
    return step.value;
  }

  /**
   * 分片版（D2）：每 `chunkPairs` 次比较让出一次事件循环。
   * **结果与 `findDuplicates` 逐字相同**（同一核心、同一判据），差别仅在让出。
   */
  async findDuplicatesChunked(
    memories: { id: string; content: string; createdAt: number }[],
    chunkPairs: number = DEFAULT_DEDUP_CHUNK_PAIRS
  ): Promise<DedupResult> {
    const it = this.dedupCore(memories, Math.max(1, chunkPairs));
    let step = it.next();
    while (!step.done) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      step = it.next();
    }
    return step.value;
  }

  getStats(): ConsolidationStats {
    return { ...this.stats };
  }
}

/**
 * 记忆冲突检测器
 * 检测记忆之间的信息冲突，如相同主题的不同描述
 */

import type { Memory } from '../types/Memory';

/**
 * 冲突类型
 */
export type ConflictType =
  | 'fact_value' // 事实值矛盾（如"年龄30" vs "年龄25"）
  | 'negation' // 肯定与否定冲突（如"是A" vs "不是A"）
  | 'relation' // 关系矛盾（如"属于X组" vs "属于Y组"）
  | 'temporal'; // 时间矛盾（如"创建于2024" vs "创建于2023"）

/**
 * 冲突检测结果
 */
export interface ConflictResult {
  memoryIdA: string;
  memoryIdB: string;
  conflictType: ConflictType;
  subject: string;
  valueA: string;
  valueB: string;
  confidence: number;
  description: string;
}

/**
 * 冲突检测配置
 */
export interface ConflictDetectionConfig {
  minContentLength: number;
  enabled: boolean;
}

const DEFAULT_CONFIG: ConflictDetectionConfig = {
  minContentLength: 10,
  enabled: true,
};

const FACT_PATTERNS = [
  /(?:\b\w+\s+)(?:是|为|叫|属于|位于|来自|拥有|包含)(?:\s+\w+)/g,
  /(?:\b\w+\s+)(?:is|was|are|were|has|have|belongs? to|located in|comes? from)\s+\w+/g,
];

const NEGATION_PATTERNS = [
  /不(?:是|会|能|在|有|属于)/g,
  /(?:not|never|no|without|except)\s+\w+/gi,
];

function extractFacts(content: string): Map<string, string[]> {
  const facts = new Map<string, string[]>();

  for (const pattern of FACT_PATTERNS) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const parts = match[0].split(
        /[是为叫属于位于来自拥有包含]|is|was|are|were|has|have|belongs?\s*to|located\sin|comes?\s*from/
      );
      if (parts.length >= 2) {
        const subject = parts[0].trim().toLowerCase();
        const obj = parts[1].trim().toLowerCase();
        if (subject && obj) {
          const existing = facts.get(subject) || [];
          existing.push(obj);
          facts.set(subject, existing);
        }
      }
    }
  }

  return facts;
}

function hasNegation(content: string): boolean {
  for (const pattern of NEGATION_PATTERNS) {
    if (pattern.test(content)) {
      return true;
    }
  }
  return false;
}

/**
 * 记忆冲突检测器
 * 通过提取事实断言（主语-谓语-宾语）比较记忆间的冲突
 */
export class MemoryConflictDetector {
  private config: ConflictDetectionConfig;

  constructor(config: Partial<ConflictDetectionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 检测一组记忆中的信息冲突
   * @param memories 待检测的记忆列表
   * @returns 冲突检测结果列表
   */
  detect(memories: Memory[]): ConflictResult[] {
    if (!this.config.enabled || memories.length < 2) {
      return [];
    }

    const conflicts: ConflictResult[] = [];
    const processed = new Set<string>();

    for (let i = 0; i < memories.length; i++) {
      const memA = memories[i];
      if (memA.content.length < this.config.minContentLength) continue;

      for (let j = i + 1; j < memories.length; j++) {
        const memB = memories[j];
        const pairKey = [memA.id, memB.id].sort().join(':');
        if (processed.has(pairKey)) continue;
        processed.add(pairKey);

        if (memB.content.length < this.config.minContentLength) continue;

        const result = this.comparePair(memA, memB);
        if (result) {
          conflicts.push(result);
        }
      }
    }

    return conflicts;
  }

  /**
   * 比较一对记忆是否存在冲突
   */
  private comparePair(memA: Memory, memB: Memory): ConflictResult | null {
    const factsA = extractFacts(memA.content);
    const factsB = extractFacts(memB.content);

    if (factsA.size === 0 || factsB.size === 0) return null;

    const negationA = hasNegation(memA.content);
    const negationB = hasNegation(memB.content);

    for (const [subject, valuesA] of factsA) {
      const valuesB = factsB.get(subject);
      if (!valuesB) continue;

      for (const valA of valuesA) {
        for (const valB of valuesB) {
          if (valA !== valB) {
            if (negationA !== negationB) {
              return {
                memoryIdA: memA.id,
                memoryIdB: memB.id,
                conflictType: 'negation',
                subject,
                valueA: memA.content.substring(0, 80),
                valueB: memB.content.substring(0, 80),
                confidence: 0.6,
                description: `对"${subject}"存在肯定与否定冲突`,
              };
            }

            return {
              memoryIdA: memA.id,
              memoryIdB: memB.id,
              conflictType: 'fact_value',
              subject,
              valueA: valA,
              valueB: valB,
              confidence: 0.5,
              description: `对"${subject}"的事实描述不同："${valA}" vs "${valB}"`,
            };
          }
        }
      }
    }

    return null;
  }
}

/**
 * SkillFilter 技能智能过滤器
 * 提供技能的搜索、过滤、排序和推荐能力
 */
import type { Skill } from '../types/index.js';

/**
 * 过滤条件
 */
export interface SkillFilterCriteria {
  query?: string;
  source?: string;
  tags?: string[];
  minPriority?: number;
  enabled?: boolean;
  categories?: string[];
}

/**
 * 排序方式
 */
export type SkillSortOrder =
  | 'name'
  | 'priority'
  | 'usage'
  | 'source'
  | 'recent';

/**
 * 过滤结果
 */
export interface FilterResult {
  skills: Skill[];
  total: number;
  filtered: number;
  suggestions?: string[];
}

/**
 * 技能智能过滤器
 */
export class SkillFilter {
  /**
   * 过滤技能列表
   */
  filter(skills: Skill[], criteria: SkillFilterCriteria): FilterResult {
    const total = skills.length;
    let filtered = [...skills];

    if (criteria.query) {
      const q = criteria.query.toLowerCase();
      filtered = filtered.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          (s.aliases || []).some((a) => a.toLowerCase().includes(q))
      );
    }

    if (criteria.source) {
      filtered = filtered.filter((s) => s.source === criteria.source);
    }

    if (criteria.enabled !== undefined) {
      filtered = filtered.filter((s) => !s.isHidden === criteria.enabled);
    }

    return {
      skills: filtered,
      total,
      filtered: total - filtered.length,
      suggestions: this.generateSuggestions(filtered, criteria.query),
    };
  }

  /**
   * 排序技能列表
   */
  sort(skills: Skill[], order: SkillSortOrder = 'name'): Skill[] {
    const sorted = [...skills];

    switch (order) {
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'source':
        sorted.sort((a, b) => a.source.localeCompare(b.source));
        break;
      case 'usage':
        break;
      case 'recent':
        break;
    }

    return sorted;
  }

  /**
   * 获取推荐技能
   */
  recommend(skills: Skill[], context?: string): Skill[] {
    if (!context) {
      return skills.slice(0, 5);
    }

    const ctx = context.toLowerCase();
    const scored = skills.map((s) => {
      let score = 0;
      if (s.description.toLowerCase().includes(ctx)) score += 3;
      if (s.name.toLowerCase().includes(ctx)) score += 2;
      if ((s.aliases || []).some((a) => a.toLowerCase().includes(ctx)))
        score += 1;
      return { skill: s, score };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((s) => s.skill);
  }

  /**
   * 生成搜索建议
   */
  private generateSuggestions(skills: Skill[], query?: string): string[] {
    if (!query || skills.length > 0) return [];

    const suggestions: string[] = [];
    const allNames = skills.map((s) => s.name);

    for (const name of allNames) {
      const dist = this.levenshtein(query.toLowerCase(), name.toLowerCase());
      if (dist <= 3) {
        suggestions.push(name);
      }
    }

    return suggestions.slice(0, 3);
  }

  /**
   * 计算编辑距离
   */
  private levenshtein(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () =>
      Array(n + 1).fill(0)
    );

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] =
          a[i - 1] === b[j - 1]
            ? dp[i - 1][j - 1]
            : Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]) + 1;
      }
    }

    return dp[m][n];
  }
}

export const skillFilter = new SkillFilter();

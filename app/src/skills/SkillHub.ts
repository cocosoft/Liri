/**
 * 技能 Hub 集中仓库
 * 对标 Hermes SkillHub，提供集中式技能索引和分发
 */
import type { Skill, SkillLoader, SkillSource } from './types';

/**
 * 技能条目（Hub 中的元数据）
 */
export interface SkillHubEntry {
  name: string;
  source: SkillSource;
  loadedFrom: string;
  description: string;
  userInvocable: boolean;
  version?: string;
  registeredAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
}

/**
 * 技能 Hub 搜索条件
 */
export interface SkillHubSearchFilter {
  source?: SkillSource;
  userInvocable?: boolean;
  keyword?: string;
  after?: number;
  limit?: number;
}

/**
 * 技能 Hub
 */
export class SkillHub {
  private entries: Map<string, SkillHubEntry> = new Map();
  private indexBySource: Map<SkillSource, Set<string>> = new Map();

  /**
   * 注册技能到 Hub
   * @param skill 技能对象
   */
  registerSkill(skill: Skill): void {
    const now = Date.now();
    const existing = this.entries.get(skill.name);

    const entry: SkillHubEntry = {
      name: skill.name,
      source: skill.source,
      loadedFrom: skill.loadedFrom,
      description: skill.description,
      userInvocable: skill.userInvocable,
      version: skill.version,
      registeredAt: existing ? existing.registeredAt : now,
      updatedAt: now,
      metadata: {
        hasAllowedTools: skill.allowedTools && skill.allowedTools.length > 0,
        model: skill.model,
        agent: skill.agent,
        contentLength: skill.contentLength,
      },
    };

    this.entries.set(skill.name, entry);

    if (!this.indexBySource.has(skill.source)) {
      this.indexBySource.set(skill.source, new Set());
    }
    this.indexBySource.get(skill.source)!.add(skill.name);
  }

  /**
   * 批量注册技能
   * @param skills 技能列表
   */
  registerSkills(skills: Skill[]): void {
    for (const skill of skills) {
      this.registerSkill(skill);
    }
  }

  /**
   * 从 Hub 移除技能
   * @param skillName 技能名称
   */
  unregisterSkill(skillName: string): void {
    const entry = this.entries.get(skillName);
    if (entry) {
      const sourceSet = this.indexBySource.get(entry.source);
      if (sourceSet) {
        sourceSet.delete(skillName);
      }
    }

    this.entries.delete(skillName);
  }

  /**
   * 获取技能条目
   * @param skillName 技能名称
   * @returns 技能条目
   */
  getEntry(skillName: string): SkillHubEntry | undefined {
    return this.entries.get(skillName);
  }

  /**
   * 搜索技能
   * @param filter 搜索条件
   * @returns 匹配的技能条目列表
   */
  search(filter: SkillHubSearchFilter = {}): SkillHubEntry[] {
    let results = Array.from(this.entries.values());

    if (filter.source) {
      results = results.filter((e) => e.source === filter.source);
    }

    if (filter.userInvocable !== undefined) {
      results = results.filter((e) => e.userInvocable === filter.userInvocable);
    }

    if (filter.keyword) {
      const keyword = filter.keyword.toLowerCase();
      results = results.filter(
        (e) =>
          e.name.toLowerCase().includes(keyword) ||
          e.description.toLowerCase().includes(keyword)
      );
    }

    if (filter.after) {
      results = results.filter((e) => e.updatedAt > filter.after!);
    }

    results.sort((a, b) => b.updatedAt - a.updatedAt);

    if (filter.limit && filter.limit > 0) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  /**
   * 按来源获取技能
   * @param source 技能来源
   * @returns 技能条目列表
   */
  getBySource(source: SkillSource): SkillHubEntry[] {
    const nameSet = this.indexBySource.get(source);
    if (!nameSet) return [];

    return Array.from(nameSet)
      .map((name) => this.entries.get(name)!)
      .filter(Boolean);
  }

  /**
   * 获取 Hub 统计信息
   * @returns 统计信息
   */
  getStats(): {
    total: number;
    bySource: Record<string, number>;
    userInvocableCount: number;
  } {
    const bySource: Record<string, number> = {};
    let userInvocableCount = 0;

    for (const entry of this.entries.values()) {
      bySource[entry.source] = (bySource[entry.source] || 0) + 1;
      if (entry.userInvocable) {
        userInvocableCount++;
      }
    }

    return {
      total: this.entries.size,
      bySource,
      userInvocableCount,
    };
  }

  /**
   * 获取所有技能名称
   * @returns 技能名称列表
   */
  getAllNames(): string[] {
    return Array.from(this.entries.keys());
  }

  /**
   * 检查技能是否已注册
   * @param skillName 技能名称
   * @returns 是否已注册
   */
  hasSkill(skillName: string): boolean {
    return this.entries.has(skillName);
  }

  /**
   * 清空 Hub
   */
  clear(): void {
    this.entries.clear();
    this.indexBySource.clear();
  }
}

/**
 * 全局 Hub 实例
 */
let globalHub: SkillHub | null = null;

/**
 * 获取全局技能 Hub
 * @returns SkillHub 实例
 */
export function getSkillHub(): SkillHub {
  if (!globalHub) {
    globalHub = new SkillHub();
  }

  return globalHub;
}

/**
 * 重置全局 Hub
 */
export function resetSkillHub(): void {
  globalHub = null;
}

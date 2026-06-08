/**
 * 技能 Hub（只读投影层）
 * 从 SkillRegistry 重建只读索引，提供搜索/查询语义。
 * 本身不提供写入能力，所有数据来自 Registry。
 */
import type { Skill, SkillSource } from './types';
import type { SkillRegistry } from './SkillRegistry';

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
 * 技能 Hub（只读投影）
 *
 * 职责：
 * - 从 SkillRegistry 重建只读快照
 * - 提供高效的搜索/查询接口
 * - 事件驱动：监听 Registry 事件自动刷新
 */
export class SkillHub {
  private entries: Map<string, SkillHubEntry> = new Map();
  private indexBySource: Map<string, Set<string>> = new Map();

  /**
   * 从 Registry 重建索引
   * 清空当前状态，将所有技能重新投影到 Hub 中
   * @param registry SkillRegistry 实例
   */
  refreshFromRegistry(registry: SkillRegistry): void {
    this.entries.clear();
    this.indexBySource.clear();

    const skills = registry.getAll();
    const now = Date.now();

    for (const skill of skills) {
      const entry: SkillHubEntry = this.toEntry(skill, now);

      this.entries.set(skill.name, entry);

      const srcKey = String(skill.source);
      if (!this.indexBySource.has(srcKey)) {
        this.indexBySource.set(srcKey, new Set());
      }
      this.indexBySource.get(srcKey)!.add(skill.name);
    }
  }

  /**
   * 将 Skill 转换为 HubEntry
   */
  private toEntry(skill: Skill, now: number = Date.now()): SkillHubEntry {
    return {
      name: skill.name,
      source: skill.source,
      loadedFrom: skill.loadedFrom,
      description: skill.description,
      userInvocable: skill.userInvocable ?? true,
      version: skill.version,
      registeredAt: now,
      updatedAt: now,
      metadata: {
        hasAllowedTools: skill.allowedTools && skill.allowedTools.length > 0,
        model: skill.model,
        agent: skill.agent,
        contentLength: skill.contentLength,
      },
    };
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
    const nameSet = this.indexBySource.get(String(source));
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

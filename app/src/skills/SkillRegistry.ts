/**
 * 技能注册表
 * 负责管理技能的注册和查询，提供完整的事件系统
 */

import type { Skill } from './types';

/**
 * 注册表事件类型
 */
export type RegistryEvent =
  | 'before-register'
  | 'registered'
  | 'unregistered'
  | 'cleared';

/**
 * 事件处理器
 */
export type RegistryEventHandler = (
  event: RegistryEvent,
  skill?: Skill
) => void | boolean;

/**
 * 技能注册表
 * 管理技能的注册、查询和生命周期事件
 */
export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();
  private listeners: Map<RegistryEvent, Set<RegistryEventHandler>> = new Map();

  // ==================== 事件系统 ====================

  /**
   * 注册事件监听
   * @param event 事件类型
   * @param handler 事件处理器
   */
  on(event: RegistryEvent, handler: RegistryEventHandler): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  /**
   * 移除事件监听
   * @param event 事件类型
   * @param handler 事件处理器
   */
  off(event: RegistryEvent, handler: RegistryEventHandler): void {
    this.listeners.get(event)?.delete(handler);
  }

  /**
   * 触发事件
   * @param event 事件类型
   * @param skill 关联的技能（可选）
   * @returns 如果任何处理器返回 false，则返回 false
   */
  private emit(event: RegistryEvent, skill?: Skill): boolean {
    const handlers = this.listeners.get(event);
    if (!handlers) return true;

    for (const handler of handlers) {
      const result = handler(event, skill);
      if (result === false) return false;
    }
    return true;
  }

  // ==================== 核心操作 ====================

  /**
   * 注册技能
   * 触发 before-register（可取消）和 registered 事件
   * @param skill 要注册的技能
   */
  register(skill: Skill): void {
    if (!this.emit('before-register', skill)) {
      return;
    }
    this.skills.set(skill.name, skill);
    this.emit('registered', skill);
  }

  /**
   * 注销技能
   * 触发 unregistered 事件
   * @param skillName 技能名称
   */
  unregister(skillName: string): void {
    const skill = this.skills.get(skillName);
    this.skills.delete(skillName);
    if (skill) {
      this.emit('unregistered', skill);
    }
  }

  /**
   * 获取技能
   * @param skillName 技能名称
   * @returns 技能对象或undefined
   */
  get(skillName: string): Skill | undefined {
    return this.skills.get(skillName);
  }

  /**
   * 获取所有技能
   * @returns 技能数组
   */
  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * 按类别获取技能
   * @param category 技能类别
   * @returns 技能数组
   */
  getByCategory(category: string): Skill[] {
    return this.getAll().filter(
      (skill) => skill.manifest?.category === category
    );
  }

  /**
   * 按标签获取技能
   * @param tag 技能标签
   * @returns 技能数组
   */
  getByTag(tag: string): Skill[] {
    return this.getAll().filter(
      (skill) => skill.manifest?.tags?.includes(tag) || false
    );
  }

  /**
   * 按来源获取技能
   * @param source 技能来源
   * @returns 技能数组
   */
  getBySource(source: string): Skill[] {
    return this.getAll().filter((skill) => skill.source === source);
  }

  /**
   * 清空注册表
   * 触发 cleared 事件
   */
  clear(): void {
    this.skills.clear();
    this.emit('cleared');
  }

  /**
   * 检查技能是否存在
   * @param skillName 技能名称
   * @returns 是否存在
   */
  has(skillName: string): boolean {
    return this.skills.has(skillName);
  }

  /**
   * 获取技能数量
   * @returns 技能数量
   */
  size(): number {
    return this.skills.size;
  }

  /**
   * 按名称搜索技能
   * @param query 搜索关键词
   * @returns 技能数组
   */
  search(query: string): Skill[] {
    const lowerQuery = query.toLowerCase();
    return this.getAll().filter(
      (skill) =>
        skill.name.toLowerCase().includes(lowerQuery) ||
        skill.description.toLowerCase().includes(lowerQuery) ||
        (skill.aliases || []).some((alias) =>
          alias.toLowerCase().includes(lowerQuery)
        ) ||
        skill.manifest?.tags?.some((tag) =>
          tag.toLowerCase().includes(lowerQuery)
        ) ||
        false
    );
  }

  /**
   * 批量注册技能
   * @param skills 技能数组
   */
  registerBatch(skills: Skill[]): void {
    for (const skill of skills) {
      this.register(skill);
    }
  }

  /**
   * 获取指定来源的技能数量
   * @param source 技能来源
   * @returns 技能数量
   */
  countBySource(source: string): number {
    let count = 0;
    for (const skill of this.skills.values()) {
      if (skill.source === source) count++;
    }
    return count;
  }
}

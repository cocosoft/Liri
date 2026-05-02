/**
 * 技能注册表
 * 负责管理技能的注册和查询
 */

import type { Skill } from '../types/skill';

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();

  /**
   * 注册技能
   * @param skill 要注册的技能
   */
  register(skill: Skill): void {
    this.skills.set(skill.manifest.name, skill);
  }

  /**
   * 注销技能
   * @param skillName 技能名称
   */
  unregister(skillName: string): void {
    this.skills.delete(skillName);
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
      (skill) => skill.manifest.category === category
    );
  }

  /**
   * 按标签获取技能
   * @param tag 技能标签
   * @returns 技能数组
   */
  getByTag(tag: string): Skill[] {
    return this.getAll().filter(
      (skill) => skill.manifest.tags?.includes(tag) || false
    );
  }

  /**
   * 清空注册表
   */
  clear(): void {
    this.skills.clear();
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
        skill.manifest.name.toLowerCase().includes(lowerQuery) ||
        skill.manifest.description.toLowerCase().includes(lowerQuery) ||
        skill.manifest.tags?.some((tag) =>
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
}

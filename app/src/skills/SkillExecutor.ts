/**
 * 技能执行器
 * 负责执行技能并管理执行过程
 */

import type { Skill, SkillContext, SkillResult } from './types';
import { SkillRegistry } from './SkillRegistry';
import { ParallelExecutor } from '../tools/executor/ParallelExecutor';

export class SkillExecutor {
  private registry: SkillRegistry;
  private parallelExecutor: ParallelExecutor;

  /**
   * 构造函数
   * @param registry 技能注册表
   */
  constructor(registry: SkillRegistry, parallelExecutor?: ParallelExecutor) {
    this.registry = registry;
    this.parallelExecutor = parallelExecutor || new ParallelExecutor();
  }

  /**
   * 执行单个技能
   * @param skillName 技能名称
   * @param context 技能上下文
   * @returns 技能执行结果
   */
  async execute(
    skillName: string,
    context: SkillContext
  ): Promise<SkillResult> {
    const skill = this.registry.get(skillName);
    if (!skill) {
      return {
        success: false,
        error: `Skill '${skillName}' not found`,
      };
    }

    try {
      // 根据受歧视联合类型路由执行路径
      if (skill.impl.kind !== 'executable') {
        return {
          success: false,
          error: `Skill '${skillName}' is not executable (kind: ${skill.impl.kind})`,
        };
      }

      // 验证技能执行条件
      if (skill.impl.validate && !skill.impl.validate(context)) {
        return {
          success: false,
          error: `Skill '${skillName}' validation failed`,
        };
      }

      // 执行技能
      const startTime = Date.now();
      const result = await skill.impl.execute(context);
      const durationMs = Date.now() - startTime;

      // 添加上下文信息
      return {
        ...result,
        success: true,
        usage: {
          ...result?.usage,
          durationMs,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Error executing skill '${skillName}': ${error}`,
      };
    }
  }

  /**
   * 批量执行技能
   * @param skills 技能执行配置数组
   * @returns 技能执行结果数组
   */
  async executeBatch(
    skills: Array<{ name: string; context: SkillContext }>
  ): Promise<SkillResult[]> {
    const results: SkillResult[] = [];

    for (const skillConfig of skills) {
      const result = await this.execute(skillConfig.name, skillConfig.context);
      results.push(result);
    }

    return results;
  }

  /**
   * 并行执行技能
   * @param skills 技能执行配置数组
   * @returns 技能执行结果数组
   */
  async executeParallel(
    skills: Array<{ name: string; context: SkillContext }>
  ): Promise<SkillResult[]> {
    const tasks = skills.map((skillConfig) => ({
      execute: () => this.execute(skillConfig.name, skillConfig.context),
    }));

    const results = await this.parallelExecutor.execute<SkillResult>(tasks);
    return results
      .map((r) => r.data)
      .filter((d): d is SkillResult => d !== undefined);
  }

  /**
   * 获取可用技能
   * @returns 技能数组
   */
  getAvailableSkills(): Skill[] {
    return this.registry.getAll();
  }

  /**
   * 按类别获取技能
   * @param category 技能类别
   * @returns 技能数组
   */
  getSkillsByCategory(category: string): Skill[] {
    return this.registry.getByCategory(category);
  }

  /**
   * 按标签获取技能
   * @param tag 技能标签
   * @returns 技能数组
   */
  getSkillsByTag(tag: string): Skill[] {
    return this.registry.getByTag(tag);
  }

  /**
   * 搜索技能
   * @param query 搜索关键词
   * @returns 技能数组
   */
  searchSkills(query: string): Skill[] {
    return this.registry.search(query);
  }

  /**
   * 检查技能是否可用
   * @param skillName 技能名称
   * @returns 是否可用
   */
  isSkillAvailable(skillName: string): boolean {
    return this.registry.has(skillName);
  }
}

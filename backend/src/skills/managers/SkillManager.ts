import { Skill, SkillLoader } from '../types';

export class SkillManager {
  private skills: Map<string, Skill> = new Map();
  private loaders: SkillLoader[] = [];
  private lastLoadTime: number = 0;
  private cacheTimeout: number = 300000; // 5分钟缓存超时

  /**
   * 注册技能加载器
   * @param loader 技能加载器
   */
  public registerLoader(loader: SkillLoader): void {
    // 检查是否已注册相同类型的加载器
    const existingLoader = this.loaders.find(
      (l) => l.constructor.name === loader.constructor.name
    );
    if (!existingLoader) {
      this.loaders.push(loader);
    }
  }

  /**
   * 加载技能
   * @param forceReload 是否强制重新加载
   */
  public async loadSkills(forceReload: boolean = false): Promise<void> {
    // 检查缓存是否有效
    const now = Date.now();
    if (
      !forceReload &&
      this.skills.size > 0 &&
      now - this.lastLoadTime < this.cacheTimeout
    ) {
      return; // 缓存有效，直接返回
    }

    try {
      const skills = await Promise.all(
        this.loaders.map((loader) => loader.loadSkills())
      );

      // 清空现有技能
      this.skills.clear();

      // 合并技能，处理重复（后加载的覆盖先加载的）
      for (const skillList of skills) {
        for (const skill of skillList) {
          this.skills.set(skill.name, skill);
        }
      }

      // 更新最后加载时间
      this.lastLoadTime = now;
    } catch (error) {
      console.error('Error loading skills:', error);
      // 加载失败时保留现有技能
    }
  }

  /**
   * 获取技能
   * @param name 技能名称
   * @returns 技能对象
   */
  public getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * 获取所有技能
   * @param filter 过滤条件
   * @returns 技能列表
   */
  public getSkills(filter?: {
    source?: string;
    userInvocable?: boolean;
  }): Skill[] {
    let skills = Array.from(this.skills.values());

    // 应用过滤条件
    if (filter) {
      if (filter.source) {
        skills = skills.filter((skill) => skill.source === filter.source);
      }
      if (filter.userInvocable !== undefined) {
        skills = skills.filter(
          (skill) => skill.userInvocable === filter.userInvocable
        );
      }
    }

    return skills;
  }

  /**
   * 执行技能
   * @param name 技能名称
   * @param args 技能参数
   * @param toolUseContext 工具使用上下文
   * @returns 技能执行结果
   */
  public async executeSkill(
    name: string,
    args: any,
    toolUseContext: any
  ): Promise<any> {
    const skill = this.getSkill(name);
    if (!skill) {
      throw new Error(`Skill not found: ${name}`);
    }

    try {
      const prompt = await skill.getPromptForCommand(args, toolUseContext);
      return prompt;
    } catch (error) {
      console.error(`Error executing skill ${name}:`, error);
      throw error;
    }
  }

  /**
   * 清理技能缓存
   */
  public clearCache(): void {
    this.skills.clear();
    this.lastLoadTime = 0;
  }

  /**
   * 获取技能数量
   * @returns 技能数量
   */
  public getSkillCount(): number {
    return this.skills.size;
  }

  /**
   * 检查技能是否存在
   * @param name 技能名称
   * @returns 是否存在
   */
  public hasSkill(name: string): boolean {
    return this.skills.has(name);
  }

  /**
   * 设置缓存超时时间
   * @param milliseconds 超时时间（毫秒）
   */
  public setCacheTimeout(milliseconds: number): void {
    this.cacheTimeout = milliseconds;
  }
}

// 单例模式
export const skillManager = new SkillManager();

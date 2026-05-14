/**
 * 技能条件匹配器
 * 对标 Hermes YAML front matter 条件系统
 * 评估技能文件中的 front matter 条件，决定技能是否应在当前上下文启用
 */

/**
 * 条件上下文
 * 包含评估技能条件所需的所有运行时信息
 */
export interface ConditionContext {
  platform: string;
  os: string;
  model?: string;
  agent?: string;
  channelId?: string;
  environment?: string;
  tools?: string[];
  [key: string]: unknown;
}

/**
 * 技能条件匹配器
 */
export class SkillConditionMatcher {
  private context: ConditionContext;

  /**
   * 构造函数
   * @param context 条件上下文
   */
  constructor(context: ConditionContext) {
    this.context = {
      ...context,
      os: context.os || process.platform,
    };
  }

  /**
   * 更新条件上下文
   * @param updates 更新的上下文
   */
  updateContext(updates: Partial<ConditionContext>): void {
    this.context = { ...this.context, ...updates };
  }

  /**
   * 评估 front matter 条件是否满足
   * @param frontmatter front matter 对象
   * @returns 是否满足条件
   */
  evaluate(frontmatter: Record<string, unknown>): boolean {
    if (frontmatter['platform'] !== undefined) {
      const platforms = this.normalizeStringArray(frontmatter['platform']);
      if (!platforms.includes(this.context.platform)) {
        return false;
      }
    }

    if (frontmatter['os'] !== undefined) {
      const osList = this.normalizeStringArray(frontmatter['os']);
      if (!osList.includes(this.context.os)) {
        return false;
      }
    }

    if (frontmatter['model'] !== undefined) {
      const models = this.normalizeStringArray(frontmatter['model']);
      const currentModel = this.context.model || '';
      if (!models.some((m) => currentModel.includes(m))) {
        return false;
      }
    }

    if (frontmatter['agent'] !== undefined) {
      const expectedAgent = String(frontmatter['agent']);
      if (this.context.agent !== expectedAgent) {
        return false;
      }
    }

    if (frontmatter['require_tool'] !== undefined) {
      const requiredTools = this.normalizeStringArray(
        frontmatter['require_tool']
      );
      const availableTools = this.context.tools || [];
      for (const tool of requiredTools) {
        if (!availableTools.includes(tool)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * 从技能 front matter 中获取所需平台列表
   * @param frontmatter front matter 对象
   * @returns 平台列表
   */
  getRequiredPlatforms(frontmatter: Record<string, unknown>): string[] {
    if (frontmatter['platform'] !== undefined) {
      return this.normalizeStringArray(frontmatter['platform']);
    }

    return [];
  }

  /**
   * 从技能 front matter 中获取所需模型列表
   * @param frontmatter front matter 对象
   * @returns 模型列表
   */
  getRequiredModels(frontmatter: Record<string, unknown>): string[] {
    if (frontmatter['model'] !== undefined) {
      return this.normalizeStringArray(frontmatter['model']);
    }

    return [];
  }

  /**
   * 将 front matter 值标准化为字符串数组
   * @param value front matter 值
   * @returns 字符串数组
   */
  private normalizeStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.map((v) => String(v).trim());
    }

    if (typeof value === 'string') {
      return [value.trim()];
    }

    return [];
  }
}

/**
 * 从环境创建默认条件上下文
 * @returns ConditionContext
 */
export function createDefaultConditionContext(
  overrides?: Partial<ConditionContext>
): ConditionContext {
  return {
    platform: process.platform,
    os: process.platform,
    environment: process.env['NODE_ENV'] || 'development',
    ...overrides,
  };
}

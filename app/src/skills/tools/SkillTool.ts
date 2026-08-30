/**
 * 支持Inline模式、Fork模式、权限检查、参数验证等功能
 */

import { resolve, relative, isAbsolute } from 'path';
import type { SkillDefinition } from '../utils/skillParser';
import { SkillParser } from '../utils/skillParser';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
const logger = getLogger('skills:tool');

/**
 * 技能执行上下文
 */
export interface SkillExecutionContext {
  /**
   * 技能定义
   */
  skill: SkillDefinition;

  /**
   * 参数
   */
  arguments: string;

  /**
   * 执行模式
   */
  context: 'inline' | 'fork';

  /**
   * 当前工作目录
   */
  currentDirectory: string;

  /**
   * 会话ID
   */
  sessionId: string;

  /**
   * 用户ID
   */
  userId: string;

  /**
   * 允许的工具
   */
  allowedTools: string[];

  /**
   * 模型配置
   */
  model: string;

  /**
   * 努力级别
   */
  effort: number;
}

/**
 * 技能执行结果
 */
export interface SkillExecutionResult {
  /**
   * 是否成功
   */
  success: boolean;

  /**
   * 执行输出
   */
  output?: string;

  /**
   * 错误信息
   */
  error?: string;

  /**
   * 执行时间（毫秒）
   */
  executionTime: number;

  /**
   * 使用的工具
   */
  toolsUsed: string[];

  /**
   * 生成的提示词
   */
  generatedPrompt?: string;

  /**
   * 执行统计
   */
  stats: {
    totalTokens?: number;
    toolCalls?: number;
    memoryUsage?: number;
  };
}

/**
 * 技能权限检查结果
 */
export interface SkillPermissionResult {
  /**
   * 是否允许执行
   */
  allowed: boolean;

  /**
   * 拒绝原因
   */
  reason?: string;

  /**
   * 是否需要用户确认
   */
  requiresConfirmation: boolean;

  /**
   * 确认消息
   */
  confirmationMessage?: string;
}

export class SkillTool {
  private parser: SkillParser;
  private skillUsage: Map<string, number> = new Map();

  constructor() {
    this.parser = new SkillParser();
  }

  /**
   * 执行技能
   */
  async executeSkill(
    context: SkillExecutionContext
  ): Promise<SkillExecutionResult> {
    const startTime = Date.now();

    try {
      // 权限检查
      const permission = await this.checkPermission(context);
      if (!permission.allowed) {
        return {
          success: false,
          error: permission.reason || 'Permission denied',
          executionTime: Date.now() - startTime,
          toolsUsed: [],
          stats: {},
        };
      }

      // 参数验证
      const validation = this.validateArguments(context);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.errors.join(', '),
          executionTime: Date.now() - startTime,
          toolsUsed: [],
          stats: {},
        };
      }

      // 参数替换
      const processedContent = this.parser.substituteArguments(
        context.skill.content,
        context.arguments,
        Array.isArray(context.skill.frontmatter.arguments)
          ? context.skill.frontmatter.arguments
          : context.skill.frontmatter.arguments
            ? [context.skill.frontmatter.arguments]
            : [],
        context.currentDirectory
      );

      // S1-2：shell 执行已永久禁用，无命令提取/执行

      // 根据执行模式处理
      let result: SkillExecutionResult;

      if (context.context === 'fork') {
        result = await this.executeInForkMode(context, processedContent);
      } else {
        result = await this.executeInInlineMode(context, processedContent);
      }

      // 记录技能使用
      this.recordSkillUsage(context.skill.name);

      return {
        ...result,
        executionTime: Date.now() - startTime,
        generatedPrompt: processedContent,
      };
    } catch (error) {
      // §1.9：统一 handleError（Logger + ErrorTracker），技能执行失败以结构化结果返回
      await handleError(error, {
        module: 'skills:tool',
        action: 'execute',
        context: { skillName: context.skill.name },
      }).catch(() => {});
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime,
        toolsUsed: [],
        stats: {},
      };
    }
  }

  /**
   * 检查技能权限
   */
  private async checkPermission(
    context: SkillExecutionContext
  ): Promise<SkillPermissionResult> {
    const { skill } = context;

    // 检查用户可调用性
    if (!skill.frontmatter['user-invocable'] && context.context === 'inline') {
      return {
        allowed: false,
        reason: 'Skill is not user-invocable',
        requiresConfirmation: false,
      };
    }

    // 检查工具权限
    if (skill.frontmatter['allowed-tools']) {
      const allowedTools = skill.frontmatter['allowed-tools'];
      const hasRequiredTools = allowedTools.every((tool) =>
        context.allowedTools.includes(tool)
      );

      if (!hasRequiredTools) {
        return {
          allowed: false,
          reason: `Missing required tools: ${allowedTools.filter((tool) => !context.allowedTools.includes(tool)).join(', ')}`,
          requiresConfirmation: false,
        };
      }
    }

    // 检查路径权限（S1-3：includes → 归一化后 relative + 前缀边界，防 /home/user2 误判）
    if (skill.frontmatter.paths) {
      const paths = Array.isArray(skill.frontmatter.paths)
        ? skill.frontmatter.paths
        : [skill.frontmatter.paths];

      const cwd = resolve(context.currentDirectory);
      const isPathAllowed = paths.some((allowedPath) => {
        const allowed = resolve(allowedPath);
        const rel = relative(allowed, cwd);
        return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
      });

      if (!isPathAllowed) {
        return {
          allowed: false,
          reason: `Skill is not allowed in current directory`,
          requiresConfirmation: false,
        };
      }
    }

    // S1-3：仅"无任何危险能力"的技能可免确认（原 hasSafeAttributes 有 description 即放行，形同虚设）
    if (!this.hasDangerousCapabilities(skill)) {
      return {
        allowed: true,
        requiresConfirmation: false,
      };
    }

    // 需要用户确认的情况
    return {
      allowed: true,
      requiresConfirmation: true,
      confirmationMessage: this.generateConfirmationMessage(skill, context),
    };
  }

  /**
   * 验证参数
   */
  private validateArguments(context: SkillExecutionContext): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];
    const { skill, arguments: args } = context;

    if (skill.frontmatter.arguments) {
      const expectedArgs = Array.isArray(skill.frontmatter.arguments)
        ? skill.frontmatter.arguments
        : [skill.frontmatter.arguments];

      const providedArgs = args
        .split(' ')
        .filter((arg) => arg.trim().length > 0);

      if (providedArgs.length < expectedArgs.length) {
        errors.push(
          `Expected ${expectedArgs.length} arguments, but got ${providedArgs.length}`
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * 执行Inline模式
   */
  private async executeInInlineMode(
    context: SkillExecutionContext,
    processedContent: string
  ): Promise<SkillExecutionResult> {
    // 在Inline模式下，技能内容作为用户消息注入当前对话
    // S1-2：shell 执行永久禁用
    return {
      success: true,
      output: processedContent,
      executionTime: 0,
      toolsUsed: [],
      stats: {},
    };
  }

  /**
   * 执行Fork模式
   */
  private async executeInForkMode(
    context: SkillExecutionContext,
    processedContent: string
  ): Promise<SkillExecutionResult> {
    // 在Fork模式下，技能在子代理中独立执行
    // 这里简化实现，实际应该创建子代理进程
    // S1-2：shell 执行永久禁用

    // 应用上下文修改器
    if (context.skill.frontmatter.model) {
      context.model = context.skill.frontmatter.model;
    }

    if (context.skill.frontmatter.effort) {
      context.effort =
        typeof context.skill.frontmatter.effort === 'number'
          ? context.skill.frontmatter.effort
          : parseInt(context.skill.frontmatter.effort.toString()) || 1;
    }

    return {
      success: true,
      output: processedContent,
      executionTime: 0,
      toolsUsed: [],
      stats: {},
    };
  }

  /**
   * 是否含危险能力（S1-3：shell / 路径访问 / 工具调用 / hooks 均为危险能力）
   * 含任一危险能力 → 执行必须用户确认
   */
  private hasDangerousCapabilities(skill: SkillDefinition): boolean {
    const fm = skill.frontmatter;
    return Boolean(
      fm.shell ||
      (fm.paths?.length ?? 0) > 0 ||
      (fm['allowed-tools']?.length ?? 0) > 0 ||
      fm.hooks
    );
  }

  /**
   * 生成确认消息
   */
  private generateConfirmationMessage(
    skill: SkillDefinition,
    context: SkillExecutionContext
  ): string {
    const messageParts: string[] = [];

    messageParts.push(`Execute skill: ${skill.name}`);
    messageParts.push(`Description: ${skill.description}`);

    if (skill.frontmatter['when-to-use']) {
      messageParts.push(`When to use: ${skill.frontmatter['when-to-use']}`);
    }

    if (context.arguments) {
      messageParts.push(`Arguments: ${context.arguments}`);
    }

    if (skill.frontmatter['allowed-tools']) {
      messageParts.push(
        `Allowed tools: ${skill.frontmatter['allowed-tools'].join(', ')}`
      );
    }

    return messageParts.join('\n');
  }

  /**
   * 记录技能使用
   */
  private recordSkillUsage(skillName: string): void {
    const currentCount = this.skillUsage.get(skillName) || 0;
    this.skillUsage.set(skillName, currentCount + 1);

    // 限制使用记录数量
    if (this.skillUsage.size > 1000) {
      const sorted = Array.from(this.skillUsage.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 500);

      this.skillUsage.clear();
      sorted.forEach(([name, count]) => this.skillUsage.set(name, count));
    }
  }

  /**
   * 获取技能使用统计
   */
  getSkillUsageStats(): Array<{ skillName: string; usageCount: number }> {
    return Array.from(this.skillUsage.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([skillName, usageCount]) => ({ skillName, usageCount }));
  }

  /**
   * 获取推荐技能
   */
  getRecommendedSkills(
    skills: SkillDefinition[],
    context: string,
    limit: number = 5
  ): SkillDefinition[] {
    const usageStats = this.getSkillUsageStats();

    // 基于使用频率和上下文相关性排序
    return skills
      .map((skill) => {
        const usage = usageStats.find((stat) => stat.skillName === skill.name);
        const relevanceScore = this.calculateRelevanceScore(skill, context);

        return {
          skill,
          score: (usage?.usageCount || 0) * 0.7 + relevanceScore * 0.3,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.skill);
  }

  /**
   * 计算技能相关性分数
   */
  private calculateRelevanceScore(
    skill: SkillDefinition,
    context: string
  ): number {
    let score = 0;

    // 基于描述匹配
    if (skill.description.toLowerCase().includes(context.toLowerCase())) {
      score += 0.5;
    }

    // 基于使用时机匹配
    if (
      skill.frontmatter['when-to-use']
        ?.toLowerCase()
        .includes(context.toLowerCase())
    ) {
      score += 0.3;
    }

    // 基于内容匹配
    if (skill.content.toLowerCase().includes(context.toLowerCase())) {
      score += 0.2;
    }

    return Math.min(score, 1);
  }

  /**
   * 生成技能执行报告
   */
  generateExecutionReport(result: SkillExecutionResult): string {
    const report: string[] = [];

    report.push('# Skill Execution Report');
    report.push('');
    report.push(`**Status**: ${result.success ? '✅ Success' : '❌ Failed'}`);
    report.push(`**Execution Time**: ${result.executionTime}ms`);
    report.push(`**Tools Used**: ${result.toolsUsed.join(', ') || 'None'}`);
    report.push('');

    if (result.output) {
      report.push('## Output');
      report.push('```');
      report.push(
        result.output.substring(0, 500) +
          (result.output.length > 500 ? '...' : '')
      );
      report.push('```');
      report.push('');
    }

    if (result.error) {
      report.push('## Error');
      report.push('```');
      report.push(result.error);
      report.push('```');
      report.push('');
    }

    report.push('## Statistics');
    report.push(`- Total Tokens: ${result.stats.totalTokens || 'N/A'}`);
    report.push(`- Tool Calls: ${result.stats.toolCalls || 0}`);
    report.push(`- Memory Usage: ${result.stats.memoryUsage || 'N/A'} bytes`);

    return report.join('\n');
  }
}

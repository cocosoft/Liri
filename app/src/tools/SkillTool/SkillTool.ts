/**
 * SkillTool - 执行注册的技能
 *
 * 参考CC源码实现: cc_code/backend/tools/SkillTool/SkillTool.ts
 *
 * 功能:
 * - 执行已注册的技能
 * - 支持多种Skill来源(builtin, mcp, plugin, user, project)
 * - 支持Skill参数传递
 */

import { Tool, ToolInfo, ToolTag, ValidationResult } from '../types/Tool';
import { ToolResult, ToolExecutionStatus } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import { SKILL_TOOL_NAME, BUILTIN_SKILLS } from './constants';
import type {
  SkillInput,
  SkillDefinition,
  SkillContext,
  SkillType,
  SkillSource,
} from './types';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'tools:SkillTool:SkillTool', level: LogLevel.INFO });

/**
 * SkillTool参数定义
 */
const SKILL_PARAMS = [
  {
    name: 'name',
    type: 'string' as const,
    description: 'The name of the skill to execute',
    required: true,
  },
  {
    name: 'arguments',
    type: 'object' as const,
    description: 'Arguments to pass to the skill',
    required: false,
  },
];

/**
 * SkillTool实现
 *
 * 用于执行已注册的技能
 */
export class SkillTool implements Tool {
  /** 工具名称 */
  readonly name: string = SKILL_TOOL_NAME;

  /** 工具描述 */
  readonly description: string = 'Execute a registered skill';

  /** 工具参数 */
  readonly params = SKILL_PARAMS;

  /** 搜索提示 */
  readonly searchHint?: string = 'run skill custom command';

  /** Skill注册表 */
  private skills: Map<string, SkillDefinition> = new Map();

  /** 活跃执行映射 */
  private activeExecutions: Map<
    string,
    {
      skillName: string;
      startTime: number;
      status: 'running' | 'completed' | 'failed';
    }
  > = new Map();

  /**
   * 构造函数
   */
  constructor() {
    this.registerBuiltinSkills();
  }

  /**
   * 注册内置Skills
   */
  private registerBuiltinSkills(): void {
    for (const skill of Object.values(BUILTIN_SKILLS)) {
      this.registerSkill({
        ...skill,
        deferred: false,
      });
    }
  }

  /**
   * 获取工具信息
   */
  getInfo(): ToolInfo {
    return {
      name: this.name,
      description: this.description,
      params: this.params,
      aliases: undefined,
      searchTips: undefined,
      enabled: true,
      readOnly: false,
      destructive: false,
      concurrencySafe: true,
      deferred: false,
      alwaysLoad: false,
      interruptBehavior: 'block',
      tags: [ToolTag.AGENT],
    };
  }

  /**
   * 检查工具是否启用
   */
  isEnabled(): boolean {
    return true;
  }

  /**
   * 检查工具是否只读
   */
  isReadOnly(_input?: Record<string, unknown>): boolean {
    return false;
  }

  /**
   * 检查工具是否有破坏性
   */
  isDestructive(_input?: Record<string, unknown>): boolean {
    return false;
  }

  /**
   * 检查工具是否并发安全
   */
  isConcurrencySafe(_input?: Record<string, unknown>): boolean {
    return true;
  }

  /**
   * 注册Skill
   * @param skill Skill定义
   */
  registerSkill(skill: SkillDefinition): void {
    this.skills.set(skill.name, skill);
  }

  /**
   * 批量注册Skills
   * @param skills Skill定义数组
   */
  registerSkills(skills: SkillDefinition[]): void {
    for (const skill of skills) {
      this.registerSkill(skill);
    }
  }

  /**
   * 获取Skill
   * @param name Skill名称
   */
  getSkill(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  /**
   * 获取所有Skills
   */
  getAllSkills(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  /**
   * 获取已启用的Skills
   */
  getEnabledSkills(): SkillDefinition[] {
    return this.getAllSkills().filter((skill) => skill.enabled);
  }

  /**
   * 按来源获取Skills
   * @param source Skill来源
   */
  getSkillsBySource(source: SkillSource): SkillDefinition[] {
    return this.getAllSkills().filter((skill) => skill.source === source);
  }

  /**
   * 按类型获取Skills
   * @param type Skill类型
   */
  getSkillsByType(type: SkillType): SkillDefinition[] {
    return this.getAllSkills().filter((skill) => skill.type === type);
  }

  /**
   * 搜索Skills
   * @param query 搜索查询
   */
  searchSkills(query: string): SkillDefinition[] {
    const lowerQuery = query.toLowerCase();
    return this.getAllSkills().filter(
      (skill) =>
        skill.name.toLowerCase().includes(lowerQuery) ||
        skill.description.toLowerCase().includes(lowerQuery) ||
        skill.tags?.some((tag) => tag.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * 验证输入参数
   * @param input 输入参数
   */
  validateInput(input: Record<string, unknown>): ValidationResult {
    if (!input.name || typeof input.name !== 'string') {
      return {
        result: false,
        message: 'name is required and must be a string',
      };
    }

    const skill = this.skills.get(input.name as string);
    if (!skill) {
      return { result: false, message: `Skill '${input.name}' not found` };
    }

    if (!skill.enabled) {
      return { result: false, message: `Skill '${input.name}' is disabled` };
    }

    return { result: true };
  }

  /**
   * 执行Skill核心逻辑
   * @param skill Skill定义
   * @param args Skill参数
   * @param context 执行上下文
   */
  private async executeSkill(
    skill: SkillDefinition,
    args?: Record<string, unknown>,
    _context?: ToolUseContext
  ): Promise<string> {
    switch (skill.type) {
      case 'prompt':
        return this.executePromptSkill(skill, args);
      case 'command':
        return this.executeCommandSkill(skill, args);
      case 'agent':
        return this.executeAgentSkill(skill, args);
      default:
        return this.executeGenericSkill(skill, args);
    }
  }

  /**
   * 执行Prompt类型的Skill
   */
  private executePromptSkill(
    skill: SkillDefinition,
    args?: Record<string, unknown>
  ): string {
    const template = skill.promptTemplate || `Execute skill: ${skill.name}`;
    const rendered = this.renderTemplate(template, args);

    return (
      `[Prompt Skill: ${skill.name}]\n\n` +
      `Description: ${skill.description}\n\n` +
      `Rendered Prompt:\n${rendered}\n\n` +
      `This is a placeholder. In production, this would be sent to the LLM for execution.`
    );
  }

  /**
   * 执行Command类型的Skill
   */
  private executeCommandSkill(
    skill: SkillDefinition,
    args?: Record<string, unknown>
  ): string {
    const command = skill.command || `echo "Skill ${skill.name} executed"`;

    return (
      `[Command Skill: ${skill.name}]\n\n` +
      `Description: ${skill.description}\n\n` +
      `Command: ${command}\n\n` +
      `Args: ${JSON.stringify(args || {}, null, 2)}\n\n` +
      `This is a placeholder. In production, this would execute the command.`
    );
  }

  /**
   * 执行Agent类型的Skill
   */
  private executeAgentSkill(
    skill: SkillDefinition,
    args?: Record<string, unknown>
  ): string {
    return (
      `[Agent Skill: ${skill.name}]\n\n` +
      `Description: ${skill.description}\n\n` +
      `Args: ${JSON.stringify(args || {}, null, 2)}\n\n` +
      `This is a placeholder. In production, this would spawn an agent to execute the task.`
    );
  }

  /**
   * 执行通用Skill
   */
  private executeGenericSkill(
    skill: SkillDefinition,
    args?: Record<string, unknown>
  ): string {
    return (
      `[Skill: ${skill.name}]\n\n` +
      `Description: ${skill.description}\n\n` +
      `Type: ${skill.type}\n\n` +
      `Args: ${JSON.stringify(args || {}, null, 2)}`
    );
  }

  /**
   * 渲染模板
   * @param template 模板字符串
   * @param args 参数
   */
  private renderTemplate(
    template: string,
    args?: Record<string, unknown>
  ): string {
    if (!args) return template;

    let result = template;
    for (const [key, value] of Object.entries(args)) {
      const placeholder = `{{${key}}}`;
      const stringValue =
        typeof value === 'string' ? value : JSON.stringify(value);
      result = result.replace(new RegExp(placeholder, 'g'), stringValue);
    }
    return result;
  }

  /**
   * 执行Skill
   * @param input Skill输入
   * @param context 执行上下文
   */
  async execute(
    input: Record<string, unknown>,
    context?: ToolUseContext
  ): Promise<ToolResult<unknown>> {
    const validation = this.validateInput(input);
    if (!validation.result) {
      return {
        status: ToolExecutionStatus.FAILURE,
        result: null,
        error: validation.message || undefined,
        executionTime: 0,
        output: '',
        errorOutput: validation.message || '',
        progress: [],
        metadata: {},
        executionId: '',
        toolName: this.name,
        timestamp: Date.now(),
      };
    }

    const skillInput = input as unknown as SkillInput;
    const skill = this.skills.get(skillInput.name)!;
    const startTime = Date.now();

    const executionId = `skill-${skillInput.name}-${Date.now()}`;
    this.activeExecutions.set(executionId, {
      skillName: skillInput.name,
      startTime,
      status: 'running',
    });

    try {
      const result = await this.executeSkill(
        skill,
        skillInput.arguments,
        context
      );

      this.activeExecutions.get(executionId)!.status = 'completed';

      return {
        status: ToolExecutionStatus.SUCCESS,
        result: result,
        error: undefined,
        executionTime: Date.now() - startTime,
        output: result,
        errorOutput: '',
        progress: [],
        metadata: {
          skillName: skill.name,
          skillType: skill.type,
          skillSource: skill.source,
        },
        executionId,
        toolName: this.name,
        timestamp: Date.now(),
      };
    } catch (error) {
      this.activeExecutions.get(executionId)!.status = 'failed';

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      return {
        status: ToolExecutionStatus.FAILURE,
        result: null,
        error: errorMessage,
        executionTime: Date.now() - startTime,
        output: '',
        errorOutput: errorMessage,
        progress: [],
        metadata: {
          skillName: skill.name,
          skillType: skill.type,
          skillSource: skill.source,
        },
        executionId,
        toolName: this.name,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * 获取活跃执行列表
   */
  getActiveExecutions(): Array<{
    skillName: string;
    startTime: number;
    status: 'running' | 'completed' | 'failed';
  }> {
    return Array.from(this.activeExecutions.values());
  }

  /**
   * 获取执行状态
   * @param executionId 执行ID
   */
  getExecutionStatus(executionId: string): {
    status: 'running' | 'completed' | 'failed' | 'not_found';
    duration?: number;
  } {
    const execution = this.activeExecutions.get(executionId);
    if (!execution) {
      return { status: 'not_found' };
    }

    return {
      status: execution.status,
      duration: Date.now() - execution.startTime,
    };
  }

  /**
   * 清理已完成的执行
   */
  cleanupCompletedExecutions(): number {
    let cleaned = 0;
    for (const [id, execution] of this.activeExecutions.entries()) {
      if (execution.status !== 'running') {
        this.activeExecutions.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }
}

/**
 * 创建SkillTool实例
 */
export function createSkillTool(): SkillTool {
  return new SkillTool();
}

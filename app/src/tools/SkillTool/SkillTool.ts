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

import { getLogger, getOTelTracing } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { getSkillRegistryLazy } from './skillRegistryAccess';
import { skillUsageTracker } from '@modules/skills/services/SkillUsageTracker';
import { getToolRegistry } from '@modules/tools/ToolRegistry';
const logger = getLogger('tools:SkillTool:SkillTool');

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
    // T3b 预热（2026-08-30）：getSkillRegistryLazy 为"异步 import + 同步读缓存"，
    // 若 getInfo() 首次调用前未触发预热会读到 null → 回退静态描述（冷启动时序缺陷，
    // 实测 bun test 直接 new SkillTool() + getInfo() 拿到静态描述）。构造时触发
    // 异步预热，后续 getInfo() 即可读到真实 registry（生产 ToolManager 注册亦受益）。
    getSkillRegistryLazy();
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
   * 2026-08-06：从真实 SkillRegistry（systemPromptSections 单例）同步技能，
   * 使 LLM 可通过 Skill 工具调用注册表内技能（含 skillify/update-config 等 bundled 技能）。
   * 幂等：每次执行时同步，仅注册缺失技能（用户新建技能写盘后重载 registry 即可感知）。
   * prompt 型技能绑定 promptProvider，执行时取 impl.getPromptForCommand 真实内容。
   */
  private async ensureSyncedFromRegistry(): Promise<void> {
    try {
      const { skillRegistry } =
        await import('@modules/constants/systemPromptSections');
      for (const skill of skillRegistry.getAll({ includeDisabled: true })) {
        if (this.skills.has(skill.name)) continue;
        const enabled = !(skill.isEnabled && skill.isEnabled() === false);
        if (skill.impl.kind !== 'prompt') continue;
        const impl = skill.impl;
        this.registerSkill({
          name: skill.name,
          description: skill.description || '',
          type: 'prompt',
          source: skill.source === 'builtin' ? 'builtin' : 'user',
          enabled,
          tags: [],
          promptProvider: async (args) => {
            const prompts = await impl.getPromptForCommand(args ?? {}, {});
            return prompts.map((p) => p.text).join('\n');
          },
        });
      }
    } catch {
      // @ignore-catch: 注册表不可用时仅保留硬编码内置技能
    }
  }

  /**
   * 获取工具信息
   */
  getInfo(): ToolInfo {
    return {
      name: this.name,
      description: this.buildDynamicDescription(),
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
   * T3b（2026-08-30）：动态描述——同步读 registry 构建紧凑技能名清单，供模型感知
   * 可调用技能（BUG-6）。M-1：getInfo 为同步接口，不依赖 async ensureSyncedFromRegistry
   * （后者仅 execute 时调用）；M-2：仅列技能名，描述详情保留在注入块（避免 token 双份）。
   * 配合 ToolLazyWrapper.getInfo() 穿透（T3a），每次请求取到最新清单。
   */
  private buildDynamicDescription(): string {
    try {
      const registry = getSkillRegistryLazy();
      const names =
        registry
          ?.getAll({ includeDisabled: false })
          .filter((s) => s.impl.kind === 'prompt')
          .map((s) => s.name) ?? [];
      if (names.length === 0) return this.description;
      const list =
        names.slice(0, 15).join(', ') +
        (names.length > 15 ? `, +${names.length - 15} more` : '');
      return `Execute a registered skill. Available: ${list}. 技能名可从上下文 <available_skills> 获取。`;
    } catch {
      // registry 不可用回退静态描述
      return this.description;
    }
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
      // P3-7b（2026-09-02）：技能不存在但同名系统工具存在 → 引导直接调用工具。
      // 实测：模型反复用 Skill 包装 todo_write（工具）→ "Skill 'todo_write' not found"，
      // 4 个会话反复发生、单会话最多 4 次，导致任务卡壳。返回引导错误让模型直接
      // 调用同名工具，而非继续 Skill 包装。
      const sameNameTool = getToolRegistry().getTool(input.name as string);
      if (sameNameTool) {
        const paramNames =
          sameNameTool.params
            ?.map((p) => p.name)
            .filter((n): n is string => typeof n === 'string') ?? [];
        return {
          result: false,
          message: `Skill '${input.name}' not found — '${input.name}' 是系统工具，请直接调用该工具（无需 Skill 包装）。可用参数：${JSON.stringify(paramNames)}`,
        };
      }
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
        return await this.executePromptSkill(skill, args);
      case 'command':
        return await this.executeCommandSkill(skill, args);
      case 'agent':
        return await this.executeAgentSkill(skill, args);
      default:
        return await this.executeGenericSkill(skill, args);
    }
  }

  /**
   * 执行Prompt类型的Skill
   */
  private async executePromptSkill(
    skill: SkillDefinition,
    args?: Record<string, unknown>
  ): Promise<string> {
    // 2026-08-06：注册表技能优先返回真实 prompt 内容（impl.getPromptForCommand）
    if (skill.promptProvider) {
      const rendered = await skill.promptProvider(args);
      return `[Prompt Skill: ${skill.name}]\n\n${rendered}`;
    }
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
  private async executeCommandSkill(
    skill: SkillDefinition,
    args?: Record<string, unknown>
  ): Promise<string> {
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
  private async executeAgentSkill(
    skill: SkillDefinition,
    args?: Record<string, unknown>
  ): Promise<string> {
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
  private async executeGenericSkill(
    skill: SkillDefinition,
    args?: Record<string, unknown>
  ): Promise<string> {
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
    // 2026-08-06：执行前确保已从真实 SkillRegistry 同步技能（含 skillify 等 bundled 技能）
    await this.ensureSyncedFromRegistry();

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
      // 2026-08-30 可观测性：技能执行统一 OTel span（技能名维度，对齐 SkillExecutor）
      const result = await getOTelTracing().wrap(
        {
          name: 'skill.execute',
          attributes: { 'skills.name': skillInput.name },
        },
        () => this.executeSkill(skill, skillInput.arguments, context)
      )();

      this.activeExecutions.get(executionId)!.status = 'completed';
      // P2-2（2026-09-02）：技能使用遥测——执行成功才计数（对标 hermes skill_usage bump_use）
      void skillUsageTracker.bumpUse(skill.name);

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

      // 2026-08-30 §1.9：统一 handleError（Logger + ErrorTracker），工具失败以结构化结果返回
      await handleError(error, {
        module: 'tools:SkillTool:SkillTool',
        action: 'execute',
        context: { skillName: skill.name },
      }).catch(() => {});

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

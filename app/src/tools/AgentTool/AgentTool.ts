/**
 * AgentTool - 创建子代理执行任务
 *
 * 功能:
 * - 创建子代理执行复杂任务
 * - 完整的查询循环（多轮工具调用）
 * - 后台运行支持（BackgroundTaskManager）
 * - 隐式 fork 子代理
 * - 工作目录隔离
 * - 多种Agent类型
 */

import { randomUUID } from 'crypto';
import {
  Tool,
  ToolInfo,
  ToolTag,
  ValidationResult,
  ToolCallProgress,
} from '../types/Tool';
import { ToolResult, ToolExecutionStatus } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import { WorkspaceGit } from '../../workspaces/WorkspaceGit';
import {
  AGENT_TOOL_NAME,
  LEGACY_AGENT_TOOL_NAME,
  BUILTIN_AGENTS,
} from './constants';
import type { AgentInput, AgentConfig, BuiltInAgent, AgentType } from './types';
import type { AgentToolProgress } from '../types/ToolProgress';
import { VERIFICATION_SYSTEM_PROMPT } from './strategies/VerificationStrategy';
import { STATUSLINE_SYSTEM_PROMPT } from './strategies/StatuslineStrategy';
import {
  FORK_SUBAGENT_TYPE,
  isForkSubagentEnabled,
  buildForkSystemPrompt,
  buildForkContextMessages,
  buildChildMessage,
} from './ForkSubagent';
import { SubAgentEngine, getSubAgentEngine } from './SubAgentEngine';
import { ParallelOrchestrator } from './ParallelOrchestrator';
import { agentRegistry } from '@modules/agent';
import { getTeammateManager } from '../../subagent/TeammateManager';
import { taskRegistry } from '@modules/tasks';
import { resolveModelRoute, RouteKey } from '@modules/ai';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { BackgroundAgentTask } from '@modules/tasks';
import type { BackgroundTaskInfo } from '@modules/tasks/types';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { trackUsage } from '@modules/ai';
import { subAgentTokenListeners } from '../../core/tokenBudget/SubAgentTokenBridge';

/**
 * 工具管理器引用（DI 注入，避免循环依赖）
 * ToolManager → ToolFactory → AgentTool → ToolManager 闭环
 */
let _getAllTools: (() => Tool[]) | null = null;

export function setAgentToolManager(getter: () => Tool[]): void {
  _getAllTools = getter;
}

function getAllTools(): Tool[] {
  if (!_getAllTools) return [];
  return _getAllTools();
}

const logger = getLogger('tools:agentTool');

/** B3：子代理最大嵌套深度（对齐 PilotDeck maxSubagentDepth 默认 1） */
const MAX_SUBAGENT_DEPTH = 1;

/**
 * AgentTool参数定义
 */
const AGENT_PARAMS = [
  {
    name: 'description',
    type: 'string' as const,
    description: 'A short (3-5 word) description of the task',
    required: true,
  },
  {
    name: 'prompt',
    type: 'string' as const,
    description: 'The task for the agent to perform',
    required: true,
  },
  {
    name: 'subagent_type',
    type: 'string' as const,
    description:
      'The type of specialized agent to use: general, explore, plan, verification, code-guide, statusline-setup',
    required: false,
    default: 'general',
  },
  {
    name: 'model',
    type: 'string' as const,
    description: 'Optional model override: a registered model ID',
    required: false,
  },
  {
    name: 'run_in_background',
    type: 'boolean' as const,
    description: 'Set to true to run this agent in the background',
    required: false,
    default: false,
  },
  {
    name: 'name',
    type: 'string' as const,
    description:
      'Name for the spawned agent. Makes it addressable via SendMessage',
    required: false,
  },
  {
    name: 'cwd',
    type: 'string' as const,
    description: 'Absolute path to run the agent in',
    required: false,
  },
  {
    name: 'allowedTools',
    type: 'string' as const,
    description:
      'Comma-separated tool names the sub-agent is allowed to use. If empty, all tools are available.',
    required: false,
  },
  {
    name: 'deniedTools',
    type: 'string' as const,
    description:
      'Comma-separated tool names the sub-agent is denied from using.',
    required: false,
  },
];

/**
 * 默认Agent配置
 */
const DEFAULT_AGENT_CONFIG: AgentConfig = {
  defaultType: 'general',
  maxConcurrentAgents: 5,
  timeoutMs: 600000,
  allowBackground: true,
};

/**
 * AgentTool实现
 *
 * 用于创建子代理执行复杂任务
 */
export class AgentTool implements Tool {
  /** 工具名称 */
  readonly name: string = AGENT_TOOL_NAME;

  /** 工具描述 */
  readonly description: string =
    'Create a specialized sub-agent to perform a specific task';

  /** 工具参数 */
  readonly params = AGENT_PARAMS;

  /** 工具别名 */
  readonly aliases?: string[] = [LEGACY_AGENT_TOOL_NAME, 'Task', 'SubAgent'];

  /** 搜索提示 */
  readonly searchHint?: string = 'create agent task subagent';

  /** 工具配置 */
  private config: AgentConfig;

  /** 子代理引擎 */
  private engine: SubAgentEngine;

  /** 活跃的Agent映射 */
  private activeAgents: Map<
    string,
    {
      id: string;
      name: string;
      type: AgentType;
      startTime: number;
      status: 'running' | 'completed' | 'failed';
    }
  > = new Map();

  /**
   * 活跃子 agent 的 teammate handle 映射（设计二 2026-08-26）：
   * 注册时机前移到 execute 入口（agentId 确定后），生命周期绑定执行全程；
   * 前台在 execute 返回时清理，后台在 bgTask 完成/失败回调中清理。
   */
  private agentTeammateHandles: Map<string, string> = new Map();

  /** 注册子 agent 为可寻址 teammate（返回 handleId；失败返回 null 不阻断执行） */
  private async registerTeammate(
    agentId: string,
    name: string | undefined,
    systemPrompt: string,
    model?: string
  ): Promise<string | null> {
    if (!name) return null;
    try {
      const handle = await getTeammateManager().spawnTeammate('in_process', {
        name,
        model,
        systemPrompt,
      });
      this.agentTeammateHandles.set(agentId, handle.id);
      logger.info('子 agent 已注册为可寻址 teammate', {
        agentId,
        name,
        handleId: handle.id,
      });
      return handle.id;
    } catch (error) {
      // 注册失败（重名/上限）不阻断主流程：子 agent 仅不可寻址
      logger.warning('子 agent teammate 注册失败（仅不可寻址，不影响执行）', {
        agentId,
        name,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /** 注销子 agent 的 teammate（幂等，失败仅记录） */
  private async unregisterTeammate(agentId: string): Promise<void> {
    const handleId = this.agentTeammateHandles.get(agentId);
    if (!handleId) return;
    this.agentTeammateHandles.delete(agentId);
    try {
      await getTeammateManager().killTeammate(handleId);
      logger.info('子 agent teammate 已清理', { agentId, handleId });
    } catch (error) {
      logger.warning('teammate 清理失败', {
        agentId,
        handleId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 构造函数
   * @param config Agent配置
   */
  constructor(config: Partial<AgentConfig> = {}) {
    this.config = { ...DEFAULT_AGENT_CONFIG, ...config };
    this.engine = getSubAgentEngine();
  }

  /**
   * 获取工具信息
   */
  getInfo(): ToolInfo {
    return {
      name: this.name,
      description: this.description,
      params: this.params,
      aliases: this.aliases,
      enabled: true,
      readOnly: false,
      destructive: false,
      concurrencySafe: false,
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
    return false;
  }

  /**
   * 获取Agent类型
   * @param typeName 类型名称
   */
  private getAgentType(typeName?: string): AgentType {
    if (!typeName) {
      return this.config.defaultType;
    }

    const normalizedType = typeName.toLowerCase();

    switch (normalizedType) {
      case 'general':
        return 'general';
      case 'explore':
        return 'explore';
      case 'plan':
        return 'plan';
      case 'verification':
        return 'verification';
      case 'code-guide':
        return 'code-guide';
      case 'statusline-setup':
        return 'statusline-setup';
      default:
        return 'custom';
    }
  }

  /**
   * 获取内置Agent定义
   * @param type Agent类型
   */
  private getBuiltInAgent(type: AgentType): BuiltInAgent | undefined {
    const agents = Object.values(BUILTIN_AGENTS);
    return agents.find((agent) => agent.type === type);
  }

  /**
   * 验证输入参数
   * @param input 输入参数
   */
  validateInput(input: Record<string, unknown>): ValidationResult {
    if (!input.description || typeof input.description !== 'string') {
      return {
        result: false,
        message: 'description is required and must be a string',
      };
    }

    if (!input.prompt || typeof input.prompt !== 'string') {
      return {
        result: false,
        message: 'prompt is required and must be a string',
      };
    }

    if (input.description.length > 100) {
      return {
        result: false,
        message: 'description must be 100 characters or less',
      };
    }

    return { result: true };
  }

  /**
   * 获取用户可见的工具名称
   */
  userFacingName(input?: Partial<any>): string {
    const description = (input?.description as string) || '';
    const type = (input?.subagent_type as string) || 'general';
    if (description) {
      return `Agent: ${type} - ${description.substring(0, 30)}${description.length > 30 ? '...' : ''}`;
    }
    return this.name;
  }

  /**
   * 获取活动描述
   */
  getActivityDescription(input?: Partial<any>): string | null {
    const description = (input?.description as string) || '';
    const type = (input?.subagent_type as string) || 'general';
    if (description) {
      return `Creating ${type} agent for: ${description}`;
    }
    return null;
  }

  /**
   * 获取工具使用摘要
   */
  getToolUseSummary(input?: Partial<any>): string | null {
    const description = (input?.description as string) || '';
    const type = (input?.subagent_type as string) || 'general';
    if (description) {
      return `Create ${type} agent: ${description.substring(0, 50)}${description.length > 50 ? '...' : ''}`;
    }
    return null;
  }

  /**
   * 创建Agent ID
   */
  private createAgentId(type: AgentType, name?: string): string {
    const prefix = type === 'general' ? 'a' : 'x';
    const uuid = randomUUID().replace(/-/g, '').substring(0, 8);
    return `${prefix}-${name || 'agent'}-${uuid}`;
  }

  /**
   * 检查是否超过最大并发数
   */
  private checkConcurrencyLimit(): boolean {
    const runningCount = Array.from(this.activeAgents.values()).filter(
      (agent) => agent.status === 'running'
    ).length;

    return runningCount < this.config.maxConcurrentAgents;
  }

  /**
   * 获取默认系统提示
   * @param type Agent类型
   */
  private getDefaultSystemPrompt(type: AgentType): string {
    switch (type) {
      case 'explore':
        return 'You are an exploration agent. Your goal is to explore the codebase and gather information about the project structure, key files, and functionality.';
      case 'plan':
        return 'You are a planning agent. Your goal is to create a detailed plan for implementing a feature or fixing an issue.';
      case 'verification':
        return VERIFICATION_SYSTEM_PROMPT;
      case 'code-guide':
        return 'You are a code guide assistant. Your goal is to help users write clean, efficient, and maintainable code by providing best practices and code review feedback.';
      case 'statusline-setup':
        return STATUSLINE_SYSTEM_PROMPT;
      default:
        return 'You are a helpful AI agent. You have access to various tools to help complete tasks.';
    }
  }

  /**
   * 构建工具定义列表（支持 allowedTools/deniedTools 过滤）
   * @param toolPool 工具池（缺陷 3 修复：子 agent 传排除 AgentTool 自身的池，
   *                 防止无限嵌套递归；默认全量）
   */
  private buildToolDefinitions(
    allowedTools?: string[],
    deniedTools?: string[],
    toolPool?: Tool[]
  ): Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }> {
    let tools = toolPool ?? getAllTools();

    // 白名单过滤：只保留名称在列表中的工具
    if (allowedTools && allowedTools.length > 0) {
      const allowedSet = new Set(allowedTools.map((t) => t.toLowerCase()));
      tools = tools.filter((t) => allowedSet.has(t.name.toLowerCase()));
    }

    // 黑名单过滤：排除名称在列表中的工具
    if (deniedTools && deniedTools.length > 0) {
      const deniedSet = new Set(deniedTools.map((t) => t.toLowerCase()));
      tools = tools.filter((t) => !deniedSet.has(t.name.toLowerCase()));
    }

    return tools.map((tool) => {
      const info = tool.getInfo();
      return {
        name: tool.name,
        description: info.description,
        parameters: {
          type: 'object' as const,
          properties: info.params.reduce(
            (acc, param) => {
              acc[param.name] = {
                type: param.type,
                description: param.description,
              };
              if (param.default !== undefined) {
                (acc[param.name] as any).default = param.default;
              }
              return acc;
            },
            {} as Record<string, unknown>
          ),
          required: info.params
            .filter((param) => param.required)
            .map((param) => param.name),
        },
      };
    });
  }

  /**
   * 使用子代理引擎运行Agent任务
   */
  private async runWithEngine(
    input: AgentInput,
    agentId: string,
    systemPrompt: string,
    isFork: boolean,
    onProgress: ToolCallProgress<AgentToolProgress> | undefined,
    teammateHandleId: string | null = null,
    mailbox: Array<{ role: 'user'; content: string }> = [],
    toolContext?: ToolUseContext
  ): Promise<{
    result: string;
    // N1 修复（2026-08-27）：透出 engine 完成状态——原只返回 result/tokenUsage，
    // 中断（abort）结果被上层无条件覆盖为 completed，被停止的任务显示"已完成"
    completed: boolean;
    error?: string;
    tokenUsage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  }> {
    // 缺陷 3 修复（2026-08-26）：子 agent 工具池排除 AgentTool 自身——
    // 原注入全量工具（含 AgentTool），子 agent 可再调 agent 工具无限嵌套，
    // 每层独立 LLM 调用 + teammate 注册 + 工具实例，资源消耗无上限
    const subAgentToolPool = getAllTools().filter(
      (t) => t.name !== AGENT_TOOL_NAME && t.name !== LEGACY_AGENT_TOOL_NAME
    );

    const toolDefinitions = this.buildToolDefinitions(
      input.allowedTools,
      input.deniedTools,
      subAgentToolPool
    );

    const engineInput = {
      agentId,
      systemPrompt,
      messages: [{ role: 'user' as const, content: input.prompt }],
      tools: toolDefinitions.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
      toolInstances: new Map(subAgentToolPool.map((t) => [t.name, t])),
      maxTurns: 50,
      model: input.model,
      // BUG 5 修复（2026-08-27）：透传父级工具上下文（sessionId/权限域）给子代理内部工具调用
      // B3：克隆上下文并递增 subagentDepth（父代对象不被复用，避免共享引用污染）
      toolContext: toolContext
        ? {
            ...toolContext,
            subagentDepth: (toolContext.subagentDepth ?? 0) + 1,
          }
        : undefined,
    };

    const engineOnProgress = (event: {
      agentId: string;
      type: string;
      message: string;
      toolUseId?: string;
      toolName?: string;
      turn?: number;
      maxTurns?: number;
    }) => {
      onProgress?.({
        toolUseID: agentId,
        data: {
          type: 'agent_tool',
          agentName: input.name || agentId,
          action: event.type,
          message: event.message,
          isRunning: true,
          isComplete: event.type === 'complete' || event.type === 'error',
        },
      });
    };

    // 设计二（2026-08-26）：teammate 注册已前移到 execute 入口（agentId 确定后），
    // 此处仅接收外部传入的 handleId 与 mailbox：投递消息收集 → 注入子 agent 上下文。
    // 生命周期（注册/清理）由 execute 或后台任务负责，本方法不再自注册/自 kill。
    const result = await this.engine.execute(
      {
        ...engineInput,
        messageSource: teammateHandleId
          ? () => mailbox.splice(0, mailbox.length)
          : undefined,
      },
      engineOnProgress
    );

    return {
      result: result.output,
      completed: result.completed,
      error: result.error,
      tokenUsage: result.tokenUsage,
    };
  }

  /**
   * 直接调用LLM（简单任务，不使用查询循环）
   */
  private async runDirectCall(
    input: AgentInput,
    agentId: string,
    systemPrompt: string
  ): Promise<{ result: string; completed: true }> {
    const { providerRegistry } = await import('@modules/ai');
    const agentModel = await resolveModelRoute(RouteKey.CHAT);
    const llmClient = agentModel
      ? providerRegistry.getByModel(agentModel)
      : undefined;
    if (!llmClient) {
      throw new AppError(
        `AgentTool: 任务分工中"对话"模型未配置或对应供应商未注册。请在「模型管理→任务分工」中配置。`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const toolDefinitions = this.buildToolDefinitions(
      input.allowedTools,
      input.deniedTools
    ).map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: input.prompt },
    ];

    let response: Awaited<ReturnType<typeof llmClient.chat>>;
    try {
      const startTime = Date.now();
      response = await llmClient.chat(messages, {
        tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
        model: input.model,
      });
      const latencyMs = Date.now() - startTime;

      trackUsage(response as unknown as Record<string, unknown>, {
        model: input.model || agentModel,
        latencyMs,
      });
    } catch (e) {
      handleError(e, {
        module: 'tools:agentTool',
        action: 'runDirectCallLLM',
      });
      throw e;
    }

    const content = response.content || '';
    const toolCalls = response.tool_calls;

    if (toolCalls && toolCalls.length > 0) {
      return {
        completed: true,
        result:
          `Agent [${agentId}] completed task with tool calls:\n\n` +
          `Type: ${input.subagent_type || 'general'}\n` +
          `Prompt: ${input.prompt}\n\n` +
          `Tool Calls: ${JSON.stringify(toolCalls, null, 2)}\n\n` +
          `Content: ${content}`,
      };
    }

    return {
      completed: true,
      result:
        `Agent [${agentId}] completed task:\n\n` +
        `Type: ${input.subagent_type || 'general'}\n` +
        `Prompt: ${input.prompt}\n\n` +
        `Result: ${content}`,
    };
  }

  /**
   * 执行Agent任务
   * @param input 任务输入
   * @param context 执行上下文
   * @param onProgress 进度回调
   */
  async execute(
    input: Record<string, unknown>,
    context?: ToolUseContext,
    onProgress?: ToolCallProgress<AgentToolProgress>
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

    const agentInput = input as unknown as AgentInput;
    const agentType = this.getAgentType(agentInput.subagent_type);

    const isFork = !agentInput.subagent_type && isForkSubagentEnabled();
    const effectiveType = isFork
      ? (FORK_SUBAGENT_TYPE as AgentType)
      : agentType;
    const isBackground = agentInput.run_in_background === true;

    // B3：子代理嵌套深度硬上限（纵深防御——主路径已靠工具池排除 AgentTool 防递归）
    const parentDepth = context?.subagentDepth ?? 0;
    if (parentDepth >= MAX_SUBAGENT_DEPTH) {
      logger.warning('Agent execution rejected: subagent depth exceeded', {
        parentDepth,
        maxDepth: MAX_SUBAGENT_DEPTH,
      });
      return {
        status: ToolExecutionStatus.FAILURE,
        result: null,
        error: `Subagent nesting depth exceeded (max ${MAX_SUBAGENT_DEPTH})`,
        executionTime: 0,
        output: '',
        errorOutput: 'Subagent nesting depth exceeded',
        progress: [],
        metadata: {},
        executionId: '',
        toolName: this.name,
        timestamp: Date.now(),
      };
    }

    // Phase 3: 解析工具过滤（LLM 传递逗号分隔字符串，转为数组）
    if (typeof agentInput.allowedTools === 'string') {
      agentInput.allowedTools = (agentInput.allowedTools as string)
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);
    }
    if (typeof agentInput.deniedTools === 'string') {
      agentInput.deniedTools = (agentInput.deniedTools as string)
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);
    }

    if (!this.checkConcurrencyLimit()) {
      logger.warning('Agent execution rejected: concurrent limit reached');
      return {
        status: ToolExecutionStatus.FAILURE,
        result: null,
        error: 'Maximum concurrent agents reached',
        executionTime: 0,
        output: '',
        errorOutput: 'Maximum concurrent agents reached',
        progress: [],
        metadata: {},
        executionId: '',
        toolName: this.name,
        timestamp: Date.now(),
      };
    }

    const agentId = this.createAgentId(
      isFork ? 'custom' : agentType,
      agentInput.name
    );
    const startTime = Date.now();

    this.activeAgents.set(agentId, {
      id: agentId,
      name: agentInput.name || agentId,
      type: effectiveType,
      startTime,
      status: 'running',
    });

    logger.info('Agent execution started', {
      agentId,
      agentType: effectiveType,
      isBackground,
      isFork,
      promptLength: agentInput.prompt?.length || 0,
    });

    onProgress?.({
      toolUseID: agentId,
      data: {
        type: 'agent_tool',
        agentName: agentInput.name || agentId,
        action: 'start',
        message: `Starting agent: ${agentInput.name || agentId}`,
        isRunning: true,
        isComplete: false,
      },
    });

    // G3 接线：worktree 隔离变量（try/finally 均需访问，声明在 try 之外——JS 块级作用域）
    let worktreeContext: ToolUseContext | undefined;
    let worktreeGit: WorkspaceGit | undefined;

    try {
      // ========== 方案 7：并行执行 ==========
      // 当 LLM 传入 tasks 数组时，路由到 ParallelOrchestrator 并行执行
      if (agentInput.tasks && agentInput.tasks.length > 0) {
        logger.info('Parallel execution started', {
          agentId,
          taskCount: agentInput.tasks.length,
        });

        const orchestrator = new ParallelOrchestrator();
        const taskResults = await orchestrator.executeAll(
          agentInput.tasks,
          undefined,
          agentInput.model
        );

        this.activeAgents.get(agentId)!.status = 'completed';

        // 汇总结果为 JSON 字符串
        const aggregatedOutput = taskResults
          .map(
            (r) =>
              `[${r.success ? 'OK' : 'FAIL'}] ${r.name}: ${r.success ? r.output.substring(0, 500) : r.error}`
          )
          .join('\n---\n');

        onProgress?.({
          toolUseID: agentId,
          data: {
            type: 'agent_tool',
            agentName: agentInput.name || agentId,
            action: 'complete',
            message: `Parallel execution completed: ${taskResults.filter((r) => r.success).length}/${taskResults.length} tasks succeeded`,
            isRunning: false,
            isComplete: true,
          },
        });

        return {
          status: ToolExecutionStatus.SUCCESS,
          result: aggregatedOutput,
          error: undefined,
          executionTime: Date.now() - startTime,
          output: aggregatedOutput,
          errorOutput: '',
          progress: [],
          metadata: {
            agentId,
            agentType: effectiveType,
            completed: true,
            parallelTaskCount: taskResults.length,
            parallelSuccessCount: taskResults.filter((r) => r.success).length,
          },
          executionId: agentId,
          toolName: this.name,
          timestamp: Date.now(),
        };
      }

      const builtInAgent = this.getBuiltInAgent(effectiveType);
      let systemPrompt =
        builtInAgent?.systemPrompt ||
        this.getDefaultSystemPrompt(effectiveType);

      // 2026-08-26（模块集成）：子 agent 接入 agent 管理模块——
      // subagent_type 非内置类型时，从 AgentRegistry 查找用户自定义 agent
      //（匹配 agentId/name/role），使用其 systemPrompt 与推荐模型。
      // 此前仅硬编码 6 种内置类型，用户通过 AgentPage 配置的自定义 agent
      // 无法被子 agent 工具使用（断裂点 2）。
      if (effectiveType === 'custom' && agentInput.subagent_type) {
        const regType = String(agentInput.subagent_type);
        const customAgent =
          agentRegistry.getAgent(regType) ||
          agentRegistry
            .listAll()
            .find((a) => a.name === regType || a.role === regType);
        if (customAgent) {
          if (customAgent.systemPrompt) {
            systemPrompt = customAgent.systemPrompt;
          }
          if (customAgent.model && !agentInput.model) {
            agentInput.model = customAgent.model;
          }
          logger.info('AgentTool 使用自定义 agent', {
            agentId,
            customId: customAgent.agentId,
            name: customAgent.name,
            role: customAgent.role,
            hasSystemPrompt: !!customAgent.systemPrompt,
          });
        }
      }

      // 设计二（2026-08-26）：teammate 注册前移到 execute 入口（systemPrompt 确定后）——
      // 原在 runWithEngine 内注册+finally kill，后台模式会在主线程返回时被过早清理。
      // 现注册时机提前，生命周期绑定执行全程（前台 execute 返回清理，后台 bgTask 回调清理）。
      let teammateHandleId: string | null = null;
      const mailbox: Array<{ role: 'user'; content: string }> = [];
      // BUG 6 修复（2026-08-27）：simple task（runDirectCall，无 SubAgentEngine
      // messageSource 消费）不注册 teammate——原注册后 mailbox 无人消费，消息堆积丢弃
      const isSimpleTaskNow =
        agentInput.prompt.length < 500 && !isFork && !agentInput.subagent_type;
      if (!isSimpleTaskNow) {
        teammateHandleId = await this.registerTeammate(
          agentId,
          agentInput.name,
          systemPrompt,
          agentInput.model
        );
      }
      if (teammateHandleId && agentInput.name) {
        const handleName = agentInput.name;
        getTeammateManager().onTeammateMessage(teammateHandleId, (message) => {
          const content =
            typeof message.content === 'string'
              ? message.content
              : JSON.stringify(message.content);
          mailbox.push({
            role: 'user',
            content: `[来自 ${String(message.metadata?.sender ?? 'teammate')} 的消息] ${content}`,
          });
          logger.info('teammate 消息已进入子 agent 信箱', {
            agentId,
            name: handleName,
          });
        });
      }

      // G3 接线（2026-08-31）：isolation='worktree' 程序化创建隔离 worktree，
      // 将 cwd 注入子代理工具上下文（文件工具相对路径解析到 worktree 内）。
      if (agentInput.isolation === 'worktree') {
        if (isBackground) {
          // 后台任务生命周期复杂（execute 返回后任务仍在运行），保留提示词注入降级
          systemPrompt +=
            '\n\nThis agent runs in an isolated git worktree.\n' +
            `Use EnterWorktree to create a worktree with slug "${agentInput.name || agentId}" before making changes.\n` +
            'After completing work, use ExitWorktree to clean up the worktree.\n' +
            'All file modifications must be done inside the worktree, never in the parent workspace.';
          logger.warn(
            'Worktree isolation: 后台任务不程序化创建 worktree，降级为提示词引导',
            {
              agentId,
            }
          );
        } else {
          try {
            const baseDir = context?.options?.cwd;
            if (baseDir) {
              const git = new WorkspaceGit({ baseDir });
              const info = await git.createWorktree(agentId);
              worktreeGit = git;
              worktreeContext = {
                ...context,
                options: {
                  ...(context?.options ?? {}),
                  cwd: info.worktreePath,
                },
              } as ToolUseContext;
              systemPrompt +=
                '\n\nThis agent runs in an isolated git worktree.\n' +
                `Your working directory is: ${info.worktreePath}\n` +
                'Relative file paths in read_file/write_file/edit_file resolve to this directory.\n' +
                'All file modifications must be inside the worktree, never in the parent workspace.';
              logger.info('Worktree isolation: 已程序化创建 worktree', {
                agentId,
                worktreePath: info.worktreePath,
              });
            }
          } catch (error) {
            // 创建失败（非 git 仓库等）→ 降级为提示词引导
            logger.warn(
              'Worktree isolation: 程序化创建失败，降级为提示词引导',
              {
                agentId,
                error: error instanceof Error ? error.message : String(error),
              }
            );
            systemPrompt +=
              '\n\nThis agent runs in an isolated git worktree.\n' +
              `Use EnterWorktree to create a worktree with slug "${agentInput.name || agentId}" before making changes.\n` +
              'After completing work, use ExitWorktree to clean up the worktree.\n';
          }
        }
      }

      if (isFork) {
        const parentMessages: Array<{
          role: 'user' | 'assistant';
          content: string;
        }> = context?.messages
          ? context.messages.map((m: { role: string; content: string }) => ({
              role: m.role as 'user' | 'assistant',
              content:
                typeof m.content === 'string'
                  ? m.content
                  : JSON.stringify(m.content),
            }))
          : [];

        systemPrompt = buildForkSystemPrompt(systemPrompt, {
          renderedSystemPrompt: systemPrompt,
          parentMessages,
          directive: agentInput.description,
        });

        const forkMessages = buildForkContextMessages(parentMessages);
        const childInstruction = buildChildMessage(agentInput.prompt);
        agentInput.prompt =
          forkMessages.map((m) => `${m.role}: ${m.content}`).join('\n\n') +
          '\n\n' +
          childInstruction;
      }

      if (isBackground) {
        if (!this.config.allowBackground) {
          logger.warning('Background execution disabled', { agentId });
          // 泄漏修复（2026-08-27）：该分支 return 前清理已注册的 teammate
          await this.unregisterTeammate(agentId);
          return {
            status: ToolExecutionStatus.FAILURE,
            result: null,
            error: 'Background execution is disabled',
            executionTime: 0,
            output: '',
            errorOutput: 'Background execution is disabled',
            progress: [],
            metadata: {},
            executionId: agentId,
            toolName: this.name,
            timestamp: Date.now(),
          };
        }

        const taskId = `bg-${randomUUID().replace(/-/g, '').substring(0, 12)}`;
        const bgInfo: BackgroundTaskInfo = {
          taskId,
          agentName: agentInput.name || agentId,
          agentType: effectiveType,
          description: agentInput.description || 'Background agent task',
          status: 'running',
          createdAt: Date.now(),
          startedAt: Date.now(),
        };
        const bgTask = new BackgroundAgentTask(bgInfo, taskId);
        taskRegistry.register(bgTask, taskId);

        this.runWithEngine(
          agentInput,
          agentId,
          systemPrompt,
          isFork,
          onProgress,
          teammateHandleId,
          mailbox,
          context
        )
          .then(async (runResult) => {
            // N1 修复（2026-08-27）：按 engine 真实结果置状态——原无条件置
            // 'completed'，被 stopAgent 中止的后台任务在任务列表显示"已完成"
            const taskCompleted = runResult.completed;
            bgTask.syncFromBgInfo({
              ...bgInfo,
              status: taskCompleted ? 'completed' : 'failed',
              result: runResult.result,
              error: taskCompleted
                ? undefined
                : runResult.error || 'Agent execution stopped',
              tokenUsage: runResult.tokenUsage || {
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
              },
              completedAt: Date.now(),
              durationMs: Date.now() - bgInfo.createdAt,
            });
            this.activeAgents.get(agentId)!.status = taskCompleted
              ? 'completed'
              : 'failed';
            // 设计二：后台任务完成时才清理 teammate（保留整个后台窗口期的可寻址性）
            await this.unregisterTeammate(agentId);
            // 残留 9 修复：后台完成也清理 activeAgents 条目
            this.cleanupCompletedAgents();
            logger.info('Background agent completed', { agentId, taskId });
          })
          .catch(async (error) => {
            handleError(error, {
              module: 'tools:agent',
              action: '后台Agent任务异常',
            });
            bgTask.syncFromBgInfo({
              ...bgInfo,
              status: 'failed',
              error: error instanceof Error ? error.message : String(error),
              completedAt: Date.now(),
              durationMs: Date.now() - bgInfo.createdAt,
            });
            this.activeAgents.get(agentId)!.status = 'failed';
            // 设计二：失败也清理 teammate
            await this.unregisterTeammate(agentId);
            // 残留 9 修复：后台失败也清理 activeAgents 条目
            this.cleanupCompletedAgents();
          });

        return {
          status: ToolExecutionStatus.SUCCESS,
          result: `Background agent task started (ID: ${taskId}). Use /agent status ${taskId} to check progress.`,
          error: undefined,
          executionTime: 0,
          output: `Background agent task started (ID: ${taskId})`,
          errorOutput: '',
          progress: [],
          metadata: {
            agentId,
            agentType: effectiveType,
            taskId,
            background: true,
            isFork,
          },
          executionId: agentId,
          toolName: this.name,
          timestamp: Date.now(),
        };
      }

      // N6 修复（2026-08-27）：复用 execute 入口的 isSimpleTaskNow（889 行），
      // 原此处重复计算同一条件（仅冗余，无行为差异）
      let result: {
        result: string;
        completed: boolean;
        error?: string;
        tokenUsage?: any;
      };

      if (isSimpleTaskNow) {
        result = await this.runDirectCall(agentInput, agentId, systemPrompt);
        logger.info('Agent direct call completed', {
          agentId,
          agentType: effectiveType,
        });
      } else {
        result = await this.runWithEngine(
          agentInput,
          agentId,
          systemPrompt,
          isFork,
          onProgress,
          teammateHandleId,
          mailbox,
          // G3：worktree 隔离时注入带 worktree cwd 的子代理上下文
          worktreeContext ?? context
        );
        logger.info('Agent engine execution completed', {
          agentId,
          agentType: effectiveType,
        });
      }

      // 设计二：前台执行路径结束后统一清理 teammate（directCall 与 engine 共用）
      await this.unregisterTeammate(agentId);

      // 将子 Agent 的 token 消耗汇聚到父会话的 UnifiedTokenTracker
      if (result.tokenUsage && context?.sessionId) {
        const usage = result.tokenUsage;
        if (usage.totalTokens > 0) {
          for (const listener of subAgentTokenListeners) {
            try {
              listener({
                sessionId: context.sessionId,
                promptTokens: usage.promptTokens ?? 0,
                completionTokens: usage.completionTokens ?? 0,
                totalTokens: usage.totalTokens,
              });
            } catch (err) {
              handleError(err, {
                module: 'tools:AgentTool',
                action: 'tokenListener',
              });
            }
          }
        }
      }

      // N1 修复（2026-08-27）：按 engine 真实结果置状态——原无条件置
      // 'completed'，被 stopAgent 中止的任务显示"已完成"
      this.activeAgents.get(agentId)!.status = result.completed
        ? 'completed'
        : 'failed';

      onProgress?.({
        toolUseID: agentId,
        data: {
          type: 'agent_tool',
          agentName: agentInput.name || agentId,
          action: result.completed ? 'complete' : 'error',
          message: result.completed
            ? 'Agent task completed successfully'
            : result.error || 'Agent execution stopped',
          isRunning: false,
          isComplete: true,
        },
      });

      return {
        status: result.completed
          ? ToolExecutionStatus.SUCCESS
          : ToolExecutionStatus.FAILURE,
        result: result.result,
        error: result.completed ? undefined : result.error,
        executionTime: Date.now() - startTime,
        output: result.result || '',
        errorOutput: result.completed ? '' : result.error || '',
        progress: [],
        metadata: {
          agentId,
          agentType: effectiveType,
          completed: result.completed,
          isFork,
          tokenUsage: result.tokenUsage,
        },
        executionId: agentId,
        toolName: this.name,
        timestamp: Date.now(),
      };
    } catch (error) {
      this.activeAgents.get(agentId)!.status = 'failed';
      // 设计二：失败路径同样清理 teammate（防泄漏）
      await this.unregisterTeammate(agentId);

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      handleError(error, {
        module: 'tools:agentTool',
        action: 'execute',
      });

      onProgress?.({
        toolUseID: agentId,
        data: {
          type: 'agent_tool',
          agentName: agentInput.name || agentId,
          action: 'error',
          message: errorMessage,
          isRunning: false,
          isComplete: true,
        },
      });

      return {
        status: ToolExecutionStatus.FAILURE,
        result: null,
        error: errorMessage,
        executionTime: Date.now() - startTime,
        output: '',
        errorOutput: errorMessage,
        progress: [],
        metadata: {
          agentId,
          agentType: effectiveType,
          completed: false,
        },
        executionId: agentId,
        toolName: this.name,
        timestamp: Date.now(),
      };
    } finally {
      // G3：清理程序化创建的 worktree（仅前台成功创建时）
      if (worktreeGit) {
        try {
          await worktreeGit.removeWorktree(agentId);
          logger.info('Worktree isolation: 已清理 worktree', { agentId });
        } catch (error) {
          logger.warn('Worktree isolation: worktree 清理失败', {
            agentId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      // 残留 9 修复（2026-08-27）：清理 completed/failed 条目，防 activeAgents 长期增长
      this.cleanupCompletedAgents();
    }
  }

  /**
   * 获取子代理引擎
   */
  getEngine(): SubAgentEngine {
    return this.engine;
  }

  /**
   * 获取活跃Agent列表
   */
  getActiveAgents(): Array<{
    id: string;
    name: string;
    type: AgentType;
    startTime: number;
    status: 'running' | 'completed' | 'failed';
  }> {
    return Array.from(this.activeAgents.values());
  }

  /**
   * 获取Agent状态
   * @param agentId Agent ID
   */
  getAgentStatus(agentId: string): {
    status: 'running' | 'completed' | 'failed' | 'not_found';
    duration?: number;
  } {
    const agent = this.activeAgents.get(agentId);
    if (!agent) {
      return { status: 'not_found' };
    }

    return {
      status: agent.status,
      duration: Date.now() - agent.startTime,
    };
  }

  /**
   * 停止Agent
   * @param agentId Agent ID
   */
  stopAgent(agentId: string): boolean {
    const agent = this.activeAgents.get(agentId);

    const engineStopped = this.engine.abort(agentId);

    if (agent && agent.status === 'running') {
      agent.status = 'failed';
      return true;
    }

    return engineStopped;
  }

  /**
   * 清理已完成的Agent
   */
  cleanupCompletedAgents(): number {
    let cleaned = 0;
    for (const [id, agent] of this.activeAgents.entries()) {
      if (agent.status !== 'running') {
        this.activeAgents.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }
}

/**
 * 创建AgentTool实例
 */
export function createAgentTool(config?: Partial<AgentConfig>): AgentTool {
  return new AgentTool(config);
}

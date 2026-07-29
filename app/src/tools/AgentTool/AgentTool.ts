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
import { taskRegistry } from '@modules/tasks/TaskRegistry';
import {
  resolveModelRoute,
  RouteKey,
} from '@modules/ai/router/resolveModelRoute.js';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { BackgroundAgentTask } from '@modules/tasks/BackgroundAgentTask';
import type { BackgroundTaskInfo } from '@modules/tasks/types';
import { Logger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { trackUsage } from '../../ai/UsageTracker';
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

const logger = new Logger({ module: 'tools:agentTool' });

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
      'The type of specialized agent to use: general, explore, plan, verification, claude-code-guide, statusline-setup',
    required: false,
    default: 'general',
  },
  {
    name: 'model',
    type: 'string' as const,
    description: 'Optional model override: sonnet, opus, haiku',
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
      case 'claude-code-guide':
        return 'claude-code-guide';
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
      case 'claude-code-guide':
        return 'You are a code guide assistant. Your goal is to help users write clean, efficient, and maintainable code by providing best practices and code review feedback.';
      case 'statusline-setup':
        return STATUSLINE_SYSTEM_PROMPT;
      default:
        return 'You are a helpful AI agent. You have access to various tools to help complete tasks.';
    }
  }

  /**
   * 构建工具定义列表（支持 allowedTools/deniedTools 过滤）
   */
  private buildToolDefinitions(
    allowedTools?: string[],
    deniedTools?: string[]
  ): Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }> {
    let tools = getAllTools();

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
    onProgress?: ToolCallProgress<AgentToolProgress>
  ): Promise<{
    result: string;
    tokenUsage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  }> {
    const toolDefinitions = this.buildToolDefinitions(
      input.allowedTools,
      input.deniedTools
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
      toolInstances: new Map(getAllTools().map((t) => [t.name, t])),
      maxTurns: 50,
      model: input.model,
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

    const result = await this.engine.execute(engineInput, engineOnProgress);

    return {
      result: result.output,
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
  ): Promise<{ result: string }> {
    const { providerRegistry } =
      await import('../../ai/providers/ProviderRegistry');
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
        result:
          `Agent [${agentId}] completed task with tool calls:\n\n` +
          `Type: ${input.subagent_type || 'general'}\n` +
          `Prompt: ${input.prompt}\n\n` +
          `Tool Calls: ${JSON.stringify(toolCalls, null, 2)}\n\n` +
          `Content: ${content}`,
      };
    }

    return {
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

      if (agentInput.isolation === 'worktree') {
        systemPrompt +=
          '\n\nThis agent runs in an isolated git worktree.\n' +
          `Use EnterWorktree to create a worktree with slug "${agentInput.name || agentId}" before making changes.\n` +
          'After completing work, use ExitWorktree to clean up the worktree.\n' +
          'All file modifications must be done inside the worktree, never in the parent workspace.';
        logger.info('Worktree isolation enabled', {
          agentId,
          slug: agentInput.name || agentId,
        });
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
          onProgress
        )
          .then((runResult) => {
            bgTask.syncFromBgInfo({
              ...bgInfo,
              status: 'completed',
              result: runResult.result,
              tokenUsage: runResult.tokenUsage || {
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
              },
              completedAt: Date.now(),
              durationMs: Date.now() - bgInfo.createdAt,
            });
            this.activeAgents.get(agentId)!.status = 'completed';
            logger.info('Background agent completed', { agentId, taskId });
          })
          .catch((error) => {
            bgTask.syncFromBgInfo({
              ...bgInfo,
              status: 'failed',
              error: error instanceof Error ? error.message : String(error),
              completedAt: Date.now(),
              durationMs: Date.now() - bgInfo.createdAt,
            });
            this.activeAgents.get(agentId)!.status = 'failed';
            logger.error('Background agent failed', {
              agentId,
              taskId,
              error: error instanceof Error ? error.message : String(error),
            });
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

      const isSimpleTask =
        agentInput.prompt.length < 500 && !isFork && !agentInput.subagent_type;

      let result: { result: string; tokenUsage?: any };

      if (isSimpleTask) {
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
          onProgress
        );
        logger.info('Agent engine execution completed', {
          agentId,
          agentType: effectiveType,
        });
      }

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

      this.activeAgents.get(agentId)!.status = 'completed';

      onProgress?.({
        toolUseID: agentId,
        data: {
          type: 'agent_tool',
          agentName: agentInput.name || agentId,
          action: 'complete',
          message: 'Agent task completed successfully',
          isRunning: false,
          isComplete: true,
        },
      });

      return {
        status: ToolExecutionStatus.SUCCESS,
        result: result.result,
        error: undefined,
        executionTime: Date.now() - startTime,
        output: result.result || '',
        errorOutput: '',
        progress: [],
        metadata: {
          agentId,
          agentType: effectiveType,
          completed: true,
          isFork,
          tokenUsage: result.tokenUsage,
        },
        executionId: agentId,
        toolName: this.name,
        timestamp: Date.now(),
      };
    } catch (error) {
      this.activeAgents.get(agentId)!.status = 'failed';

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      handleError(error, {
        module: 'tools:agentTool',
        action: 'execute',
      });

      logger.error('Agent execution failed', {
        agentId,
        agentType: effectiveType,
        error: errorMessage,
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

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
import { getTaskConcurrencyLimits } from '../../tasks/limits';
import {
  Tool,
  ToolInfo,
  ToolParam,
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
import type {
  AgentInput,
  AgentConfig,
  BuiltInAgent,
  AgentType,
  SubTask,
} from './types';
import { getAgentRunLedger, type AgentRunStatus } from './AgentRunLedger';
import {
  resolveAgentDescriptor as resolveDescriptorChain,
  renderSubagentTypeDescription,
  setEnabledRoleNames,
  type AgentDescriptorResult,
} from './AgentDescriptorResolver';
import {
  ALWAYS_BLOCKED_TOOLS,
  DELEGATE_BLOCKED_TOOLS,
  validateToolsetRequest,
} from './AgentToolsetContract';
import { getToolCategory } from '../toolCategories';
import { getAgentRunStore } from './AgentRunStore';
import { isSpawnPaused, getSpawnPauseState } from './spawnPause';
import { getSettlementOutbox } from '../../chat/yield/SettlementOutbox';
import {
  computeSummaryCharBudget,
  trimSummaryWithFooter,
  SUMMARY_MIN_CHARS,
} from './summaryTrim';
// O9/G14：真实预算取数来源（父当前上下文 + 模型窗口）
import { getUnifiedTokenTracker } from '@modules/core/tokenBudget/UnifiedTokenTracker';
// O10b（v7.1）：控制面 Tier1 血缘链（会话祖先判定）
import { isAncestorSession } from '@modules/session';
import { resolveContextWindowAsync } from '@modules/context';
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
// B-4（2026-09-20）：并行执行统一走 AgentSwarm 单引擎（原 ParallelOrchestrator 已删除），
// 并在此发布 PARALLEL_* 事件以保持前端 SSE 时间线不断供。
import { AgentSwarm, type SwarmExecutor } from '../../tasks/swarm/AgentSwarm';
import { globalEventBus } from '../../core/events/EventBus.js';
// 阶段 A（A1-e）：并行批次结算 → yield 等待收敛桥
import { notifyYieldSettled } from '../../chat/yield/YieldSettlementBridge.js';
import { agentRegistry, OrchestrationEventType } from '@modules/agent';
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
// N-41（2026-09-21 真机实证）：工具池兜底来源 —— 唯一注册表（project_rules §1.16）
import { getToolRegistry } from '../ToolRegistry';
// N-42（2026-09-21）：工具名合法性（OpenAI 兼容 `^[a-zA-Z0-9_-]+$`）——
// 复用 MCP 归一化的唯一实现（CS01 归一化，禁止重复正则）
import { isValidMcpName } from '../../services/mcp/normalization';

/**
 * 工具管理器引用（DI 注入，避免循环依赖）
 * ToolManager → ToolFactory → AgentTool → ToolManager 闭环
 */
let _getAllTools: (() => Tool[]) | null = null;

export function setAgentToolManager(getter: () => Tool[]): void {
  _getAllTools = getter;
}

/**
 * 清除 DI 注入，回到"回退唯一注册表"分支（**仅供测试**，与 `resetAgentRunLedger`
 * 等同一惯例）—— 用于防回归覆盖 N-41：注入缺失时不得静默返回空池。
 */
export function resetAgentToolManager(): void {
  _getAllTools = null;
}

/**
 * O18：刷新"可用子代理类型名"快照（DB 中 `enabled = 1` 的角色）。
 *
 * 调用点：① `AgentTool` 构造（fire-and-forget ⇒ schema 尽早反映 DB 角色）；
 * ② `/v1/agent-roles` 的 POST/PUT/DELETE 之后 —— **替代原 `AgentRegistry.invalidateCache()`**：
 * 后者清的是 `discover()` 的会话缓存，而解析链①走 DB 直查（无缓存）、②直读 `agents` Map
 * （不经该缓存）⇒ 对目标路径零作用（O17 复核认定为空修复）；真正需要刷新的是
 * **模型事前可见的清单**（工具 schema 描述）。
 *
 * 失败只记 warn（不回滚已落库的角色变更，也不阻断工具可用性）；
 * 未成功刷新时描述退化为"内置 + 运行时注册"，不臆测。
 */
export async function refreshAvailableSubagentTypeNames(): Promise<void> {
  try {
    const { getAgentRoleStore } =
      await import('@modules/workspace/AgentRoleStore');
    const store = getAgentRoleStore();
    await store.init();
    const roles = await store.listEnabled();
    setEnabledRoleNames(roles.map((role) => role.agentId));
  } catch (error) {
    logger.warn('刷新可用子代理类型名失败（schema 描述保留旧快照）', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function getAllTools(): Tool[] {
  if (_getAllTools) return _getAllTools();
  // N-41（2026-09-21 真机实证）：`setAgentToolManager` 的**唯一**调用点是
  // `ToolManager.initialize()`，而运行时主链路直接经 `getToolRegistry()` 注册/消费工具，
  // **从不调用该 initialize** ⇒ getter 恒为 null ⇒ 原实现 `return []` 静默放行，
  // 子代理工具池为空（OTel `subAgent.execute` 实证 `tools.count: 0`），
  // 使"被授权角色可再委派"（T9）在真机上永不可能发生，且失败无任何日志。
  // 兜底收敛到**唯一注册表**（project_rules §1.16）：能力可用性不再由注入时序决定。
  return Array.from(getToolRegistry().getTools().values());
}

const logger = getLogger('tools:agentTool');

/** B3：子代理最大嵌套深度（2026-09-01 决策 6：1 → 3，对标 deepseek-harness maxDepth=3；
 *  原值 1 仅允许单层子代理，3 允许 2 层嵌套，深度限制仍防失控递归）
 *  1-4（2026-09-03）：值收敛到 tasks/limits.ts（env TASK_SUBAGENT_DEPTH 可覆盖） */
const MAX_SUBAGENT_DEPTH = getTaskConcurrencyLimits().subagentDepth;

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
  {
    name: 'goal',
    type: 'string' as const,
    description:
      'Overall goal for parallel execution (used by verifier/synthesizer). Defaults to description.',
    required: false,
  },
  {
    name: 'verify',
    type: 'boolean' as const,
    description:
      'After parallel execution, run a verifier gate on each worker result (per-worker verified + allPassed). Default false.',
    required: false,
  },
  {
    name: 'synthesize',
    type: 'boolean' as const,
    description:
      'After parallel execution, synthesize all worker results into a single report. Default false.',
    required: false,
  },
];

/**
 * 默认Agent配置
 */
const DEFAULT_AGENT_CONFIG: AgentConfig = {
  defaultType: 'general',
  // 1-4（2026-09-03）：并发上限收敛到 tasks/limits.ts（env TASK_AGENT_CONCURRENCY）
  maxConcurrentAgents: getTaskConcurrencyLimits().agentConcurrency,
  timeoutMs: 600000,
  allowBackground: true,
};

/**
 * O12-1：swarm 单个子任务的描述符解析结果。
 *
 * `error` 与 `systemPrompt` 互斥：解析失败 ⇒ 该任务 fail-closed（不执行）。
 */
interface SwarmTaskDescriptor {
  systemPrompt?: string;
  model?: string;
  source?: string;
  error?: string;
}

/** O12-2：注入引擎的工具定义（OpenAI 兼容形状） */
interface SwarmToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

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

  /**
   * 工具参数（O18：`subagent_type` 的描述**动态生成**）。
   *
   * 每次访问按当前快照渲染 ⇒ 角色变更后**无需重建工具实例**，模型下一轮即可看到新清单；
   * 名单来源与解析链的可用值共享同一处（内置 `BUILTIN_AGENTS` + DB 启用角色 + 运行时注册）。
   */
  get params(): ToolParam[] {
    return AGENT_PARAMS.map((param) =>
      param.name === 'subagent_type'
        ? {
            ...param,
            description: renderSubagentTypeDescription({
              builtinTypeNames: Object.keys(BUILTIN_AGENTS),
              registeredNames: agentRegistry.listAll().map((a) => a.agentId),
            }),
          }
        : param
    );
  }

  /** 工具别名 */
  readonly aliases?: string[] = [LEGACY_AGENT_TOOL_NAME, 'Task', 'SubAgent'];

  /** 搜索提示 */
  readonly searchHint?: string = 'create agent task subagent';

  /** 工具配置 */
  private config: AgentConfig;

  /** 子代理引擎 */
  private engine: SubAgentEngine;

  /**
   * 活跃的Agent运行台账（O2-1 单一所有者）：登记/置态/注销/查询只经 `AgentRunLedger`，
   * 其全部方法为同步临界区（无 `await`）⇒ 消除"全表扫描清理删掉在途条目"的交错竞态。
   *
   * O15（N6）：改为**进程内共享单例** —— `AgentTool` 有多个构造点（ToolManager loader /
   * `Coordinator` / `getAllBaseTools()`），实例字段会让"能否再开一个"只按单实例计数，
   * 与 `SubAgentEngine`、`AgentRunStore` 的单例口径分裂。
   */
  private _ledger = getAgentRunLedger();

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
    // O18：让 `subagent_type` 的 schema 描述尽早反映 DB 中的启用角色
    // （异步、失败只记 warn；未完成/失败时描述退化为"内置 + 运行时注册"）
    void refreshAvailableSubagentTypeNames();
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
   * Agent 描述符解析链（O11）：决策逻辑在 `AgentDescriptorResolver`（可独立单测），
   * 此处只注入**真实取数依赖** —— DB 角色 / 运行时注册表 / 内置名单。
   *
   * ① 的取数用**惰性导入**（本模块在求值期不依赖 workspace 子域，避免
   * "tools → workspace → core 桶 → tools" 的循环导入 —— 本项目已有两次 TDZ 前科）；
   * ② 用已静态依赖的 `agentRegistry`；③ 的内置名单与错误提示共用同一来源。
   */
  private async resolveAgentDescriptor(params: {
    subagentType?: string;
    baseSystemPrompt: string;
  }): Promise<AgentDescriptorResult> {
    const { getAgentRoleStore } =
      await import('@modules/workspace/AgentRoleStore');
    return resolveDescriptorChain({
      subagentType: params.subagentType,
      baseSystemPrompt: params.baseSystemPrompt,
      deps: {
        // T7：取数走存储层的**三态**入口 —— 启用判定收敛在存储层，解析链不再自建判定
        getRole: async (key) => {
          const store = getAgentRoleStore();
          await store.init();
          return await store.resolveForDelegation(key);
        },
        getRegistered: (key, raw) =>
          agentRegistry.getAgent(key) ??
          agentRegistry
            .listAll()
            .find((a) => a.name === raw || a.role === raw) ??
          null,
        builtinTypeNames: Object.keys(BUILTIN_AGENTS),
      },
    });
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

    // B-4：并行门控/合成参数校验（此前 validateInput 只校验 description/prompt/长度）
    if (input.goal !== undefined && typeof input.goal !== 'string') {
      return { result: false, message: 'goal must be a string' };
    }
    if (input.verify !== undefined && typeof input.verify !== 'boolean') {
      return { result: false, message: 'verify must be a boolean' };
    }
    if (
      input.synthesize !== undefined &&
      typeof input.synthesize !== 'boolean'
    ) {
      return { result: false, message: 'synthesize must be a boolean' };
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
   * 检查是否超过最大并发数（O10a③：`cancel_requested` 仍占用槽位 —— 引擎尚未收敛）
   */
  private checkConcurrencyLimit(): boolean {
    return this._ledger.liveCount() < this.config.maxConcurrentAgents;
  }

  /**
   * 失败结果构造（O5 seam：消除逐字复制的失败字面量）。
   *
   * 字段与原内联实现逐条一致：`status: FAILURE` / `result: null` / `executionTime: 0` /
   * `output: ''` / `progress: []` / `metadata: {}` / `toolName: this.name`；
   * `errorOutput` 缺省等于 `error`（深度守卫例外，显式传入短文案）。
   */
  private failureResult(
    error: string,
    executionId = '',
    errorOutput: string = error
  ): ToolResult<unknown> {
    return {
      status: ToolExecutionStatus.FAILURE,
      result: null,
      error,
      executionTime: 0,
      output: '',
      errorOutput,
      progress: [],
      metadata: {},
      executionId,
      toolName: this.name,
      timestamp: Date.now(),
    };
  }

  /**
   * 执行前置守卫（O5 seam `executeGuard`）：校验 → 解析 → 两道拒绝（深度 / 并发）。
   *
   * **行为中性**：判定顺序与原地实现逐条一致 ——
   * `validateInput` → 类型/fork 解析 → 深度守卫 → 工具集归一 → 并发守卫；
   * 日志调用点与字段、失败结果形状均不变。
   */
  private executeGuard(
    input: Record<string, unknown>,
    context?: ToolUseContext
  ):
    | {
        ok: true;
        agentInput: AgentInput;
        agentType: AgentType;
        effectiveType: AgentType;
        isFork: boolean;
        isBackground: boolean;
      }
    | { ok: false; error: ToolResult<unknown> } {
    const validation = this.validateInput(input);
    if (!validation.result) {
      return {
        ok: false,
        error: this.failureResult(validation.message || ''),
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
        ok: false,
        error: this.failureResult(
          `Subagent nesting depth exceeded (max ${MAX_SUBAGENT_DEPTH})`,
          '',
          'Subagent nesting depth exceeded'
        ),
      };
    }

    // E2：spawn 暂停开关 —— **阻断新 spawn、在途不受影响**（fail-closed 且说明原因）
    if (isSpawnPaused()) {
      const pauseState = getSpawnPauseState();
      logger.warning('Agent execution rejected: spawn paused', {
        reason: pauseState.reason ?? null,
        changedAt: pauseState.changedAt ?? null,
      });
      return {
        ok: false,
        error: this.failureResult(
          `子代理 spawn 已暂停（原因：${pauseState.reason ?? '未提供'}）。` +
            '在途子代理不受影响；恢复（resume）后可继续委派。'
        ),
      };
    }

    // Phase 3: 解析工具过滤 + **O7 两段校验**（未知工具集 / 禁止扩权 / fail-closed 空清单）
    const toolsetError = this.executeToolsets(agentInput);
    if (toolsetError) {
      logger.warning('Agent execution rejected: invalid toolset request', {
        allowedTools: agentInput.allowedTools ?? null,
        deniedTools: agentInput.deniedTools ?? null,
        error: toolsetError,
      });
      return { ok: false, error: this.failureResult(toolsetError) };
    }

    if (!this.checkConcurrencyLimit()) {
      logger.warning('Agent execution rejected: concurrent limit reached');
      return {
        ok: false,
        error: this.failureResult('Maximum concurrent agents reached'),
      };
    }

    return {
      ok: true,
      agentInput,
      agentType,
      effectiveType,
      isFork,
      isBackground,
    };
  }

  /**
   * 工具集入口（O5 seam `executeToolsets` + **O7 契约**）：归一 + **两段校验**。
   *
   * 契约（O7④）：
   * `子代理可用工具 = 父级可继承工具（父级全量 − DELEGATE_BLOCKED_TOOLS）`
   * `∩ allowedTools（若有） − deniedTools` —— 模型**只能收窄，不能扩权**。
   *
   * 校验在**登记台账之前**执行（`executeGuard` 内），失败即拒绝，不产生任何运行态副作用。
   *
   * @returns 拒绝原因；通过时返回 `null`（并把归一后的清单回写 `agentInput`）
   */
  private executeToolsets(agentInput: AgentInput): string | null {
    // 归一：仅当传入**字符串**时按逗号切分去空白（非字符串不在此处改动）
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

    const allowed = this.toToolNameList(agentInput.allowedTools);
    const denied = this.toToolNameList(agentInput.deniedTools);
    if (allowed === 'invalid' || denied === 'invalid') {
      return 'allowedTools / deniedTools 必须是字符串或字符串数组。';
    }

    const result = validateToolsetRequest({
      allowedTools: allowed,
      deniedTools: denied,
      contract: { parentToolNames: getAllTools().map((t) => t.name) },
    });
    if (!result.ok) {
      return result.error;
    }

    // 校验通过 ⇒ 以归一值回写，保证与 `buildToolDefinitions` 的口径一致
    if (allowed !== undefined) {
      agentInput.allowedTools = allowed;
    }
    if (denied !== undefined) {
      agentInput.deniedTools = denied;
    }
    return null;
  }

  /** 工具名清单归一（`undefined` 表示"未提供"；类型非法返回 `'invalid'`） */
  private toToolNameList(value: unknown): string[] | undefined | 'invalid' {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (Array.isArray(value)) {
      if (!value.every((v) => typeof v === 'string')) {
        return 'invalid';
      }
      return value as string[];
    }
    return 'invalid';
  }

  /**
   * 子代理**可继承**工具池（O7①）：父级全量 − `DELEGATE_BLOCKED_TOOLS`（单一入口）。
   *
   * 修复前只有 `runWithEngine` 内联排除了 `Agent`/`Task`，而 `runDirectCall` 传的是
   * **全量池**（含 `Agent`/`Task`/`sessions_yield`）—— 同一契约两处实现、且其中一处漏排除。
   */
  private getInheritableToolPool(
    options: { allowDelegation?: boolean } = {}
  ): Tool[] {
    // T9：被授权的角色不再剔除**委派入口**（`Agent`/`Task`）；`sessions_yield` 等
    // `ALWAYS_BLOCKED_TOOLS` 与授权无关，**始终**剔除（yield 属会话级语义）
    const blockedNames = options.allowDelegation
      ? ALWAYS_BLOCKED_TOOLS
      : DELEGATE_BLOCKED_TOOLS;
    const blocked = new Set(blockedNames.map((n) => n.toLowerCase()));
    // N-42（2026-09-21 真机实证）：工具名必须满足 provider 的命名约束
    // （OpenAI 兼容 `^[a-zA-Z0-9_-]+$`）—— 否则**整个 tools 数组被上游 400 拒绝**，
    // 子代理连一个工具都用不上（实证 `Invalid 'tools[60].function.name'`，来源是
    // media 模块的 `media:image:*` 等 15 个含冒号的工具名）。
    // 与 O7 同源约束：**定义侧与执行侧共用此池**（`buildToolDefinitions` 与
    // `toolInstances` 均取自本方法）⇒ 此处剔除即两侧同时生效，不会出现
    // "定义侧过滤、执行侧放行"的错配。
    const all = getAllTools();
    const illegal = all.filter((t) => !isValidMcpName(t.name));
    if (illegal.length > 0) {
      logger.warn(
        'AgentTool 工具池剔除名称不合法的工具（避免整个 tools 被上游拒绝）',
        {
          dropped: illegal.length,
          sample: illegal.slice(0, 5).map((t) => t.name),
        }
      );
    }
    return all.filter(
      (t) => !blocked.has(t.name.toLowerCase()) && isValidMcpName(t.name)
    );
  }

  /**
   * T9：**能否再委派**的双判据合取 —— 角色策略（用户配置）× 父侧深度上限。
   *
   * - 角色策略：`canDelegate`（缺省 `false` ⇒ fail-closed）；
   * - 深度：判据与 `executeGuard` 同源（`context.subagentDepth < MAX_SUBAGENT_DEPTH`），
   *   避免出现"工具可见、但一调用就被深度守卫拒绝"的错配。
   *
   * **模型不能自选**：策略位来自 DB 角色（用户设定），模型只能在 `subagent_type` 里
   * 选择"用户已授权的角色"，无法把授权授予自己（即提权）。
   */
  private resolveDelegationGrant(
    canDelegate: boolean | undefined,
    context?: ToolUseContext
  ): boolean {
    if (canDelegate !== true) return false;
    const depth = context?.subagentDepth ?? 0;
    return depth < MAX_SUBAGENT_DEPTH;
  }

  /**
   * 进度发射（O5 seam `executeProgress`）：三处内联 `onProgress?.({…})` 的 payload
   * 形状收敛于此（单一来源），字段与原地实现逐条一致。
   */
  private emitStart(
    onProgress: ToolCallProgress<AgentToolProgress> | undefined,
    agentId: string,
    agentName: string
  ): void {
    onProgress?.({
      toolUseID: agentId,
      data: {
        type: 'agent_tool',
        agentName,
        action: 'start',
        message: `Starting agent: ${agentName}`,
        isRunning: true,
        isComplete: false,
      },
    });
  }

  private emitComplete(
    onProgress: ToolCallProgress<AgentToolProgress> | undefined,
    agentId: string,
    agentName: string,
    message: string
  ): void {
    onProgress?.({
      toolUseID: agentId,
      data: {
        type: 'agent_tool',
        agentName,
        action: 'complete',
        message,
        isRunning: false,
        isComplete: true,
      },
    });
  }

  private emitError(
    onProgress: ToolCallProgress<AgentToolProgress> | undefined,
    agentId: string,
    agentName: string,
    message: string
  ): void {
    onProgress?.({
      toolUseID: agentId,
      data: {
        type: 'agent_tool',
        agentName,
        action: 'error',
        message,
        isRunning: false,
        isComplete: true,
      },
    });
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
   * 按 `allowedTools` / `deniedTools` 过滤工具池（O7：**定义侧与执行侧的单一过滤源**）。
   *
   * 白名单先于黑名单（与原实现一致）；比较**大小写不敏感**。
   */
  private filterToolPool(
    allowedTools: string[] | undefined,
    deniedTools: string[] | undefined,
    toolPool: Tool[]
  ): Tool[] {
    let tools = toolPool;

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

    return tools;
  }

  /**
   * 构建工具定义列表（支持 allowedTools/deniedTools 过滤）
   *
   * **O7 契约（两段校验由 `executeToolsets` 在登记前完成，此处只做过滤）**：
   * `子代理可用工具 = 父级可继承工具（父级全量 − DELEGATE_BLOCKED_TOOLS）`
   * `∩ allowedTools（若有） − deniedTools`；模型**只能收窄，不能扩权**。
   *
   * @param toolPool 工具池（**默认即可继承池**，已排除 `Agent`/`Task`/`sessions_yield`；
   *                 调用方仅在需要更窄的池时才显式传入）
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
    const tools = this.filterToolPool(
      allowedTools,
      deniedTools,
      toolPool ?? this.getInheritableToolPool()
    );

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
    toolContext?: ToolUseContext,
    /** T9：该子代理是否被授权再委派（角色策略 × 深度，见 `resolveDelegationGrant`） */
    allowDelegation = false
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
    // O7：可继承池为**单一入口**（`getInheritableToolPool`），且**定义侧与执行侧同源** ——
    // 修复前 `toolInstances` 用的是**未过滤**的全池，模型凭旧上下文里的工具名仍可执行
    // 未授权工具（"定义侧过滤、执行侧放行"），使两段校验形同虚设。
    const subAgentPool = this.getInheritableToolPool({ allowDelegation });
    const filteredPool = this.filterToolPool(
      input.allowedTools,
      input.deniedTools,
      subAgentPool
    );
    const toolDefinitions = this.buildToolDefinitions(
      input.allowedTools,
      input.deniedTools,
      subAgentPool
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
      toolInstances: new Map(filteredPool.map((t) => [t.name, t])),
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
   * B-4：为 AgentSwarm 构造 executor 适配器 —— 把 swarm 的"裸 LLM 调用"映射到既有子代理执行器。
   *
   * 与 ParallelOrchestrator（B-4 已删除）的 executeSingle 同构：
   * 空工具池 + maxTurns 20 + 外部 signal 透传，
   * 因此 AgentSwarm 无需自建 LLM 通路，token 记账仍走同一子代理引擎链路。
   *     该字段已在 AgentSwarm 契约中预留，待引擎支持后再接。
   */
  /**
   * O9③：摘要**超限时把全文落盘**（`resolveOutputDir()`，规则要求 AI 生成文件走该目录）。
   *
   * 只写文件，不做裁剪 —— 裁剪由 `trimSummaryWithFooter` 负责，二者职责分离。
   * 失败返回 `undefined`：调用方退化为"无指针"的裁剪标记，**不阻断汇总**。
   */
  private async spillSummaryToDisk(params: {
    agentId: string;
    taskKey: string;
    text: string;
  }): Promise<string | undefined> {
    try {
      const [{ writeFile, mkdir }, { join }, { resolveOutputDir }] =
        await Promise.all([
          import('fs/promises'),
          import('path'),
          import('@modules/core/paths'),
        ]);
      const dir = resolveOutputDir();
      await mkdir(dir, { recursive: true });
      // 路径安全：任务键可能含 `::` / 斜杠等，统一净化后再拼文件名
      const safeKey = params.taskKey.replace(/[^A-Za-z0-9_.-]/g, '_');
      const file = join(dir, `agent-summary-${safeKey}.md`);
      await writeFile(file, params.text, 'utf8');
      logger.info('子代理摘要全文已落盘', {
        agentId: params.agentId,
        taskKey: params.taskKey,
        file,
        chars: params.text.length,
      });
      return file;
    } catch (err) {
      // @ignore-catch — 落盘失败仅失去指针，摘要仍以头尾裁剪形式进入父上下文
      logger.warn('子代理摘要全文落盘失败（退化为无指针标记）', {
        agentId: params.agentId,
        taskKey: params.taskKey,
        error: String(err),
      });
      return undefined;
    }
  }

  /**
   * O12-1：swarm **per-task 描述符解析**（`tasks[].subagent_type` ⇒ 角色提示词 + 推荐模型）。
   *
   * 与单代理路径**共用** `resolveAgentDescriptor`（四级回退 + fail-closed）；唯一差异：
   * **未指定 `subagent_type` 的任务不解析** ⇒ 沿用 `AgentSwarm` 的 worker 提示词（行为中性）。
   *
   * 修复前该字段在本路径被完全忽略（`AgentSwarm` 三处硬编码提示词 + 落盘恒 `'general'`）。
   */
  private async resolveSwarmTaskDescriptors(
    tasks: Array<{ id: string; agentType?: string }>
  ): Promise<Map<string, SwarmTaskDescriptor>> {
    const resolved = new Map<string, SwarmTaskDescriptor>();
    for (const task of tasks) {
      if (!task.agentType) continue;
      const descriptor = await this.resolveAgentDescriptor({
        subagentType: task.agentType,
        // 基准提示词 = 该类型的内置/默认提示词（命中 ③ 时即用它；未知类型走 ④ 拒绝）
        baseSystemPrompt: this.getDefaultSystemPrompt(
          this.getAgentType(task.agentType)
        ),
      });
      resolved.set(
        task.id,
        descriptor.ok
          ? {
              systemPrompt: descriptor.systemPrompt,
              model: descriptor.model,
              source: descriptor.source,
            }
          : { error: descriptor.error }
      );
    }
    return resolved;
  }

  /**
   * 构造 swarm executor（O6⑥ 逐任务落盘 / O12 解析链与契约贯通）。
   *
   * O12 补齐三处"契约已声明却从未被消费"的字段：
   * ① `agentType`：per-task 解析结果在此**真正消费** —— 角色提示词前置 + 推荐模型 +
   *    落盘真实类型（`SubAgentRequest` 无该字段 ⇒ 类型解析的落点在**本适配器**，
   *    这是有意的职责划分，不再是"透传后被引擎丢弃"）；
   * ② `tools`：按声明的**类别**清单过滤出只读工具注入（修复前恒空池 ⇒ worker 连检索都不可用）；
   * ③ `taskDescriptors` 解析失败 ⇒ **fail-closed**（不执行 + 落 `failed` 行 + 抛出使汇总可见原因）。
   *
   * 行为中性边界：**未携带 `taskKey` 的调用（verifier/synthesizer）不注入工具、不解析类型**，
   * 与修复前一致（其产物是 JSON 结论/汇总报告，注入工具只增加非确定性与轮次）。
   */
  private buildSwarmExecutor(options: {
    signal: AbortSignal;
    /** 批次级模型覆盖：显式指定优先于角色推荐模型（与单代理路径的优先级一致） */
    model?: string;
    /** 批次 id（= 本工具调用 id）：worker 行以 `batchId::taskKey` 为主键落盘 */
    batchId?: string;
    /** 父级工具上下文（含 sessionId）：worker 在引擎侧具备归属（O14-2） */
    context?: ToolUseContext;
    /** 父级工具集约束（O7 同源：定义侧与执行侧共用同一过滤源） */
    allowedTools?: string[];
    deniedTools?: string[];
    /** per-task 解析结果（缺省 ⇒ 全部沿用 AgentSwarm 的 worker 提示词） */
    taskDescriptors?: Map<string, SwarmTaskDescriptor>;
  }): SwarmExecutor {
    const {
      signal,
      model,
      batchId,
      context,
      allowedTools,
      deniedTools,
      taskDescriptors,
    } = options;
    const inheritablePool = this.getInheritableToolPool();
    /** O12-2：按"类别清单"memo 的工具集（同批次多个 worker 共用一份，避免重复实例化） */
    const toolsetCache = new Map<
      string,
      { definitions: SwarmToolDefinition[]; instances: Map<string, Tool> }
    >();

    const resolveWorkerToolset = (
      categories: string[]
    ): { definitions: SwarmToolDefinition[]; instances: Map<string, Tool> } => {
      const cacheKey = [...categories].sort().join('|');
      const cached = toolsetCache.get(cacheKey);
      if (cached) return cached;
      const allowedCategories = new Set(categories);
      const categoryPool = inheritablePool.filter((tool) =>
        allowedCategories.has(getToolCategory(tool.name))
      );
      const entry = {
        definitions: this.buildToolDefinitions(
          allowedTools,
          deniedTools,
          categoryPool
        ).map((t) => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
        instances: new Map(
          this.filterToolPool(allowedTools, deniedTools, categoryPool).map(
            (t) => [t.name, t]
          )
        ),
      };
      toolsetCache.set(cacheKey, entry);
      return entry;
    };

    return async ({
      systemPrompt,
      userPrompt,
      taskKey,
      agentType,
      tools: declaredCategories,
    }) => {
      // O6⑥：**批次内逐任务落盘** —— 仅 worker 调用携带 taskKey（verifier/synthesizer 不落）
      const isWorkerCall =
        taskKey !== undefined && (declaredCategories?.length ?? 0) > 0;
      const resolved = taskKey ? taskDescriptors?.get(taskKey) : undefined;

      // O12-1 fail-closed：解析失败 ⇒ 该任务**不执行**、落 `failed` 行（不留 running 残留）；
      // 抛出 ⇒ AgentSwarm 记入 feedback（汇总行 `[FAIL] <desc>: 执行失败: <原因>` 可见）
      if (resolved?.error) {
        if (batchId && taskKey) {
          await getAgentRunStore().startRun({
            toolCallId: `${batchId}::${taskKey}`,
            agentId: batchId,
            name: taskKey,
            agentType: agentType ?? 'general',
            status: 'running',
            batchId,
            taskKey,
          });
          await getAgentRunStore().settleRun(
            `${batchId}::${taskKey}`,
            'failed',
            { error: resolved.error }
          );
        }
        logger.warn('swarm 子任务描述符解析失败（fail-closed，不执行）', {
          batchId: batchId ?? null,
          taskKey: taskKey ?? null,
          subagentType: agentType ?? null,
          reason: resolved.error,
        });
        throw new Error(resolved.error);
      }

      if (batchId && taskKey) {
        await getAgentRunStore().startRun({
          toolCallId: `${batchId}::${taskKey}`,
          agentId: batchId,
          name: taskKey,
          // O12-2：落盘**真实类型**（修复前恒 'general'）
          agentType: agentType ?? 'general',
          // O19：来源落盘（解析链命中时才有值；未指定 subagent_type 的 worker 留空）
          descriptorSource: resolved?.source,
          status: 'running',
          batchId,
          taskKey,
        });
      }

      const toolset = isWorkerCall
        ? resolveWorkerToolset(declaredCategories ?? [])
        : {
            definitions: [] as SwarmToolDefinition[],
            instances: new Map<string, Tool>(),
          };

      const result = await this.engine.execute({
        agentId: `swarm-${randomUUID().substring(0, 8)}`,
        // O12-1：角色提示词**前置**于 swarm 的 worker 框架（后者承载黑板/只读契约，不可丢）
        systemPrompt: resolved?.systemPrompt
          ? `${resolved.systemPrompt}\n\n${systemPrompt}`
          : systemPrompt,
        messages: [{ role: 'user' as const, content: userPrompt }],
        // O12-2：只读检索工具集（修复前恒空 ⇒ worker 无任何工具可用）
        tools: toolset.definitions,
        toolInstances: toolset.instances,
        maxTurns: 20,
        // 批次显式模型优先；未指定 ⇒ 用角色推荐模型（与单代理路径同优先级）
        model: model ?? resolved?.model,
        signal,
        // O14-2：透传父级工具上下文 ⇒ 引擎侧登记该 worker 的**归属会话**，
        // 使控制面能对 `swarm-<id>` 做归属校验（否则 owner 恒 undefined ⇒ 越权口子）；
        // `subagentDepth` 递增与单代理路径（`runWithEngine`）同源，避免嵌套深度漏计
        toolContext: context
          ? { ...context, subagentDepth: (context.subagentDepth ?? 0) + 1 }
          : undefined,
      });

      if (batchId && taskKey) {
        // 逐任务写回终态：崩溃只丢"未完成的那几个"，而非整批状态未知
        await getAgentRunStore().settleRun(
          `${batchId}::${taskKey}`,
          result.completed ? 'completed' : 'failed'
        );
      }

      // O4：透出**真实成败与超时**（原实现只回 `result.output` ⇒ 超时/截断被上层记为成功）
      return {
        output: result.output,
        ok: result.completed,
        timedOut: result.timedOut === true,
      };
    };
  }

  /**
   * 直接调用LLM（简单任务，不使用查询循环）
   */
  private async runDirectCall(
    input: AgentInput,
    agentId: string,
    systemPrompt: string,
    /** T9：该子代理是否被授权再委派（角色策略 × 深度） */
    allowDelegation = false
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

    // O7①：与 `runWithEngine` 共用**同一**可继承池（修复前此处传的是全量池，
    // 含 `Agent`/`Task`/`sessions_yield` ⇒ 简单任务路径会把委派入口暴露给子代理）
    const toolDefinitions = this.buildToolDefinitions(
      input.allowedTools,
      input.deniedTools,
      this.getInheritableToolPool({ allowDelegation })
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
    // O5 seam：校验 + 类型解析 + 两道守卫（行为中性迁移，判定顺序不变）
    const guard = this.executeGuard(input, context);
    if (!guard.ok) return guard.error;
    const { agentInput, effectiveType, isFork, isBackground, agentType } =
      guard;

    // O5 seam `executeLifecycle`：登记（prologue）
    const { agentId, startTime } = await this.beginRun({
      agentInput,
      agentType,
      effectiveType,
      isFork,
      isBackground,
      context,
      onProgress,
    });

    // G3 接线：worktree 隔离变量（try/finally 均需访问，声明在 try 之外——JS 块级作用域）
    let worktreeContext: ToolUseContext | undefined;
    let worktreeGit: WorkspaceGit | undefined;

    try {
      // O5 seam `executeDispatch`：并行批次路径（tasks 非空时统一路由到 AgentSwarm）
      if (agentInput.tasks && agentInput.tasks.length > 0) {
        return await this.runSwarmPath({
          tasks: agentInput.tasks,
          agentInput,
          agentId,
          effectiveType,
          startTime,
          context,
          onProgress,
        });
      }

      const builtInAgent = this.getBuiltInAgent(effectiveType);
      let systemPrompt =
        builtInAgent?.systemPrompt ||
        this.getDefaultSystemPrompt(effectiveType);

      // O11：统一 Agent 描述符解析链（DB 角色 → 运行时注册表 → 内置 → **显式拒绝**）。
      // 原实现只查 `AgentRegistry`（实测恒空）⇒ 用户通过 /agent/roles 配置的角色
      // **完全不生效**，且未知名字被静默降级为 'custom' + 默认提示词（与 O7 要防的
      // "拼错名字被静默放过"同类）。详见方案 §4 O11。
      const descriptor = await this.resolveAgentDescriptor({
        subagentType: agentInput.subagent_type,
        baseSystemPrompt: systemPrompt,
      });
      if (!descriptor.ok) {
        // fail-closed（O11-1）：显式拒绝；**同时结算台账**，否则该条目会以
        // 'running' 永久占用并发槽位（与并发上限判定同源）
        await this.settleRun(agentId, 'failed');
        return this.failureResult(descriptor.error, agentId);
      }
      systemPrompt = descriptor.systemPrompt;
      if (descriptor.model && !agentInput.model) {
        agentInput.model = descriptor.model;
      }
      logger.info('AgentTool 描述符解析完成', {
        agentId,
        subagentType: agentInput.subagent_type ?? null,
        source: descriptor.source,
        modelOverride: descriptor.model ?? null,
      });
      // O19：来源落盘（**此刻即写**，早于终态）—— 排障第一问"这条 run 用的是 DB 角色还是内置"
      // 必须能在"解析后、结算前"崩溃的行上作答
      await this.recordDescriptorSource(agentId, descriptor.source);

      // T9：授权位 = 角色策略（用户配置）× 父侧深度上限（双判据合取，模型不可自选）
      const canDelegate = this.resolveDelegationGrant(
        descriptor.canDelegate,
        context
      );

      // O5 seam `executeLifecycle`：teammate 绑定（含 isSimpleTaskNow 判定）
      const { teammateHandleId, mailbox, isSimpleTaskNow } =
        await this.bindTeammate({
          agentInput,
          agentId,
          systemPrompt,
          isFork,
        });

      // O5 seam `executeLifecycle`：隔离与 fork 提示词组装。
      // **陷阱处置**：两者均**就地改写** `systemPrompt`（逐段 `+=`）与 `agentInput.prompt`
      // ⇒ 前者必须以**返回值回写**，后者靠传入同一对象引用自然生效（与原实现等价）。
      const isolationApplied = await this.applyIsolationAndFork({
        agentInput,
        agentId,
        systemPrompt,
        context,
        isFork,
        isBackground,
      });
      systemPrompt = isolationApplied.systemPrompt;
      worktreeGit = isolationApplied.worktreeGit;
      worktreeContext = isolationApplied.worktreeContext;

      // O5 seam `executeDispatch`：后台路径（run_in_background）
      if (isBackground) {
        return await this.runBackgroundPath({
          agentInput,
          agentId,
          effectiveType,
          isFork,
          systemPrompt,
          teammateHandleId,
          mailbox,
          context,
          canDelegate,
          onProgress,
        });
      }

      // O5 seam `executeDispatch`：前台路径（directCall / engine 自适应）
      return await this.runForegroundPath({
        agentInput,
        agentId,
        effectiveType,
        isFork,
        startTime,
        systemPrompt,
        teammateHandleId,
        mailbox,
        worktreeContext,
        context,
        isSimpleTaskNow,
        canDelegate,
        onProgress,
      });
    } catch (error) {
      await this.settleRun(agentId, 'failed');
      // 设计二：失败路径同样清理 teammate（防泄漏）
      await this.unregisterTeammate(agentId);

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      handleError(error, {
        module: 'tools:agentTool',
        action: 'execute',
      });

      this.emitError(
        onProgress,
        agentId,
        agentInput.name || agentId,
        errorMessage
      );

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
      // O2：不再做全表扫描清理 —— 条目由 `_ledger.settle()` 在各自收尾点**就地**注销
      // （原来的 `cleanupCompletedAgents()` 会删掉其他在途路径的条目，见 AgentRunLedger 注释）
    }
  }

  /**
   * 执行生命周期：登记（O5 seam `executeLifecycle` / prologue）。
   *
   * 行为中性：id 生成条件、台账登记字段、启动日志字段与进度发射顺序逐一保留。
   */
  private async beginRun(params: {
    agentInput: AgentInput;
    agentType: AgentType;
    effectiveType: AgentType;
    isFork: boolean;
    isBackground: boolean;
    context?: ToolUseContext;
    onProgress?: ToolCallProgress<AgentToolProgress>;
  }): Promise<{ agentId: string; startTime: number }> {
    const {
      agentInput,
      agentType,
      effectiveType,
      isFork,
      isBackground,
      context,
      onProgress,
    } = params;

    const agentId = this.createAgentId(
      isFork ? 'custom' : agentType,
      agentInput.name
    );
    const startTime = Date.now();

    this._ledger.register({
      id: agentId,
      name: agentInput.name || agentId,
      type: effectiveType,
      startTime,
      sessionId: context?.sessionId,
    });

    logger.info('Agent execution started', {
      agentId,
      agentType: effectiveType,
      isBackground,
      isFork,
      promptLength: agentInput.prompt?.length || 0,
    });

    this.emitStart(onProgress, agentId, agentInput.name || agentId);

    // O6（B4）：起跑即落盘（durable completion ≠ durable execution —— 只保证终态/归因可查）
    await getAgentRunStore().startRun({
      toolCallId: agentId,
      agentId,
      sessionId: context?.sessionId,
      name: agentInput.name || agentId,
      // N-43 修复（2026-09-21）：落**真实类型名**（`subagent_type` 原值）。
      // 原落 `effectiveType` 经 `getAgentType()` 归一 —— 该函数只认 6 个内置类型，
      // 其余一律 `default: return 'custom'` ⇒ DB 角色（architect / security …）被记成
      // 无意义的 `custom`，前端「运行态」面板（`CouncilAgentRolesPage` 直接渲染
      // `run.agentType`）无法区分角色。此口径与 swarm 分支一致
      // （`buildSwarmExecutor` 的 `agentType ?? 'general'`，即 O12-2「落盘真实类型」）。
      // 未显式指定 `subagent_type`（fork / 走默认）时才回退归一值。
      agentType: agentInput.subagent_type || effectiveType,
      status: 'running',
      startedAt: startTime,
    });

    return { agentId, startTime };
  }

  /**
   * O19：落盘**描述符来源**（可观测性）。
   *
   * 与 `settleRun` 同约定：落盘失败只记日志，不影响执行（台账是观测面，不是正确性前置）。
   */
  private async recordDescriptorSource(
    agentId: string,
    source: string
  ): Promise<void> {
    try {
      await getAgentRunStore().setDescriptorSource(agentId, source);
    } catch (err) {
      logger.warn('子代理描述符来源落盘失败（不影响执行）', {
        agentId,
        source,
        error: String(err),
      });
    }
  }

  /**
   * 落终态（O6/B4）：**先**内存台账（同步临界区）**再**持久化（失败不影响已落定的内存终态）。
   *
   * 持久化失败只记日志 —— 台账落盘是"可观测性"而非"正确性前置"，
   * 不得因磁盘问题让一次已完成的委派对外表现为失败。
   *
   * O13：**内存拒绝的写，磁盘不得写** —— 原实现丢弃 `settle()` 的返回值并**无条件**落盘，
   * 使内存侧的终态幂等保护（"已完成、收尾组装抛错"不被反向写失败）在磁盘上原样敞着
   * ⇒ 同一事实两个答案（内存 `completed` / 磁盘 `failed`）。
   */
  private async settleRun(
    agentId: string,
    status: 'completed' | 'failed'
  ): Promise<void> {
    const settled = this._ledger.settle(agentId, status);
    if (!settled) {
      // 幂等/不存在：内存已落终态或条目非本路径所有 ⇒ 磁盘沿用它，不覆盖
      logger.debug('终态落盘跳过：内存台账未接受该迁移', {
        agentId,
        status,
      });
      return;
    }
    try {
      await getAgentRunStore().settleRun(agentId, status);
    } catch (err) {
      logger.warn('子代理运行台账落盘失败（不影响内存终态）', {
        agentId,
        status,
        error: String(err),
      });
    }
  }

  /**
   * 执行生命周期：teammate 绑定（O5 seam `executeLifecycle` / bind）。
   *
   * 行为中性：注册时机（systemPrompt 确定后、后台回调清理）与
   * `isSimpleTaskNow` 判定（`prompt.length < 500 && !isFork && !subagent_type`）逐字保留；
   * 信箱订阅与日志字段不变。返回 `isSimpleTaskNow` 供前台路径复用（原实现同源复用）。
   */
  private async bindTeammate(params: {
    agentInput: AgentInput;
    agentId: string;
    systemPrompt: string;
    isFork: boolean;
  }): Promise<{
    teammateHandleId: string | null;
    mailbox: Array<{ role: 'user'; content: string }>;
    isSimpleTaskNow: boolean;
  }> {
    const { agentInput, agentId, systemPrompt, isFork } = params;

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

    return { teammateHandleId, mailbox, isSimpleTaskNow };
  }

  /**
   * 执行生命周期：隔离与 fork 提示词组装（O5 seam `executeLifecycle` / isolation+prompt）。
   *
   * 行为中性：worktree 三条分支（后台降级 / 前台创建 / 创建失败降级）的日志与提示词
   * **逐字保留**；fork 上下文组装与 `agentInput.prompt` 就地改写保留（同一对象引用）。
   */
  private async applyIsolationAndFork(params: {
    agentInput: AgentInput;
    agentId: string;
    systemPrompt: string;
    context?: ToolUseContext;
    isFork: boolean;
    isBackground: boolean;
  }): Promise<{
    systemPrompt: string;
    worktreeGit?: WorkspaceGit;
    worktreeContext?: ToolUseContext;
  }> {
    const { agentInput, agentId, context, isFork, isBackground } = params;
    let systemPrompt = params.systemPrompt;
    let worktreeGit: WorkspaceGit | undefined;
    let worktreeContext: ToolUseContext | undefined;

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
          logger.warn('Worktree isolation: 程序化创建失败，降级为提示词引导', {
            agentId,
            error: error instanceof Error ? error.message : String(error),
          });
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

    return { systemPrompt, worktreeGit, worktreeContext };
  }

  /**
   * 并行批次路径（O5 seam `executeDispatch`）。
   *
   * 行为中性迁移：判定、日志、事件（PARALLEL_START/END）、汇总格式、结算与返回结构
   * 与原内联实现逐一保留；`tasks` 由调用方保证非空（等价于原 `if (tasks?.length > 0)`）。
   */
  private async runSwarmPath(params: {
    tasks: SubTask[];
    agentInput: AgentInput;
    agentId: string;
    effectiveType: AgentType;
    startTime: number;
    context?: ToolUseContext;
    onProgress?: ToolCallProgress<AgentToolProgress>;
  }): Promise<ToolResult<unknown>> {
    const {
      tasks,
      agentInput,
      agentId,
      effectiveType,
      startTime,
      context,
      onProgress,
    } = params;

    logger.info('Parallel execution started', {
      agentId,
      taskCount: tasks.length,
      verify: agentInput.verify === true,
      synthesize: agentInput.synthesize === true,
    });

    // PARALLEL_START（原由 ParallelOrchestrator 发布，B-4 已迁移至此以保持前端 SSE 时间线不断供）
    globalEventBus.publish(OrchestrationEventType.PARALLEL_START, {
      totalTasks: tasks.length,
      tasks: tasks.map((t) => ({
        description: t.description,
        agentType: t.subagent_type,
        name: t.name,
      })),
    });

    const swarmAbort = new AbortController();
    // SubTask.id 可选 → 统一补稳定兜底 id，供结果回填与汇总按 id 对齐
    const swarmTasks = tasks.map((t, idx) => ({
      id: t.id ?? `task-${idx}`,
      description: t.description,
      agentType: t.subagent_type,
    }));
    // O12-1：**per-task 描述符解析**（与单代理路径同源）—— 未知/禁用 ⇒ 该任务 fail-closed；
    // 未指定 `subagent_type` 的任务不解析（沿用 AgentSwarm 的 worker 提示词，行为中性）
    const taskDescriptors = await this.resolveSwarmTaskDescriptors(swarmTasks);
    const swarmResult = await new AgentSwarm().run({
      tasks: swarmTasks,
      goal: agentInput.goal || agentInput.description,
      executor: this.buildSwarmExecutor({
        signal: swarmAbort.signal,
        model: agentInput.model,
        // O6⑥：批次 id = 本工具调用 id ⇒ worker 行以 `batchId::taskKey` 为主键落盘
        batchId: agentId,
        // O14-2：父级上下文（含 sessionId）⇒ worker 在引擎侧具备归属
        context,
        // O12-2：父级工具集约束（O7 同源）⇒ worker 工具集与单代理路径一致地受父级白/黑名单管辖
        allowedTools: agentInput.allowedTools,
        deniedTools: agentInput.deniedTools,
        taskDescriptors,
      }),
      // 不传 isolation：本路径 executor 为只读子代理调用（适配器不透传隔离资源），
      // 而 createAgentIsolation() 会同步落盘 `~/.pyapp/workspaces/<id>` 空目录且默认不清理。
      enableVerify: agentInput.verify === true,
      enableSynthesize: agentInput.synthesize === true,
      signal: swarmAbort.signal,
    });

    const succeeded = swarmResult.workers.filter((w) => w.success).length;
    globalEventBus.publish(OrchestrationEventType.PARALLEL_END, {
      totalTasks: tasks.length,
      completedTasks: succeeded,
      failedTasks: tasks.length - succeeded,
    });

    await this.settleRun(agentId, 'completed');

    // O9：摘要预算 —— **真实取数**（G14 口径）
    // ① 父**当前**上下文：`getCurrentInputTokens()` 读本轮基线（**非累计**）；
    // ② 模型窗口：`resolveContextWindowAsync()` 以 DB `model_registry.context_window` 为事实来源。
    // 任一项取不到 ⇒ `computeSummaryCharBudget` 退化为下限（不臆测）。
    let summaryBudget = SUMMARY_MIN_CHARS;
    try {
      const tracker = getUnifiedTokenTracker();
      const parentPromptTokens = tracker?.getCurrentInputTokens(
        context?.sessionId
      );
      const routeModel = await resolveModelRoute(RouteKey.CHAT);
      const contextWindow = routeModel
        ? (await resolveContextWindowAsync(routeModel)).tokens
        : undefined;
      summaryBudget = computeSummaryCharBudget({
        parentPromptTokens,
        contextWindow,
        workerCount: tasks.length,
      });
      logger.debug('swarm 摘要预算已解析', {
        agentId,
        parentPromptTokens: parentPromptTokens ?? null,
        contextWindow: contextWindow ?? null,
        workerCount: tasks.length,
        summaryBudget,
      });
    } catch (err) {
      // @ignore-catch — 预算取数失败 ⇒ 退化下限，不阻断汇总
      logger.warn('swarm 摘要预算取数失败（退化下限）', {
        agentId,
        error: String(err),
      });
    }

    // 未开合成/门禁时，汇总格式与既有实现逐字一致：`[OK|FAIL] <name>: <output|error>`
    // O9③：**超限即全文落盘**，并把文件路径作为指针写进裁剪标记（头尾各留结论/改动清单）
    const summaryTextByWorkerId = new Map<string, string>();
    for (const w of swarmResult.workers) {
      const rawText = w.output || w.feedback || '';
      const probe = trimSummaryWithFooter(rawText, summaryBudget);
      if (!probe.truncated) {
        summaryTextByWorkerId.set(w.id, probe.text);
        continue;
      }
      const spillPath = await this.spillSummaryToDisk({
        agentId,
        taskKey: w.id,
        text: rawText,
      });
      summaryTextByWorkerId.set(
        w.id,
        trimSummaryWithFooter(
          rawText,
          summaryBudget,
          spillPath ? { spillPath } : {}
        ).text
      );
    }

    const workerById = new Map(swarmResult.workers.map((w) => [w.id, w]));
    const legacyAggregated = swarmTasks
      .map((t, idx) => {
        const w = workerById.get(t.id) ?? swarmResult.workers[idx];
        const name = t.description;
        if (!w) return `[FAIL] ${name}: 未返回结果`;
        return w.success
          ? `[OK] ${name}: ${summaryTextByWorkerId.get(w.id) ?? ''}`
          : `[FAIL] ${name}: ${w.feedback ?? '执行失败'}`;
      })
      .join('\n---\n');

    const gated = agentInput.verify === true || agentInput.synthesize === true;
    const aggregatedOutput = gated
      ? [
          swarmResult.synthesized
            ? `## 合成结果\n${swarmResult.synthesized}`
            : '',
          `## Worker 结果（verified ${swarmResult.workers.filter((w) => w.verify !== 'failed').length}/${swarmResult.workers.length}，allPassed: ${swarmResult.allPassed}）`,
          ...swarmResult.workers.map(
            (w) =>
              `[${w.success ? 'OK' : 'FAIL'}${w.verify === 'failed' ? ' 未过门禁' : ''}] ${w.id}: ${summaryTextByWorkerId.get(w.id) ?? ''}`
          ),
        ]
          .filter(Boolean)
          .join('\n\n')
      : legacyAggregated;

    this.emitComplete(
      onProgress,
      agentId,
      agentInput.name || agentId,
      `Parallel execution completed: ${succeeded}/${swarmResult.workers.length} tasks succeeded${gated ? `（allPassed: ${swarmResult.allPassed}）` : ''}`
    );

    // 阶段 A（A1-e）：并行批次已全部结算（AgentSwarm 内 Promise.allSettled 收口）
    // → 通知结算桥：等待中的父会话据此判定是否恢复。
    this.notifyYieldSettlement(context);

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
        parallelTaskCount: swarmResult.workers.length,
        parallelSuccessCount: succeeded,
      },
      executionId: agentId,
      toolName: this.name,
      timestamp: Date.now(),
    };
  }

  /**
   * 后台路径（O5 seam `executeDispatch`）：`run_in_background` —— 工具立即返回，
   * run 在引擎中继续，结算发生在 bgTask 回调里。
   *
   * 行为中性迁移：禁用分支的 teammate 清理、bgTask 登记、按真实结果的置态、
   * teammate 清理、结算通知（B1/O1-3）与返回结构逐一保留。
   */
  private async runBackgroundPath(params: {
    agentInput: AgentInput;
    agentId: string;
    effectiveType: AgentType;
    isFork: boolean;
    systemPrompt: string;
    teammateHandleId: string | null;
    mailbox: Array<{ role: 'user'; content: string }>;
    context?: ToolUseContext;
    /** T9：该子代理是否被授权再委派（角色策略 × 深度已在 execute 内合取） */
    canDelegate: boolean;
    onProgress?: ToolCallProgress<AgentToolProgress>;
  }): Promise<ToolResult<unknown>> {
    const {
      agentInput,
      agentId,
      effectiveType,
      isFork,
      systemPrompt,
      teammateHandleId,
      mailbox,
      context,
      canDelegate,
      onProgress,
    } = params;

    if (!this.config.allowBackground) {
      logger.warning('Background execution disabled', { agentId });
      // 泄漏修复（2026-08-27）：该分支 return 前清理已注册的 teammate
      await this.unregisterTeammate(agentId);
      // 台账泄漏修复（B3）：早期返回必须落终态，否则条目以 'running' 永久占用并发槽位
      await this.settleRun(agentId, 'failed');
      return this.failureResult('Background execution is disabled', agentId);
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
      context,
      // T9：授权位（后台路径同前台口径）
      canDelegate
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
        await this.settleRun(agentId, taskCompleted ? 'completed' : 'failed');
        // 设计二：后台任务完成时才清理 teammate（保留整个后台窗口期的可寻址性）
        await this.unregisterTeammate(agentId);
        // B1/O1-3：后台 run 的结算只能在此处通知（工具早已返回）——
        // 漏掉即"后台委派 + sessions_yield"永不恢复
        await this.notifyYieldSettlement(context);
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
        await this.settleRun(agentId, 'failed');
        // 设计二：失败也清理 teammate
        await this.unregisterTeammate(agentId);
        // B1/O1-3：失败同样是一次结算——不通知则等待中的父会话永久挂起
        await this.notifyYieldSettlement(context);
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

  /**
   * 前台路径（O5 seam `executeDispatch`）：简单任务走 `runDirectCall`，
   * 其余走 `runWithEngine`；随后统一清理 teammate、回灌 token、落终态、发进度、返回。
   *
   * 行为中性迁移：判定（`isSimpleTaskNow`）、日志、teammate 清理、
   * token 监听（`subAgentTokenListeners`）、置态与返回结构逐一保留。
   */
  private async runForegroundPath(params: {
    agentInput: AgentInput;
    agentId: string;
    effectiveType: AgentType;
    isFork: boolean;
    startTime: number;
    systemPrompt: string;
    teammateHandleId: string | null;
    mailbox: Array<{ role: 'user'; content: string }>;
    worktreeContext?: ToolUseContext;
    context?: ToolUseContext;
    isSimpleTaskNow: boolean;
    /** T9：该子代理是否被授权再委派（角色策略 × 深度已在 execute 内合取） */
    canDelegate: boolean;
    onProgress?: ToolCallProgress<AgentToolProgress>;
  }): Promise<ToolResult<unknown>> {
    const {
      agentInput,
      agentId,
      effectiveType,
      isFork,
      startTime,
      systemPrompt,
      teammateHandleId,
      mailbox,
      worktreeContext,
      context,
      isSimpleTaskNow,
      canDelegate,
      onProgress,
    } = params;

    let result: {
      result: string;
      completed: boolean;
      error?: string;
      tokenUsage?: any;
    };

    if (isSimpleTaskNow) {
      result = await this.runDirectCall(
        agentInput,
        agentId,
        systemPrompt,
        canDelegate
      );
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
        worktreeContext ?? context,
        // T9：授权位（角色策略 × 深度已在 execute 内合取）
        canDelegate
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
    await this.settleRun(agentId, result.completed ? 'completed' : 'failed');

    if (result.completed) {
      this.emitComplete(
        onProgress,
        agentId,
        agentInput.name || agentId,
        'Agent task completed successfully'
      );
    } else {
      this.emitError(
        onProgress,
        agentId,
        agentInput.name || agentId,
        result.error || 'Agent execution stopped'
      );
    }

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
  }

  /**
   * 获取子代理引擎
   */
  getEngine(): SubAgentEngine {
    return this.engine;
  }

  /**
   * 通知"该会话的一批子代理 run 已结算"（B1/O1-3：结算通知的唯一发送点）。
   *
   * 覆盖**所有会把 run 带出工具调用生命周期的路径**：
   * - 并行批次（`Promise.allSettled` 全部收口后）；
   * - 后台任务（`run_in_background`，工具已返回但 run 仍在跑，结算发生在回调中）。
   *
   * 遗漏任一路径 ⇒ 该路径上的 yield 等待永不收敛（结算通知是该等待唯一的恢复触发源）。
   * 无会话上下文（无父会话可恢复）时静默跳过。
   */
  private async notifyYieldSettlement(context?: ToolUseContext): Promise<void> {
    const sessionId = context?.sessionId;
    if (!sessionId) return;
    const endedAt = Date.now();

    // O8（B5）：**先落台账再投递** —— 进程若在"已结算 → 已恢复"之间崩溃，
    // 结算信号不会丢（回放路径可据 `pending/attempting` 行续投）。
    // claim 后进入 `attempting`：语义为"已发出、对端可能已收到"⇒ 重放须带 `restored` 标记。
    let deliveryId: number | null = null;
    let outbox: ReturnType<typeof getSettlementOutbox> | null = null;
    try {
      outbox = getSettlementOutbox();
      deliveryId = await outbox.enqueue({ sessionId, endedAt });
      await outbox.claim(deliveryId);
    } catch (err) {
      // @ignore-catch — 台账不可用不得阻断投递本身（可观测性 < 功能可用性）
      logger.warn('结算信号落台账失败（继续投递）', {
        sessionId,
        error: String(err),
      });
    }

    // O8③：以**监听器的 ack** 作为投递凭证（`handleYieldSettlement` 的 true = 会话确实被恢复）
    const delivered = await notifyYieldSettled({ sessionId, endedAt });

    if (outbox && deliveryId !== null) {
      try {
        if (delivered) {
          await outbox.markDelivered(deliveryId);
        } else {
          // 未获 ack（无等待登记 / 判定不可恢复）⇒ `failed`：留待回放，直至超上限转 `dropped`
          await outbox.markFailed(deliveryId, '未获监听器 ack');
        }
      } catch (err) {
        // @ignore-catch — 台账回写失败不影响投递结果本身
        logger.warn('结算台账回写失败', { sessionId, error: String(err) });
      }
    }
  }

  /**
   * 获取活跃Agent列表
   *
   * O3/O10a②：返回**新建投影对象**（而非内部条目引用），且**不外泄** `sessionId`
   * 等控制面专有字段 —— 调用方改写返回值不得影响台账。
   */
  getActiveAgents(): Array<{
    id: string;
    name: string;
    type: AgentType;
    startTime: number;
    status: AgentRunStatus;
  }> {
    return this._ledger.listActive();
  }

  /**
   * 获取Agent状态（O2-4：内存活跃表未命中 ⇒ 归因表；**O19：仍未命中 ⇒ 磁盘台账**）。
   *
   * 修复前只有内存一条路（归因表 CAP=200）⇒ 超出该窗口的 run 一律 `not_found`，
   * 而磁盘保留终态 50 条 / 7 天 ⇒ "内存答不出、磁盘答得出"（N14 的两个区间）。
   * 返回 `source` 便于调用方区分答案来自哪一层。
   *
   * 注：磁盘不可用时的错误**直接抛出**，不伪装成 `not_found`（避免把环境故障说成"查无此 run"）。
   *
   * @param agentId Agent ID
   */
  async getAgentStatus(agentId: string): Promise<{
    status: AgentRunStatus | 'unknown' | 'not_found';
    duration?: number;
    /** 状态来源：`memory`（内存台账）/ `store`（磁盘台账） */
    source?: 'memory' | 'store';
  }> {
    const agent = this._ledger.view(agentId);
    if (agent) {
      return {
        status: agent.status,
        duration: Date.now() - agent.startTime,
        source: 'memory',
      };
    }

    const persisted = await getAgentRunStore().getRun(agentId);
    if (!persisted) {
      return { status: 'not_found' };
    }
    // `AgentRunRow.startedAt` 由 `AgentRunRecord` 继承 ⇒ 类型上可选（`toRow` 恒有值）
    const startedAt = persisted.startedAt ?? Date.now();
    const endedAt = persisted.endedAt;
    return {
      status: persisted.status,
      duration: endedAt
        ? Math.max(0, endedAt - startedAt)
        : Date.now() - startedAt,
      source: 'store',
    };
  }

  /**
   * 停止Agent（O10a③：落 `cancel_requested` **中间态**，不再直接写 `failed`）。
   *
   * 语义：`engine.abort()` 只是**受理**取消；引擎在下一个安全边界收敛前，
   * 该 run 仍占并发额度、条目留在活跃表，状态由执行路径以真实终态落定
   * （`completed` 或 `failed`）—— 原实现直接置 `failed`，把"已受理、终态未定"
   * 显示成"确定没跑成"。
   */
  stopAgent(
    agentId: string,
    opts?: { requesterSessionId?: string; privileged?: boolean }
  ): boolean {
    // Tier2 归属校验（O10a① / O14）：**fail-closed**
    //  · `privileged` 是**显式**的进程内特权标志（Coordinator / CLI 等无会话上下文的调用方），
    //    替代原实现"不传 requester 即特权"的隐式默认（无法区分"忘了传"与"确有权限"）；
    //  · 带 requester 时必须**能证明**归属：台账（本工具注册的 run）或引擎（并行批次的
    //    `swarm-<id>` worker）任一给出 owner 且与请求方一致才放行；
    //  · **owner 缺失即拒绝** —— 原实现 `if (owner && owner !== requester)` 在 owner 缺失时
    //    放行，配合"worker 不在台账"⇒ 任意会话拿到 id 即可中止它。
    const requester = opts?.requesterSessionId;
    if (opts?.privileged !== true) {
      const owner =
        this._ledger.ownerSessionId(agentId) ??
        this.engine.ownerSessionId(agentId);
      if (!requester || !owner) {
        logger.warn('stopAgent 被拒：请求方会话与该代理归属不一致', {
          agentId,
          requester: requester ?? null,
          owner: owner ?? null,
        });
        return false;
      }
      if (owner !== requester) {
        // O10b（v7.1）**Tier1 血缘链**：请求方可能是归属会话的**祖先**
        // （会话 fork 建立 `metadata.parentSessionId` ⇒ 父会话对"后代会话里的子代理"
        // 具有与归属会话同等的控制权）。判定为运行期同步链，`max_hops = 8`，fail-closed：
        // 链上查不到（含重启后未重建血缘）即拒绝 —— Tier2 归属判定不受影响。
        if (!isAncestorSession(requester, owner)) {
          logger.warn('stopAgent 被拒：请求方既非归属会话，也不在其血缘链上', {
            agentId,
            requester,
            owner,
          });
          return false;
        }
        logger.info('stopAgent 放行：请求方为归属会话的祖先（Tier1 血缘链）', {
          agentId,
          requester,
          owner,
        });
      }
    }

    const accepted = this._ledger.requestCancel(agentId);
    const engineStopped = this.engine.abort(agentId);
    return accepted || engineStopped;
  }
}

/**
 * 创建AgentTool实例
 */
export function createAgentTool(config?: Partial<AgentConfig>): AgentTool {
  return new AgentTool(config);
}

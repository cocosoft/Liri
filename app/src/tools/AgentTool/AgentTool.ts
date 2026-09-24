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
import {
  getAgentRunLedger,
  type AgentRunReservation,
  type AgentRunStatus,
} from './AgentRunLedger';
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
// 接线期③ ③-A（2026-09-24）：未完成 run 的失败归因类型（随台账落盘）
import type { AgentRunAttribution } from './runAttribution';
import { isSpawnPaused, getSpawnPauseState } from './spawnPause';
import { getSettlementOutbox } from '@modules/chat';
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
import {
  AgentSwarm,
  DEFAULT_SWARM_CONCURRENCY,
  type SwarmExecutor,
  type AgentSwarmResult,
} from '@modules/tasks';
// M-6/M-7 接线（2026-09-22）：批次收口 ⇒ 落定该会话未终结目标的状态
import { settleGoalForRun } from '@modules/tasks';
import { takeBatchGoalInstruction } from '@modules/tasks';
// B3-2（2026-09-23）：注入片段统一类型 —— 通道前缀由类型给出（唯一渲染入口 renderFragment）
import { renderFragment, type ContextualFragment } from '@modules/context';
import { enqueueIdleContinuation } from '@modules/tasks';
// R1 修正（2026-09-22）：批次取消注册表改为**进程内单例**（与 `getAgentRunLedger()` 同法）
import {
  registerBatchAbort,
  getBatchAbort,
  unregisterBatchAbort,
} from './swarmBatchRegistry';
import { globalEventBus } from '../../core/events/EventBus.js';
// 阶段 A（A1-e）：并行批次结算 → yield 等待收敛桥
import { notifyYieldSettled } from '@modules/chat';
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
    // F4（2026-09-21）：本字段**恒被 `params` getter 覆盖**（O18 按当前快照渲染
    // "内置 + DB 启用角色 + 运行时注册"）。修复前这里硬编码 6 个内置名，与真实可用值
    // 脱节（新增角色/注册项不会出现在此处）；若后来者直接消费该常量即拿到过期名单。
    // 已核实：`AGENT_PARAMS` 为本模块私有 const，**无外部消费方**（仅 getter 与定义处）。
    // ⇒ 改为中性占位，禁止在此再枚举具体名单（名单唯一来源 = `renderSubagentTypeDescription`）。
    description: 'The type of specialized agent to use',
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
              // F1（2026-09-21）：**列全解析链真正认的名字**。
              // 修复前只传 `agentId`，而 `resolveAgentDescriptor` 的 ② 分支
              // （`:505-510`）是 `getAgent(key) ?? find(a => a.name === raw || a.role === raw)`
              // ⇒ `name` / `role` 同样可解析成功，却不在描述里 ⇒ 模型"看得见的可用值"
              // 少于"实际能用的值"（N9/R4 可见面与实现面不同步的残留）。
              registeredNames: agentRegistry
                .listAll()
                .flatMap((a) => [a.agentId, a.name, a.role]),
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
        /** R2（2026-09-21）：本批次准入时**预留**的并发槽位数（单代理恒为 1） */
        plannedWeight: number;
        /** 0b（2026-09-22）：准入时创建并**已登记**的 run id（`beginRun` 不再自建 id） */
        agentId: string;
        /** 0b：与预留条目**同源**的起跑时间（保证 `getAgentStatus` 时长口径一致） */
        startTime: number;
        /** 0b：额度预留句柄（RAII）—— 由 `execute` 的 `finally` 释放 */
        reservation: AgentRunReservation;
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

    // R2（2026-09-21）：**准入即预留**。
    // 修复前本判定按 1 个槽位放行，随后才在 `runSwarmPath` 用 `setWeight(tasks.length)`
    // 事后校准 ⇒ 是"事中校准"而非"准入预留"：上限仍可被突破最多 Σ(tasks)−1
    //（多个并发批次各自以 1 通过准入后一起加权）。
    //
    // R2 修正（2026-09-22）：预留量取**批次真实并发占用** = `min(任务数, swarm 并发上限)`，
    // 而非任务总数 —— `tasks` 在 `validateInput` 里**没有数量上限校验**，若按总数预留，
    // `tasks.length > maxConcurrentAgents` 的合法批次会被准入**整体拒绝**（修复前它能跑）；
    // 而 swarm 同时最多只投递 `DEFAULT_SWARM_CONCURRENCY` 个 worker ⇒ 这才是忠实的占位量。
    // 缺陷 4 修复（2026-09-22，D-C 路线①）：再与**全局并发上限**取 `min`。
    // 修复前预留量无视 `maxConcurrentAgents`：配置上限 2 时 `plannedWeight = 3`（任务数 3）
    // ⇒ `0 + 3 <= 2` 为假，**合法批次被整批拒绝**；若只补 min 而不透传，失真会从准入层
    // 挪到执行层（准入占 2、实际在飞 3 ⇒ 真实并发突破上限）。故本值同时作为
    // `runSwarmPath` 的 `maxConcurrency` 传给 `AgentSwarm`（单一派生源，禁止下游自算）。
    const plannedWeight = Math.max(
      1,
      Math.min(
        agentInput.tasks?.length ?? 1,
        DEFAULT_SWARM_CONCURRENCY,
        this.config.maxConcurrentAgents
      )
    );
    // 0b（2026-09-22，M-9）：**准入即预留** —— 判定与占位在**同一次同步调用**内完成
    // （`tryReserve`），并把"释放义务"交给返回的 guard（`execute` 的 finally 释放）。
    // 修复前此处只做纯判定（`checkConcurrencyLimit(): boolean`），与 `beginRun` 的
    // `register()` 分离 ⇒ 两者之间任一提前 return / 抛错都会**泄漏并发槽位**。
    const agentId = this.createAgentId(
      isFork ? 'custom' : agentType,
      agentInput.name
    );
    const startTime = Date.now();
    const reservation = this._ledger.tryReserve({
      id: agentId,
      name: agentInput.name || agentId,
      type: effectiveType,
      startTime,
      sessionId: context?.sessionId,
      weight: plannedWeight,
      // 上限由工具配置提供（台账不自持配置）；判定与登记同源 ⇒ 口径不会漂移
      limit: this.config.maxConcurrentAgents,
    });
    if (!reservation) {
      logger.warning('Agent execution rejected: concurrent limit reached', {
        plannedWeight,
        liveCount: this._ledger.liveCount(),
        maxConcurrentAgents: this.config.maxConcurrentAgents,
      });
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
      plannedWeight,
      agentId,
      startTime,
      reservation,
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
      // F3（2026-09-21）：父级工具池改为**与实际继承同源**（`getInheritableToolPool()`）。
      // 修复前传 `getAllTools()` 全量：它包含 N-42 判定为非法名的工具
      //（如 `media:image:*`，provider 命名约束 `^[a-zA-Z0-9_-]+$` 之外的冒号形式），
      // 而 worker 实际拿到的池经 `getInheritableToolPool()` 过滤 ⇒ 校验说"父级有、可授予"，
      // 执行侧池里却没有（"校验通过但工具缺失"）。同源后第①段即拒绝这类名字。
      contract: {
        parentToolNames: this.getInheritableToolPool().map((t) => t.name),
      },
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
    /** 接线期③ ③-A：未完成时的失败归因（引擎产出，供上层随台账落盘） */
    attribution?: AgentRunAttribution;
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
      // 接线期③ ③-A（2026-09-24）：显式指派的角色（未指定 ⇒ 无分配边，不臆测）
      assignedRole: input.subagent_type,
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
      // 接线期③ ③-A：未完成时的失败归因透出（成功路径为 undefined）
      ...(result.attribution ? { attribution: result.attribution } : {}),
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

      // P0-B（2026-09-21）：worker 工具池**空集 fail-closed**。
      // worker 池 = `类别池（类别由 AgentSwarm 硬编码）∩ allowedTools − deniedTools`，
      // 而 O7 两段校验用的是 `getAllTools()`（**父级全量**）⇒ "校验通过 ≠ worker 池非空"。
      // 例：`allowedTools: ['file_write','bash']` 校验通过，但
      // `{grep,glob,file_read} ∩ {file_write,bash}` = 空集 ⇒ 修复前 worker 会在**无任何工具**
      // 的情况下跑满 20 轮，无警告、无降级、无报错，最后照常落 `completed`
      //（N-41 修掉的"静默空池"在 swarm 路径的同族复现）。
      // 仅在 `isWorkerCall` 时检查：verifier / synthesizer 的 instances 本就为空，不可误伤。
      if (isWorkerCall && toolset.instances.size === 0) {
        const emptyPoolReason =
          'worker 工具池为空：类别池与 allowedTools 无交集' +
          `（declaredCategories=[${(declaredCategories ?? []).join(',')}]，` +
          `allowedTools=${allowedTools ? `[${allowedTools.join(',')}]` : '未限制'}）`;
        if (batchId && taskKey) {
          await getAgentRunStore().settleRun(
            `${batchId}::${taskKey}`,
            'failed',
            {
              error: emptyPoolReason,
            }
          );
        }
        logger.warn('swarm worker 工具池为空（fail-closed，不执行）', {
          batchId: batchId ?? null,
          taskKey: taskKey ?? null,
          declaredCategories: declaredCategories ?? null,
          allowedTools: allowedTools ?? null,
          deniedTools: deniedTools ?? null,
        });
        throw new Error(emptyPoolReason);
      }

      const result = await this.engine.execute({
        // P1-E（2026-09-21）：worker 的**引擎 id 与台账主键同源**（`batchId::taskKey`）。
        // 修复前三处 id 断裂：磁盘/台账主键 = `batchId::taskKey`（`:1344`）、
        // 引擎登记 = `swarm-<rand>`、控制面 `agentId` = `batchId`（`/v1/agents/runs`）。
        // ⇒ 前端拿列表里的 `toolCallId` 去 `POST /v1/agents/:id/stop` 时
        // `engine.ownerSessionId(id)` 必然 miss（fail-closed 拒绝）；即便放行，
        // `engine.abort(id)` 也无对应登记 ⇒ **取消是空操作**。
        // 统一后：引擎登记 = 磁盘主键 = 控制面可见 id，归属校验与 abort 同时命中。
        // 非 worker 调用（verifier / synthesizer：无 `taskKey`，不落台账）保留随机 id 仅需唯一。
        agentId:
          batchId && taskKey
            ? `${batchId}::${taskKey}`
            : `swarm-${randomUUID().substring(0, 8)}`,
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
        // 使控制面能对 worker（P1-E 后 id = `${batchId}::${taskKey}`）做归属校验
        //（否则 owner 恒 undefined ⇒ 越权口子）；
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
        // M-8（2026-09-22）：透出 worker 真实用量（引擎已聚合 prompt+completion）
        // ⇒ 批次汇总（`AgentSwarmResult.totalTokens`）⇒ 目标级记账
        tokens: result.tokenUsage?.totalTokens ?? 0,
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
    const {
      agentInput,
      effectiveType,
      isFork,
      isBackground,
      plannedWeight,
      agentId,
      startTime,
      reservation,
    } = guard;

    // G3 接线：worktree 隔离变量（try/finally 均需访问，声明在 try 之外——JS 块级作用域）
    let worktreeContext: ToolUseContext | undefined;
    let worktreeGit: WorkspaceGit | undefined;

    try {
      // O5 seam `executeLifecycle`：登记（prologue）。
      // 0b（M-9）：台账条目已由 `executeGuard.tryReserve()` 登记并占位 ⇒ 本调用只补
      // 磁盘行/事件/日志；并**移入 try**，使其抛错同样被 finally 兜住（释放预留）。
      await this.beginRun({
        agentInput,
        effectiveType,
        isFork,
        isBackground,
        context,
        onProgress,
        agentId,
        startTime,
      });
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
          // 缺陷 4（2026-09-22）：准入预留量同时作为**执行层并发上限** ——
          // 只改准入不改执行会"准入占 2、实际在飞 3"，上限从准入层挪到执行层被突破。
          maxConcurrency: plannedWeight,
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
      // 0b（2026-09-22，M-9）：额度预留的**结构性释放** —— 任何提前 return / 抛错都被
      // 这里兜住，不再依赖"每条路径都记得调 settleRun"。`release()` 委托
      // `ledger.settle()`（终态幂等）：正常路径已按真实结果结算 ⇒ 此处 no-op；
      // 异常/提前返回 ⇒ 收敛为 `failed`，杜绝"准入占位永不释放"。
      reservation.release();
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
   * 0b（2026-09-22，M-9）：**台账登记已上移到 `executeGuard` 的 `tryReserve()`**
   *（准入判定与占位同一次同步调用 + RAII 释放义务）⇒ 本方法只保留
   * 启动日志 / 进度发射 / 磁盘落盘的副作用，**不再 register、不再自建 id 与起跑时间**。
   */
  private async beginRun(params: {
    agentInput: AgentInput;
    effectiveType: AgentType;
    isFork: boolean;
    isBackground: boolean;
    context?: ToolUseContext;
    onProgress?: ToolCallProgress<AgentToolProgress>;
    /** 0b：`executeGuard.tryReserve()` 已登记（含额度占位）的 run id */
    agentId: string;
    /** 0b：与预留条目**同源**的起跑时间 */
    startTime: number;
  }): Promise<{ agentId: string; startTime: number }> {
    const {
      agentInput,
      effectiveType,
      isFork,
      isBackground,
      context,
      onProgress,
      agentId,
      startTime,
    } = params;

    // 0b（2026-09-22，M-9）：台账登记已由 `executeGuard` 的 `tryReserve()` 完成
    //（**判定与占位同一次同步调用**）⇒ 本方法不再 `register()`、也不再自建 id/起跑时间，
    // 只补**磁盘行 / 事件 / 日志**（保留原有副作用与执行顺序）。
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
   *
   * §3.0 实施顺序约束（2026-09-22）：磁盘 `AgentRunStore.settleRun` 同样带终态幂等守卫
   * （`WHERE status NOT IN ('completed','failed')`，命中失败时 `changed=0` 且**无日志**）
   * ⇒ **必须在唯一写入点按真实结果派生终态**，不得"先落 completed、再由补偿写入改 failed"
   * —— 反序时补偿会 100% 静默空转。
   */
  private async settleRun(
    agentId: string,
    status: 'completed' | 'failed',
    opts: { error?: string; attribution?: AgentRunAttribution } = {}
  ): Promise<void> {
    // M-5（P0-8）：结算**前**取归属会话 —— `settle()` 之后内存条目移入归因表，
    // `ownerSessionId()` 这一"控制面归属原语"不再可得。
    const ownerSessionId = this._ledger.ownerSessionId(agentId);
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
      // opts 透传（`error` 用于把"未通过原因"钉在磁盘行上；store 侧本就支持，无需新增方法）
      // 返回值为 false = 磁盘**守卫未命中**（该行已是终态）⇒ 本次写被静默丢弃。
      // §3.0 顺序约束的**运行时兜底**（2026-09-22）：反过来改错顺序时，日志会当场叫出来，
      // 不必等用例兜（磁盘侧命中失败本无任何日志，故障静默）。
      const persisted = await getAgentRunStore().settleRun(
        agentId,
        status,
        opts
      );
      if (!persisted) {
        logger.warn('终态落盘未命中：磁盘行已是终态，本次写被丢弃', {
          agentId,
          status,
        });
      }
    } catch (err) {
      logger.warn('子代理运行台账落盘失败（不影响内存终态）', {
        agentId,
        status,
        error: String(err),
      });
    }

    // M-5（P0-8）：**结算即通知** —— 通知收敛到本方法这**唯一入口**，
    // 从结构上消除"某条结算路径忘了调 `notifyYieldSettlement`"。
    // 修复前 7 处 `settleRun` 调用点里只有 3 处手工补了通知，**单代理前台结算**与
    // **descriptor fail-closed** 两条路径漏掉 ⇒ 其上的 yield 等待永不收敛
    //（"子代理结算"是该等待唯一的恢复触发源）。
    // 用 `await`：使"结算 → 落盘 → 通知（内含 outbox 落行）"成为**确定序列**，
    // 而非 fire-and-forget 的竞态（P1-7 关注的正是该顺序，见 §2.5）。
    // 归属缺失（无父会话可恢复）⇒ 内部静默跳过。
    await this.notifyYieldSettlement(ownerSessionId);
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
    /**
     * 批次并发上限（= 准入预留量 `plannedWeight`，单一派生源）。
     *
     * 缺陷 4（2026-09-22）：修复前不传 ⇒ `AgentSwarm` 恒用 `DEFAULT_SWARM_CONCURRENCY(3)`，
     * 与 `maxConcurrentAgents` 脱钩（配置上限 2 时真实在飞 3）。
     */
    maxConcurrency: number;
  }): Promise<ToolResult<unknown>> {
    const {
      tasks,
      agentInput,
      agentId,
      effectiveType,
      startTime,
      context,
      onProgress,
      maxConcurrency,
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

    // P1-C + R2（2026-09-21）：批次按 **worker 数占位**并发额度。
    // 占位本身在 **`executeGuard` 准入**时完成（`plannedWeight`，见
    // `AgentRunLedger.tryReserve()` —— 0b 起"判定与占位同一次同步调用 + RAII 释放"），
    // 本方法不再做"事后加权"——修复前先以 1 通过准入、再 `setWeight(N)` 校准，是可被
    // 并发批次累加突破的上限缺口（R2）。
    const swarmAbort = new AbortController();
    // 缺陷 2（2026-09-22）：注销所需的句柄 **`let` 外提**，注册点与全部可抛点**同处 try 内**。
    // 修复前 `registerBatchAbort` 在 try 之外（原 `:2150`），而 `resolveSwarmTaskDescriptors`
    // （跨 DB/角色库边界，可抛）同样在 try 之外 ⇒ 它抛出时 `finally` 根本不执行、
    // 且**不存在任何 unregister 路径** ⇒ `batchAborts` 单调增长（**永久泄漏**）；
    // 陈旧 controller 还会让**首次** `stopAgent` 报出"受理成功"的假阳性。
    // 泄漏是根，假阳性只是其表征（第二次起即为 false）。
    let parentSignal: AbortSignal | undefined;
    let onParentAbort: (() => void) | undefined;
    // 登记自身若抛错，不得去注销一个未写入的键
    let registered = false;
    let swarmResult: AgentSwarmResult;
    // SubTask.id 可选 → 统一补稳定兜底 id，供结果回填与汇总按 id 对齐。
    // 必须在 try 之外：`tasks.map` 不抛，且结算/汇总段（try 之后）仍需读取该清单。
    const swarmTasks = tasks.map((t, idx) => ({
      id: t.id ?? `task-${idx}`,
      description: t.description,
      agentType: t.subagent_type,
    }));
    try {
      // R1（2026-09-21）：把批次控制器登记到**可被控制面触达**的注册表。
      // 修复前两条取消通路互不连通：A 的 `swarmAbort` 只由 `context.abortController` 驱动，
      // 而 `stopAgent` 走台账 + `engine.abort` + 前缀扇出，**从不触碰 swarmAbort** ⇒
      // 用户停批次时"在飞 worker 被中止、但 `runBatched` 的 `signal?.aborted` 短路仍为假"，
      // 尚未投递的后续批次照常启动。此处让 `stopAgent` 能按 batchId 拿到同一个控制器。
      // R1 修正（2026-09-22）：注册表是**进程内单例**（`swarmBatchRegistry`），
      // 与 `_ledger` 同法 —— 否则"执行批次的实例"与"控制面取的实例"不同时查不到控制器。
      registerBatchAbort(agentId, swarmAbort);
      registered = true;
      // P0-A（2026-09-21）：把**父级取消信号**桥接到批次 AbortController。
      // 修复前 `swarmAbort` 只定义、**从不 abort** ⇒ `AgentSwarm.runBatched` 的
      // `if (signal?.aborted)` 短路恒为假，且父会话中止（用户点停止 / 工具级 abort）
      // 无法传导到批次 —— worker 只能靠引擎 `timeoutMs`（默认 600s）自然收敛。
      // R3（2026-09-21）：该桥接的**上游**已补齐 —— 真实聊天路径原先注入的工具 context
      // 没有 `abortController`（被内联类型断言掩盖），故此处 `parentSignal` 恒 undefined、
      // 桥接形同空转；现由 `ToolExecutionService` 注入会话级控制器（用户点停止即 abort）。
      parentSignal = context?.abortController?.signal;
      onParentAbort = (): void => {
        if (!swarmAbort.signal.aborted) swarmAbort.abort();
      };
      if (parentSignal) {
        // 父级**已**中止 ⇒ 立即同步（不依赖事件回调时序）
        if (parentSignal.aborted) onParentAbort();
        else
          parentSignal.addEventListener('abort', onParentAbort, { once: true });
      }
      // O12-1：**per-task 描述符解析**（与单代理路径同源）—— 未知/禁用 ⇒ 该任务 fail-closed；
      // 未指定 `subagent_type` 的任务不解析（沿用 AgentSwarm 的 worker 提示词，行为中性）
      const taskDescriptors =
        await this.resolveSwarmTaskDescriptors(swarmTasks);
      swarmResult = await new AgentSwarm().run({
        tasks: swarmTasks,
        goal: agentInput.goal || agentInput.description,
        // 缺陷 4（2026-09-22）：透传准入预留量 ⇒ 真实在飞 worker ≤ `maxConcurrentAgents`。
        // 该值同时驱动 worker 批次与 verifier 门禁批次（`AgentSwarm` 内共用同一 `concurrency`）。
        maxConcurrency,
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
    } finally {
      // R1（2026-09-21）：注销批次控制器（`stopAgent` 的扇出按 batchId 查表，必须防泄漏）。
      // 缺陷 2（2026-09-22）：该行原在 try 之外 ⇒ 解析链抛出时**永远不会执行**。
      if (registered) unregisterBatchAbort(agentId);
      // R4（2026-09-21）：解除父级监听放到 **finally** —— 修复前只在 `run()` 正常返回后
      // 调用，抛出时留下的监听虽因 `{once:true}` 有界，但"异常路径不清理"本身是缺口。
      if (parentSignal && onParentAbort)
        parentSignal.removeEventListener('abort', onParentAbort);
    }

    // 缺陷 1（2026-09-22）：**单一派生源**。
    // 修复前本路径的台账/metadata/汇总文案各自硬编码"成功"，与 worker 行的真实终态矛盾
    // （N-38「静默成功」同族）。此处一次性派生出全部对外口径，禁止下游各处自算。
    const workers = swarmResult.workers;
    const okCount = workers.filter((w) => w.ok).length;
    // O4 口径：`ok = success ∧ 门禁通过 ∧ ¬timedOut`（AgentSwarm 门禁阶段后统一计算）。
    // 收敛（2026-09-22）：**直接取 `AgentSwarm.allPassed`**，不再在此重算同语义表达式 ——
    // 原 `workers.length > 0 && okCount === workers.length` 是"单一派生源"注释下的第二份实现，
    // 任一处 `ok` 定义变更即产生漂移。
    const batchOk = swarmResult.allPassed;
    const partialFailure = workers.length > 0 && okCount > 0 && !batchOk;
    // 出口⑥：`runBatched` 在 `signal.aborted` 时直接 return（AgentSwarm.ts:225-232）⇒ 未投递的任务
    // **既没跑也没失败**，不可计入 failed（修复前 `tasks.length - succeeded` 把它们全算成失败）。
    // ⚠ 语义钉死：本值 = **投递缺口**（未投递数），**不等于取消事实**（见下 `cancelledFact`）。
    const cancelledCount = Math.max(0, tasks.length - workers.length);
    // 取消**事实**（取 `AgentSwarm` 的终态快照，不在此重读 `signal.aborted`）。
    // 2026-09-22 修复（Liri v1.4 复审 D1/D2）：先前只派生 `cancelledCount` ⇒ 取消发生在
    // **门禁/合成等收尾阶段**时任务已全部投递、缺口为 0 ⇒ 对外口径**完全看不到"批次被取消"**，
    // 控制面无法区分"3/3 成功后被取消"与"3/3 成功正常结束"。二者必须并列派生、禁止互相替代。
    const cancelledFact = swarmResult.cancelled === true;
    const failedCount = workers.length - okCount;
    // 出口⑤：门禁三态分列（`skipped` ≠ "已验证"）
    const verifyPassed = workers.filter((w) => w.verify === 'passed').length;
    const verifyFailed = workers.filter((w) => w.verify === 'failed').length;
    const verifySkipped = workers.length - verifyPassed - verifyFailed;
    // 门禁事实（由 `AgentSwarm` 暴露，不在此重算）：请求了门禁却有成功 worker 未获结论
    const gateIncomplete = swarmResult.verifyIncomplete === true;
    // 归因（2026-09-22 修正）：原为"取消优先"的嵌套三元 ⇒ 取消与失败同时存在时**丢掉失败原因**
    // （典型：取消发生在门禁阶段 ⇒ `cancelledCount = 0`，文案变成"已取消（完成 3/5，未投递 0）"，
    // 既自相矛盾、又抹掉了"2 个 worker 门禁未过"）。现改为**逐项罗列，互不遮蔽**。
    const reasonParts: string[] = [];
    if (failedCount > 0) {
      reasonParts.push(`${failedCount}/${workers.length} 个 worker 未通过`);
    }
    if (cancelledCount > 0) {
      reasonParts.push(`${cancelledCount} 个任务未投递（批次被取消）`);
    } else if (cancelledFact) {
      // 收尾阶段（门禁/合成）被取消：任务已全部投递 ⇒ 投递缺口为 0，但取消事实为真
      // ⇒ 必须单独成句，否则"取消"在归因里彻底不可见（Liri v1.4 D2）
      reasonParts.push('批次被取消（任务已全部投递，中止发生在收尾阶段）');
    }
    if (gateIncomplete) {
      reasonParts.push(`门禁未完成（${verifySkipped} 个 worker 未获门禁结论）`);
    }
    const batchError = batchOk
      ? undefined
      : reasonParts.length > 0
        ? reasonParts.join('；')
        : `批次未通过（完成 ${okCount}/${tasks.length}）`;

    globalEventBus.publish(OrchestrationEventType.PARALLEL_END, {
      totalTasks: tasks.length,
      completedTasks: okCount,
      failedTasks: failedCount,
      cancelledTasks: cancelledCount,
    });

    await this.settleRun(
      agentId,
      batchOk ? 'completed' : 'failed',
      batchOk ? {} : { error: batchError }
    );

    // M-6/M-7 接线（2026-09-22）：批次收口 ⇒ 把结果绑到该会话的**未终结目标**上。
    // 零回归：该会话没有未终结目标时 `settleGoalForRun` 立即返回 null（不建行、不写库）。
    // 状态映射见 `goalRunBinding.deriveGoalStatus`：
    // 全通过 ⇒ `completed`、部分成功 ⇒ `blocked`、全失败 ⇒ `failed`、批次取消 ⇒ `cancelled`。
    // M-8 / 停止条件接线（2026-09-22）：目标侧指令（预算收尾 / 停滞停止）
    // —— 下文追加到批次输出 ⇒ 经 tool result 注入 LLM 输入（见 `finalOutput`）。
    // B3-2（2026-09-23）：持有**类型化片段**（而非拼接好的字符串）—— 前缀由片段类型给出。
    let goalInstruction: ContextualFragment | undefined;
    try {
      const settledGoal = await settleGoalForRun({
        sessionId: context?.sessionId,
        outcome: { allPassed: batchOk, okCount, cancelled: cancelledFact },
        // M-8：批次 worker 真实用量（`AgentSwarm` 汇总；executor 未提供 ⇒ 0，不估算）
        tokens: swarmResult.totalTokens,
        // B2-4 / X6（2026-09-23）：批次在 `agent_runs` 中的**行 id** —— 本批次自身那行由
        // `beginRun()` 以 `toolCallId: agentId` 写入（`AgentRunStore` 主键为 `tool_call_id`）
        // ⇒ 此处传 `agentId` 即"可反查的归属批次行"（Spec §10.2 U4 已核实）。
        runId: agentId,
      });
      if (settledGoal) {
        logger.info('批次结果已绑定到目标', {
          goalId: settledGoal.goalId,
          status: settledGoal.status,
          tokens: swarmResult.totalTokens,
          noProgressStreak: settledGoal.noProgressStreak ?? null,
        });
        // 触顶收尾（M-8）与停滞停止（停止条件）**互斥**：触顶路径在记账处早返回，
        // 不会同时产出两条指令 ⇒ 此处取其一即可，不拼接多段指令。
        //
        // B2-2 / X2（2026-09-23）：**注入即落盘**（`project_rules.md §1.6` 红线）——
        // 该指令是模型可见输入（下方写入 tool result ⇒ `TAORLoop` 序列化为 `role:'tool'`），
        // 故在此处（注入点）取指令并**成对**落 `goal/injected{channel:'tool_result'}`，
        // 载荷 `text` = 实际注入的原文 ⇒ "模型当时看到了什么"可逐字重建。
        const injection = await takeBatchGoalInstruction({
          sessionId: context?.sessionId,
          settlement: settledGoal,
        });
        goalInstruction = injection?.fragment;
        if (injection) {
          logger.warn('目标侧指令已注入批次输出', {
            goalId: settledGoal.goalId,
            status: settledGoal.status,
            templateKind: injection.templateKind,
            instruction: injection.text,
          });
        }

        // M-7 idle 触发续接（2026-09-22）：目标落到 `blocked`（未达成但**非终态**）
        // ⇒ 登记**一次**延迟唤醒，会话空闲时自动续跑（有界性/防陈旧见
        // `goalIdleContinuation` 文件头；未启用 CG3 时静默降级为不登记）。
        const streak = settledGoal.noProgressStreak;
        if (settledGoal.status === 'blocked' && streak !== undefined) {
          try {
            const enqueued = await enqueueIdleContinuation({
              sessionId: context?.sessionId,
              goalId: settledGoal.goalId,
              streak,
            });
            logger.info('目标空闲续接登记结果', {
              goalId: settledGoal.goalId,
              streak,
              enqueued,
            });
          } catch (err) {
            // @ignore-catch — 续接调度属"推进面"，登记失败不得影响批次结果返回
            logger.warn('目标空闲续接登记失败（不影响批次结果）', {
              goalId: settledGoal.goalId,
              error: String(err),
            });
          }
        }
      }
    } catch (err) {
      // @ignore-catch — 目标绑定属"意图/观测面"，失败不得影响批次结果返回
      logger.warn('目标状态落定失败（不影响批次结果）', { error: String(err) });
    }

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
      .map((t) => {
        // M-13（2026-09-22）：**只按 id 取，禁止下标兜底**。
        // 修复前 `?? swarmResult.workers[idx]` 把"完成顺序数组"当"task 顺序数组"用：
        // 任一任务未产出 worker（最常见触发：批次取消 ⇒ `runBatched` 短路，
        // 剩余任务从未投递）时，会把**别的** worker 结果挂到它名下（张冠李戴）。
        const w = workerById.get(t.id);
        const name = t.description;
        // 未产出 worker ⇒ 如实标注（与"执行失败"区分开）
        if (!w) return `[FAIL] ${name}: 未执行（批次取消或未投递）`;
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
          `## Worker 结果（门禁：passed ${verifyPassed} / failed ${verifyFailed} / skipped ${verifySkipped}；allPassed: ${swarmResult.allPassed}）`,
          ...swarmResult.workers.map(
            (w) =>
              `[${w.success ? 'OK' : 'FAIL'}${w.verify === 'failed' ? ' 未过门禁' : ''}] ${w.id}: ${summaryTextByWorkerId.get(w.id) ?? ''}`
          ),
        ]
          .filter(Boolean)
          .join('\n\n')
      : legacyAggregated;

    // M-8 / 停止条件接线（2026-09-22）：目标侧指令**注入 LLM 输入**——追加到 tool result 文本。
    // 无指令（未触顶且未停滞）⇒ 输出**逐字不变**，既有格式断言零回归。
    // B3-2（2026-09-23）：片段类型化 —— 通道前缀 `[SYSTEM] ` 由 `kind:'goal_instruction'` 给出，
    // 渲染唯一走 `renderFragment()`（拼接结果与迁移前**逐字一致**）。
    const finalOutput = goalInstruction
      ? `${aggregatedOutput}\n\n${renderFragment(goalInstruction)}`
      : aggregatedOutput;

    this.emitComplete(
      onProgress,
      agentId,
      agentInput.name || agentId,
      `Parallel execution completed: ${okCount}/${workers.length} tasks succeeded` +
        `${cancelledCount > 0 ? `（已取消：${cancelledCount} 个任务未投递）` : ''}` +
        // 收尾阶段被取消（缺口为 0）也要如实说 —— 否则用户看到"全部成功"却不知批次已被中止
        `${cancelledCount === 0 && cancelledFact ? '（批次被取消：任务已全部投递，收尾阶段中止）' : ''}` +
        `${gated ? `（allPassed: ${swarmResult.allPassed}）` : ''}`
    );

    // 阶段 A（A1-e）/ M-5：并行批次已全部结算（`AgentSwarm` 内 `Promise.allSettled` 收口）
    // ⇒ 结算通知由 `settleRun()`（**唯一入口**）统一发出，此处不再手工通知。

    // 出口②（D-A 方案 A′ 三档，2026-09-22）：全 `ok` ⇒ SUCCESS；**部分失败 ⇒ SUCCESS**
    // （保住部分结果，不被上游当"工具调用失败"丢弃，真实成败由 `metadata.completed` /
    // `metadata.partialFailure` 表达）；**全失败 / 启动前取消 ⇒ FAILURE**（此时无结果可保）。
    const resultStatus =
      okCount > 0 ? ToolExecutionStatus.SUCCESS : ToolExecutionStatus.FAILURE;
    // `error` 仅在 FAILURE 时携带 —— 成功路径保持既有契约（原先恒 `undefined`）逐字不变。
    const resultError =
      resultStatus === ToolExecutionStatus.FAILURE ? batchError : undefined;
    return {
      status: resultStatus,
      result: finalOutput,
      error: resultError,
      executionTime: Date.now() - startTime,
      output: finalOutput,
      errorOutput: resultError ?? '',
      progress: [],
      metadata: {
        agentId,
        agentType: effectiveType,
        // 出口③：与 `batchOk` 同源（修复前恒 `true`）
        completed: batchOk,
        parallelTaskCount: workers.length,
        parallelSuccessCount: okCount,
        // ⚠ 语义：**未投递**任务数（≠ 取消事实）—— 收尾阶段取消时该值为 0，须与下项并列判读
        cancelledTaskCount: cancelledCount,
        // 取消事实（与 `cancelledTaskCount` 互补）；补上后 `swarmResult.cancelled` 不再是无消费方的死字段
        cancelled: cancelledFact,
        ...(partialFailure
          ? {
              partialFailure: `${failedCount}/${workers.length} 个 worker 未通过`,
            }
          : {}),
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
        // B1/O1-3 / M-5：后台 run 的结算同样经 `settleRun()` ⇒ 通知由其统一发出
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
        // B1/O1-3 / M-5：失败同属结算 ⇒ 通知同样由 `settleRun()` 统一发出
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
      /** 接线期③ ③-A：引擎路径透出的失败归因（直调路径无） */
      attribution?: AgentRunAttribution;
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
    // 接线期③ ③-A：未完成时把**失败归因**（图快照 + 根因候选）一并落盘
    await this.settleRun(agentId, result.completed ? 'completed' : 'failed', {
      ...(result.attribution ? { attribution: result.attribution } : {}),
    });

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
   *
   * **M-5（2026-09-22）收敛**：本方法**不再由各结算点手工调用** —— 通知的唯一触发点是
   * `settleRun()`（见其注释）。此处 `sessionId` 由 `settleRun` 从台账归属取得，
   * 不再依赖调用方传 `ToolUseContext`（原先"谁记得传 context"决定了是否能通知）。
   */
  private async notifyYieldSettlement(sessionId?: string): Promise<void> {
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
   *
   * **M-0 尾项（2026-09-22）——回落口径的契约边界**：
   * - 本方法是"内存 → 磁盘 → `not_found`"回落的**唯一实现**（全 `app/src` 仅此一处，
   *   已 grep 核对）⇒ 新增查询需求必须复用本方法，禁止再写一处等价回落；
   * - `source` **仅供可观测标注**（如 CLI 提示"来源: 磁盘台账"），
   *   ❌ **禁止**以 `source` 作业务分支依据 —— 单一事实源收敛的目标是"答案一致"，
   *   而不是让调用方按层选择行为（当前唯一消费点 `commands/tools/ai/agent.ts:351`
   *   仅拼接展示文案，符合该边界）；
   * - 内存仍是**一等事实源**（0a 后 worker 也进台账）⇒ 命中即返回；
   *   磁盘只补"内存窗口之外的终态"，不参与活跃判定。
   *
   * 注：磁盘不可用时的错误**直接抛出**，不伪装成 `not_found`（避免把环境故障说成"查无此 run"）。
   *
   * @param agentId Agent ID
   */
  async getAgentStatus(agentId: string): Promise<{
    status: AgentRunStatus | 'unknown' | 'not_found';
    duration?: number;
    /** 状态来源：`memory`（内存台账）/ `store`（磁盘台账）——**仅作展示标注** */
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
    //    worker，P1-E 后引擎 id = `${batchId}::${taskKey}`）任一给出 owner 且与请求方一致才放行；
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
    // 精确匹配 `agentId`：**单代理路径**的引擎登记 id 就是 `agentId`（本文件 `:1139`）
    // ⇒ 这一行是单代理停止的**唯一命中路径**，**不可删**。
    // 批次路径下它确实恒 miss（worker 登记为 `${batchId}::${taskKey}`，见 `:1462`），
    // 而那正是下面 `:2907` 前缀扇出存在的理由 —— 两者**互补**，不是冗余。
    // （2026-09-22 复核结论：曾有评审建议"删除该恒 miss 调用"，实为对"单代理登记 id"的误判。）
    const engineStopped = this.engine.abort(agentId);

    // R1（2026-09-21）：**批次级取消** —— abort 该批次的 `swarmAbort`。
    // 这是唯一能让 `AgentSwarm.runBatched` 的 `signal?.aborted` 短路生效的入口：
    // 修复前停批次只中止"在飞 worker"，**尚未投递的后续批次照常启动**。
    // 与父级桥接（A）共用同一个控制器 ⇒ 两条取消通路在此汇合。
    const batchController = getBatchAbort(agentId);
    const batchAborted =
      batchController !== undefined && !batchController.signal.aborted;
    if (batchAborted) {
      batchController.abort();
    }

    // P1-E（2026-09-21）：**批次级取消扇出**。
    // 控制面 `/v1/agents/control` 列的是台账条目（批次 = `batchId`），而 worker 在引擎上
    // 以 `${batchId}::${taskKey}` 登记 ⇒ `engine.abort(batchId)` 精确匹配必然 miss：
    // 修复前"停批次"只把台账置 `cancel_requested`（A 与 D 的链路修好后依然如此），
    // **worker 一个都不会停**，要等引擎 `timeoutMs`（默认 600s）自然收敛 ——
    // 用户点"停止"看到的成功是假的。此处按前缀补上批次 → worker 的扇出。
    // 遍历用 `getActiveAgents()` 的快照数组（`abort()` 会改 `activeAgents` Map，边遍历边改不安全）。
    let workersStopped = 0;
    for (const { agentId: engineId } of this.engine.getActiveAgents()) {
      if (engineId.startsWith(`${agentId}::`) && this.engine.abort(engineId)) {
        workersStopped++;
      }
    }
    if (workersStopped > 0) {
      logger.info('批次取消扇出：已中止批次内 worker', {
        batchId: agentId,
        workersStopped,
      });
    }

    // P1-D（2026-09-21）：把取消受理**同步到磁盘台账**。
    // 修复前 `cancel_requested` 只有内存写入点（`AgentRunLedger.requestCancel`），
    // `AgentRunStore` 从未写过该态 ⇒ 经本方法受理的取消在磁盘上仍是 `running`，
    // 进程重启后被陈旧自愈判成 `unknown`（"无法证明结果"），而真相是
    // "取消已受理、正在下一个安全边界收敛"（`unknown` 会让上层以为需要人工确认）。
    // 与 `recordDescriptorSource` 同约定：落盘是**观测面**而非正确性前置 —— 本方法是
    // 同步签名（全部调用方为 HTTP pause/stop、Coordinator、CLI），无法 await，
    // 故 fire-and-forget + 失败只记日志；取消本身已受理，不因落盘失败而回退语义。
    if (accepted || engineStopped || workersStopped > 0 || batchAborted) {
      void getAgentRunStore()
        .markCancelRequested(agentId)
        .catch((err: unknown) =>
          logger.warn('取消受理落盘失败（取消本身不受影响）', {
            agentId,
            error: String(err),
          })
        );
    }

    return accepted || engineStopped || workersStopped > 0 || batchAborted;
  }
}

/**
 * 创建AgentTool实例
 */
export function createAgentTool(config?: Partial<AgentConfig>): AgentTool {
  return new AgentTool(config);
}

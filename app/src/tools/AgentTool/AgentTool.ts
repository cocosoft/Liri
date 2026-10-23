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
import type { AgentInput, AgentConfig, BuiltInAgent, AgentType } from './types';
import {
  getAgentRunLedger,
  type AgentRunLedgerPort,
  type AgentRunReservation,
  type AgentRunStatus,
} from './AgentRunLedger';
import {
  resolveAgentDescriptor as resolveDescriptorChain,
  renderSubagentTypeDescription,
  setEnabledRoleNames,
  type AgentDescriptorResult,
} from './AgentDescriptorResolver';
import { getAgentRunStore } from './AgentRunStore';
// 接线期③ ③-A（2026-09-24）：未完成 run 的失败归因类型（随台账落盘）
import type { AgentRunAttribution } from './runAttribution';
import { isSpawnPaused, getSpawnPauseState } from './spawnPause';
import { getSettlementOutbox } from '@modules/chat';
// O10b（v7.1）：控制面 Tier1 血缘链（会话祖先判定）
import { isAncestorSession } from '@modules/session';
import type { AgentToolProgress } from '../types/ToolProgress';
import { VERIFICATION_SYSTEM_PROMPT } from './strategies/VerificationStrategy';
import { VERIFICATION_AGENT_DEFINITION } from './strategies/VerificationStrategy';
import { STATUSLINE_SYSTEM_PROMPT } from './strategies/StatuslineStrategy';
import { STATUSLINE_SETUP_AGENT_DEFINITION } from './strategies/StatuslineStrategy';
import { FORK_SUBAGENT_TYPE, isForkSubagentEnabled } from './ForkSubagent';
import { SubAgentEngine, getSubAgentEngine } from './SubAgentEngine';
// B-4（2026-09-20）：并行执行统一走 AgentSwarm 单引擎（原 ParallelOrchestrator 已删除），
// 并在此发布 PARALLEL_* 事件以保持前端 SSE 时间线不断供。
import {
  AgentSwarm,
  DEFAULT_SWARM_CONCURRENCY,
  type SwarmExecutor,
} from '@modules/tasks';
// R1 修正（2026-09-22）：批次取消注册表改为**进程内单例**（与 `getAgentRunLedger()` 同法）
import { getBatchAbort } from './swarmBatchRegistry';
// 阶段 A（A1-e）：并行批次结算 → yield 等待收敛桥
import { notifyYieldSettled } from '@modules/chat';
import { agentRegistry } from '@modules/agent';
import { taskRegistry } from '@modules/tasks';
import { resolveModelRoute, RouteKey } from '@modules/ai';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { BackgroundAgentTask } from '@modules/tasks';
import type { BackgroundTaskInfo } from '@modules/tasks/types';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { trackUsage } from '@modules/ai';
// G-2/E（2026-10-11，Spec §5-D-1 E）：日预算闸门（派生前）与子代理用量计账
import { getDailyBudget, recordDailyBudgetFromUsage } from '@modules/query';
import { subAgentTokenListeners } from '@modules/tokenBudget';
// N-41（2026-09-21 真机实证）：工具池兜底来源 —— 唯一注册表（project_rules §1.16）
import { getToolRegistry } from '../ToolRegistry';
// B1（2026-10-05 文件规模债拆分）：工具池/授权/定义 + 进度发射簇（C3+C4）外迁
import { AgentToolPool } from './agentToolPool';
// B3（2026-10-05 文件规模债拆分）：队友注册/注销/隔离/fork 簇（C8）外迁
import { AgentTeammateIsolation } from './agentTeammateIsolation';
// B2（2026-10-05 文件规模债拆分）：台账/结算/血缘簇（C7）外迁
import { AgentLedgerLifecycle } from './agentLedgerLifecycle';
// U-22/S1（2026-10-17）：并行批次路径 + worker executor 适配器外移（行为等价搬迁）
import {
  buildSwarmExecutor,
  resolveDeniedTools,
  runSwarmPath,
  type BuildSwarmExecutorOptions,
  type RunSwarmPathParams,
  type SwarmPathDeps,
  type SwarmTaskDescriptor,
} from './swarmPath';
// 兼容既有导入路径（测试与调用方仍从 `AgentTool` 取该纯函数）
export { resolveDeniedTools } from './swarmPath';

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
    description: '任务的简短描述（3-5 个词）',
    required: true,
  },
  {
    name: 'prompt',
    type: 'string' as const,
    description: '子代理要执行的任务',
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
    description: '要使用的专用代理类型',
    required: false,
    default: 'general',
  },
  {
    name: 'model',
    type: 'string' as const,
    description: '可选的模型覆盖：已注册的模型 ID',
    required: false,
  },
  {
    name: 'run_in_background',
    type: 'boolean' as const,
    description: '设为 true 以在后台运行此代理',
    required: false,
    default: false,
  },
  {
    name: 'name',
    type: 'string' as const,
    description: '所创建子代理的名称。使其可通过 SendMessage 寻址',
    required: false,
  },
  {
    name: 'cwd',
    type: 'string' as const,
    description: '运行该代理的绝对路径',
    required: false,
  },
  {
    name: 'allowedTools',
    type: 'string' as const,
    description:
      '逗号分隔的工具名，表示子代理允许使用哪些工具。若为空，则所有工具均可用。',
    required: false,
  },
  {
    name: 'deniedTools',
    type: 'string' as const,
    description: '逗号分隔的工具名，表示子代理被禁止使用哪些工具。',
    required: false,
  },
  {
    name: 'goal',
    type: 'string' as const,
    description:
      '并行执行的总体目标（供 verifier/synthesizer 使用）。默认为 description。',
    required: false,
  },
  {
    name: 'verify',
    type: 'boolean' as const,
    description:
      '并行执行后，对每个 worker 的结果运行验证关卡（每个 worker 的 verified + allPassed）。默认 false。',
    required: false,
  },
  {
    name: 'synthesize',
    type: 'boolean' as const,
    description: '并行执行后，将所有 worker 的结果综合为单一报告。默认 false。',
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
 * 内置子代理定义（仅收录携带 `disallowedTools` 的策略定义）。
 *
 * 键 = `BUILTIN_AGENTS` 的键（= `subagent_type` 归一后的**小写名**），与解析链 ③ 分支
 * 传入的 `key` 口径一致；未收录/未声明者取不到 ⇒ `undefined`（不抛错）。
 */
const BUILTIN_AGENT_DEFINITIONS_BY_TYPE: Record<
  string,
  { disallowedTools?: string[] }
> = {
  [VERIFICATION_AGENT_DEFINITION.agentType]: VERIFICATION_AGENT_DEFINITION,
  [STATUSLINE_SETUP_AGENT_DEFINITION.agentType]:
    STATUSLINE_SETUP_AGENT_DEFINITION,
};

/**
 * 按 `allowedTools` / `deniedTools` 过滤工具池（O7：**定义侧与执行侧的单一过滤源**）。
 *
 * 白名单先于黑名单（与原实现一致）；比较**大小写不敏感**。
 * 模块级纯函数：便于守卫测试直接断言过滤语义（`AgentTool` 私有方法委托至此，行为不变）。
 */
export function filterToolPool(
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
 * AgentTool实现
 *
 * 用于创建子代理执行复杂任务
 */
export class AgentTool implements Tool {
  /** 工具名称 */
  readonly name: string = AGENT_TOOL_NAME;

  /** PR-0：非 `BaseTool`（无 `getRiskClass()`）⇒ 显式声明风险（lint:tool-risk 规则 3） */
  readonly riskClass = 'external' as const;

  /** 工具描述 */
  readonly description: string = '创建一个专用子代理来执行特定任务';

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
  // P2-6（2026-09-25）：字段类型收敛为**台账契约** —— 消费方依赖接口而非具体类，
  // 使台账可被桩化/替换（"判据源"由类型表达，见 `.trae/specs/agent-run-ports.md`）。
  private _ledger: AgentRunLedgerPort = getAgentRunLedger();

  /**
   * B1（2026-10-05 文件规模债拆分）：工具池/授权/定义 + 进度发射簇（C3+C4）外迁
   * （见 `.trae/specs/file-size-debt-partition-plan.md` §28.5）。
   *
   * 被迁出成员引用的宿主模块级符号（`getAllTools` / `MAX_SUBAGENT_DEPTH` / `filterToolPool`）
   * 经 getter/闭包注入，避免 `AgentTool.ts ↔ agentToolPool.ts` 循环 import。
   */
  private readonly agentToolPool: AgentToolPool = new AgentToolPool({
    getAllTools,
    getMaxSubagentDepth: () => MAX_SUBAGENT_DEPTH,
    filterToolPool,
  });

  /**
   * B3（2026-10-05 文件规模债拆分）：队友注册/注销/隔离/fork 簇（C8）外迁
   * （见 `.trae/specs/file-size-debt-partition-plan.md` §28.5）。
   *
   * 零宿主依赖 ⇒ 被迁 `agentTeammateHandles` 字段随迁至模块内，无参构造。
   */
  private readonly agentTeammateIsolation: AgentTeammateIsolation =
    new AgentTeammateIsolation();

  /**
   * B2（2026-10-05 文件规模债拆分）：台账/结算/血缘簇（C7）外迁
   * （见 `.trae/specs/file-size-debt-partition-plan.md` §28.5）。
   *
   * 被迁出成员引用的宿主实例依赖经闭包注入：`getName`（`this.name`）·
   * `emitStart`（`this.agentToolPool.emitStart`）· `notifyYieldSettlement`（宿主方法，
   * 箭头闭包在**调用时**解析实例成员 ⇒ 测试猴补生效）。`_ledger` 字段本体仍留宿主
   * （`agentControlOwnership.test.ts` 反射守卫），模块侧改用 `getAgentRunLedger()` 同一单例。
   */
  private readonly agentLedgerLifecycle: AgentLedgerLifecycle =
    new AgentLedgerLifecycle({
      getName: () => this.name,
      emitStart: (onProgress, agentId, agentName) =>
        this.agentToolPool.emitStart(onProgress, agentId, agentName),
      notifyYieldSettlement: (sessionId?: string) =>
        this.notifyYieldSettlement(sessionId),
    });

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
        // 定义侧裁剪来源：内置定义的 `disallowedTools`（如 verification ⇒ ['agent','notebook']）。
        // 取不到返回 undefined（本函数不抛错），与 `BUILTIN_AGENTS` 的键（小写名）同口径。
        getBuiltinDisallowedTools: (typeName) =>
          BUILTIN_AGENT_DEFINITIONS_BY_TYPE[typeName]?.disallowedTools,
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
        error: this.agentLedgerLifecycle.failureResult(
          validation.message || ''
        ),
      };
    }

    // N-70（2026-09-25）：工具入参在**部分路径下是只读的** —— 实测 `Attempted to assign to readonly property.`
    // 仅在**传入字符串 `allowedTools`/`deniedTools`** 时爆发（即本函数下方 `executeToolsets` 对
    // `agentInput.allowedTools/deniedTools` 的赋值处）：3 个并发调用全传字符串 ⇒ 3 次报错；
    // 单次调用未传 ⇒ 0 次报错（精确对应）。
    // **修复**：一律以**浅拷贝**承载本次执行的归一结果，**不再对调用方传入的对象赋值**
    //（工具本就不应改写入参 ⇒ 同时消除"入参只读 ⇒ 整次工具调用失败"这一失败模式）。
    const agentInput: AgentInput = { ...(input as unknown as AgentInput) };
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
        error: this.agentLedgerLifecycle.failureResult(
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
        error: this.agentLedgerLifecycle.failureResult(
          `子代理 spawn 已暂停（原因：${pauseState.reason ?? '未提供'}）。` +
            '在途子代理不受影响；恢复（resume）后可继续委派。'
        ),
      };
    }

    // G-2/E（2026-10-11，Spec `daily-budget-over-limit-ux.md` §5-D-1 E）：**日预算闸门（派生前）**。
    //
    // 接线既有 `canSpawnSubAgent()`（此前**零调用者**）：子代理是"扇出"入口，额度吃紧时先拦派生，
    // 避免一次委派把剩余额度同时放大 N 份。语义（既有实现）：**仅 `normal` 档位放行** ——
    // 即进入告警区（≥80%）后就不再派生，比 chat 闸门（`report_only` 仍放行）更保守。
    // 拒绝结果作为**工具结果**回父对话（复用 A 的卡片语义：放行 / 调高上限后重试）。
    const dailyBudget = getDailyBudget();
    if (!dailyBudget.canSpawnSubAgent()) {
      const budgetState = dailyBudget.getMode();
      logger.warning('Agent execution rejected: daily budget insufficient', {
        mode: budgetState.mode,
        todayUsed: budgetState.todayUsed,
        dailyLimit: budgetState.dailyLimit,
      });
      return {
        ok: false,
        error: this.agentLedgerLifecycle.failureResult(
          `今日 Token 预算不足，已阻止派生新子代理（档位：${budgetState.mode}，已用 ${budgetState.todayUsed} / 上限 ${budgetState.dailyLimit}）。` +
            '可在桌面端「用量中心 → 日限额」临时提额 / 今日解除，或调高每日上限后重试；在途子代理不受影响。'
        ),
      };
    }

    // Phase 3: 解析工具过滤 + **O7 两段校验**（未知工具集 / 禁止扩权 / fail-closed 空清单）
    const toolsetError = this.agentToolPool.executeToolsets(agentInput);
    if (toolsetError) {
      logger.warning('Agent execution rejected: invalid toolset request', {
        allowedTools: agentInput.allowedTools ?? null,
        deniedTools: agentInput.deniedTools ?? null,
        error: toolsetError,
      });
      return {
        ok: false,
        error: this.agentLedgerLifecycle.failureResult(toolsetError),
      };
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
    const agentId = this.agentLedgerLifecycle.createAgentId(
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
        error: this.agentLedgerLifecycle.failureResult(
          'Maximum concurrent agents reached'
        ),
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
   * B1 薄转发（2026-10-05 文件规模债拆分，见 `.trae/specs/file-size-debt-partition-plan.md` §28.5）：
   * 保留同名 private 方法 —— 测试以 `Reflect.get(tool,'getInheritableToolPool') + fn.call(tool,…)`
   * **接收者绑定**消费（`agentToolPoolSource.test.ts`），且宿主执行主链调用点继续调用本转发
   * （实现已外迁 `AgentToolPool#getInheritableToolPool`，故本转发非僵尸方法）。
   */
  private getInheritableToolPool(
    options: { allowDelegation?: boolean } = {}
  ): Tool[] {
    return this.agentToolPool.getInheritableToolPool(options);
  }

  /**
   * B1 薄转发（2026-10-05 文件规模债拆分，见 `.trae/specs/file-size-debt-partition-plan.md` §28.5）：
   * 保留同名 private 方法 —— 测试以 `Reflect.get(tool,'resolveDelegationGrant') + fn.call(tool,…)`
   * **接收者绑定**消费（`agentDelegationGrant.test.ts`），且宿主执行主链调用点继续调用本转发
   * （实现已外迁 `AgentToolPool#resolveDelegationGrant`，故本转发非僵尸方法）。
   */
  private resolveDelegationGrant(
    canDelegate: boolean | undefined,
    context?: ToolUseContext
  ): boolean {
    return this.agentToolPool.resolveDelegationGrant(canDelegate, context);
  }

  /**
   * 获取默认系统提示
   * @param type Agent类型
   */
  private getDefaultSystemPrompt(type: AgentType): string {
    switch (type) {
      case 'explore':
        return '你是探索代理。你的目标是探查代码库，并收集关于项目结构、关键文件与功能的信息。';
      case 'plan':
        return '你是规划代理。你的目标是为实现某个功能或修复某个问题制定详细计划。';
      case 'verification':
        return VERIFICATION_SYSTEM_PROMPT;
      case 'code-guide':
        return '你是代码指导助手。你的目标是通过提供最佳实践与代码评审意见，帮助用户写出干净、高效、可维护的代码。';
      case 'statusline-setup':
        return STATUSLINE_SYSTEM_PROMPT;
      default:
        return '你是一个乐于助人的 AI 代理。你可以使用多种工具来帮助完成任务。';
    }
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
    allowDelegation = false,
    /**
     * 定义侧禁用工具（`descriptor.disallowedTools`，如 verification 的 ['agent','notebook']）。
     *
     * 追加在参数末尾且有默认值 ⇒ 既有调用方位置参数不变。与调用侧 `deniedTools` **取并集**
     * 后作黑名单 —— **只收窄，不扩权**。
     */
    definitionDeniedTools: string[] = []
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
    // 定义侧 `disallowedTools` 与调用侧 `deniedTools` 合取（只收窄，不扩权）
    const deniedTools = resolveDeniedTools(
      input.deniedTools,
      definitionDeniedTools
    );
    const filteredPool = this.agentToolPool.filterToolPool(
      input.allowedTools,
      deniedTools,
      subAgentPool
    );
    const toolDefinitions = this.agentToolPool.buildToolDefinitions(
      input.allowedTools,
      deniedTools,
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
              // D-48（2026-09-30）：**已接线** —— 定义侧 `disallowedTools` 随描述符下发，
              // 由 `buildSwarmExecutor` 在**每个 worker 自己的**工具集构造处与批次级
              // `deniedTools` 合取（`resolveDeniedTools`）⇒ 各 worker 只受自己声明的限制。
              // 修复前该字段在此被丢弃（台账 D-46 遗留的"共享池 vs 每任务禁用"歧义，
              // 现按**每任务精确**裁定：过滤点是 per-task，能取到该任务的描述符）。
              disallowedTools: descriptor.disallowedTools,
            }
          : { error: descriptor.error }
      );
    }
    return resolved;
  }

  /** U-22/S1：swarm 路径依赖（每次调用重建，全部为轻量引用/闭包） */
  private swarmPathDeps(): SwarmPathDeps {
    return {
      toolName: this.name,
      agentLedgerLifecycle: this.agentLedgerLifecycle,
      agentToolPool: this.agentToolPool,
      engine: this.engine,
      getInheritableToolPool: () => this.getInheritableToolPool(),
      resolveSwarmTaskDescriptors: (tasks) =>
        this.resolveSwarmTaskDescriptors(tasks),
    };
  }

  /**
   * 构造 swarm executor（U-22/S1 外移；实现在 `./swarmPath`，行为等价搬迁）。
   */
  private buildSwarmExecutor(
    options: BuildSwarmExecutorOptions
  ): SwarmExecutor {
    return buildSwarmExecutor(options, this.swarmPathDeps());
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
    // 含 `agent`/`Task`/`sessions_yield` ⇒ 简单任务路径会把委派入口暴露给子代理）
    const toolDefinitions = this.agentToolPool
      .buildToolDefinitions(
        input.allowedTools,
        input.deniedTools,
        this.getInheritableToolPool({ allowDelegation })
      )
      .map((t) => ({
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

      // 债四「换算接线」（2026-10-13）：与 `trackUsage` **同一模型表达式**（数出同源）
      const turnModel = input.model || agentModel;
      trackUsage(response as unknown as Record<string, unknown>, {
        model: turnModel,
        latencyMs,
      });

      // G-2/E（2026-10-11，Spec §5-D-1 E）：**直调路径**同样走非 chat 管线（直调 provider）⇒
      // 用量须计入每日预算，否则"简单任务"子代理可绕过日限额（与引擎路径同款单点记账）。
      recordDailyBudgetFromUsage(
        (response as { usage?: unknown }).usage,
        undefined,
        turnModel
      );
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
      await this.agentLedgerLifecycle.beginRun({
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
        await this.agentLedgerLifecycle.settleRun(agentId, 'failed');
        return this.agentLedgerLifecycle.failureResult(
          descriptor.error,
          agentId
        );
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
      await this.agentLedgerLifecycle.recordDescriptorSource(
        agentId,
        descriptor.source
      );

      // T9：授权位 = 角色策略（用户配置）× 父侧深度上限（双判据合取，模型不可自选）
      const canDelegate = this.resolveDelegationGrant(
        descriptor.canDelegate,
        context
      );

      // O5 seam `executeLifecycle`：teammate 绑定（含 isSimpleTaskNow 判定）
      const { teammateHandleId, mailbox, isSimpleTaskNow } =
        await this.agentTeammateIsolation.bindTeammate({
          agentInput,
          agentId,
          systemPrompt,
          isFork,
        });

      // O5 seam `executeLifecycle`：隔离与 fork 提示词组装。
      // **陷阱处置**：两者均**就地改写** `systemPrompt`（逐段 `+=`）与 `agentInput.prompt`
      // ⇒ 前者必须以**返回值回写**，后者靠传入同一对象引用自然生效（与原实现等价）。
      const isolationApplied =
        await this.agentTeammateIsolation.applyIsolationAndFork({
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
        try {
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
            // 定义侧裁剪（descriptor 命中来源的 disallowedTools ⇒ 只收窄工具池）
            definitionDisallowedTools: descriptor.disallowedTools ?? [],
            onProgress,
          });
        } catch (err) {
          // M-9c（2026-09-25）：后台**移交失败**兜底 —— 任务注册/调度在挂上 `.then/.catch`
          // 结算回调**之前**抛错（如 `taskRegistry.register` 抛错）时，`runBackgroundPath`
          // 的结算点永不执行，而 `finally` 的释放被 `isBackground` 守卫跳过
          // （见 :1860 注释）⇒ 条目永久 `running`、并发槽位泄漏。
          // `settleRun` 落终态即释放槽位；重复结算为幂等 no-op（claim 闸门）。
          await this.agentLedgerLifecycle.settleRun(agentId, 'failed');
          throw err;
        }
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
        // 定义侧裁剪（descriptor 命中来源的 disallowedTools ⇒ 只收窄工具池）
        definitionDisallowedTools: descriptor.disallowedTools ?? [],
        onProgress,
      });
    } catch (error) {
      await this.agentLedgerLifecycle.settleRun(agentId, 'failed');
      // 设计二：失败路径同样清理 teammate（防泄漏）
      await this.agentTeammateIsolation.unregisterTeammate(agentId);

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      handleError(error, {
        module: 'tools:agentTool',
        action: 'execute',
      });

      this.agentToolPool.emitError(
        onProgress,
        agentId,
        agentInput.name || agentId,
        errorMessage
      );

      return {
        status: ToolExecutionStatus.FAILURE,
        data: null,
        error: errorMessage,
        executionTime: Date.now() - startTime,
        output: '',
        errorOutput: errorMessage,
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
      //
      // M-9b（2026-09-25）：**释放义务按路径归属** —— 后台路径（`run_in_background`）的工具
      // 在 `runBackgroundPath` 返回时即交回，而 run 仍在 `.then/.catch` 里跑；此时释放等于
      // ① 并发槽位提前回收（`liveCount()` 失真，真实在飞数可突破 `maxConcurrentAgents`）
      // ② `release()` 委托的 `settle()` 会把条目**提前写成 `failed` 终态** ⇒ 后台回调按
      // 真实结果结算时被终态幂等拒绝（磁盘行永久 `running`、yield 通知不发）。
      // ⇒ 后台路径的槽位由 `runBackgroundPath` 的结算点（`settleRun`）释放；
      // 该路径的所有退出分支（禁用后台的早返回 / 异常）都必经 `settleRun`，故不会泄漏。
      if (!isBackground) {
        reservation.release();
      }
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
  } /**
   * 并行批次路径（U-22/S1 外移；实现在 `./swarmPath`，行为等价搬迁）。
   */
  private async runSwarmPath(
    params: RunSwarmPathParams
  ): Promise<ToolResult<unknown>> {
    return runSwarmPath(params, this.swarmPathDeps());
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
    /** 定义侧禁用工具（`descriptor.disallowedTools`）；缺省 = 不额外收窄 */
    definitionDisallowedTools?: string[];
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
      definitionDisallowedTools,
      onProgress,
    } = params;

    if (!this.config.allowBackground) {
      logger.warning('Background execution disabled', { agentId });
      // 泄漏修复（2026-08-27）：该分支 return 前清理已注册的 teammate
      await this.agentTeammateIsolation.unregisterTeammate(agentId);
      // 台账泄漏修复（B3）：早期返回必须落终态，否则条目以 'running' 永久占用并发槽位
      await this.agentLedgerLifecycle.settleRun(agentId, 'failed');
      return this.agentLedgerLifecycle.failureResult(
        'Background execution is disabled',
        agentId
      );
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
      canDelegate,
      // 定义侧裁剪（后台路径同前台口径）：与 input.deniedTools 合取，只收窄
      definitionDisallowedTools ?? []
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
        await this.agentLedgerLifecycle.settleRun(
          agentId,
          taskCompleted ? 'completed' : 'failed'
        );
        // 设计二：后台任务完成时才清理 teammate（保留整个后台窗口期的可寻址性）
        await this.agentTeammateIsolation.unregisterTeammate(agentId);
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
        await this.agentLedgerLifecycle.settleRun(agentId, 'failed');
        // 设计二：失败也清理 teammate
        await this.agentTeammateIsolation.unregisterTeammate(agentId);
        // B1/O1-3 / M-5：失败同属结算 ⇒ 通知同样由 `settleRun()` 统一发出
      });

    return {
      status: ToolExecutionStatus.SUCCESS,
      data: `Background agent task started (ID: ${taskId}). Use /agent status ${taskId} to check progress.`,
      error: undefined,
      executionTime: 0,
      output: `Background agent task started (ID: ${taskId})`,
      errorOutput: '',
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
    /** 定义侧禁用工具（`descriptor.disallowedTools`）；缺省 = 不额外收窄 */
    definitionDisallowedTools?: string[];
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
      definitionDisallowedTools,
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
        canDelegate,
        // 定义侧裁剪：与 input.deniedTools 合取，只收窄
        definitionDisallowedTools ?? []
      );
      logger.info('Agent engine execution completed', {
        agentId,
        agentType: effectiveType,
      });
    }

    // 设计二：前台执行路径结束后统一清理 teammate（directCall 与 engine 共用）
    await this.agentTeammateIsolation.unregisterTeammate(agentId);

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
    await this.agentLedgerLifecycle.settleRun(
      agentId,
      result.completed ? 'completed' : 'failed',
      {
        ...(result.attribution ? { attribution: result.attribution } : {}),
      }
    );

    if (result.completed) {
      this.agentToolPool.emitComplete(
        onProgress,
        agentId,
        agentInput.name || agentId,
        'Agent task completed successfully'
      );
    } else {
      this.agentToolPool.emitError(
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
      data: result.result,
      error: result.completed ? undefined : result.error,
      executionTime: Date.now() - startTime,
      output: result.result || '',
      errorOutput: result.completed ? '' : result.error || '',
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

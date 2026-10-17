// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * swarmPath —— 并行批次路径 + worker executor 适配器（AgentTool 拆分批 U-22/S1）
 *
 * **来源**：从 `AgentTool.ts` 外移 `runSwarmPath`（461 行）与 `buildSwarmExecutor`（251 行），
 * 以及两者共用的 `resolveDeniedTools` / `SwarmTaskDescriptor` / `SwarmToolDefinition`。
 *
 * **职责（单一：一批 worker 如何被构造、执行、结算与汇总）**：
 *   ① `buildSwarmExecutor`：per-task 描述符消费（提示词前置/推荐模型/落盘真实类型）、
 *      类别→工具集 memo、空池 fail-closed、逐任务台账开/结
 *   ② `runSwarmPath`：批次控制器登记与父级取消桥接 → `AgentSwarm.run` → 单一派生源汇总
 *      （`deriveParallelEndData`）→ 台账/目标绑定/摘要预算/输出裁剪 → 工具结果
 *
 * **行为等价**：日志文案、事件载荷、fail-closed 分支与 `.catch` 兜底语义**逐字未变**
 * （仅把 `this.` 换成注入的 deps）。日志 module 名仍为 `tools:AgentTool`。
 */

import { randomUUID } from 'crypto';

import { OrchestrationEventType, deriveParallelEndData } from '@modules/agent';
import { resolveModelRoute, RouteKey } from '@modules/ai';
import {
  renderFragment,
  resolveContextWindowAsync,
  type ContextualFragment,
} from '@modules/context';
import { getLogger } from '@modules/monitoring';
import {
  AgentSwarm,
  ensureGoalForBatch,
  enqueueIdleContinuation,
  settleGoalForRun,
  takeBatchGoalInstruction,
  type AgentSwarmResult,
  type SwarmExecutor,
} from '@modules/tasks';
import { getUnifiedTokenTracker } from '@modules/tokenBudget';

import { globalEventBus } from '../../core/events/EventBus.js';
import { getToolCategory } from '../toolCategories';
import type { Tool, ToolCallProgress } from '../types/Tool';
import { ToolExecutionStatus, type ToolResult } from '../types/ToolResult';
import type { ToolUseContext } from '../types/ToolUseContext';
import type { AgentToolProgress } from '../types/ToolProgress';
import { getAgentRunStore } from './AgentRunStore';
import type { AgentLedgerLifecycle } from './agentLedgerLifecycle';
import type { AgentToolPool } from './agentToolPool';
import type { SubAgentEngine } from './SubAgentEngine';
import { registerBatchAbort, unregisterBatchAbort } from './swarmBatchRegistry';
import {
  computeSummaryCharBudget,
  trimSummaryWithFooter,
  SUMMARY_MIN_CHARS,
} from './summaryTrim';
import type { AgentInput, AgentType, SubTask } from './types';

const logger = getLogger('tools:AgentTool');

/**
 * O12-1：swarm 单个子任务的描述符解析结果。
 *
 * `error` 与 `systemPrompt` 互斥：解析失败 ⇒ 该任务 fail-closed（不执行）。
 */
export interface SwarmTaskDescriptor {
  systemPrompt?: string;
  model?: string;
  source?: string;
  /**
   * 定义侧禁用项（D-48 接线）：该任务角色声明的 `disallowedTools`。
   * 与批次级 `deniedTools` 合取后**只收窄**该 worker 的工具集（白名单顺序不变）。
   */
  disallowedTools?: string[];
  error?: string;
}

/** O12-2：注入引擎的工具定义（OpenAI 兼容形状） */
export interface SwarmToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * 合并两路黑名单：调用侧 `deniedTools` + 定义侧 `disallowedTools`
 * （如 verification 的 `['agent','notebook']`）。
 *
 * **只收窄语义**：结果仅用作 `filterToolPool` 的**黑名单**（且在 `allowedTools` 白名单
 * **之后**生效）——既不新增白名单、也不改写白/黑顺序 ⇒ 不可能因此拿到原本不可用的工具。
 * 顺序：先 input 后 definition（重复项保留原样，过滤侧按集合判定）。
 */
export function resolveDeniedTools(
  inputDenied: string[] | undefined,
  definitionDisallowed: string[] | undefined
): string[] {
  return [...(inputDenied ?? []), ...(definitionDisallowed ?? [])];
}

export interface SwarmPathDeps {
  /** 工具名（写入 `ToolResult.toolName`） */
  toolName: string;
  /** 台账/结算/血缘簇 */
  agentLedgerLifecycle: AgentLedgerLifecycle;
  /** 工具池/授权/定义簇 */
  agentToolPool: AgentToolPool;
  /** 子代理引擎（worker 执行） */
  engine: SubAgentEngine;
  /** 父级可继承工具池（O12-2 类别过滤的基准） */
  getInheritableToolPool: () => Tool[];
  /** per-task 描述符解析（宿主保留四级回退链） */
  resolveSwarmTaskDescriptors: (
    tasks: Array<{ id: string; agentType?: string }>
  ) => Promise<Map<string, SwarmTaskDescriptor>>;
}

export interface BuildSwarmExecutorOptions {
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
export function buildSwarmExecutor(
  options: BuildSwarmExecutorOptions,
  deps: SwarmPathDeps
): SwarmExecutor {
  const {
    signal,
    model,
    batchId,
    context,
    allowedTools,
    deniedTools,
    taskDescriptors,
  } = options;
  const inheritablePool = deps.getInheritableToolPool();
  /** O12-2：按"类别清单"memo 的工具集（同批次多个 worker 共用一份，避免重复实例化） */
  const toolsetCache = new Map<
    string,
    { definitions: SwarmToolDefinition[]; instances: Map<string, Tool> }
  >();

  const resolveWorkerToolset = (
    categories: string[],
    taskDisallowedTools?: string[]
  ): { definitions: SwarmToolDefinition[]; instances: Map<string, Tool> } => {
    // D-48（2026-09-30）：**定义侧 disallowedTools 已接线** —— 与批次级 `deniedTools`
    // 合取（只收窄；白名单仍先于黑名单、位置参数不变）。取到的是**该任务自己的**禁用项
    //（调用点在 per-task 闭包内，`resolved` 已就绪）⇒ 无"共享池"歧义。
    const effectiveDeniedTools = resolveDeniedTools(
      deniedTools,
      taskDisallowedTools
    );
    // memo 键**必须**含生效黑名单：否则"同类别、不同定义侧禁用项"的两个 worker 会复用
    // 同一份工具集 ⇒ 后者的禁用项被前者的缓存吞掉（静默失效）。
    const cacheKey = `${[...categories].sort().join('|')}::${[
      ...effectiveDeniedTools,
    ]
      .sort()
      .join(',')}`;
    const cached = toolsetCache.get(cacheKey);
    if (cached) return cached;
    const allowedCategories = new Set(categories);
    const categoryPool = inheritablePool.filter((tool) =>
      allowedCategories.has(getToolCategory(tool.name))
    );
    const entry = {
      definitions: deps.agentToolPool
        .buildToolDefinitions(allowedTools, effectiveDeniedTools, categoryPool)
        .map((t) => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
      instances: new Map(
        deps.agentToolPool
          .filterToolPool(allowedTools, effectiveDeniedTools, categoryPool)
          .map((t) => [t.name, t])
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
        await getAgentRunStore().settleRun(`${batchId}::${taskKey}`, 'failed', {
          error: resolved.error,
        });
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
      ? // D-48：把**该任务**的定义侧禁用项传给工具集构造（`resolved` 已按 taskKey 取到）
        resolveWorkerToolset(
          declaredCategories ?? [],
          resolved?.disallowedTools
        )
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
        await getAgentRunStore().settleRun(`${batchId}::${taskKey}`, 'failed', {
          error: emptyPoolReason,
        });
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

    const result = await deps.engine.execute({
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
      // 接线期③ ③-A：该 worker **被指派的类型**（未声明 ⇒ 无分配边，不臆测为 'general'）
      assignedRole: agentType,
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
      // 接线期③ ③-A：worker 未完成时把**失败归因**（图快照 + 根因候选）一并落盘
      await getAgentRunStore().settleRun(
        `${batchId}::${taskKey}`,
        result.completed ? 'completed' : 'failed',
        {
          ...(result.attribution ? { attribution: result.attribution } : {}),
        }
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

export interface RunSwarmPathParams {
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
}

/**
 * 并行批次路径（O5 seam `executeDispatch`）。
 *
 * 行为中性迁移：判定、日志、事件（PARALLEL_START/END）、汇总格式、结算与返回结构
 * 与原内联实现逐一保留；`tasks` 由调用方保证非空（等价于原 `if (tasks?.length > 0)`）。
 */
export async function runSwarmPath(
  params: RunSwarmPathParams,
  deps: SwarmPathDeps
): Promise<ToolResult<unknown>> {
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

  // X11（2026-10-05，.trae/specs/goal-entity.md §11.1）：**仅 swarm 批次路径**在启动时
  // 尝试为目标（`task_goals`）自动建行 —— 该会话无未终结目标才建；direct / foreground /
  // background 路径不建（避免"用户随口一问就产生目标"）。
  // objective 来源：`agentInput.description` → `tasks[].description` 拼接（≤200 字）→ 占位。
  let objective = agentInput.description.trim();
  if (!objective) {
    objective = tasks
      .map((t) => t.description.trim())
      .filter((d) => d.length > 0)
      .join('；')
      .slice(0, 200);
  }
  if (!objective) objective = '(swarm batch)';
  const createdGoal = await ensureGoalForBatch({
    sessionId: context?.sessionId,
    objective,
  });
  logger.info('swarm 批次目标自动创建检查完成', {
    hasSession: Boolean(context?.sessionId),
    created: createdGoal !== null,
    goalId: createdGoal?.id ?? null,
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
    const taskDescriptors = await deps.resolveSwarmTaskDescriptors(swarmTasks);
    swarmResult = await new AgentSwarm().run({
      tasks: swarmTasks,
      goal: agentInput.goal || agentInput.description,
      // 缺陷 4（2026-09-22）：透传准入预留量 ⇒ 真实在飞 worker ≤ `maxConcurrentAgents`。
      // 该值同时驱动 worker 批次与 verifier 门禁批次（`AgentSwarm` 内共用同一 `concurrency`）。
      maxConcurrency,
      executor: buildSwarmExecutor(
        {
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
        },
        deps
      ),
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
  // P1-11（2026-09-25）：三个量改由 `deriveParallelEndData` **单一派生** ——
  // 事件载荷与下方归因文案共用同一次派生；修复前事件只发"投递缺口"、不发"取消事实"。
  // ⚠ 语义钉死：`cancelledTasks` = **投递缺口**（未投递数），**不等于取消事实**（`cancelledFact`）。
  const pe = deriveParallelEndData({
    totalTasks: tasks.length,
    succeededTasks: okCount,
    deliveredTasks: workers.length,
    // 取消**事实**（取 `AgentSwarm` 的终态快照，不在此重读 `signal.aborted`）。
    cancelledFact: swarmResult.cancelled === true,
  });
  const cancelledCount = pe.cancelledTasks;
  // 2026-09-22 修复（Liri v1.4 复审 D1/D2）：先前只派生 `cancelledCount` ⇒ 取消发生在
  // **门禁/合成等收尾阶段**时任务已全部投递、缺口为 0 ⇒ 对外口径**完全看不到"批次被取消"**，
  // 控制面无法区分"3/3 成功后被取消"与"3/3 成功正常结束"。二者必须并列派生、禁止互相替代。
  const cancelledFact = pe.cancelledFact;
  const failedCount = pe.failedTasks;
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

  // P1-11（2026-09-25）：载荷直接复用同一次派生（含 `cancelledFact`）——
  // 修复前只发 `cancelledTasks`（投递缺口）⇒ 消费端读不到取消事实。
  globalEventBus.publish(OrchestrationEventType.PARALLEL_END, pe);

  await deps.agentLedgerLifecycle.settleRun(
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
    const spillPath = await deps.agentLedgerLifecycle.spillSummaryToDisk({
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

  deps.agentToolPool.emitComplete(
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
    // B2-c（2026-09-30）：载荷字段由 `result` 迁至 `data`（对齐主契约与校验器口径）
    data: finalOutput,
    error: resultError,
    executionTime: Date.now() - startTime,
    output: finalOutput,
    errorOutput: resultError ?? '',
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
    toolName: deps.toolName,
    timestamp: Date.now(),
  };
}

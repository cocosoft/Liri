/**
 * ReActToolLoop — ToolLoopRunner 的 ReActLoop 骨架适配器（M1 细化版）
 *
 * P1-3 迁移：把 ToolLoopRunner 的 while(currentToolCalls.length > 0) 手写循环
 * 收敛到 ReActLoop 统一骨架。
 *
 * M1 细化 6 项（对照双跑一致性报告 §3.2）：
 *  1. 残缺工具调用重试（reason 流式路径：尾部残缺标签检测 + 重试一次）
 *  2. 交互恢复（act：requiresUserInteraction 工具 → pendingInteractions 等待答案）
 *  3. 周期性检查点（beforeReasoning：每 5 轮 saveCheckpointWithData）
 *  4. 循环检测（act：loopDetector.detect critical → 中止循环）
 *  5. 心跳进度数据（子类维护 completedToolNames/totalCompletedToolCount，供转换层聚合）
 *  6. maxTurns 提示文案（finalize：达 maxIterations 时附加提示）
 *
 * M1 致命缺口补齐（B0(M0) 对齐评审，2026-08-13）——对齐旧 ToolLoopRunner 状态机：
 *  A. 首轮 currentToolCalls 直接执行（流式主路径 LLM 已产出 tool_calls，禁止重复调 LLM）
 *  B. 工具结果消息落盘（createToolResultMessage + addAndPersistMessage）
 *  C. 下一轮消息回填（buildToolRoundMessages）+ 轮次推进（nextRound）+ unifiedTracker
 *  D. LLM 结果：stripBareExploration 清洗 + tool_calls metadata + 助手消息落盘 + recordTurn
 *  E. 流式 LLM：完整清洗链（think 标签/图片修复/scrubber/orphan 标签）+ onStream + usage 上报
 *  F. 非流式 LLM：tools 参数透传（toolDefinitions）
 *  G. 流式检查点（streamingCheckpoint.onToolCompleted）+ completedToolCallIds 维护
 */

import { ReActLoop, EXTERNAL_FETCH_TOOLS } from '@modules/query';
// 二期 F2-1（2026-09-23 修复计划 §六）：终止原因类型（单一来源 = ReActLoop 判别器）
import type { TerminationReason } from '@modules/query';
import { createErrorRecoveryManager } from '@modules/query';
import { createPathGuard } from '@modules/query';
import type {
  ReActLoopConfig,
  BudgetControllerLike,
  ReasonResult,
  ActResult,
  ToolCallEntry,
  ToolResultEntry,
  ReActEvent,
} from '@modules/query';
import type { ToolLoopContext, ToolLoopInput } from './ToolLoopRunner.js';
import {
  DYNAMIC_TURNS_PER_PENDING_TODO,
  EXTERNAL_FETCH_EXPANSION_TURNS,
  MAX_DYNAMIC_TOOL_TURNS_CAP,
} from './loopTurnLimits.js';
import type { ToolCall, ToolResult } from './types/tool.js';
import type { ChatResponse, ChatMessage } from '@modules/ai';
import type { Message } from './types/message.js';
import { getToolCallName } from './types/tool.js';
import { getLogger } from '@modules/monitoring';
import {
  enterPhase,
  exitPhase,
} from '@modules/diagnostics/loopProbe/phaseStack';
// B3-2（2026-09-23）：注入片段统一类型 —— 通道前缀由类型给出（唯一渲染入口 renderFragment）
import {
  createFragment,
  renderFragment,
} from '@modules/context/fragments/ContextualFragment';
import { registerYieldFromResults } from '../session/yield';
// M-7（2026-09-22）：续接指令文案**单一来源**（原为本文件内 4 个硬编码常量，逐字迁移）
import { CONTINUATION_TEMPLATES } from '../tasks/goal/goalTemplates';
// P1-2 / P1-4（B2-4，2026-09-23）：轮级熔断 / 压缩停滞 ⇒ **落 Goal**（目标层可见"为何停下"）。
// 注意：`tasks/` 不是 `chat/`，此处不构成"反向层依赖"（与 goalTemplates 同向）。
import {
  settleGoalForTurn,
  type GoalTurnReason,
} from '../tasks/goal/goalRunBinding';
// X8（2026-09-23，Spec §5.5）：主会话预算触顶 ⇒ 下一轮请求前经 steering 注入收尾指令
import { injectMainSessionBudgetWrapUp } from '../tasks/goal/goalBudget';
import { prepareToolResultsForContext } from '@modules/tools';
import {
  ensureThinkResponseTags,
  stripThinkResponseTags,
  stripOrphanToolTags,
  truncateApiMessages,
  sanitizeApiMessages,
} from './services/MessageContextPipeline';
import { StreamingToolCallScrubber } from '../streaming/scrubbers/StreamingToolCallScrubber';
import { StreamingThinkScrubber } from '../streaming/scrubbers/StreamingThinkScrubber';
import { stripBareExploration } from './services/bareExplorationStripper';
import { repairImageUrls, extractTodoData } from './services/ChatHelper';
import type { TodoBlockData } from '@modules/runtime/api/todo-types';
import type {
  QuestionData,
  QuestionOption,
} from '@modules/runtime/api/CoreAPI.js';
import { trackUsage } from '@modules/ai';
import {
  shouldAsk as decisionGateCheck,
  type GateTier,
} from './services/DecisionGate';
import {
  loadNegotiationState,
  createNegotiationState,
  addPendingQuestion,
  recordAnswer,
  type NegotiationState,
} from './services/NegotiationState';
// 工具轮内上下文压缩（2026-08-23）：复用主流程压缩策略/编排器，
// 防止长工具会话消息膨胀导致 LLM 请求超限（deepseek 1M 窗口请求 1.78M 实测）
import { compactionOrchestrator } from '@modules/context';
// 内存画像（2026-09-02 排查"会话中断/内存尖峰"用，MEM_PROFILE=1 才采样）
import { memProfile } from '../monitoring/memProfile.js';
// 内存水位（2026-09-02，OS kswapd 式；见 dev_docs/内存水位触发机制-详细设计）
import { getMemoryPressureMonitor } from '../monitoring/memoryPressure/MemoryPressureMonitor.js';

const logger = getLogger('chat:reactToolLoop');

/** 残缺工具调用检测：LLM 输出尾部残留未闭合的标签 */
const TRUNCATED_TAG_RE =
  /<\/?(?:parameter|invoke|tool_call|tool_calls)\b[^>]*>\s*$/i;

/**
 * 分层窗口压缩最小间隔（2026-09-02）：同一轮压缩后若仍超窗口，避免每轮重复
 * 触发 snip 抖动——间隔内只评估不压缩，靠既有 truncate/PAIR-GUARD 兜底。
 */
const LAYER_COMPACT_MIN_INTERVAL_MS = 30_000;

/** 不完整回合重试指令（对标 openclaw incomplete-turn.ts:172-179，2026-09-01） */
const EMPTY_RESPONSE_RETRY_INSTRUCTION = CONTINUATION_TEMPLATES.empty;
const REASONING_ONLY_RETRY_INSTRUCTION = CONTINUATION_TEMPLATES.reasoning;
const PLANNING_ONLY_RETRY_INSTRUCTION = CONTINUATION_TEMPLATES.planning;
/** 输出被 max_tokens 截断的续接指令（2026-09-03）：不再重复已输出内容/思考，直接续完被截断的部分 */
const TRUNCATED_RESPONSE_RETRY_INSTRUCTION = CONTINUATION_TEMPLATES.truncated;
/** planning-only 启发式判定：纯计划陈述模式（保守，避免误判正常回答） */
const PLANNING_ONLY_RE =
  /(?:以下(?:是)?(?:我(?:的)?)?(?:执行)?计划|我的计划(?:如下|是)|\bplan(?:\s*:|\s+is|\s+to)\b|步骤\s*[:：]|接下来(?:我)?(?:将|会))/i;

/** 延时工具（v3：交互心跳轮询用；文件此前无定义，直接使用会编译报错） */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 一期 F1-2（2026-09-23 修复计划）："provider 未报结束原因"的统一哨兵值。
 *
 * 此前同一事实在三个位置有不同取值（诊断日志 `?? 'unknown'`、助手消息落库
 * `|| 'stop'`），噪声污染可观测性；现收敛为单一取值。取 `'unknown'` 而非 `'stop'`
 * ——后者会把"未知"谎报为"正常结束"（与 AB-3 既有修复方向一致）。
 */
const UNKNOWN_FINISH_REASON = 'unknown';

/**
 * 一期 F1-1（2026-09-23 修复计划）："未返回任何可见信息即终止"的兜底文案。
 *
 * 系统生成的**事实性提示**（非模型产出，CS04）：只陈述"本轮无可见回复"这一事实，
 * 不臆断具体成因（输出被截断 / 空回复重试耗尽 / 压缩失败均可能），并给出可操作建议。
 */
const EMPTY_OUTPUT_FALLBACK_TEXT =
  '\n\n⚠️ 本次未能生成回复（模型本轮未产出可见内容，可能因输出被截断或空回复重试已达上限）。请重发消息或换个问法重试。';

/**
 * 安全序列化（遗漏 3，2026-08-14 复查）：
 * ToolResult.result 类型为 unknown，工具可返回任意结构；循环引用/BigInt 会抛
 * TypeError → ReActLoop.run() 外层 catch 中断整轮剩余工具执行。失败降级为空串。
 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch (err) {
    // 序列化失败（循环引用/BigInt 等异常结构）：降级空串，记录来源便于排查
    logger.warn('reactToolLoop:safeStringify failed', {
      error: String(err),
      valueType: typeof value,
    });
    return '';
  }
}

/** P2-3（2026-09-02）：工具调用参数归一化——键排序 + 字符串化（截断防超长 key） */
function _toolCallArgsKey(args: Record<string, unknown>): string {
  try {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(args ?? {}).sort()) {
      const v = (args as Record<string, unknown>)[k];
      sorted[k] =
        v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
    const json = JSON.stringify(sorted);
    return json.length > 200 ? json.slice(0, 200) : json;
  } catch {
    return '';
  }
}

/** M1 子类自持的跨轮状态 */
interface ReActToolLoopState {
  messages: Record<string, unknown>[];
  assistantMessage: Message | null;
  toolTurnCount: number;
  llmCallCount: number;
  completedToolNames: string[];
  totalCompletedToolCount: number;
  completedToolCallIds: string[];
  loopDetected: { detector: string; message: string } | null;
  /** 工具结果携带的 todo 数据（供转换层产出 todo chunk，对齐旧类 extractTodoData） */
  pendingTodos: TodoBlockData[];
  /** 达上限收尾总结（对标 hermes 2026-09-01：onMaxIterations 不带 tools 总结请求的结果，finalize 使用） */
  maxIterationsSummary?: string;
  /** P10（2026-09-01）：本轮循环是否涉及外部获取/技能探索（web_fetch/web_search/skill_view 等）——
   *  用于无 todo 时的动态轮次扩容（此类任务需要多轮尝试）。 */
  hasExternalFetchActivity?: boolean;
  /** R2（2026-09-16）：工具轮内压缩连续 no_effect 次数——达到阈值后在低用量时稳态跳过，避免每轮白跑重 token */
  consecutiveCompactNoEffect: number;
  /**
   * 最近一次实测的上下文占用比（2026-09-22，"压缩失败暂停续接"判据）。
   *
   * 事实来源：`unifiedTracker.checkBeforeRequest()` 的 `snapshot.ratio`（每轮发送前实测）。
   * 与 `consecutiveCompactNoEffect` 组合可区分"压不动**且**吃紧"与"低占用会话"。
   */
  lastCompactRatio?: number;
}

/** M3-T3.2：并发批次项——isConcurrencySafe 工具执行延迟到 flush（Promise.all） */
interface ParallelBatchItem {
  tc: ToolCallEntry;
  progressEvents: number[];
  run: () => Promise<ToolResult>;
  remainingToolCalls: Array<{
    id: string;
    name: string;
    arguments: unknown;
  }>;
}

export class ReActToolLoop extends ReActLoop<
  ToolLoopInput,
  ToolLoopContext,
  Message
> {
  private ctx: ToolLoopContext;
  private input: ToolLoopInput;

  private loopState: ReActToolLoopState;

  /**
   * P3-6（2026-09-02）：文件产出循环检测（根治"换文件名反复写相似文件"死循环）。
   * 记录会话内已写入文件（path + 内容骨架），配合 FILE_WRITE_LOOP_THRESHOLD 判定。
   */
  private readonly writtenFiles: Array<{ path: string; contentHead: string }> =
    [];
  /** 文件产出循环已注入 steering（每会话仅 1 次，避免反复打扰） */
  private fileWriteLoopPrompted = false;

  /** P1-2（2026-08-26）：LLM 调用错误恢复判定（复用 TAOR 的 errorRecovery，CS01） */
  private readonly _llmRecovery = createErrorRecoveryManager();

  /** P1-3（2026-08-23）：当前工具轮 assistant 消息 id——工具轮入口（首次 _streamLlm 前）预分配，
   *  chunk 事件写入与 createAssistantMessage 复用（N4/A3） */
  private _activeToolRoundMessageId = '';
  /** 分层窗口压缩最近触发时间（2026-09-02，防抖用，见 LAYER_COMPACT_MIN_INTERVAL_MS） */
  private _lastLayerCompactAt = 0;
  /** 本轮 reason 是否产出 thinking（reasoning-only 检测，对标 openclaw 2026-09-01） */
  private _lastRoundHadThinking = false;
  /** 不完整回合重试计数（每类上限 1 次，防死循环，对标 openclaw RETRY_LIMITS） */
  private readonly _incompleteRetries = {
    empty: 0,
    reasoning: 0,
    planning: 0,
    truncated: 0,
  };
  /**
   * 二期 F2-0/F2-2（2026-09-23 修复计划 §六）：本轮因**外部拦停**（超时）而未执行的
   * tool_calls 数量（0 = 无）。
   *
   * 用途：把"这批调用已被丢弃"**显式告知**（结构化日志 + 收尾文案），修复
   * "`shouldContinue` 说停、`onIncompleteTurn` 又因'有工具调用'拒收 ⇒ 无人认领、
   * 静默消失"这一**两侧判据相反**的缺陷。
   */
  private droppedToolCallsAtStop = 0;
  /**
   * 二期 F2-3（2026-09-23 修复计划 §六）：终止副作用（落 Goal）**幂等守卫**。
   *
   * `finalize()` 每轮至少被调用 2 次（`run()` 的 return 值 + `getAssistantMessage()`）
   * ⇒ 守卫从"防御性"变为"必要性"（N1）。
   */
  private _terminalSettled = false;
  /**
   * 二期 F3-1（2026-09-23 修复计划 §六）：终止副作用（落 Goal）的 **pending promise**。
   *
   * 由 `settleTerminalState()` 记录、由 `flushTerminalSettlement()` 在轮次边界 await
   * ⇒ 落盘失败可被观测/断言（治 N4：原为 fire-and-forget，调用方无法感知）。
   */
  private _terminalSettle: Promise<void> | null = null;
  /** 截断续接重试的 maxTokens 放大标记（2026-09-03）：onIncompleteTurn truncated 分支置位，
   *  下一轮 reason 的 LLM 调用把输出预算放大到 base×4（封顶 64K），避免"重试仍被截断"空转。 */
  private _boostNextReasonMaxTokens = false;
  /** L2（2026-09-06）：PathGuard 越界路径防护（对齐 batch 三守卫；仅 deny 列表命中才拦截） */
  private readonly pathGuard = createPathGuard();

  /** v3：交互心跳间隔（前端 STREAM_IDLE_TIMEOUT_MS=60s，10s 留 5 次余量）+ 最大等待（防资源泄漏） */
  private static readonly INTERACTION_HEARTBEAT_MS = 10_000;
  private static readonly INTERACTION_MAX_WAIT_MS = 10 * 60_000;
  /** P3-6（2026-09-02）：文件产出循环判定阈值——同内容骨架文件 ≥3 个即视为重复产出循环 */
  private static readonly FILE_WRITE_LOOP_THRESHOLD = 3;
  /** P3-6：内容骨架长度（取内容前 N 字符比较，覆盖 HTML/文档模板开头一致性） */
  private static readonly FILE_CONTENT_HEAD_LENGTH = 200;
  /** BUG-05（2026-09-16）：重读收敛阈值——同一资源（文件/搜索 pattern）被非连续重读数次即注入强制收尾 steering */
  private static readonly READ_REEXPLORE_STEER_THRESHOLD = 5;
  /** R2（2026-09-16）：压缩稳态豁免比例——上下文占用低于模型窗口该比例（0.6）视为"容量充足" */
  private static readonly COMPACT_STEADY_RATIO = 0.6;
  /** R2：压缩连续 no_effect 达到该次数后，才允许在低占用时稳态跳过本轮压缩 */
  private static readonly COMPACT_NO_EFFECT_SKIP_THRESHOLD = 2;
  /** R2（2026-09-16）：路径①分层窗口压缩的退避封顶——30s 基础间隔按 no_effect 次数指数增长，
   *  上限 5min，防止"每次触发都白跑 + 无退避"导致 CPU 高频空转 */
  private static readonly LAYER_COMPACT_BACKOFF_CAP_MS = 5 * 60 * 1000;
  /** R4（2026-09-16）：任务硬收敛窗口——距工具轮次上限还剩该轮数时，注入强制收尾 steering（软收敛非硬熔断） */
  private static readonly CONVERGE_WINDOW = 5;
  /** 观察点修复（2026-08-26）：会话级总时长上限（默认 3 小时，env 可覆盖） */
  private static readonly MAX_TOTAL_DURATION_MS =
    Number(process.env.REACT_LOOP_MAX_DURATION_MS) || 3 * 60 * 60 * 1000;
  /** 动态工具轮次上限（2026-09-01：长程任务卡壳治理，对标 PDCA max(20, steps*5)）
   *  常量统一来自 loopTurnLimits（调用方分级单一事实来源）：
   *  基础阈值 ctx.maxToolTurns（默认 30，env MAX_TOOL_TURNS/MAX_TAOR_TURNS 可覆盖）；
   *  每 1 个未完成 todo task 扩容 DYNAMIC_TURNS_PER_PENDING_TODO 轮，硬顶 MAX_DYNAMIC_TOOL_TURNS_CAP。
   *  长任务（有 todo 清单）自动获得更多轮次，简单对话（无 todo）保持基础阈值。 */
  /** 会话开始时间（总时长上限检查用） */
  private readonly startedAt = Date.now();
  /** P2-3（2026-09-02）：同工具同参数重复调用纠偏——记录上一轮工具调用 key（工具名+归一化参数） */
  private _lastToolCallKeys: string[] | null = null;
  /** BUG-05（2026-09-16）：重读收敛——被重读/重搜资源 → 累计次数（键 = 工具名:资源） */
  private readReExploreCounts = new Map<string, number>();
  /** BUG-05：是否已注入一次"重读收敛" steering（避免重复刷屏） */
  private readReExploreSteered = false;
  /** R4（2026-09-16）：任务硬收敛——是否已注入强制收尾 steering（每会话仅 1 次，避免反复打扰） */
  private convergeSteeringPrompted = false;
  /** 动态上限固定基础值（构造时确定，env MAX_TOOL_TURNS/MAX_TAOR_TURNS 覆盖），
   *  动态扩容基于此值而非已扩容值，避免每轮重复叠加 */
  private readonly baseMaxToolTurns: number;
  /** 实例级可配置（测试缩短心跳间隔用），默认取 static 常量 */
  private heartbeatMs: number;
  private maxWaitMs: number;
  /** 候选 C（2026-09-05）：本次等待是否因超时结束（timeout 保留 entry 宽限） */
  private _interactionTimedOut: boolean = false;
  /** DecisionGate 门控强度（undefined 表示门控未启用，对齐设计方案 §5.1） */
  private gateTier?: GateTier;
  /** 协商状态（跨消息持久化，null 表示未启用协商引擎） */
  private negotiationState: NegotiationState | null = null;

  constructor(
    ctx: ToolLoopContext,
    input: ToolLoopInput,
    config?: Partial<ReActLoopConfig> & {
      interactionHeartbeatMs?: number;
      interactionMaxWaitMs?: number;
      gateTier?: GateTier;
    }
  ) {
    super({
      maxIterations: ctx.maxToolTurns,
      abortSignal: ctx.abortSignal,
      ...config,
    });
    this.ctx = ctx;
    this.input = input;
    // 固定基础值：config 展开可能覆盖 maxIterations，取最终生效值
    this.baseMaxToolTurns = this.config.maxIterations;
    this.heartbeatMs =
      config?.interactionHeartbeatMs ?? ReActToolLoop.INTERACTION_HEARTBEAT_MS;
    this.maxWaitMs =
      config?.interactionMaxWaitMs ?? ReActToolLoop.INTERACTION_MAX_WAIT_MS;
    this.gateTier = config?.gateTier;
    // 加载或创建协商状态（跨消息持久化恢复）
    this.negotiationState = loadNegotiationState(ctx.session.id);
    if (!this.negotiationState) {
      this.negotiationState = createNegotiationState(ctx.session.id, {
        tier: this.gateTier,
      });
    }
    this.loopState = {
      messages: [...input.apiMessages],
      assistantMessage: input.assistantMessage ?? null,
      toolTurnCount: 0,
      llmCallCount: 0,
      completedToolNames: [],
      totalCompletedToolCount: 0,
      completedToolCallIds: [],
      loopDetected: null,
      pendingTodos: [],
      /** R2（2026-09-16）：工具轮内压缩连续 no_effect 次数——达到阈值后在低用量时稳态跳过，避免每轮白跑重 token */
      consecutiveCompactNoEffect: 0,
    };
  }

  /** 8.4③（2026-09-16，治缺陷 2/3）：履约 resetRunState() 契约 + 恢复基础轮次上限。
   * 复用实例（如 batch 缓存）时避免跨 run 状态污染与扩容值残留。 */
  override async *run(
    input: ToolLoopInput
  ): AsyncGenerator<ReActEvent, Message> {
    this.resetRunState();
    this.config.maxIterations = this.baseMaxToolTurns;
    return yield* super.run(input);
  }

  // ─── 骨架 hooks：检查点 + 循环检测（reason 前） ────────

  protected override async beforeReasoning(): Promise<void> {
    // P11（2026-09-01）：新对话轮次（用户新消息）首轮清理旧任务残留——
    // 旧任务的 [STEERING] 求助指令 + 探索类工具结果会污染上下文，导致模型无视
    // 用户最新消息、继续旧任务（实测 seq 1247-1248 模型明确纠结后仍陷旧任务）。
    if (this.loopState.toolTurnCount === 0) {
      this._sanitizeForNewTask();
    }

    // 动态上限（2026-09-01）：任务越复杂（未完成 todo 越多），轮次上限越高，
    // 避免长程任务在基础阈值（默认 30 轮）被误杀截断。仅扩容不缩容，硬顶 500。
    const dynamicMax = this._resolveDynamicMaxIterations();
    if (dynamicMax > this.config.maxIterations) {
      logger.info('reactToolLoop:dynamic_max_turns_expanded', {
        sessionId: this.ctx.session.id,
        base: this.config.maxIterations,
        expanded: dynamicMax,
        toolTurn: this.loopState.toolTurnCount,
      });
      this.config.maxIterations = dynamicMax;
    }

    // R4（2026-09-16）：任务硬收敛——工具轮次距上限还剩 CONVERGE_WINDOW 轮时，注入强制
    // 收尾 steering。软收敛（非硬熔断多轮）：提示模型停止新探索、基于已掌握信息产出最终
    // 结论，避免长任务空转到被 max_tokens 截断才终止（截断常致输出被裁、任务半途而废）。
    // 锚定当前生效上限（动态扩容后），每会话仅注入 1 次。
    if (
      !this.convergeSteeringPrompted &&
      this.config.maxIterations > 0 &&
      this.loopState.toolTurnCount >=
        this.config.maxIterations - ReActToolLoop.CONVERGE_WINDOW
    ) {
      this.convergeSteeringPrompted = true;
      this.steeringQueue.push(
        `⚠️ 你已接近本轮任务的最大工具轮次限制（当前 ${this.loopState.toolTurnCount} / 上限 ${this.config.maxIterations}），` +
          '剩余轮次不足，请停止新的探索/搜索。现在请直接基于已掌握的信息输出最终完整结论；' +
          '若部分关键数据确实缺失，请明确列出缺失项而非继续尝试获取，以便我后续补充。'
      );
      logger.warn('reactToolLoop:converge_steering_injected', {
        sessionId: this.ctx.session.id,
        toolTurn: this.loopState.toolTurnCount,
        maxIterations: this.config.maxIterations,
      });
    }

    // 3. 周期性检查点：每 5 轮保存（失败不阻塞，对齐旧类 _savePeriodicCheckpoint）
    if (
      this.loopState.toolTurnCount > 0 &&
      this.loopState.toolTurnCount % 5 === 0
    ) {
      try {
        const { session } = this.ctx;
        await this.ctx.checkpointService.saveCheckpointWithData(
          session.id,
          session.messages,
          session.metadata,
          session.state,
          `auto-round-${this.loopState.toolTurnCount}`,
          `工具执行第 ${this.loopState.toolTurnCount} 轮自动检查点`,
          true,
          this.ctx.estimateMessagesTokens(
            session.messages as unknown as Record<string, unknown>[]
          )
        );
      } catch {
        // 检查点保存失败不影响执行（@ignore-catch）
      }
    }

    // 4. 工具轮内上下文保护（2026-08-23 修复）：
    //    消息随工具轮累积膨胀（LLM 回复 + 工具结果逐轮回填），而主流程压缩只在
    //    streamMessageFlow 首轮评估一次，工具轮内不再评估 → 长工具会话请求超限
    //    （实测 deepseek-v4-flash 1M 窗口请求 1.78M，OpenAI stream error 400）。
    //    每轮 reason 前对齐主流程：① 评估 → 超限压缩 loopState.messages（本轮 LLM 输入）
    //    ② 发送前兜底截断（压缩不足/未触发时丢弃旧消息，确保输入 ≤ 窗口 - 输出预留）。
    try {
      const { session } = this.ctx;
      const model = (this.ctx.options?.model as string | undefined) ?? '';
      // 分层窗口压缩触发（2026-09-02，C 单轮长任务残留风险收口）：
      // 工具轮内压缩原按模型 ctx 触发（deepseek-v4-flash 1M → ~60-75% ≈ 600-750K），
      // 单轮长任务（无 user 边界、computePaginationPoint 禁止头部切窗）在该点之前
      // 上下文/构建分配已很大。此处估算超 REACT_LAYER_WINDOW_TOKENS（默认 45K，
      // 设 0 关闭）时提前对旧轮做分层压缩（Tier2 snip + 既有后台摘要链兜底），
      // 把单请求封顶在 ~45K 附近，降低重复构建/分配对 RSS 与 GC STW 的压力。
      const baseWindow = Number(
        process.env.REACT_LAYER_WINDOW_TOKENS ?? '45000'
      );
      // 内存水位 tick（工具轮边界驱动；零日志除非级别变化）
      getMemoryPressureMonitor().tick();
      // 压力（L1+）下收紧分层窗口（缩小工作集，OS kswapd 式提前收缩）
      const layerWindowTokens =
        baseWindow > 0
          ? getMemoryPressureMonitor().effectiveLayerWindow(baseWindow)
          : 0;
      // R2（2026-09-16）：路径①分层窗口压缩也接入 consecutiveCompactNoEffect 退避——
      // 基础 30s 间隔按 no_effect 次数指数（2^n，n 封顶 4）递增，上限 LAYER_COMPACT_BACKOFF_CAP，
      // 避免"context 恒超窗口 → 每 30s 必触 + 无退避"的高频空转白跑（no_effect 计数见 L467-479）。
      const layerNoEffect = this.loopState.consecutiveCompactNoEffect ?? 0;
      const layerMinIntervalMs = Math.min(
        LAYER_COMPACT_MIN_INTERVAL_MS * (1 << Math.min(layerNoEffect, 4)),
        ReActToolLoop.LAYER_COMPACT_BACKOFF_CAP_MS
      );
      if (
        layerWindowTokens > 0 &&
        this.loopState.messages.length > 0 &&
        Date.now() - this._lastLayerCompactAt > layerMinIntervalMs
      ) {
        const estLayer = this.ctx.estimateMessagesTokens(
          this.loopState.messages as unknown as Record<string, unknown>[]
        );
        if (estLayer > layerWindowTokens) {
          this._lastLayerCompactAt = Date.now();
          logger.warn('reactToolLoop:分层窗口压缩触发（提前压缩点）', {
            sessionId: session.id,
            toolTurn: this.loopState.toolTurnCount,
            messageCount: this.loopState.messages.length,
            estimatedTokens: estLayer,
            layerWindow: layerWindowTokens,
          });
          // 反向信号（2026-09-02 v1.1 §3.2）：压力下窗口收紧导致同一任务内
          // 反复分层压缩（可能过度收紧/重做）→ 上报 monitor，60s 内 ≥2 次放宽窗口
          getMemoryPressureMonitor().recordReverseSignal(
            session.id,
            'react 分层窗口压缩触发'
          );
          // R2①（2026-09-16 fix A）：去掉 skipTier3Sync，循环内同步执行 Tier3 迭代折叠。
          // 根因：skipTier3Sync 使 LLM 折叠在 ReAct 循环内从不执行（且无人调用 compactSessionInBackground），
          // 而 Tier2 snip 因 ReAct 单任务 user 轮次少（turns≤6）天然不生效 → applied 恒 false → 退避白跑。
          // 这是 ReAct 循环内唯一能真实削减上下文的路径，代价是工具循环最多让步 60s（_runFullCompactionWithTimeout 兜底）。
          const layered = await compactionOrchestrator.compact(
            this.loopState.messages as unknown as ChatMessage[],
            { model, sessionId: session.id },
            {
              preEvaluated: {
                decision: 'trigger',
                beforeTokens: estLayer,
                snapshot: {
                  tokens: estLayer,
                  maxTokens: layerWindowTokens,
                  ratio: estLayer / layerWindowTokens,
                },
              },
            }
          );
          if (layered.applied) {
            this.loopState.messages = layered.messages as unknown as Record<
              string,
              unknown
            >[];
            this.loopState.consecutiveCompactNoEffect = 0;
            logger.info('reactToolLoop:分层窗口压缩完成', {
              sessionId: session.id,
              toolTurn: this.loopState.toolTurnCount,
              afterMessageCount: layered.messages.length,
            });
          } else {
            // R2（2026-09-16）：路径①压缩未生效也递增 no_effect —— 与路径②行为对齐，
            // 触发指数退避（见 L422-429），避免高频白跑；计数与路径②共享，稳态豁免判据见 L493-499。
            this.loopState.consecutiveCompactNoEffect =
              (this.loopState.consecutiveCompactNoEffect ?? 0) + 1;
            logger.warn('reactToolLoop:分层窗口压缩未生效（触发退避）', {
              sessionId: session.id,
              toolTurn: this.loopState.toolTurnCount,
              consecutiveNoEffect: this.loopState.consecutiveCompactNoEffect,
            });
          }
        }
      }
      if (this.loopState.messages.length > 0) {
        const evalResult = await this.ctx.unifiedTracker.checkBeforeRequest(
          this.loopState.messages as unknown as ChatMessage[],
          model
        );
        // 压缩失败暂停续接（2026-09-22）：记录本轮**实测**占用比 —— `onIncompleteTurn`
        // 据此区分"压不动且吃紧"（该停续接）与"低占用会话里的输出截断"（该照常续接）。
        this.loopState.lastCompactRatio = Number(
          evalResult.snapshot?.ratio ?? 0
        );
        if (evalResult.decision !== 'skip') {
          const ratio = Number(evalResult.snapshot?.ratio ?? 0);
          // R2（2026-09-16）：压缩稳态豁免——上下文占用远低于模型窗口（容量充足）且压缩已连续 no_effect，
          // 说明当前场景"压不动但也没有爆窗风险"；跳过本轮压缩尝试，避免每轮白跑全量 token 重估/大请求构造。
          const steadySkip =
            ratio < ReActToolLoop.COMPACT_STEADY_RATIO &&
            (this.loopState.consecutiveCompactNoEffect ?? 0) >=
              ReActToolLoop.COMPACT_NO_EFFECT_SKIP_THRESHOLD;
          if (steadySkip) {
            logger.info('reactToolLoop:compact_steady_state_skip', {
              sessionId: session.id,
              ratio: Number(ratio.toFixed(3)),
              windowTokens: evalResult.snapshot?.maxTokens,
              estimatedTokens: evalResult.snapshot?.tokens,
              consecutiveNoEffect: this.loopState.consecutiveCompactNoEffect,
              toolTurn: this.loopState.toolTurnCount,
            });
          } else {
            logger.info('reactToolLoop:工具轮内压缩评估触发', {
              sessionId: session.id,
              decision: evalResult.decision,
              tokens: evalResult.snapshot.tokens,
              maxTokens: evalResult.snapshot.maxTokens,
              ratio: Number(evalResult.snapshot.ratio.toFixed(3)),
              messageCount: this.loopState.messages.length,
              toolTurn: this.loopState.toolTurnCount,
            });
            const compactResult = await compactionOrchestrator.compact(
              this.loopState.messages as unknown as ChatMessage[],
              { model, sessionId: session.id },
              { skipTier3Sync: true, preEvaluated: evalResult }
            );
            if (compactResult.applied) {
              this.loopState.messages =
                compactResult.messages as unknown as Record<string, unknown>[];
              this.loopState.consecutiveCompactNoEffect = 0;
              logger.info('reactToolLoop:工具轮内上下文压缩完成', {
                sessionId: session.id,
                beforeTokens: evalResult.snapshot.tokens,
                afterMessageCount: compactResult.messages.length,
                toolTurn: this.loopState.toolTurnCount,
              });
            } else {
              this.loopState.consecutiveCompactNoEffect =
                (this.loopState.consecutiveCompactNoEffect ?? 0) + 1;
            }
          }
        }
        // 兜底：无论压缩是否生效，发送前强制截断（估算超窗口-输出预留才截断，否则零开销早退）
        await truncateApiMessages(
          this.loopState.messages as unknown as Record<string, unknown>[],
          evalResult.snapshot.maxTokens,
          new Map([[session.id, session]]),
          session.id,
          (this.ctx.options?.maxTokens as number | undefined) ?? undefined
        );
        // PAIR-GUARD（2026-08-30）：发送前无条件配对清理——truncateApiMessages 未超限时
        // 早退（不执行内部 sanitize），历史残留/事件派生可能产生"assistant tool_calls 无配对
        // tool 消息"→ OpenAI 400 "insufficient tool messages following tool_calls"。
        // 删除不完整 assistant 而非补占位，保守且与 OpenAI 配对约束一致（sanitize 幂等）。
        sanitizeApiMessages(
          this.loopState.messages as unknown as Record<string, unknown>[]
        );
        // 内存画像（MEM_PROFILE=1）：压缩评估/截断后采样，观察工具轮消息累积对
        // RSS/堆的影响（排查 agentic 运行期 RSS 2-4.4GB 尖峰与 GC STW）
        memProfile('react-toolloop:presend', {
          sessionId: session.id,
          toolTurn: this.loopState.toolTurnCount,
          messageCount: this.loopState.messages.length,
        });
      }
    } catch {
      // 压缩/截断失败不阻断工具循环（@ignore-catch，CS03）
    }

    // X8（2026-09-23，Spec §5.5）：**主会话预算触顶 ⇒ 下一轮请求前经 steering 注入收尾指令**。
    // 一个**独立的、幂等的检查**（与 compression / token 预算决策无关，不改其既有行为）：
    // - **开销极小**：读库一次；该会话无"已触顶且尚未报告"的目标 ⇒ 立即返回；
    // - **幂等**：认领走 `budget_limit_reported_at` 的单条条件 UPDATE（`changes` 判首次）
    //   ⇒ 至多注入一次，跨进程/重启亦然（不用内存 flag）；
    // - **形态 = steering**：正文进 `steeringQueue`，骨架在**下一轮 reason 前**注入
    //   （`ReActLoop` 的 steering 消费点）⇒ 正是"下一轮请求前"，且**不主动发起新请求**（软停）。
    try {
      await injectMainSessionBudgetWrapUp({
        sessionId: this.ctx.session.id,
        steer: (text) => this.queueSteering(text),
      });
    } catch (err) {
      // @ignore-catch — 收尾注入属"意图面"，读库/注入失败不得中断本轮推理（CS03）
      logger.warn('reactToolLoop:budget_wrapup_inject_failed', {
        sessionId: this.ctx.session.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ─── 抽象方法 ──────────────────────────────────────

  /**
   * P11（2026-09-01）：新对话轮次首轮清理旧任务残留——解决"用户发新消息，模型仍按
   * 旧任务执行"（实测：模型 thinking 已看到"升级 CLI"新要求，但因旧任务上下文 +
   * [STEERING] 求助指令主导，行动上继续旧任务探索）。
   * 1) 移除 [STEERING]/[SYSTEM] 注入指令残留（旧任务求助指令干扰）；
   * 2) 成对移除探索类工具（skill_view/glob/grep/web_fetch 等）的 assistant(tool_calls)
   *    + tool 结果——旧任务探索结果污染上下文（首轮时这些均为历史残留，无当前轮配对）；
   * 3) 若清理过旧任务残留，注入任务切换提示（最新用户指令优先）。
   * 注：普通对话文本/非探索类工具结果完整保留；注入提示本轮生效，下次新消息清理时移除。
   */
  private _sanitizeForNewTask(): void {
    const msgs = this.loopState.messages;
    const cleaned: Record<string, unknown>[] = [];
    let skipExplorePair = false; // 正在跳过一组探索类工具结果
    let removedCount = 0;
    for (const m of msgs) {
      const content = typeof m.content === 'string' ? m.content : '';
      // 1) 移除系统注入指令残留
      if (
        m.role === 'user' &&
        (content.startsWith('[STEERING]') || content.startsWith('[SYSTEM]'))
      ) {
        removedCount++;
        continue;
      }
      // 2) 成对移除探索类工具的 assistant(tool_calls) + 后续 tool 结果
      if (
        m.role === 'assistant' &&
        Array.isArray(m.tool_calls) &&
        m.tool_calls.length > 0
      ) {
        const names = m.tool_calls.map(
          (tc) =>
            (tc as { function?: { name?: string }; name?: string }).function
              ?.name ??
            (tc as { name?: string }).name ??
            ''
        );
        if (
          names.length > 0 &&
          names.every((n) => EXTERNAL_FETCH_TOOLS.has(n))
        ) {
          skipExplorePair = true;
          removedCount++;
          continue;
        }
      }
      if (m.role === 'tool') {
        if (skipExplorePair) {
          removedCount++;
          continue; // 跳过配对 tool 结果
        }
      } else {
        skipExplorePair = false;
      }
      cleaned.push(m);
    }

    if (removedCount > 0) {
      this.loopState.messages = cleaned;
      this.loopState.messages.push({
        role: 'user',
        content:
          '[SYSTEM] 请以最新一条用户消息为准重新规划当前任务；之前工具循环中未完成的工作仅在与最新消息直接相关时继续，否则忽略，不要重复执行旧任务步骤。',
      });
      logger.info('reactToolLoop:new_task_sanitized', {
        sessionId: this.ctx.session.id,
        removedCount,
        remainingMessages: this.loopState.messages.length,
      });
    }
  }

  /** 动态扩容计算：基础阈值 + 未完成 todo 项数 × 每项轮次，封顶 500 */
  private _resolveDynamicMaxIterations(): number {
    // 按 planId（无则 title）去重：extractTodoData 每轮无条件 push，
    const seen = new Set<string>();
    let pendingTodoCount = 0;
    for (const td of this.loopState.pendingTodos) {
      const key = td.planId ?? td.title;
      if (seen.has(key)) continue;
      seen.add(key);
      pendingTodoCount += td.tasks.filter(
        (t) => t.status === 'pending' || t.status === 'in_progress'
      ).length;
    }
    // P10（2026-09-01）：无 todo 但涉及外部获取/技能探索的任务同样扩容——
    // 此类任务需多轮尝试（抓取→失败→换源→查询→求助），基础 30 轮偏紧。
    let expansion = pendingTodoCount * DYNAMIC_TURNS_PER_PENDING_TODO;
    if (this.loopState.hasExternalFetchActivity) {
      expansion += EXTERNAL_FETCH_EXPANSION_TURNS;
    }
    // 8.4②（2026-09-16，治缺陷 1）：探索型任务（无 todo、无外部抓取）结构性拿不到扩容——
    // 纯检索（grep/glob 等）只要持续产出就会烧光基础阈值。改用客观可观测的"已执行轮次"
    // 而非"产出物痕迹"反推复杂度：轮次过半后按已执行轮次线性扩容，探索任务自动获 ~2 倍基础余量。
    if (this.loopState.toolTurnCount > this.baseMaxToolTurns / 2) {
      expansion += Math.floor(this.loopState.toolTurnCount / 2);
    }
    return Math.min(
      this.baseMaxToolTurns + expansion,
      MAX_DYNAMIC_TOOL_TURNS_CAP
    );
  }

  protected async *reason(
    _input: ToolLoopInput,
    context?: ToolLoopContext
  ): AsyncGenerator<ReActEvent, ReasonResult<ToolLoopContext>> {
    // 本轮 thinking 标记重置（reasoning-only 检测用，对标 openclaw 2026-09-01）
    this._lastRoundHadThinking = false;

    // 4. 循环检测已触发 → 不再调 LLM，直接结束
    if (this.loopState.loopDetected) {
      return { text: '', toolCalls: [], finishReason: 'stop', context };
    }

    // A. 首轮已有待执行工具（流式主路径：主回复 LLM 已产出 tool_calls）→ 直接执行，不再调 LLM。
    //    对齐旧类 run()：currentToolCalls.length > 0 时跳过初始 LLM 调用直接进工具循环。
    if (
      this.loopState.toolTurnCount === 0 &&
      !this.input.needsInitialLlmCall &&
      this.input.currentToolCalls.length > 0
    ) {
      const toolCalls: ToolCallEntry[] = this.input.currentToolCalls.map(
        (tc) => ({
          id: tc.id,
          name:
            getToolCallName(tc as { name?: string; function?: string }) ||
            tc.name,
          input: tc.arguments ?? {},
        })
      );
      return {
        // 主回复流已显示该文本，A-path 不再重复输出（转换层 reasoning_end 会跳过空文本）
        text: '',
        toolCalls,
        finishReason: 'tool_calls',
        context,
      };
    }

    // LLM 调用（M4 方案 A）：流式路径逐 chunk 增量 yield（reasoning_delta/thinking_delta，P0-C 恢复）；
    // 非流式路径整段返回。
    let response: ChatResponse;
    let cleanContent = '';
    if (this.input.nonStreaming) {
      response = await this._callLlmNonStreaming();
      cleanContent = response.content ?? '';
    } else {
      response = yield* this._consumeStreamingLlm(false);
      cleanContent = response.content ?? '';
    }

    // 1. 残缺工具调用重试：流式输出尾部残留未闭合标签且无 tool_calls → 重试一次
    if (
      !response.tool_calls?.length &&
      TRUNCATED_TAG_RE.test(cleanContent.trimEnd())
    ) {
      logger.warn('reactToolLoop:truncated_tool_call_retry', {
        sessionId: this.ctx.session.id,
        contentTail: cleanContent.slice(-160),
      });
      // 5. 残缺重试时 maxTokens 加倍（对齐旧类 _streamLlmRound L868-870），提高完整输出概率
      if (this.input.nonStreaming) {
        response = await this._callLlmNonStreaming();
      } else {
        response = yield* this._consumeStreamingLlm(true);
      }
      cleanContent = response.content ?? '';
    }

    const toolCalls: ToolCallEntry[] = (response.tool_calls ?? []).map(
      (tc) => ({
        id: tc.id,
        name:
          getToolCallName(tc as { name?: string; function?: string }) ||
          tc.name,
        input: tc.arguments ?? {},
      })
    );

    // 排查锚点：每轮推理产出的工具调用默认可见。circuit_breaker 触发时，
    // 配合 onToolCall end 和工具自身失败日志，可完整还原"AI 决策 → 工具执行 → 失败"链路。
    // 参数 JSON 化后截断 200 字符（命令类工具如 powershell/bash 必须能看到命令内容）。
    if (toolCalls.length > 0) {
      logger.info('reactToolLoop:reason_tool_calls', {
        sessionId: this.ctx.session.id,
        iteration: this.state.iteration,
        toolCallCount: toolCalls.length,
        toolCalls: toolCalls.map((tc) => ({
          name: tc.name,
          argsPreview: safeStringify(tc.input).slice(0, 200),
        })),
        finishReason:
          (response as { finishReason?: string }).finishReason ??
          (response as { stop_reason?: string }).stop_reason ??
          UNKNOWN_FINISH_REASON,
      });
    }

    // D. 对齐旧类 _prepareNextRound：清洗叙述 + tool_calls metadata + 助手消息落盘
    const repairedContent = stripBareExploration(cleanContent);
    const resp = response as unknown as {
      finishReason?: string;
      stop_reason?: string;
    };

    // P0-fix: 如果 assistantMessage 已存在（流式主路径已创建），更新它而不是创建新消息
    // 这解决了重复消息问题：streamMessageFlow.ts 创建第一条后，ReActToolLoop 不应再创建第二条
    // 注意：不调用 addAndPersistMessage，因为 _finalizeStreamMessage 会在最后统一持久化
    if (this.loopState.assistantMessage) {
      const existingMsg = this.loopState.assistantMessage;
      existingMsg.content = repairedContent;
      existingMsg.finishReason =
        resp.finishReason || resp.stop_reason || UNKNOWN_FINISH_REASON;
      if (response.tool_calls?.length) {
        existingMsg.metadata = {
          ...existingMsg.metadata,
          tool_calls: response.tool_calls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments:
                typeof tc.arguments === 'string'
                  ? tc.arguments
                  : JSON.stringify(tc.arguments || {}),
            },
          })),
        };
      }
      logger.debug('reactToolLoop:reason updated existing assistantMessage', {
        sessionId: this.ctx.session.id,
        messageId: existingMsg.id,
        contentLength: repairedContent.length,
      });
    } else {
      const assistantMsg = this.ctx.messageService.createAssistantMessage(
        repairedContent,
        {
          sessionId: this.ctx.session.id,
          // P1-3：复用工具轮入口预分配的 id（A3），保证 chunk 事件与落盘 id 一致
          id: this._activeToolRoundMessageId,
        }
      );
      assistantMsg.finishReason =
        resp.finishReason || resp.stop_reason || UNKNOWN_FINISH_REASON;
      if (response.tool_calls?.length) {
        assistantMsg.metadata = {
          ...assistantMsg.metadata,
          tool_calls: response.tool_calls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments:
                typeof tc.arguments === 'string'
                  ? tc.arguments
                  : JSON.stringify(tc.arguments || {}),
            },
          })),
        };
      }
      this.ctx.addAndPersistMessage(this.ctx.session.id, assistantMsg);
      this.loopState.assistantMessage = assistantMsg;
    }

    // 4. LoopDetector 记录轮次（对齐旧类 recordTurn(currentToolCalls.length > 0)）
    this.ctx.loopDetector.recordTurn(toolCalls.length > 0);

    return {
      text: cleanContent,
      toolCalls,
      // 修复（2026-09-03）：保留真实终止原因而非无 tool_calls 一律改写 'stop'——
      // 输出被 max_tokens 截断时上层（onIncompleteTurn）依赖该信号决定"续接重试"，
      // 改写为 'stop' 会让"截断中断"伪装成"正常结束"，任务半途而废（用户感知"才提要求就中断"）。
      // 一期 F1-2（2026-09-23）：**取消"有 tool_calls 就覆盖"的分支优先级**——那种覆盖
      // 恰恰吃掉了上面这条修复要保住的截断信号（"被截断 + 只吐出半个 tool_calls"是最常见
      // 形态）。现约定：provider 真实值优先（不覆盖）；"本轮是否有工具调用"由
      // `toolCalls.length` 独立表达，无需借 finishReason 承载；原始值另存
      // rawFinishReason，信息不销毁（不参与控制流）。
      finishReason:
        ((resp.finishReason ??
          resp.stop_reason) as ReasonResult<ToolLoopContext>['finishReason']) ??
        (toolCalls.length > 0 ? 'tool_calls' : 'stop'),
      rawFinishReason:
        resp.finishReason ?? resp.stop_reason ?? UNKNOWN_FINISH_REASON,
      context,
    };
  }

  protected async *act(
    calls: ToolCallEntry[],
    _context?: ToolLoopContext
  ): AsyncGenerator<ReActEvent, ActResult> {
    this.loopState.toolTurnCount++;
    const results: ToolResultEntry[] = [];
    const processedResults: Array<{
      normalizedToolCall: ToolCall;
      result: ToolResult;
    }> = [];
    // M3-T3.2（2026-08-31）：读类并发批次——isConcurrencySafe 工具批量并发执行，
    // 其余严格串行。遇到非并发安全工具或循环结束时 flush。
    const parallelBatch: ParallelBatchItem[] = [];

    try {
      // 4. 循环检测：对本轮工具调用预检（critical 中止，warning 记录）
      for (const tc of calls) {
        const detection = this.ctx.loopDetector.detect(tc.name, tc.input);
        if (detection.stuck && detection.level === 'critical') {
          this.loopState.loopDetected = {
            detector: detection.detector ?? 'unknown',
            message: detection.message ?? '未提供详情',
          };
          logger.warn('reactToolLoop:loop_detected', {
            sessionId: this.ctx.session.id,
            toolName: tc.name,
            detector: this.loopState.loopDetected.detector,
            message: this.loopState.loopDetected.message,
            turn: this.loopState.toolTurnCount,
          });
          return { results: [], allSucceeded: false, anyAborted: false };
        }
      }

      // L2（2026-09-06）：PathGuard 越界路径防护（对齐 batch 三守卫，TAORLoop.ts:938-951）。
      // 仅命中 deny 列表（.env/凭据/密钥/锁文件等）才拦截；无路径参数或未命中 → 放行，正常工具不受影响。
      for (const tc of calls) {
        const pathCheck = this.pathGuard.checkToolCall(tc.name, tc.input);
        if (!pathCheck.allowed) {
          // 复用 loopDetected 终止通道（detector 区分来源）→ reason 早退、finalize 带原因提示
          this.loopState.loopDetected = {
            detector: 'pathGuard',
            message: `路径守卫拦截 ${tc.name}: ${pathCheck.reason ?? '未知原因'}`,
          };
          logger.warn('reactToolLoop:pathguard_blocked', {
            sessionId: this.ctx.session.id,
            toolName: tc.name,
            reason: pathCheck.reason,
            turn: this.loopState.toolTurnCount,
          });
          return { results: [], allSucceeded: false, anyAborted: false };
        }
      }

      for (const tc of calls) {
        // PAIR-FILL（2026-08-30）：被跳过工具必须回填 processedResults——assistant 消息
        // 携带全部 tool_calls，若部分调用无 tool 结果消息，OpenAI 兼容 API 返回 400
        // "tool_calls must be followed by tool messages"（reactLoop:[reasoning] 400 根因）。
        // 与成功分支的 processedResults.push 对称，保证 buildToolRoundMessages 配对完整。
        const recordSkippedTool = (error: string) => {
          results.push({
            toolCallId: tc.id,
            name: tc.name,
            status: 'error' as const,
            error,
          });
          processedResults.push({
            normalizedToolCall: {
              id: tc.id,
              name: tc.name,
              arguments: tc.input,
            },
            result: {
              toolCallId: tc.id,
              toolName: tc.name,
              error,
            },
          });
        };
        // DecisionGate 门控检查（设计方案 §5.3）：执行前检查是否需要用户确认
        if (this.gateTier) {
          const gateQuestion = decisionGateCheck(
            { toolName: tc.name, toolInput: tc.input },
            this.gateTier,
            'execute'
          );
          if (gateQuestion) {
            const gateQuestionData: QuestionData = {
              questionId: gateQuestion.id,
              question: gateQuestion.question,
              header: '决策确认',
              options: gateQuestion.options
                ? gateQuestion.options.map((o: string) => ({
                    label: o,
                    description: gateQuestion.rationale,
                  }))
                : [
                    { label: '继续', description: gateQuestion.rationale },
                    { label: '取消', description: '跳过此操作' },
                  ],
              multiSelect: false,
              questionType: gateQuestion.type,
            };
            if (this.ctx.pendingInteractions.has(this.ctx.session.id)) {
              logger.warn('reactToolLoop:gate_already_pending', {
                sessionId: this.ctx.session.id,
                toolName: tc.name,
              });
              recordSkippedTool('已有待处理交互，决策门控被跳过');
              continue;
            }
            let gateResolve!: (answers: string[]) => void;
            const gatePromise = new Promise<string[]>(
              (res) => (gateResolve = res)
            );
            this.ctx.pendingInteractions.set(this.ctx.session.id, {
              questionId: gateQuestion.id,
              promise: gatePromise,
              resolve: gateResolve,
            });
            logger.info('reactToolLoop:gate_question_emitted', {
              sessionId: this.ctx.session.id,
              toolCallId: tc.id,
              toolName: tc.name,
              questionId: gateQuestion.id,
              signalKind: gateQuestion.signal?.kind,
            });
            if (this.negotiationState) {
              addPendingQuestion(this.negotiationState, gateQuestion);
            }
            // P0 落盘缺口（2026-08-25）：assistant/question 落盘（data 对齐前端聚合器结构）
            await this._appendStreamEvent('assistant/question', {
              questionId: gateQuestionData.questionId,
              question: gateQuestionData.question,
              header: gateQuestionData.header,
              options: gateQuestionData.options.map((o) => ({
                label: o.label,
                description: o.description,
              })),
              multiSelect: gateQuestionData.multiSelect,
            });
            yield { type: 'question', questionData: gateQuestionData };
            const gateIter = this._awaitAnswersWithHeartbeat(
              gateQuestion.id,
              gatePromise
            );
            let gateAnswerResult = await gateIter.next();
            while (!gateAnswerResult.done) {
              yield gateAnswerResult.value;
              gateAnswerResult = await gateIter.next();
            }
            const gateAnswers = gateAnswerResult.value;
            if (this.negotiationState && gateAnswers) {
              recordAnswer(this.negotiationState, gateQuestion.id, gateAnswers);
            }
            if (
              !gateAnswers ||
              gateAnswers.length === 0 ||
              gateAnswers[0] === '取消' ||
              gateAnswers[0] === '跳过' ||
              gateAnswers[0] === '中止'
            ) {
              logger.info('reactToolLoop:gate_rejected', {
                sessionId: this.ctx.session.id,
                toolCallId: tc.id,
                toolName: tc.name,
              });
              recordSkippedTool('用户取消执行');
              continue;
            }
          }
        }

        // 2. 交互恢复：requiresUserInteraction 工具等待用户答案（v3：yield question 事件穿透 generator 挂起链路）
        const toolObj = this.ctx.toolRegistry.getTool(tc.name);
        if (toolObj?.requiresUserInteraction?.()) {
          const isRecovery =
            this.input.interactionContext &&
            calls.indexOf(tc) === this.input.interactionContext.interactionIdx;
          if (isRecovery) {
            // 2026-08-30 修复：input 可能为深冻结对象（响应/状态冻结）——注入 _userAnswers
            // 前确保可扩展，避免 "Attempting to define property on object that is not extensible"
            // 导致整轮工具执行失败（reactLoop:[acting] 冻结错误 → all-tools-failed）。
            const inputObj = tc.input as Record<string, unknown>;
            if (!Object.isExtensible(inputObj)) {
              tc.input = { ...inputObj };
            }
            (tc.input as Record<string, unknown>)._userAnswers =
              this.input.interactionContext!.userAnswers;
          } else {
            // 同轮多提问防护（v3）：Map 单槽不静默覆盖——构造 error result 保证 tool_end 闭环（避免 tool_start 卡片悬挂）
            if (this.ctx.pendingInteractions.has(this.ctx.session.id)) {
              logger.warn('reactToolLoop:interaction_already_pending', {
                sessionId: this.ctx.session.id,
                toolName: tc.name,
                toolCallId: tc.id,
              });
              recordSkippedTool('已有待处理交互，本次提问被拒绝');
              continue;
            }
            const { questionData, promise } = this._registerInteraction(tc);
            // 挂起前产出 question 事件（★ 穿透 generator 挂起链路的唯一通道）
            logger.info('reactToolLoop:interaction_question_emitted', {
              sessionId: this.ctx.session.id,
              toolCallId: tc.id,
              toolName: tc.name,
              questionId: questionData.questionId,
            });
            // P0 落盘缺口（2026-08-25）：assistant/question 落盘（data 对齐前端聚合器结构）
            await this._appendStreamEvent('assistant/question', {
              questionId: questionData.questionId,
              question: questionData.question,
              header: questionData.header,
              options: questionData.options.map((o) => ({
                label: o.label,
                description: o.description,
              })),
              multiSelect: questionData.multiSelect,
            });
            yield { type: 'question', questionData };
            // 迭代消费心跳 generator（★ 禁止 await async generator：直接 await 不执行代码，心跳全丢）
            const answersIter = this._awaitAnswersWithHeartbeat(
              questionData.questionId,
              promise
            );
            let answersResult = await answersIter.next();
            while (!answersResult.done) {
              yield answersResult.value; // question_waiting 心跳转发
              answersResult = await answersIter.next();
            }
            const answers = answersResult.value; // string[] | undefined
            if (answers) {
              // 2026-08-30 修复：input 冻结保护（同 isRecovery 分支，防止修改不可扩展对象）
              const inputObj = tc.input as Record<string, unknown>;
              if (!Object.isExtensible(inputObj)) {
                tc.input = { ...inputObj };
              }
              (tc.input as Record<string, unknown>)._userAnswers = answers;
            }
          }
        }

        // P0-4（2026-08-14）：工具执行事件同步触发 onToolCall（对齐 TAOR 路径 ChatManagerTAORAdapter）：
        // start 携带完整参数对象（不再截断）→ CoreAPIImpl.onToolCall 产出带参数的 tool_call chunk + "🔧 Running tool" 提示；
        // end 携带 ok/message/result → 产出 "✅/❌ Tool xxx completed" 提示 + toolResultCache 注入。
        // （参数显示另有事件流 tool_start 兜底，前端按 toolCallId 去重合并，不产生双卡片。）
        // 排查日志：日志内仍截断 200 字符，实际回调传完整对象。
        // 遗漏 3：safeStringify 防循环引用/BigInt 抛错中断整轮工具。
        const rawArgsJson = safeStringify(tc.input);
        logger.debug('reactToolLoop:onToolCall start', {
          sessionId: this.ctx.session.id,
          toolName: tc.name,
          toolCallId: tc.id,
          argsLength: rawArgsJson.length,
          detail: rawArgsJson.slice(0, 200),
          onToolCallRegistered: !!this.ctx.onToolCall,
        });
        this.ctx.onToolCall?.('start', tc.name, tc.id, {
          args: tc.input,
        });

        // 2026-08-24 进度链路打通：收集工具执行中的细粒度进度回调，
        // 工具完成后批量 yield tool_progress 事件（reactEventsToChunks 已实现
        // 500ms 节流 → status chunk "工具执行中 X%"），与心跳 execution_phase 互补。
        // M3-T3.2（2026-08-31）：读类并发——isConcurrencySafe 工具入批次并发执行，
        // 其余严格串行（对齐 openworker _parallel_safe：low-risk 读并发、写/shell 独占）。
        // 并发工具 start 顺序保持调用顺序；结果落盘/检查点由 _flushParallelBatch 统一
        // 按序后处理（_postProcessToolResult），保证 tool/result 消息与检查点顺序一致。
        const progressEvents: number[] = [];
        const executeRun = () =>
          this.ctx.executeTool(
            {
              id: tc.id,
              name: tc.name,
              arguments: tc.input,
              sessionId: this.ctx.session.id,
            },
            {
              useErrorHandler: true,
              onProgress: (p) => {
                const data = (p.data ?? {}) as { percentage?: number };
                if (typeof data.percentage === 'number') {
                  progressEvents.push(data.percentage);
                }
              },
            }
          );
        const toolMeta = this.ctx.toolRegistry.getTool(tc.name);
        const concurrencySafe =
          toolMeta?.isConcurrencySafe?.(tc.input) ?? false;
        if (concurrencySafe) {
          parallelBatch.push({
            tc,
            progressEvents,
            run: executeRun,
            remainingToolCalls: calls
              .filter((c) => c.id !== tc.id)
              .map((c) => ({
                id: c.id,
                name: c.name,
                arguments: c.input,
              })),
          });
          continue;
        }
        // 非并发安全：先 flush 前面已收集的并发批次（保持执行顺序），再串行执行
        yield* this._flushParallelBatch(
          parallelBatch,
          results,
          processedResults
        );
        // 2026-09-01 P1：abort 时立即以"已中止"错误结果 fallback（见 _raceToolAbort）
        const toolResult = await this._raceToolAbort(executeRun, () => ({
          toolCallId: tc.id,
          toolName: tc.name,
          error: '工具执行被中止（会话停止，abort signal）',
        }));

        // 工具完成后批量产出 tool_progress 事件（细粒度百分比进度）
        for (const percentage of progressEvents) {
          yield { type: 'tool_progress', callId: tc.id, progress: percentage };
        }

        // 遗漏 2（2026-08-14 复查）：审批等待态判定提前（原 L381 重复计算，现合并）。
        // 审批等待工具不触发 onToolCall('end')——否则 CoreAPIImpl 误发 "✅ Tool completed"、
        // 前端聚合把审批中工具计入 completed++（显示 "2/3 完成"），与 pendingApproval 徽标矛盾。
        const isPendingApproval =
          (toolResult as { result?: { pendingApproval?: boolean } })?.result
            ?.pendingApproval === true;

        const rawResultJson = safeStringify(toolResult.result);
        const resultMessage = toolResult.error
          ? `失败: ${toolResult.error.slice(0, 200)}`
          : `成功: ${rawResultJson.slice(0, 200)}`;
        // 排查锚点：工具执行结果默认可见。失败用 WARN（circuit_breaker 触发时必须能
        // 看到每轮失败原因），成功用 INFO（避免 DEBUG 默认不可见导致排查断链）。
        // 配合 PowerShellTool:execution_failed 等工具自身的失败日志定位根因。
        const toolStatus = toolResult.error ? 'failed' : 'success';
        if (toolResult.error) {
          logger.warn('reactToolLoop:onToolCall end', {
            sessionId: this.ctx.session.id,
            toolName: tc.name,
            toolCallId: tc.id,
            status: toolStatus,
            detail: resultMessage,
            onToolCallRegistered: !!this.ctx.onToolCall,
            pendingApproval: isPendingApproval,
          });
        } else {
          logger.info('reactToolLoop:onToolCall end', {
            sessionId: this.ctx.session.id,
            toolName: tc.name,
            toolCallId: tc.id,
            status: toolStatus,
            detail: resultMessage,
            onToolCallRegistered: !!this.ctx.onToolCall,
            pendingApproval: isPendingApproval,
          });
        }
        if (!isPendingApproval) {
          this.ctx.onToolCall?.('end', tc.name, tc.id, {
            ok: !toolResult.error,
            message: resultMessage,
            result: toolResult.result,
          });
        }

        // 工具结果注册表 + 循环检测记录 + 心跳进度数据（5）
        try {
          this.ctx.toolResultRegistry.storeResult(
            this.ctx.session.id,
            tc.id,
            tc.name,
            tc.input,
            { result: toolResult.result, error: toolResult.error },
            this.ctx.toolResultRegistry.getCurrentRound(this.ctx.session.id)
          );
          this.ctx.loopDetector.recordToolCallOutcome(
            tc.name,
            tc.input,
            toolResult.result,
            toolResult.error
          );
        } catch {
          // 注册/记录失败不影响执行
        }

        // B. 工具结果消息落盘（对齐旧类 _executeToolRound L673-680）
        // P1-4（2026-08-23）：metadata 携带 parentMessageId（= 归属 assistant 消息 id，G1/N6/A2），
        // convertMessage 的 tool 分支据此生成 tool/result.messageId。
        // T2.3（2026-08-23）：metadata 携带 callSeq（= tool_call 事件 seq，A1③ 闭环）——
        // streamMessageFlow 在写 assistant/tool_call 事件时填充 toolCallSeqMap，
        // convertMessage tool 分支据此直读生成 tool/result.callSeq，不再依赖 _toolCallSeqMap 回填。
        const toolResultMsg = this.ctx.messageService.createToolResultMessage(
          toolResult,
          {
            sessionId: this.ctx.session.id,
            metadata: {
              ...(toolResult.metadata as Record<string, unknown> | undefined),
              parentMessageId:
                this.loopState.assistantMessage?.id ??
                this._activeToolRoundMessageId,
              ...(this.ctx.toolCallSeqMap?.has(tc.id)
                ? { callSeq: this.ctx.toolCallSeqMap.get(tc.id) }
                : {}),
            },
          }
        );
        this.ctx.addAndPersistMessage(this.ctx.session.id, toolResultMsg);

        // P3-6（2026-09-02）：文件产出循环检测（串行路径——非并发安全工具走此处）
        this._detectFileWriteLoop(tc);

        // G. 流式检查点（对齐旧类 L707-724）：断点续跑依赖此数据
        if (!this.loopState.completedToolNames.includes(tc.name)) {
          this.loopState.completedToolNames.push(tc.name);
        }
        this.loopState.totalCompletedToolCount++;
        if (!isPendingApproval) {
          this.loopState.completedToolCallIds.push(tc.id);
        }
        try {
          await this.ctx.streamingCheckpoint.onToolCompleted({
            newMessagesSinceLastCheckpoint: [
              this.loopState.assistantMessage,
              toolResultMsg,
            ],
            messagesSnapshot: this.ctx.session.messages.slice(),
            currentToolCalls: calls
              .filter((c) => c.id !== tc.id)
              .map((c) => ({
                id: c.id,
                name: c.name,
                arguments: c.input,
              })),
            completedToolCallIds: [...this.loopState.completedToolCallIds],
            generatorState: {
              toolTurnCount: this.loopState.toolTurnCount,
              llmCallCount: this.loopState.llmCallCount,
            },
            metadata: { model: this.ctx.options?.model },
            sessionState: this.ctx.session.state,
          });
        } catch {
          // 流式检查点失败不影响执行（@ignore-catch）
        }

        results.push({
          toolCallId: tc.id,
          name: tc.name,
          status: toolResult.error ? 'error' : 'success',
          // 遗漏 1（2026-08-14 复查）：对象/数组结果（grep/glob/create_project 等经
          // ToolExecutor 返回 result.data 为对象）也下发——否则 tool_end 转换层 result
          // undefined → 前端工具卡片结果区空白。对齐 ToolExecutor.ts 的 JSON.stringify 方案。
          output:
            typeof toolResult.result === 'string'
              ? toolResult.result
              : toolResult.result !== undefined
                ? safeStringify(toolResult.result)
                : undefined,
          error: toolResult.error,
        });
        // todo chunk 数据：工具结果含 _todoData 时收集（对齐旧类 _executeToolRound extractTodoData）
        const todoData = extractTodoData(toolResult);
        if (todoData) {
          this.loopState.pendingTodos.push(todoData);
        }
        processedResults.push({
          normalizedToolCall: {
            id: tc.id,
            name: tc.name,
            arguments: tc.input,
          },
          result: toolResult,
        });
      }

      // M3-T3.2：循环结束 flush 剩余并发批次（并发安全工具的统一后处理）
      yield* this._flushParallelBatch(parallelBatch, results, processedResults);

      // C. 下一轮消息回填（对齐旧类 L406-411）+ 轮次推进 + unifiedTracker（L413-419）
      // 2026-08-31 工具结果二级防御：超限结果落盘 + 路径引用（防 822KB 工具结果
      // 全量进上下文 OOM），单轮聚合超限 spill（对标 hermes tool_result_storage）
      if (processedResults.length > 0) {
        await prepareToolResultsForContext(processedResults);
      }
      // 下一轮消息回填：assistantMessage 为空时（A-path 首轮主回复消息未挂到
      // loopState 等场景）构造占位 assistant 消息，保证工具结果一定拼入下一轮请求——
      // 否则模型看不到工具结果会重复调用同一工具（实测 iter1 inputTokens 与主回复
      // 完全相同 8398，工具结果未回喂）。
      const assistantMsgForRound =
        this.loopState.assistantMessage ??
        ({
          id:
            this._activeToolRoundMessageId ||
            `msg-round-${this.loopState.toolTurnCount}`,
          role: 'assistant',
          content: '',
        } as unknown as Message);
      this.loopState.messages = this.ctx.buildToolRoundMessages(
        this.loopState.messages,
        assistantMsgForRound,
        calls.map((c) => ({
          id: c.id,
          name: c.name,
          arguments: c.input,
        })),
        processedResults as Array<{
          normalizedToolCall: ToolCall;
          result: ToolResult;
        }>
      );
      // P2-3（2026-09-02）：同工具同参数重复调用纠偏——注入必须放在
      // buildToolRoundMessages 之后（保证消息顺序：tool_calls → tool 结果 → 纠偏指令）
      this._injectRepeatCallCorrection(calls);
      this.ctx.toolResultRegistry.nextRound(this.ctx.session.id);
      this.ctx.unifiedTracker.resetStreamTokens(this.ctx.session.id);
      const model = this.ctx.options?.model as string | undefined;
      if (model) {
        await this.ctx.unifiedTracker.updateBaselineForRound(
          this.loopState.messages as unknown as Record<string, unknown>[],
          model,
          this.ctx.session.id
        );
      }

      // 阶段 A（A1-d）：成功 yield ⇒ 登记等待 + 标记让出本轮。
      // 判定/登记逻辑与 batch 路径（TAORLoop）共用同一实现（见 N-28 修复）。
      const yieldedEntry = registerYieldFromResults(
        results,
        this.ctx.session.id
      );
      if (yieldedEntry) {
        logger.info('reactToolLoop:yielded', {
          sessionId: this.ctx.session.id,
          toolCallId: yieldedEntry.toolCallId,
        });
      }

      return {
        results,
        allSucceeded: results.every((r) => r.status === 'success'),
        // L2（2026-09-17）：中止标志由真实信号/结果派生——原硬编码 false，会话中止时
        // （_raceToolAbort fallback / 串行跳过）工具会被上报为全成功
        anyAborted:
          !!this.ctx.abortSignal?.aborted ||
          results.some((r) => r.status === 'aborted' || r.status === 'timeout'),
        // 注意：`registerYieldFromResults` 未命中时返回 **null**（非 undefined）
        yielded: yieldedEntry !== null,
      };
    } finally {
      // B-2（2026-08-23）：工具调用未完成终态补发——已写 tool_call 事件
      // （toolCallSeqMap 有记录）但未完成的工具，补发 tool/canceled，保证事件流
      // 有完整终态（回放/日志不再把"已放弃"误显示为"进行中"；ask_user_question
      // 等交互挂起同样覆盖）。
      try {
        for (const tc of calls) {
          if (this.loopState.completedToolCallIds.includes(tc.id)) continue;
          if (!this.ctx.toolCallSeqMap?.has(tc.id)) continue; // 未发 tool_call 事件
          await this._appendStreamEvent('tool/canceled', {
            toolCallId: tc.id,
            callSeq: this.ctx.toolCallSeqMap.get(tc.id) ?? 0,
            reason: '工具调用未完成（工具循环结束/中止）',
          });
        }
      } catch (e) {
        // M1-INV②（2026-08-31）：补发失败会留下"无终态"的孤儿 tool_call
        // （前端 progress 永久悬挂、回放误显示进行中），必须可观测。
        logger.warn('reactToolLoop:tool/canceled 孤儿补发失败', {
          sessionId: this.ctx.session.id,
          pendingCalls: calls.filter(
            (tc) => !this.loopState.completedToolCallIds.includes(tc.id)
          ).length,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  /**
   * M2（2026-09-01 P1）：等待工具执行，同时响应 abort signal。
   *
   * 背景：工具循环挂起在 await 工具执行（如 grep 全项目 83s）时，generator.return()
   * 无法中断挂起的 await → 旧流互斥锁无法释放 → 后续同一会话请求 acquire 30s 超时。
   * 方案：Promise.race 让 abort 时立即返回 fallback（工具显示"已中止"），
   * 生成器得以继续/退出 → finally 释放锁。
   */
  private async _raceToolAbort<T>(
    run: () => Promise<T>,
    fallback: () => T
  ): Promise<T> {
    const sig = this.ctx.abortSignal;
    if (!sig) return run();
    if (sig.aborted) return fallback();
    const abortP = new Promise<T>((resolve) => {
      sig.addEventListener('abort', () => resolve(fallback()), { once: true });
    });
    return Promise.race([run(), abortP]);
  }

  /**
   * M3-T3.2（2026-08-31）：flush 并发批次——Promise.all 批量执行并发安全工具，
   * 结果按调用顺序统一后处理（_postProcessToolResult），保证 tool/result 消息、
   * 检查点与进度事件的顺序与串行路径一致。
   */
  private async *_flushParallelBatch(
    batch: ParallelBatchItem[],
    results: ToolResultEntry[],
    processedResults: Array<{
      normalizedToolCall: ToolCall;
      result: ToolResult;
    }>
  ): AsyncGenerator<ReActEvent, void> {
    enterPhase('toolround:execute');
    try {
      if (batch.length === 0) return;
      const items = batch.slice(); // 快照——batch.length=0 会清空原数组，items 必须独立引用
      batch.length = 0;
      logger.info('reactToolLoop:parallel_batch_execute', {
        sessionId: this.ctx.session.id,
        batchCount: items.length,
        tools: items.map((i) => i.tc.name),
      });
      // 2026-09-01 P1：abort 时不再等待长工具（Promise.all 不可中断），
      // 立即以"已中止"错误结果 fallback，释放生成器/互斥锁。
      const toolResults = await this._raceToolAbort(
        () => Promise.all(items.map((i) => i.run())),
        () =>
          items.map((i) => ({
            toolCallId: i.tc.id,
            toolName: i.tc.name,
            error: '工具执行被中止（会话停止，abort signal）',
          }))
      );
      for (let i = 0; i < items.length; i++) {
        const out = yield* this._postProcessToolResult(
          items[i].tc,
          toolResults[i],
          items[i].progressEvents,
          items[i].remainingToolCalls
        );
        if (out) {
          results.push(out.resultEntry);
          if (out.todoData) this.loopState.pendingTodos.push(out.todoData);
          processedResults.push(out.processedEntry);
        }
      }
    } finally {
      exitPhase('toolround:execute');
    }
  }

  /**
   * BUG-05（2026-09-16）：重读数收敛。修复"35 分钟空转"——agent 非连续反复
   * 重读/重搜同一批文件或 pattern，每次都"再看一眼"却无新产出，且因交错调用
   * 逃过了 generic_repeat（只判与上一轮**连续**相同）与 ping_pong（只判双工具交替）。
   * 判定：读类工具（read/search/grep/glob 等，排除写/改类）对同一资源累计重访
   * ≥ READ_REEXPLORE_STEER_THRESHOLD → 注入一次 [STEERING] 强制收尾（非硬熔断，
   * 不误伤正常深度探索），由模型自纠收敛。
   * 串行/并行路径共用（在 _postProcessToolResult 中与 _detectFileWriteLoop 并列）。
   */
  private _detectReadReExplore(tc: ToolCallEntry): void {
    const name = tc.name;
    // 写/改/执行类工具排除：避免把"反复编辑同一文件/重复运行"误判为"重读"
    if (
      /(write|edit|create|delete|remove|save|append|apply|run|exec|bash)/i.test(
        name
      )
    )
      return;
    // 只关心读/搜/列目录类工具
    if (!/(read|grep|glob|search|view|list|explore|cat|open)/i.test(name))
      return;

    const inp = (tc.input ?? {}) as Record<string, unknown>;
    // 取"被重读的资源"签名：文件路径或搜索 pattern（读类工具的核心是资源本身）
    const resource =
      (typeof inp.file_path === 'string' ? inp.file_path : undefined) ??
      (typeof inp.path === 'string' ? inp.path : undefined) ??
      (typeof inp.pattern === 'string' ? inp.pattern : undefined) ??
      (typeof inp.query === 'string' ? inp.query : undefined);
    if (!resource) return;

    const key = `${name}:${resource}`;
    const count = (this.readReExploreCounts.get(key) ?? 0) + 1;
    this.readReExploreCounts.set(key, count);
    if (
      count < ReActToolLoop.READ_REEXPLORE_STEER_THRESHOLD ||
      this.readReExploreSteered
    ) {
      return;
    }

    this.readReExploreSteered = true;
    this.steeringQueue.push(
      `你已反复读取/搜索同一资源（${name}: ${resource}，累计 ${count} 次）未获得新结论。` +
        '请立即收敛：要么基于当前已掌握的信息直接向用户交付最终结论，' +
        '要么在继续读取前先明确说明你仍在尝试解决的具体未决问题；' +
        '不要重复读取/搜索相同的文件或模式。'
    );
    logger.warn('reactToolLoop:read_reexplore_detected', {
      sessionId: this.ctx.session.id,
      toolName: name,
      resource,
      count,
      toolTurn: this.loopState.toolTurnCount,
    });
  }

  /**
   * P3-6（2026-09-02）：文件产出循环检测——模型反复写"相似内容/不同文件名"文件不收敛。
   *
   * 实测：deepseek-v4-flash 连续 14+ 轮 file_write 生成 AI-Agent 日报 HTML，文件名每次微调
   * （AI-Agent-日报/技术日报/前沿动态日报...）→ P15 的 file_path+contentLength 签名永不重复
   * → no_progress 熔断失效，每轮 40s+5000 tokens 白白消耗。判定：内容骨架相同（HTML/文档
   * 模板开头一致）的文件 ≥3 个 → 视为重复产出循环，注入 [STEERING] 强制收尾（非硬熔断）。
   * 串行路径（非并发安全工具）与并行批处理（_postProcessToolResult）共用本方法。
   */
  private _detectFileWriteLoop(tc: ToolCallEntry): void {
    if (
      tc.name !== 'file_write' &&
      tc.name !== 'FileWriteTool' &&
      tc.name !== 'write_file' &&
      tc.name !== 'file_edit' &&
      tc.name !== 'FileEditTool' &&
      tc.name !== 'edit_file'
    ) {
      return;
    }
    const inp = (tc.input ?? {}) as Record<string, unknown>;
    const fp =
      typeof inp.file_path === 'string'
        ? inp.file_path
        : typeof inp.path === 'string'
          ? inp.path
          : '';
    if (!fp) return;
    const content = typeof inp.content === 'string' ? inp.content : '';
    const contentHead = content.slice(
      0,
      ReActToolLoop.FILE_CONTENT_HEAD_LENGTH
    );
    const existing = this.writtenFiles.find((w) => w.path === fp);
    if (existing) {
      existing.contentHead = contentHead;
    } else {
      this.writtenFiles.push({ path: fp, contentHead });
    }
    if (
      this.fileWriteLoopPrompted ||
      this.loopState.loopDetected ||
      this.writtenFiles.length < ReActToolLoop.FILE_WRITE_LOOP_THRESHOLD
    ) {
      return;
    }
    const sameHeadCount = this.writtenFiles.filter(
      (w) => w.contentHead === contentHead
    ).length;
    if (sameHeadCount < ReActToolLoop.FILE_WRITE_LOOP_THRESHOLD) return;
    this.fileWriteLoopPrompted = true;
    const paths = this.writtenFiles.map((w) => w.path).join('、');
    this.steeringQueue.push(
      `你已成功写入 ${this.writtenFiles.length} 个文件（${paths}），其中多个文件内容结构相同。` +
        '如果任务已产出所需文件，请立即停止生成新文件，直接用文字向用户交付最终总结' +
        '（说明已生成的文件、核心内容与使用方式）；若需要调整，请用 file_edit 修改已有文件，不要新建文件。'
    );
    logger.warn('reactToolLoop:file_write_loop_detected', {
      sessionId: this.ctx.session.id,
      writtenFiles: this.writtenFiles.length,
      sameHeadCount,
      paths,
      toolTurn: this.loopState.toolTurnCount,
    });
  }

  /**
   * M3-T3.2（2026-08-31）：标准工具执行的统一后处理。
   *
   * 提取自 act 标准执行段（onToolCall end / 进度 / 结果注册 / 落盘 / 检查点），
   * 供串行执行与并发批次共用——保证并发工具的结果落盘与检查点按调用顺序一致。
   * yield tool_progress 事件；return 后处理产物（results/processedResults/todo 项）。
   */
  private async *_postProcessToolResult(
    tc: ToolCallEntry,
    toolResult: ToolResult,
    progressEvents: number[],
    remainingToolCalls: Array<{
      id: string;
      name: string;
      arguments: unknown;
    }>
  ): AsyncGenerator<
    ReActEvent,
    {
      resultEntry: ToolResultEntry;
      processedEntry: { normalizedToolCall: ToolCall; result: ToolResult };
      todoData?: ReturnType<typeof extractTodoData>;
    }
  > {
    // P10（2026-09-01）：标记外部获取/技能探索活动——供无 todo 时的动态轮次扩容。
    if (EXTERNAL_FETCH_TOOLS.has(tc.name)) {
      this.loopState.hasExternalFetchActivity = true;
    }
    // P3-6（2026-09-02）：文件产出循环检测（串行/并行路径共用）
    this._detectFileWriteLoop(tc);
    // BUG-05（2026-09-16）：重读/重搜收敛（串行/并行路径共用）
    this._detectReadReExplore(tc);
    // P7（2026-09-01）：跨轮收集"已完成工作"摘要——组合任务熔断（no_progress）时，
    // 已完成子任务（如知识库保存）的结果必须呈现给用户，不能随熔断一起丢失。
    // P12（2026-09-01）：created/skipped 统一为"已保存到知识库"，按 title 去重——
    // 此前 created（"已保存"）与 skipped（"已在知识库中"）文案不同导致同一文档
    // 列两条，且模型微调换 title 产生多条重复，用户看到的汇报混乱。
    if (
      tc.name === 'knowledge_save' &&
      !toolResult.error &&
      toolResult.result
    ) {
      const detail = toolResult.result as {
        title?: string;
        action?: string;
      };
      if (detail.title) {
        const done = `已保存到知识库：《${detail.title}》`;
        if (!this.completedWork.includes(done)) {
          this.completedWork.push(done);
        }
      }
    }
    // P15（2026-09-01）：跨轮收集"已生成/更新文件"——模型多轮 file_write 同一文件
    // 被 no_progress 熔断时（增量完善模式，content 前 200 字符相同误判无进展），
    // 已写入的文件必须呈现给用户，不能随熔断一起丢失。
    if (
      (tc.name === 'file_write' ||
        tc.name === 'FileWriteTool' ||
        tc.name === 'write_file' ||
        tc.name === 'file_edit' ||
        tc.name === 'FileEditTool' ||
        tc.name === 'edit_file') &&
      !toolResult.error
    ) {
      const inp = (tc.input ?? {}) as Record<string, unknown>;
      const fp =
        typeof inp.file_path === 'string'
          ? inp.file_path
          : typeof inp.path === 'string'
            ? inp.path
            : '';
      if (fp) {
        const done = `已生成/更新文件：${fp}`;
        if (!this.completedWork.includes(done)) {
          this.completedWork.push(done);
        }
      }
    }

    // 工具完成后批量产出 tool_progress 事件（细粒度百分比进度）
    for (const percentage of progressEvents) {
      yield { type: 'tool_progress', callId: tc.id, progress: percentage };
    }

    // 遗漏 2（2026-08-14 复查）：审批等待态判定提前（原 L381 重复计算，现合并）。
    // 审批等待工具不触发 onToolCall('end')——否则 CoreAPIImpl 误发 "✅ Tool completed"、
    // 前端聚合把审批中工具计入 completed++（显示 "2/3 完成"），与 pendingApproval 徽标矛盾。
    const isPendingApproval =
      (toolResult as { result?: { pendingApproval?: boolean } })?.result
        ?.pendingApproval === true;

    const rawResultJson = safeStringify(toolResult.result);
    const resultMessage = toolResult.error
      ? `失败: ${toolResult.error.slice(0, 200)}`
      : `成功: ${rawResultJson.slice(0, 200)}`;
    // 排查锚点：工具执行结果默认可见。失败用 WARN（circuit_breaker 触发时必须能
    // 看到每轮失败原因），成功用 INFO（避免 DEBUG 默认不可见导致排查断链）。
    const toolStatus = toolResult.error ? 'failed' : 'success';
    if (toolResult.error) {
      logger.warn('reactToolLoop:onToolCall end', {
        sessionId: this.ctx.session.id,
        toolName: tc.name,
        toolCallId: tc.id,
        status: toolStatus,
        detail: resultMessage,
        onToolCallRegistered: !!this.ctx.onToolCall,
        pendingApproval: isPendingApproval,
      });
    } else {
      logger.info('reactToolLoop:onToolCall end', {
        sessionId: this.ctx.session.id,
        toolName: tc.name,
        toolCallId: tc.id,
        status: toolStatus,
        detail: resultMessage,
        onToolCallRegistered: !!this.ctx.onToolCall,
        pendingApproval: isPendingApproval,
      });
    }
    if (!isPendingApproval) {
      this.ctx.onToolCall?.('end', tc.name, tc.id, {
        ok: !toolResult.error,
        message: resultMessage,
        result: toolResult.result,
      });
    }

    // 工具结果注册表 + 循环检测记录 + 心跳进度数据（5）
    try {
      this.ctx.toolResultRegistry.storeResult(
        this.ctx.session.id,
        tc.id,
        tc.name,
        tc.input,
        { result: toolResult.result, error: toolResult.error },
        this.ctx.toolResultRegistry.getCurrentRound(this.ctx.session.id)
      );
      this.ctx.loopDetector.recordToolCallOutcome(
        tc.name,
        tc.input,
        toolResult.result,
        toolResult.error
      );
    } catch {
      // 注册/记录失败不影响执行
    }

    // B. 工具结果消息落盘（对齐旧类 _executeToolRound L673-680）
    // P1-4（2026-08-23）：metadata 携带 parentMessageId（= 归属 assistant 消息 id，G1/N6/A2），
    // convertMessage 的 tool 分支据此生成 tool/result.messageId。
    // T2.3（2026-08-23）：metadata 携带 callSeq（= tool_call 事件 seq，A1③ 闭环）——
    // streamMessageFlow 在写 assistant/tool_call 事件时填充 toolCallSeqMap，
    // convertMessage tool 分支据此直读生成 tool/result.callSeq，不再依赖 _toolCallSeqMap 回填。
    const toolResultMsg = this.ctx.messageService.createToolResultMessage(
      toolResult,
      {
        sessionId: this.ctx.session.id,
        metadata: {
          ...(toolResult.metadata as Record<string, unknown> | undefined),
          parentMessageId:
            this.loopState.assistantMessage?.id ??
            this._activeToolRoundMessageId,
          ...(this.ctx.toolCallSeqMap?.has(tc.id)
            ? { callSeq: this.ctx.toolCallSeqMap.get(tc.id) }
            : {}),
        },
      }
    );
    this.ctx.addAndPersistMessage(this.ctx.session.id, toolResultMsg);

    // G. 流式检查点（对齐旧类 L707-724）：断点续跑依赖此数据
    if (!this.loopState.completedToolNames.includes(tc.name)) {
      this.loopState.completedToolNames.push(tc.name);
    }
    this.loopState.totalCompletedToolCount++;
    if (!isPendingApproval) {
      this.loopState.completedToolCallIds.push(tc.id);
    }
    try {
      await this.ctx.streamingCheckpoint.onToolCompleted({
        newMessagesSinceLastCheckpoint: [
          this.loopState.assistantMessage,
          toolResultMsg,
        ],
        messagesSnapshot: this.ctx.session.messages.slice(),
        currentToolCalls: remainingToolCalls,
        completedToolCallIds: [...this.loopState.completedToolCallIds],
        generatorState: {
          toolTurnCount: this.loopState.toolTurnCount,
          llmCallCount: this.loopState.llmCallCount,
        },
        metadata: { model: this.ctx.options?.model },
        sessionState: this.ctx.session.state,
      });
    } catch {
      // 流式检查点失败不影响执行（@ignore-catch）
    }

    const resultEntry: ToolResultEntry = {
      toolCallId: tc.id,
      name: tc.name,
      status: toolResult.error ? 'error' : 'success',
      // 遗漏 1（2026-08-14 复查）：对象/数组结果（grep/glob/create_project 等经
      // ToolExecutor 返回 result.data 为对象）也下发——否则 tool_end 转换层 result
      // undefined → 前端工具卡片结果区空白。对齐 ToolExecutor.ts 的 JSON.stringify 方案。
      output:
        typeof toolResult.result === 'string'
          ? toolResult.result
          : toolResult.result !== undefined
            ? safeStringify(toolResult.result)
            : undefined,
      error: toolResult.error,
    };
    // todo chunk 数据：工具结果含 _todoData 时收集（对齐旧类 _executeToolRound extractTodoData）
    const todoData = extractTodoData(toolResult);
    const processedEntry = {
      normalizedToolCall: {
        id: tc.id,
        name: tc.name,
        arguments: tc.input,
      },
      result: toolResult,
    };
    return { resultEntry, processedEntry, todoData: todoData ?? undefined };
  }

  protected shouldContinue(
    _input: ToolLoopInput,
    result: ReasonResult<ToolLoopContext>
  ): boolean {
    // 4. 循环检测触发后停止
    if (this.loopState.loopDetected) return false;
    // 观察点修复（2026-08-26）：会话级总时长上限——300 轮 × 每轮 LLM 可达数小时，
    // 防极端长任务资源占用。env REACT_LOOP_MAX_DURATION_MS 可覆盖，默认 3 小时。
    if (Date.now() - this.startedAt > ReActToolLoop.MAX_TOTAL_DURATION_MS) {
      const durationMs = Date.now() - this.startedAt;
      // 二期 F2-2（2026-09-23 修复计划 §六）：**超时必须显式终止**。此前该支只
      // `return false` 且不置任何相位 ⇒ ① 经 getTerminationReason() 被折叠成
      // 'completed'（伪装"正常完成"）；② 已产出的 tool_calls **被静默丢弃**
      // （本支短路了下面 `toolCalls.length > 0` 判据，而救援入口 onIncompleteTurn
      // 又因"有工具调用"拒收 ⇒ 两处判据相反、无人认领）。
      this.state.phase = 'timeout';
      this.droppedToolCallsAtStop = result.toolCalls.length;
      logger.warn('reactToolLoop:max_total_duration_reached', {
        sessionId: this.ctx.session.id,
        durationMs,
        maxMs: ReActToolLoop.MAX_TOTAL_DURATION_MS,
        droppedToolCalls: this.droppedToolCallsAtStop,
      });
      return false;
    }
    return result.toolCalls.length > 0;
  }

  /** 对标 hermes（2026-09-01）：达最大轮次时做一次不带 tools 的总结请求生成收尾总结。
   *  失败/超时不阻塞收尾（回退为 finalize 默认提示，CS03）。
   *  P2（2026-09-01）：不再因"无正文输出"跳过总结——模型 30 轮都在调工具时
   *  assistantMessage.content 为空，正是最需要交代的场景（否则用户只见停摆）；
   *  总结指令要求结构化交代（已完成/剩余/最小续跑方案），满足"轮次超限应换省轮次方案继续"的期望。 */
  protected override async onMaxIterations(): Promise<void> {
    try {
      // 局部数组注入总结指令，不污染 loopState.messages（用户后续对话上下文）
      const summaryMessages = [
        ...this.loopState.messages,
        {
          role: 'user',
          content:
            '[SYSTEM] 工具轮次已用尽，请只用文字总结（不要调用任何工具）：\n' +
            '1) 已完成的工作；\n' +
            '2) 未完成的工作；\n' +
            '3) 若要继续，最少需要哪几步（≤3 步，避免再次超限）。',
        },
      ] as unknown as ChatMessage[];
      const response = await this.ctx.activeClient.sendMessage(
        summaryMessages,
        {
          ...this.ctx.options,
          tools: undefined, // 不带 tools：仅总结已完成工作，不再触发工具调用
        }
      );
      let summary = response.content?.toString() ?? '';
      // P0（2026-09-01）：非流式总结响应不经流式 Scrubber，模型会输出
      // <think>/<response>/XML 标签 → 手动清洗后再作为 maxIterationsSummary
      // 附加到 finalize 消息（此前实测 summary 直接带 <think> 泄露给用户）。
      if (summary) {
        const scrubber = new StreamingThinkScrubber();
        summary =
          scrubber.scrub({ content: summary, isComplete: false }).content +
          scrubber.flush();
        summary = summary.trim();
      }
      if (summary) this.loopState.maxIterationsSummary = summary;
      logger.info('reactToolLoop:max_iterations_summary_generated', {
        sessionId: this.ctx.session.id,
        maxIterations: this.config.maxIterations,
        summaryLength: summary.length,
      });
    } catch (err) {
      logger.warn('reactToolLoop:max_iterations_summary_failed', {
        sessionId: this.ctx.session.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * 压缩是否处于"**压不动且吃紧**"（2026-09-22，"压缩失败暂停续接"判据）。
   *
   * - **压不动**：`consecutiveCompactNoEffect` 达 `COMPACT_NO_EFFECT_SKIP_THRESHOLD`
   *   （与"低占用稳态跳过"共用同一计数 ⇒ 不引入第二套阈值，避免两处口径漂移）；
   * - **且吃紧**：最近一次实测占用比 `lastCompactRatio ≥ COMPACT_STEADY_RATIO`。
   *
   * **两个条件缺一不可**：只看计数会误伤"低占用会话里输出被 `max_tokens` 截断"
   * 这种**该照常续接**的情形 —— 低占用时压缩被稳态跳过（计数不再清零而保持 ≥ 阈值），
   * 但此时上下文有余量，放大输出预算重发正是正确处置。
   */
  private isCompactionStalled(): boolean {
    return (
      (this.loopState.consecutiveCompactNoEffect ?? 0) >=
        ReActToolLoop.COMPACT_NO_EFFECT_SKIP_THRESHOLD &&
      (this.loopState.lastCompactRatio ?? 0) >=
        ReActToolLoop.COMPACT_STEADY_RATIO
    );
  }

  /** 对标 openclaw（2026-09-01）：不完整回合检测——空回复 / 只思考无答案 / 只计划不行动，
   *  注入重试指令（每类最多 1 次，防死循环）让骨架再给一次机会。 */
  protected override async onIncompleteTurn(
    result: ReasonResult<ToolLoopContext>,
    _context?: ToolLoopContext
  ): Promise<boolean> {
    if (result.toolCalls.length > 0) {
      // 二期 F2-0（2026-09-23 修复计划 §六）：**统一两处对立判据** —— 本轮已产出 tool_calls
      // 通常不属"不完整回合"，不该由本钩子接管；但若本轮是**外部拦停**（超时），这批调用
      // 已被丢弃 ⇒ 必须**显式留痕**（结构化日志 + 收尾文案），不得静默消失。
      if (this.state.phase === 'timeout' && this.droppedToolCallsAtStop > 0) {
        logger.warn('reactToolLoop:tool_calls_dropped_on_stop', {
          sessionId: this.ctx.session.id,
          reason: 'timeout',
          droppedToolCalls: this.droppedToolCallsAtStop,
          toolNames: result.toolCalls.map((tc) => tc.name),
        });
      }
      return false;
    }
    const text = (result.text ?? '').trim();

    let kind: 'empty' | 'reasoning' | 'planning' | 'truncated' | null = null;
    // 修复（2026-09-03）：输出被长度限制截断（finishReason=max_tokens）是最常见的
    // "任务中断"伪装——模型没写完就被预算打断且未产出 tool_calls。此前该信号被
    // reason() 改写为 'stop' 且此处无截断分支 → 直接 finalize → 用户看到"才提要求就中断"。
    if (result.finishReason === 'max_tokens') {
      kind = 'truncated';
    } else if (!text && !this._lastRoundHadThinking) {
      kind = 'empty'; // 空回复
    } else if (!text && this._lastRoundHadThinking) {
      kind = 'reasoning'; // 只思考未给出可见答案
    } else if (text && PLANNING_ONLY_RE.test(text)) {
      kind = 'planning'; // 只描述计划未行动（保守启发式）
    }
    if (!kind) return false;
    // R4（2026-09-16）：已注入强制收尾 steering（接近上限）后，截断输出**不再续接重发**——
    // 续接会用放大后的 maxTokens 重发并加剧上下文膨胀；此时直接取当前部分文本作为最终
    // 交付（收敛场景下"有残缺结论"优于"为求完整继续膨胀/空转"）。
    if (kind === 'truncated' && this.convergeSteeringPrompted) {
      logger.info('reactToolLoop:truncated_converge_no_continue', {
        sessionId: this.ctx.session.id,
        textPreview: text.slice(0, 80),
      });
      return false;
    }
    // 压缩失败暂停续接（2026-09-22）：压缩已连续压不动 **且** 上下文确实吃紧 ⇒
    // 续接会按「放大后的 maxTokens + 压不下来的上下文」重发，只会加剧膨胀与空转。
    // 发送前虽有 `truncateApiMessages` 硬截断兜底（`MessageContextPipeline.ts:291`），
    // 但那是"削足适履"（丢掉旧消息）而非真压缩 ⇒ 不宜以此为由继续续接。
    // 处置与 R4 一致：直接取当前部分文本交付 —— "有残缺结论"优于"继续膨胀/空转"。
    if (kind === 'truncated' && this.isCompactionStalled()) {
      logger.warn('reactToolLoop:truncated_compaction_stalled_no_continue', {
        sessionId: this.ctx.session.id,
        consecutiveNoEffect: this.loopState.consecutiveCompactNoEffect,
        lastCompactRatio: this.loopState.lastCompactRatio ?? null,
        textPreview: text.slice(0, 80),
      });
      // P1-4（B2-4，2026-09-23）：压缩停滞**落 Goal** —— 此前只"暂停本轮续接"，
      // 目标层看不到"为何停下"（缺口 X9）。连续 3 次 ⇒ 终态 `failed` ⇒ **续接有界**
      //（D7：否则"落 blocked → 续接 → 又压缩失败"会成死循环）。
      // 三期 F3-1：本处（循环中途）仍**显式 detach**（不阻塞本轮回捞判定）；可 await 的
      // 终止路径见 `settleTerminalState()` → `flushTerminalSettlement()`。
      void this.settleGoalForTurnNow('compaction_stalled');
      // 三期 F3-2（2026-09-23 修复计划 §六）：压缩失败**必须联动收尾** —— 置专门相位，
      // 使判别器给出 `compaction_failed`（不再被折叠成 `completed` 后只落一句通用兜底），
      // 用户可见"为何停下"。原实现只 `return false`，收尾文案与压缩无任何关联。
      this.state.phase = 'compaction_failed';
      return false;
    }
    if (this._incompleteRetries[kind] >= 1) return false; // 每类最多重试 1 次

    const instruction =
      kind === 'empty'
        ? EMPTY_RESPONSE_RETRY_INSTRUCTION
        : kind === 'reasoning'
          ? REASONING_ONLY_RETRY_INSTRUCTION
          : kind === 'planning'
            ? PLANNING_ONLY_RETRY_INSTRUCTION
            : TRUNCATED_RESPONSE_RETRY_INSTRUCTION;
    this._incompleteRetries[kind]++;
    // 截断续接：下一轮 reason 放大输出预算（截断是硬性预算不足，重试需更多额度）
    if (kind === 'truncated') this._boostNextReasonMaxTokens = true;
    // 注入重试指令：下一轮 reason 的 LLM 输入会携带（对齐 openclaw 重试语义）
    this.loopState.messages.push({
      role: 'user',
      content: `[SYSTEM] ${instruction}`,
    } as Record<string, unknown>);
    logger.info('reactToolLoop:incomplete_turn_retry', {
      sessionId: this.ctx.session.id,
      kind,
      retries: { ...this._incompleteRetries },
      textPreview: text.slice(0, 80),
    });
    return true;
  }

  /** 下沉自 TAORLoop（2026-09-01）：steering 消息注入到工具轮对话上下文，下一轮 reason 生效 */
  protected override async onSteering(messages: string[]): Promise<void> {
    for (const sm of messages) {
      // B3-2（2026-09-23）：片段类型化 —— `[STEERING] ` 由 `kind:'steering'` 给出，
      // 渲染唯一走 `renderFragment()`（拼接结果与迁移前**逐字一致**）。
      this.loopState.messages.push({
        role: 'user',
        content: renderFragment(createFragment({ kind: 'steering', text: sm })),
      } as Record<string, unknown>);
    }
    logger.info('reactToolLoop:steering_injected', {
      sessionId: this.ctx.session.id,
      count: messages.length,
      toolTurn: this.loopState.toolTurnCount,
    });
  }

  /**
   * 二期 F2-4（2026-09-23 修复计划 §六）：run 级复位"回合质量重试计数"。
   *
   * 对齐 `TAORLoop.reset()` 的**既有先例**（其注释原文：'回合质量重试计数随 run 归零
   * （不跨 run 累积）'）。此前本类的 `_incompleteRetries` 只有初始化与累加、**全类无
   * 任何清零** ⇒ 实为"任务级终身一次"：第二次空回复直接放行 → 空正文。
   *
   * 注：TAORLoop 的键集只有 2 个（`empty` / `planning`），本类有 4 个 ⇒ 全部纳入。
   * `resetRunState()` 由宿主在每次 run 前调用（见 `ReActLoop.resetRunState` 注释）。
   */
  protected override resetRunState(): void {
    super.resetRunState();
    this._incompleteRetries.empty = 0;
    this._incompleteRetries.reasoning = 0;
    this._incompleteRetries.planning = 0;
    this._incompleteRetries.truncated = 0;
    this.droppedToolCallsAtStop = 0;
    this._terminalSettled = false;
    this._terminalSettle = null;
  }

  /** A2（2026-09-05）：循环检测终止由 loopState.loopDetected 判别（供骨架访问器） */
  protected override isLoopDetectedReason(): boolean {
    return this.loopState.loopDetected != null;
  }

  /**
   * 轮级熔断 / 压缩停滞 / 终止 ⇒ **落 Goal 状态**的执行体（P1-2 / P1-4 / N2，二期 F3-1 起可 await）。
   *
   * - **零回归**：该会话无未终结目标时 `settleGoalForTurn` 立即返回 `null`（不建行、不写库）；
   * - **不掩盖失败**：catch 留痕（CS03）——目标状态属"意图/观测面"，落盘失败**不得抛出**给收尾路径；
   * - **可观测**（二期 F3-1 / 治 N4）：改为返回 Promise，由调用方决定 await 还是显式 detach
   *   —— 原实现为 fire-and-forget，调用方**无法感知、无法重试、无法断言**。
   */
  private async settleGoalForTurnNow(reason: GoalTurnReason): Promise<void> {
    try {
      await settleGoalForTurn({
        sessionId: this.ctx.session.id,
        reason,
      });
    } catch (err) {
      // @ignore-catch — 目标状态属观测/意图面，落盘失败不得影响本轮收尾（CS03）
      logger.warn('reactToolLoop:goal_turn_settle_failed', {
        sessionId: this.ctx.session.id,
        reason,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  protected finalize(): Message {
    // 二期 F2-3（2026-09-23 修复计划 §六）：`finalize` = **纯投影**（可重入）+ **幂等**副作用。
    // 背景（N1）：本方法每轮**至少被调用 2 次**（`run()` 的 return 值 + `streamMessageFlow`
    // 的 `getAssistantMessage()`），而 `getAssistantMessage()` 只是转调本方法 ⇒ 它实际是
    // "带写库副作用的 getter"（D3）；原实现在 loopDetected 分支内**直接**发副作用
    // ⇒ 重复取消息会重复落 Goal、加速把目标打成 failed。
    const msg = this.computeFinalMessage();
    this.settleTerminalState();
    return msg;
  }

  /**
   * 二期 F2-3：最终消息的**纯投影**（无副作用、可重入）。
   *
   * 文案与 metadata.finishReason 由 `resolveTerminationOutput()` 单一来源提供
   * （一期 F1-1：此前 `finalize` 与 `getTerminationTip` 各写一份同样的文案，两处一旦
   * 漂移，"流里提示"与"落库提示"就会对不上）。
   */
  private computeFinalMessage(): Message {
    const { suffix, finishReason } = this.resolveTerminationOutput();

    // 无终止提示且已有消息（正文非空）⇒ 原样返回，零行为变更
    if (!suffix && this.loopState.assistantMessage) {
      return this.loopState.assistantMessage;
    }

    const rawContent = this.loopState.assistantMessage?.content;
    const base = typeof rawContent === 'string' ? rawContent : '';
    const msg = this.ctx.messageService.createAssistantMessage(base + suffix, {
      sessionId: this.ctx.session.id,
      // 复用流式主路径已创建的消息 id（P0-fix 同源意图）：否则新消息换 id，前端流式 chunk
      // （见 streamMessageFlow 的补发点）会挂到另一个气泡上，兜底文案反而"看不见"。
      ...(this.loopState.assistantMessage
        ? { id: this.loopState.assistantMessage.id }
        : {}),
    });
    if (finishReason) {
      // A3（2026-09-05）：截断/循环/预算终止消息 metadata 落 finishReason
      //（自由 Record、JSON 落库无需 schema 扩展）
      const withMeta = msg as { metadata?: Record<string, unknown> };
      withMeta.metadata = { ...withMeta.metadata, finishReason };
    }
    return msg;
  }

  /**
   * 二期 F2-3：终止**副作用**（当前为"落 Goal"）—— **幂等**，每轮至多执行一次。
   *
   * 把"哪些终止会落 Goal"从 `if` 分支的**物理位置**改为**从终止原因派生**（与 D5 同构的修法）。
   *
   * ⚠️ 落 Goal 的**语义边界**（二期 N2，2026-09-23）：
   * - `loop_detected` ⇒ `turn_error`：**真·无进展**，推进 `no_progress_streak`（达阈值 ⇒ 终态 `failed`）；
   * - `max_turns` / `timeout` / `budget_exhausted` / `error` / `aborted` ⇒ 走 N2 新增的
   *   **只记录**原因码（`turn_limit` / `turn_timeout` / `turn_budget_exhausted` /
   *   `turn_interrupted` / `user_aborted`）：**不改状态、不计无进展、不触发 idle 续接**
   *   —— 它们都不是"无进展"，混入计数会把目标误判为失败，`user_aborted` 更会与用户意图相反。
   */
  private settleTerminalState(): void {
    if (this._terminalSettled) return;
    this._terminalSettled = true;

    const reason = this.getTerminationReason();

    // P1-2（B2-4，2026-09-23）+ 二期 N2：**把"哪些终止落 Goal"从 `if` 分支的物理位置改为
    // 从终止原因派生**（与 D5 同构的修法）。
    // - `loop_detected` ⇒ `turn_error`：既有语义 —— **推进** `no_progress_streak`，达阈值落终态；
    // - 其余非完成原因 ⇒ N2 新增的**只记录**原因码（不改状态、不计数、不触发 idle 续接）。
    const goalReason = this.mapTerminationToGoalReason(reason);

    // 三期 F3-1（治 N4，2026-09-23）：副作用**同步发起、边界 await** ——
    // 骨架的 `finalize()` 保持同步签名（否则要改 10 处 `return this.finalize(...)`
    // 与 3 个子类签名，收益相同而风险高得多）；此处记录 pending promise，
    // 由 `flushTerminalSettlement()` 在轮次边界（拿到最终消息后）await ⇒ 失败可被观测/断言。
    this._terminalSettle = (async () => {
      if (goalReason) {
        await this.settleGoalForTurnNow(goalReason);
      }

      // 二期 F2-5（治 N3）：`max_turns` 与 `loop_detected` 同时命中时，循环检测信号此前被
      // **整个吞掉**（既无提示也无 metadata）。此处留痕一次（提示文案已在投影侧并列上报）。
      if (reason === 'max_turns' && this.loopState.loopDetected) {
        logger.warn('reactToolLoop:loop_detected_shadowed_by_max_turns', {
          sessionId: this.ctx.session.id,
          detector: this.loopState.loopDetected.detector,
          message: this.loopState.loopDetected.message,
          iteration: this.state.iteration,
          maxIterations: this.config.maxIterations,
        });
      }
    })();
  }

  /**
   * 三期 F3-1（2026-09-23 修复计划 §六）：等待本轮终止副作用落定（**幂等**）。
   *
   * 由轮次边界（`streamMessageFlow` 取到最终消息之后）调用 ⇒ 落盘失败/耗时**可被 await
   * 观测与断言**，而不是只留一条无人可等的 `warn`（治 N4 / D2）。
   * 未发起过副作用（如正常完成无需落 Goal）⇒ 立即 resolve。
   */
  async flushTerminalSettlement(): Promise<void> {
    await (this._terminalSettle ?? Promise.resolve());
  }

  /**
   * 二期 N2（2026-09-23 修复计划 §六）：终止原因 ⇒ 目标层原因码（`null` = 正常完成，无需落目标）。
   *
   * 映射原则：**语义等价才共用原因码**。`loop_detected` 表示"真·无进展"（推进
   * `no_progress_streak`）；其余四类在语义上都不是"无进展" ⇒ 走"只记录"路径。
   * `compaction_stalled` 不在此表 —— 它由 `onIncompleteTurn` 直接落（压缩停滞的判点在那里）。
   */
  private mapTerminationToGoalReason(
    reason: TerminationReason
  ): GoalTurnReason | null {
    switch (reason) {
      case 'loop_detected':
        return 'turn_error';
      case 'max_turns':
        return 'turn_limit';
      case 'timeout':
        return 'turn_timeout';
      case 'budget_exhausted':
        return 'turn_budget_exhausted';
      case 'error':
        return 'turn_interrupted';
      case 'aborted':
        return 'user_aborted';
      // 三期 F3-2：压缩停滞**已由 `onIncompleteTurn` 直接落** `compaction_stalled`
      //（判点在压缩停滞处）⇒ 此处返回 null，避免同一次终止落两次目标状态。
      case 'compaction_failed':
        return null;
      // 正常完成 / 其余子类专属 stop reason：不落目标
      case 'completed':
      case 'verifier_escalate':
      case 'diminishing_returns':
        return null;
      default: {
        // 穷尽断言：新增 TerminationReason 成员而未在此映射 ⇒ 编译失败
        const exhaustive: never = reason;
        throw new Error(
          `reactToolLoop:unhandled goal turn reason (${String(exhaustive)})`
        );
      }
    }
  }

  /**
   * 二期 F2-1（2026-09-23 修复计划 §六）：终止输出**单一来源**，且判别**接线既有判别器**。
   *
   * 一期只做到"文案单点"（仍在本方法内自行重写判别条件）；二期改为：
   *   1. 原因一律取自 `getTerminationReason()`（`ReActLoop.ts` —— TAORLoop / SubAgentEngine /
   *      LongRunningTaskOrchestrator 三处生产路径已验证）⇒ 消除"同一事实两套判据"；
   *   2. 文案由 `switch (reason)` **穷尽映射**，`default` 用 `never` 断言 ⇒ **新增
   *      `TerminationReason` 成员而不补文案会编译失败**（对标事件类型三处同步的编译期约束）。
   *
   * 返回的 `reason` 供 `finalize()` 判定"是否需落 Goal"（副作用与判据同源）。
   */
  private resolveTerminationOutput(): {
    suffix: string;
    finishReason?: string;
    reason: TerminationReason;
  } {
    const reason = this.getTerminationReason();
    let suffix = '';
    let finishReason: string | undefined;

    switch (reason) {
      // 6. maxTurns 提示文案：达 maxIterations 时附加。
      // 对标 hermes（2026-09-01）：有 onMaxIterations 生成的总结则输出"已自动总结当前进度"，
      // 无总结（请求失败/超时）回退为默认提示（CS03）。
      // B1（2026-09-01）：不依赖 phase==='completed'——达上限后 phase 可能非 completed，
      // 原条件导致提示被吞（实测达上限后最终消息仅 30 字符，用户无感知任务中断）。
      case 'max_turns': {
        // 判别器把 `phase === 'truncated'`（输出长度截断）也归为 max_turns，但"轮次上限
        // 总结"只在真正达 maxIterations 时才有 ⇒ 文案以其为准（截断场景走下方统一兜底）。
        if (this.state.iteration >= this.config.maxIterations) {
          finishReason = 'max_turns';
          suffix = this.loopState.maxIterationsSummary
            ? `\n\n⚠️ 已达到最大工具轮次限制 (${this.config.maxIterations})，已自动总结当前进度：\n${this.loopState.maxIterationsSummary}`
            : `\n\n⚠️ 已达到最大工具轮次限制 (${this.config.maxIterations})，工具链提前终止。`;
        }
        // 二期 F2-5（治 N3，2026-09-23）：判别器顺序使 `max_turns` **先于** `loop_detected`，
        // 两者同时命中时（长任务里"既循环又到轮次上限"很常见）循环检测信息会被**整个吞掉**
        // （既无提示也无 metadata）⇒ 此处**并列上报**（不改变既有优先级的排序语义）。
        // 留痕（logger）在 settleTerminalState() 内，保证每轮只记一次（投影可重入）。
        if (this.loopState.loopDetected) {
          const ld = this.loopState.loopDetected;
          suffix += `\n\n（同时检测到工具调用循环 [${ld.detector}] ${ld.message}）`;
        }
        break;
      }
      // 4. 循环检测提示
      case 'loop_detected':
        finishReason = 'loop_detected';
        suffix = `\n\n⚠️ 检测到工具调用循环 [${this.loopState.loopDetected?.detector ?? 'unknown'}] ${this.loopState.loopDetected?.message ?? ''}，任务提前终止。`;
        break;
      // L1（2026-09-06）：骨架 budget_exhausted phase（流式预算耗尽）附加原因提示——
      // 对齐 A3 截断/循环提示风格，避免用户看到"无正文直接中断"的困惑。
      case 'budget_exhausted':
        finishReason = 'budget_exhausted';
        suffix = `\n\n⚠️ 已达到本轮 token 预算上限，工具链提前终止。`;
        break;
      // P4（2026-09-01）：error 终止时附加 lastError——no_progress 熔断/电路熔断的
      // 降级提示此前只 yield 了 error 事件、finalize 未附加（assistantMessage 空正文时
      // 用户看不到任何原因，实测熔断后仅 24 字符）。此处统一附加。
      // P8（2026-09-01）：不再加 ⚠️ 前缀——降级/部分完成是正常收尾（需用户提供信息的
      // 协作请求），前端对 ⚠️ 开头的消息有警告样式，用户误以为系统异常。
      case 'error':
        suffix = this.state.lastError ? `\n\n${this.state.lastError}` : '';
        break;
      // 一期 F1-3（2026-09-23）：用户主动停止——此前无对应分支，若此时尚无正文
      // ⇒ 落盘空消息（用户点"停止"却拿到一片空白）。
      case 'aborted':
        suffix = `\n\n⏹ 已按你的请求停止本轮生成。`;
        break;
      // 二期 F2-2（2026-09-23）：会话级总时长上限——此前该支不置相位，被判别器误判为
      // 'completed' ⇒ 用户看到"正常完成"却拿不到任何结论；并如实交代被丢弃的工具调用。
      case 'timeout': {
        const dropped = this.droppedToolCallsAtStop;
        suffix =
          `\n\n⚠️ 本轮已达会话总时长上限（${Math.round(ReActToolLoop.MAX_TOTAL_DURATION_MS / 60000)} 分钟），已停止继续执行。` +
          (dropped > 0
            ? `另有 ${dropped} 个已生成但未执行的工具调用随之作废。`
            : '');
        break;
      }
      // 三期 F3-2（2026-09-23）：上下文压缩失败/停滞 ⇒ 明确告知"为何停下"。
      // 此前该路径只 `return false`，phase 落 `completed` ⇒ 收尾文案与压缩无任何关联
      //（有正文时连兜底都不给，用户只看到"莫名其妙结束了"）。
      case 'compaction_failed':
        suffix = `\n\n⚠️ 上下文压缩未能生效（连续压不动且上下文已吃紧），本轮已停止继续执行。你可以重试、精简上下文，或新开一个会话继续。`;
        break;
      // 无专属文案的原因（正常完成 / 其余子类专属 stop reason）：是否兜底取决于正文是否
      // 为空 —— 见下方统一兜底（一期 F1-1）。
      case 'completed':
      case 'verifier_escalate':
      case 'diminishing_returns':
        break;
      default: {
        // 二期 F2-1：**穷尽断言** —— 新增 TerminationReason 成员而未在此补文案 ⇒ 编译失败
        const exhaustive: never = reason;
        throw new Error(
          `reactToolLoop:unhandled termination reason (${String(exhaustive)})`
        );
      }
    }

    // 一期 F1-1：无提示且正文为空 ⇒ 兜底（"正常结束但零文本"此前是静默空白，即本 BUG 现象）。
    if (!suffix) {
      const rawContent = this.loopState.assistantMessage?.content;
      // 结构化内容（ContentBlock[]）视为"已有内容"——不在此处改写，避免丢块
      const hasVisibleText = Array.isArray(rawContent)
        ? true
        : (typeof rawContent === 'string' ? rawContent : '').trim().length > 0;
      if (!hasVisibleText) suffix = EMPTY_OUTPUT_FALLBACK_TEXT;
    }

    return { suffix, finishReason, reason };
  }

  // ─── 私有辅助 ───────────────────────────────────────

  /** 非流式 LLM 调用（对齐旧类 _nonStreamingLlmRound）：tools 透传 + usage 上报 */
  private async _callLlmNonStreaming(): Promise<ChatResponse> {
    this.loopState.llmCallCount++;
    const response = await this.ctx.activeClient.sendMessage(
      this.loopState.messages as unknown as ChatMessage[],
      {
        ...this.ctx.options,
        tools:
          this.ctx.toolDefinitions.length > 0
            ? this.ctx.toolDefinitions
            : undefined,
      }
    );
    this._reportUsage(response);
    // L1：每轮 LLM 响应后向骨架预算记账（delta，防上下文无界增长；无预算时 no-op）
    this._chargeStreamBudget();
    return response;
  }

  /**
   * 流式 LLM 调用（generator，M4 方案 A）：逐 chunk 增量 yield reasoning_delta / thinking_delta
   * （P0-C 恢复 + thinking 转发），return 携带清洗后的 ChatResponse。
   * @param retried 残缺工具重试标记：maxTokens 加倍（对齐旧类 _streamLlmRound）
   */
  /**
   * P2-3（2026-09-02）：同工具同参数重复调用纠偏。
   *
   * 实测（session_mtjj70e8qti55w79nif）：模型拿到工具结果后仍机械重调同一工具——
   * 3 轮 file_read 结果均为全文（5415 字符），inputTokens 8378→16796 证明内容已回喂
   * 上下文，但模型无视工具结果，循环守卫 3 轮熔断。此处检测"本轮与上一轮工具名+
   * 参数完全相同"，向下一轮注入 user 角色强纠偏指令（比 tool 结果消息更醒目，
   * 模型必然处理），并要求改用不同参数（offset/limit）才允许再次读取。
   */
  private _injectRepeatCallCorrection(calls: ToolCallEntry[]): void {
    const currentKeys = calls.map(
      (tc) => `${tc.name}:${_toolCallArgsKey(tc.input)}`
    );
    const prevKeys = this._lastToolCallKeys;
    this._lastToolCallKeys = currentKeys;
    if (
      !prevKeys ||
      currentKeys.length === 0 ||
      currentKeys.length !== prevKeys.length ||
      !currentKeys.every((k, i) => k === prevKeys[i])
    ) {
      return;
    }
    const names = [...new Set(calls.map((c) => c.name))].join('、');
    this.loopState.messages.push({
      role: 'user',
      content:
        `[SYSTEM] 你刚刚重复调用了与上一轮完全相同的工具（${names}，参数相同）。` +
        `该工具的结果已在上文上下文中，请直接基于已有内容分析并作答，` +
        `不要再调用相同的工具与参数。如确需查看不同部分，请使用不同的参数` +
        `（例如 file_read 的 offset/limit 分页读取不同行段）。`,
    } as Record<string, unknown>);
    logger.warn('reactToolLoop:repeat_call_correction_injected', {
      sessionId: this.ctx.session.id,
      toolNames: names,
      toolTurn: this.loopState.toolTurnCount,
      messageCount: this.loopState.messages.length,
    });
    // P2-3 配套（2026-09-22）：登记"本轮已注入软纠偏" ⇒ 基类无进展熔断**让路一次**。
    // 修复前纠偏与熔断在同一轮判定、硬熔断抢先收尾，模型永远看不到纠偏指令。
    this.repeatCorrectionPending = true;
  }

  /** M1 事件溯源（2026-08-23）：工具轮 text/thinking chunk 写 events.jsonl。
   * 对齐 streamMessageFlow 主循环（首轮已实时写）——此前缺失导致工具轮正文/思考
   * 不进事件流，重新打开会话（events 派生）时正文缺失，仅靠 legacy 合并兜底。
   */
  private async _appendStreamEvent(
    type:
      | 'assistant/text'
      | 'assistant/thinking'
      | 'tool/canceled'
      | 'assistant/question',
    data: unknown
  ): Promise<void> {
    const { appendStreamEvent, getStreamTailSeq } = this.ctx;
    if (!appendStreamEvent || !getStreamTailSeq) return;
    try {
      const ts = await getStreamTailSeq(this.ctx.session.id);
      await appendStreamEvent(this.ctx.session.id, {
        type,
        schemaVersion: 1,
        seq: ts + 1,
        time: Date.now(),
        sessionId: this.ctx.session.id,
        // P1-3：工具轮 chunk 事件携带预分配的 assistant 消息 id
        data: {
          ...(data as Record<string, unknown>),
          messageId: this._activeToolRoundMessageId,
        },
      });
    } catch {
      // @ignore-catch — 事件追加失败不阻断工具循环（CS03）
    }
  }

  /**
   * A 缺口修复（2026-09-02，P3-7f 基准）：工具轮 text chunk 写入——
   * 优先走 ctx.bufferTextChunk 聚合缓冲（随下次 append 自动 flush 为
   * assistant/text-batch，F-2 语义等价），缺失时回退逐 chunk
   * assistant/text（旧行为，兼容其它调用方）。失败不抛错（CS03）。
   */
  private async _writeToolRoundText(content: string): Promise<void> {
    const buffer = this.ctx.bufferTextChunk;
    if (buffer) {
      try {
        await buffer(
          this.ctx.session.id,
          this._activeToolRoundMessageId,
          content
        );
      } catch {
        // @ignore-catch — 缓冲失败不阻断工具循环（CS03）
      }
      return;
    }
    await this._appendStreamEvent('assistant/text', { content });
  }

  /**
   * A 缺口修复：冲刷工具轮正文缓冲（流结束/异常路径调用，防止尾部正文滞留缓冲）
   */
  private async _flushToolRoundText(): Promise<void> {
    const flush = this.ctx.flushTextBuffer;
    if (!flush) return;
    try {
      await flush(this.ctx.session.id);
    } catch {
      // @ignore-catch — 冲刷失败不阻断工具循环（CS03）
    }
  }

  /**
   * G12（2026-08-23）：骨架 run() 产出的 tool_start/tool_end 事件携带工具轮消息 id，
   * 供 reactEventsToChunks 透传到 SSE chunk（前端工具轮块归属对位）。
   */
  protected override getCurrentMessageId(): string | undefined {
    return this._activeToolRoundMessageId || undefined;
  }

  private async *_streamLlm(
    retried = false
  ): AsyncGenerator<ReActEvent, ChatResponse> {
    this.loopState.llmCallCount++;
    // P1-3（2026-08-23）：工具轮 assistant 消息 id 预分配——必须在首个 chunk 事件写入前确定，
    // 首次工具轮 loopState.assistantMessage 尚不存在（N4/A3）；已有则复用其 id。
    this._activeToolRoundMessageId =
      this.loopState.assistantMessage?.id ||
      `msg-turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const toolRoundBaseMaxTokens =
      (this.ctx.options?.maxTokens as number | undefined) ?? 4096;
    // 截断续接放大（2026-09-03）：onIncompleteTurn truncated 分支置位后，本轮预算 base×4
    //（封顶 64K），一次性消费掉标记，避免后续轮次持续放大。
    const boostMaxTokens = this._boostNextReasonMaxTokens;
    if (boostMaxTokens) this._boostNextReasonMaxTokens = false;
    const toolRoundMaxTokens = boostMaxTokens
      ? Math.min(Math.max(toolRoundBaseMaxTokens * 4, 32768), 64000)
      : retried
        ? Math.min(Math.max(toolRoundBaseMaxTokens * 2, 8192), 64000)
        : toolRoundBaseMaxTokens;
    const gen = this.ctx.activeClient.streamMessage(
      this.loopState.messages as unknown as ChatMessage[],
      {
        ...this.ctx.options,
        maxTokens: toolRoundMaxTokens,
        signal: this.ctx.abortSignal,
        tools:
          this.ctx.toolDefinitions.length > 0
            ? this.ctx.toolDefinitions
            : undefined,
      }
    );
    const textChunks: string[] = [];
    // P13（2026-09-01）：工具轮 LLM 流式 text chunk 过 StreamingThinkScrubber——
    // 模型输出 <think> 内容时此前原样流式输出（仅最终 content 有清洗链），
    // 前端实时看到思考内容泄露到正文。流式逐 chunk 擦除 think/response/XML 标签。
    const thinkScrubber = new StreamingThinkScrubber();
    // KB-EVENT-BATCH（2026-08-29）：工具轮 thinking 事件防抖合并——推理模型
    // thinking chunk 逐条落盘使 events.jsonl 膨胀，会话加载 O(N²) 卡死。
    const THINKING_BATCH_SIZE = 50;
    const THINKING_BATCH_MS = 2000;
    let thinkingAccum: string[] = [];
    let lastThinkingFlushAt = Date.now();
    const flushThinkingEvents = async () => {
      if (thinkingAccum.length === 0) return;
      const joined = thinkingAccum.join('');
      thinkingAccum = [];
      lastThinkingFlushAt = Date.now();
      try {
        await this._appendStreamEvent('assistant/thinking', {
          content: joined,
        });
      } catch {
        // @ignore-catch — 事件追加失败不阻断流式（CS03）
      }
    };
    let next = await gen.next();
    while (!next.done) {
      const chunk = next.value;
      if (typeof chunk === 'string') {
        // P13（2026-09-01）：流式擦除 think/response/XML 标签——此前原样输出，
        // 前端实时看到 <think> 思考内容泄露到正文（仅最终 content 有清洗链）。
        const scrubbed = thinkScrubber.scrub({
          content: chunk,
          isComplete: false,
        }).content;
        if (scrubbed) {
          textChunks.push(scrubbed);
          // 增量文本即时输出（对齐旧类 P0-C：工具轮 LLM 文本逐 chunk SSE）
          yield {
            type: 'reasoning_delta',
            text: scrubbed,
            messageId: this._activeToolRoundMessageId,
          };
          // M1 事件溯源：工具轮 text chunk 补写事件（A 缺口修复：优先聚合缓冲 →
          // flush 为 assistant/text-batch，消除逐 chunk 写放大；缺失能力时回退
          // 逐 chunk assistant/text，兼容其它调用方）
          await this._writeToolRoundText(scrubbed);
        }
      } else if (chunk?.type === 'thinking') {
        // 本轮产出 thinking 标记（reasoning-only 检测用，对标 openclaw 2026-09-01）
        this._lastRoundHadThinking = true;
        yield {
          type: 'thinking_delta',
          content: chunk.content,
          messageId: this._activeToolRoundMessageId,
        };
        // KB-EVENT-BATCH：thinking 防抖合并落盘
        const thinkingContent =
          typeof chunk.content === 'string'
            ? chunk.content
            : JSON.stringify(chunk.content);
        thinkingAccum.push(thinkingContent);
        if (
          thinkingAccum.length >= THINKING_BATCH_SIZE ||
          Date.now() - lastThinkingFlushAt >= THINKING_BATCH_MS
        ) {
          await flushThinkingEvents();
        }
      }
      try {
        next = await gen.next();
      } catch (err) {
        // KB-EVENT-BATCH-FLUSH（2026-08-29）：流中断/异常时 flush thinking 防抖缓冲，
        // 避免最后一批 thinking 丢失（原异常路径直接跳过 flush），再传播异常。
        await this._flushToolRoundText().catch(() => {});
        await flushThinkingEvents().catch(() => {});
        throw err;
      }
    }
    // 流结束：先 flush 工具轮正文缓冲（A 缺口修复，防尾部正文滞留），
    // 再 flush 剩余 thinking 增量（KB-EVENT-BATCH）
    await this._flushToolRoundText();
    await flushThinkingEvents();
    // P13：flush 未闭合的 think 标签残留（不应输出到正文）
    const thinkResidual = thinkScrubber.flush();
    if (thinkResidual) textChunks.push(thinkResidual);
    const final = next.value as ChatResponse;
    const rawContent = final.content ?? textChunks.join('');

    // 清洗链：think 标签修复 → 图片修复 → strip think → scrubber → orphan 标签
    const repairedContent = ensureThinkResponseTags(
      repairImageUrls(rawContent)
    );
    const strippedContent = stripThinkResponseTags(repairedContent);
    const scrubber = new StreamingToolCallScrubber();
    const scrubbed = scrubber.scrub({
      content: strippedContent,
      isComplete: true,
    });
    const residual = scrubber.flush();
    const cleanContent = stripOrphanToolTags(scrubbed.content + residual);
    const onStream = this.ctx.options?.onStream as
      | ((content: string) => void)
      | undefined;
    onStream?.(cleanContent);

    this._reportUsage(final);
    // L1：每轮 LLM 响应后向骨架预算记账（delta，防上下文无界增长；无预算时 no-op）
    this._chargeStreamBudget();

    return {
      ...final,
      content: cleanContent,
    };
  }

  /** 转发流式 LLM 的增量事件，收集 return 值（供 reason generator 使用） */
  private async *_consumeStreamingLlm(
    retried: boolean
  ): AsyncGenerator<ReActEvent, ChatResponse> {
    try {
      const iter = this._streamLlm(retried);
      let r = await iter.next();
      while (!r.done) {
        yield r.value;
        r = await iter.next();
      }
      return r.value;
    } catch (error) {
      // P1-2（2026-08-26）：LLM 流中断兜底——复用 TAOR errorRecovery 判定，
      // 网络/服务端/限流/超时等瞬态错误重试一次（走非流式，避免流式事件重复）；
      // abort 类（上下文溢出等需上层降级）才抛出。
      const e = error instanceof Error ? error : new Error(String(error));
      const recovery = this._llmRecovery.assess(e, {
        turnCount: this.loopState.toolTurnCount,
        tokenUsage: 0,
      });
      if (recovery.action !== 'abort') {
        logger.warn('reactToolLoop:llm_interrupt_retry', {
          sessionId: this.ctx.session.id,
          error: e.message.slice(0, 200),
          action: recovery.action,
          turnCount: this.loopState.toolTurnCount,
        });
        // 非流式重试一次：优先保证 agent 循环继续（长程任务无人值守前提）
        return await this._callLlmNonStreaming();
      }
      throw error;
    }
  }

  /** usage 上报（对齐旧类：recordChatResponseUsage + onToolUsage + trackUsage） */
  private _reportUsage(response: ChatResponse): void {
    const usage = (response as unknown as { usage?: ChatResponse['usage'] })
      .usage;
    // 成本 0/0 修复（2026-08-14 复检 #5）：provider 流式返回的 usage 缺失（undefined）
    // 时跳过空记录——原实现无条件 trackUsage，产生 "LLM call recorded: 0/0 tokens"
    // + warn"成本累加" 空条，污染 LLMTracker 与成本统计。有 usage 时经
    // recordChatResponseUsage → `metric/timing` 事件（D1：校准的唯一数据源）驱动校准，
    // 此处空记录不丢真实数据。
    if (
      !usage ||
      (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0) === 0
    ) {
      return;
    }
    this.ctx.recordChatResponseUsage(this.ctx.session.id, usage);
    this.ctx.onToolUsage?.((usage as Record<string, unknown>) ?? {});
    trackUsage(response as unknown as Record<string, unknown>, {
      model: (this.ctx.options?.model as string) || 'unknown',
      providerId: this.ctx.activeClient.getProviderId(),
      latencyMs: 0,
      isStreaming: !this.input.nonStreaming,
      sessionId: this.ctx.session.id,
    }).catch(() => {});
  }

  /**
   * L1（2026-09-06）：每轮 LLM 响应后向骨架预算记账——按当前上下文估算扣减（delta
   * 语义由 createStreamBudget 维护，对齐 TAORLoop observe 增量扣减；compact 回落不退款）。
   * 仅当 config.budget 为工厂注入的可记账预算（含 chargeContextEstimate）时生效；
   * 显式传入的普通 BudgetControllerLike 不记账（由外部负责耗尽判定）。
   */
  private _chargeStreamBudget(): void {
    const budget = this.config.budget as
      | (BudgetControllerLike & {
          chargeContextEstimate?: (estimatedTokens: number) => void;
        })
      | undefined;
    budget?.chargeContextEstimate?.(
      this.ctx.estimateMessagesTokens(this.loopState.messages)
    );
  }

  /**
   * 注册 pendingInteraction，返回 questionData + 等待 promise（v3：不挂起调用方，
   * 由 act 内迭代消费 _awaitAnswersWithHeartbeat 产出心跳并等待答案）。
   */
  private _registerInteraction(tc: ToolCallEntry): {
    questionData: QuestionData;
    promise: Promise<string[]>;
  } {
    const questionId = `q_${Date.now()}_${(tc.id || '').slice(0, 8)}`;
    const args = tc.input as Record<string, unknown>;
    const questionData: QuestionData = {
      questionId,
      question: String(args.question),
      header: String(args.header),
      options: (args.options as QuestionOption[]) ?? [],
      multiSelect: args.multiSelect === true,
      questionType:
        (args.questionType as QuestionData['questionType']) ?? 'choice',
    };
    let resolve!: (answers: string[]) => void;
    const promise = new Promise<string[]>((res) => (resolve = res));
    this.ctx.pendingInteractions.set(this.ctx.session.id, {
      questionId,
      promise,
      resolve,
    });
    logger.info('reactToolLoop:interaction_registered', {
      sessionId: this.ctx.session.id,
      questionId,
      question: String(args.question).slice(0, 100),
      optionCount: (args.options as QuestionOption[])?.length ?? 0,
      multiSelect: args.multiSelect === true,
    });
    return { questionData, promise };
  }

  /**
   * 等待答案：Promise.race 轮询产出心跳事件 + abort/超时兜底。
   * ★ async generator，必须迭代消费（act 内 while 转发 yield），禁止直接 await。
   */
  private async *_awaitAnswersWithHeartbeat(
    questionId: string,
    promise: Promise<string[]>
  ): AsyncGenerator<ReActEvent, string[] | undefined> {
    const sig = this.ctx.abortSignal;
    const onAbort = () => abortResolve('abort');
    let abortResolve!: (v: 'abort') => void;
    const abortPromise = new Promise<'abort'>((res) => {
      abortResolve = res;
      // v3：sig undefined 时禁用 abort 兜底（超时兜底仍生效），不再静默挂起
      if (!sig) return;
      if (sig.aborted) {
        res('abort');
        return;
      }
      sig.addEventListener('abort', onAbort, { once: true });
    });
    const timeoutPromise = new Promise<'timeout'>((res) =>
      setTimeout(res, this.maxWaitMs, 'timeout' as const)
    );
    try {
      const waitStart = Date.now();
      logger.info('reactToolLoop:interaction_wait_start', {
        sessionId: this.ctx.session.id,
        questionId,
        heartbeatMs: this.heartbeatMs,
        maxWaitMs: this.maxWaitMs,
      });
      while (true) {
        const winner = await Promise.race([
          promise.then((a) => ({ kind: 'answer' as const, value: a })),
          sleep(this.heartbeatMs).then(() => ({
            kind: 'hb' as const,
          })),
          abortPromise.then((v) => ({ kind: v as 'abort' })),
          timeoutPromise.then((v) => ({ kind: v as 'timeout' })),
        ]);
        if (winner.kind === 'answer') {
          logger.info('reactToolLoop:interaction_resolved', {
            sessionId: this.ctx.session.id,
            questionId,
            answerCount: winner.value.length,
            waitMs: Date.now() - waitStart,
          });
          return winner.value;
        }
        if (winner.kind === 'abort' || winner.kind === 'timeout') {
          logger.warn('reactToolLoop:interaction_stopped', {
            sessionId: this.ctx.session.id,
            questionId,
            reason: winner.kind,
            waitMs: Date.now() - waitStart,
          });
          return undefined;
        }
        // 心跳事件（高频：仅 debug，避免刷屏；配合 wait_start/resolved 可还原完整等待曲线）
        logger.debug('reactToolLoop:interaction_heartbeat', {
          sessionId: this.ctx.session.id,
          questionId,
          waitMs: Date.now() - waitStart,
        });
        yield { type: 'question_waiting' }; // 心跳事件
      }
    } finally {
      // v3：显式移除 abort 监听器，避免跨轮多次提问累积
      if (sig) sig.removeEventListener('abort', onAbort);
      // 候选 C（2026-09-05）：abort 立即清理；timeout 保留 entry 宽限——晚到回答
      // 不再命中「未找到待处理交互」warn，而走 answeredAfterExpiry 落盘语义。
      // 注：保留 entry 无监听方（生成器已返回），resolve 仅作幂等记录与清理；
      // 「超时窗口内自动续跑」需产品化 re-run（§10.7 C 边界，未在本改动实现）。
      if (!this._interactionTimedOut) {
        this.ctx.pendingInteractions.delete(this.ctx.session.id);
      }
      this._interactionTimedOut = false;
    }
  }

  /** 供调用点读取最终消息（A2 runCollect 取 return 值即达）。
   *  始终走 finalize()：其内部已按 正常消息 → 循环检测提示 → maxTurns 提示 → lastError 分支处理，
   *  直接返回 loopState.assistantMessage 会跳过提示分支（循环检测/maxTurns 下消息缺失）。 */
  getAssistantMessage(): Message {
    return this.finalize();
  }

  /**
   * 2026-09-01：终止提示（达上限 / 循环检测 / 预算耗尽 / 推理错误 / 主动停止 / 空回复兜底）。
   * finalize 生成的终止提示只在最终消息里，不在 loop.run 事件流（reactEventsToChunks
   * 不产出）——调用点需补发 text chunk，否则前端流式收不到（实测 fullContentLength 0，
   * 用户对任务中断无感知）。
   *
   * 一期 F1-1（2026-09-23 修复计划）：改由 `resolveTerminationOutput()` **单一来源**提供，
   * 与 finalize 落库正文逐字相等（此前本方法是第二份硬编码，且只覆盖 2/4 类终止）。
   */
  getTerminationTip(): string {
    return this.resolveTerminationOutput().suffix;
  }

  /** 供转换层聚合心跳（M1c）：已完成工具名（去重）+ 执行总次数 */
  getHeartbeatData(): {
    completedToolNames: string[];
    totalCompletedToolCount: number;
  } {
    return {
      completedToolNames: [...this.loopState.completedToolNames],
      totalCompletedToolCount: this.loopState.totalCompletedToolCount,
    };
  }

  /** 取走并清空待产出的 todo 数据（M1c：供调用点转 todo chunk，对齐旧类 yield todo） */
  getPendingTodos(): TodoBlockData[] {
    const todos = this.loopState.pendingTodos;
    this.loopState.pendingTodos = [];
    return todos;
  }
}

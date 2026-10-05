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
import { createPathGuard } from '@modules/query';
import { configManager } from '@modules/config';
import type {
  ReActLoopConfig,
  ReasonResult,
  ActResult,
  ToolCallEntry,
  ToolResultEntry,
  ReActEvent,
} from '@modules/query';
import type { ToolLoopContext, ToolLoopInput } from './ToolLoopRunner.js';
import { ToolTurnBudget } from './toolTurnBudget.js';
import { StreamingLlm } from './streamingLlm.js';
import {
  ToolResultPostProcess,
  safeStringify,
  type ParallelBatchItem,
} from './toolResultPostProcess.js';
import type { ToolCall, ToolResult } from '@modules/session/types/tool.js';
import type { ChatResponse, ChatMessage } from '@modules/ai';
import type { Message } from '@modules/session/types/message.js';
import { getToolCallName } from '@modules/session/types/tool.js';
import { getLogger } from '@modules/monitoring';
// B3-2（2026-09-23）：注入片段统一类型 —— 通道前缀由类型给出（唯一渲染入口 renderFragment）
import {
  createFragment,
  renderFragment,
  FRAGMENT_KIND_FIELD,
} from '@modules/context';
import { registerYieldFromResults } from '../session/yield';
// M-7（2026-09-22）：续接指令文案**单一来源**（原为本文件内 4 个硬编码常量，逐字迁移）
// 保留子路径直连（不走 `@modules/tasks` 桶）：本文件在**模块顶层**读取
// `CONTINUATION_TEMPLATES.*`（L121-125），桶求值期 tasks 桶可能仍在循环中未初始化
// ⇒ 走桶会触发 `ReferenceError: Cannot access 'CONTINUATION_TEMPLATES' before initialization`
// （2026-09-24 R03-002 收敛时实测复现）。goalTemplates 是无依赖叶子模块，子路径直连为循环安全入口。
import {
  CONTINUATION_TEMPLATES,
  renderGoalTemplate,
} from '../tasks/goal/goalTemplates';
// P1-1②（2026-09-28）：终稿 mermaid **结构预检**（零依赖启发式，边界见该模块头注释）。
// 该模块无任何 import ⇒ 叶子，无循环风险。
import {
  lintMermaidBlocks,
  formatMermaidIssues,
  type MermaidLintIssue,
} from '@modules/utils/mermaidLint';
import type { LiriEvent } from '@modules/session/types/events';
// P1-2 / P1-4（B2-4，2026-09-23）：轮级熔断 / 压缩停滞 ⇒ **落 Goal**（目标层可见"为何停下"）。
// 注意：`tasks/` 不是 `chat/`，此处不构成"反向层依赖"（与 goalTemplates 同向）。
import { settleGoalForTurn, type GoalTurnReason } from '@modules/tasks';
// X8（2026-09-23，Spec §5.5）：主会话预算触顶 ⇒ 下一轮请求前经 steering 注入收尾指令
import { injectMainSessionBudgetWrapUp } from '@modules/tasks';
import {
  prepareToolResultsForContext,
  resolveToolParamNames,
} from '@modules/tools';
import {
  truncateApiMessages,
  sanitizeApiMessages,
} from './services/MessageContextPipeline';
import { StreamingThinkScrubber } from '@modules/streaming';
import { stripBareExploration } from './services/bareExplorationStripper';
import { extractTodoData } from './services/ChatHelper';
import type { TodoBlockData } from '@modules/runtime/api/todo-types';
import type {
  QuestionData,
  QuestionOption,
} from '@modules/runtime/api/CoreAPI.js';
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
import { getMemoryPressureMonitor } from '@modules/monitoring';

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
  /** 一期 O1-2（2026-09-24）：PathGuard 拦截留痕（与"循环检测"分通道，供收尾文案如实交代） */
  guardBlocked: { toolName: string; reason: string } | null;
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

export class ReActToolLoop extends ReActLoop<
  ToolLoopInput,
  ToolLoopContext,
  Message
> {
  private ctx: ToolLoopContext;
  private input: ToolLoopInput;

  private loopState: ReActToolLoopState;

  /** 分层窗口压缩最近触发时间（2026-09-02，防抖用，见 LAYER_COMPACT_MIN_INTERVAL_MS） */
  private _lastLayerCompactAt = 0;
  /** 本轮 reason 是否产出 thinking（reasoning-only 检测，对标 openclaw 2026-09-01） */
  private _lastRoundHadThinking = false;
  /**
   * O2-4（2026-09-24）：下一轮 reason 的正文是否**取代**已下发正文（续接/重试轮）。
   *
   * 由 `onIncompleteTurn` 在注入回捞指令时置位（该路径只处理"无 tool_calls 的不完整回合"
   * ⇒ 续接轮正文与前一轮处于**同一显示位置**，应取代而非追加）；在 `_streamLlm` 的首个
   * 正文 delta 上消费并清零（一次性）。
   */
  private _supersedeNextRoundText = false;
  /** 不完整回合重试计数（每类上限 1 次，防死循环，对标 openclaw RETRY_LIMITS） */
  private readonly _incompleteRetries = {
    empty: 0,
    reasoning: 0,
    planning: 0,
    truncated: 0,
  };
  /**
   * P1-1②（2026-09-28）：终稿校验回喂是否已用掉（**每 run 至多 1 次**）。
   *
   * 上限 1 的理由：预检是**启发式**（见 `utils/mermaidLint.ts` 头注释，与 mermaid 真解析器判定
   * 不保证一致）⇒ 若模型按指令改了而启发式仍判不合格，再回喂就是**纯空转**（每轮多一次
   * LLM 请求）。只给一次机会，其后如实放行（用户仍看到前端 ① 的降级卡片，不会静默）。
   */
  private _outputValidationRetried = false;
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
  /**
   * L2（2026-09-06）：PathGuard 越界路径防护（对齐 batch 三守卫；仅 deny 列表命中才拦截）
   * 2026-09-29：注入**运行期注册表**派生解析器 ⇒ 覆盖静态名单外的工具（含 MCP 动态工具）
   */
  private readonly pathGuard = createPathGuard({
    resolvePathArgKeys: resolveToolParamNames,
  });

  /** v3：交互心跳间隔（前端 STREAM_IDLE_TIMEOUT_MS=60s，10s 留 5 次余量）+ 最大等待（防资源泄漏） */
  private static readonly INTERACTION_HEARTBEAT_MS = 10_000;
  private static readonly INTERACTION_MAX_WAIT_MS = 10 * 60_000;
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

  /**
   * Todo 扩容 / 轮次预算 / 长任务信号（C8 纯搬迁，2026-10-05，见 `toolTurnBudget.ts`）。
   * 宿主状态经 getter 惰性读取（`loopState`/`ctx`/`baseMaxToolTurns` 均在构造期后才就绪）。
   */
  private readonly toolTurnBudget = new ToolTurnBudget({
    getLoopState: () => this.loopState,
    getCtx: () => this.ctx,
    getBaseMaxToolTurns: () => this.baseMaxToolTurns,
  });

  /**
   * LLM 流式/清洗/用量（C4 纯搬迁，2026-10-05，见 `streamingLlm.ts`）。
   * 宿主状态经 getter/setter 读写（`loopState`/`ctx`/`config`/`state`/`input` 与三个
   * 跨簇标记字段均在构造期后就绪，且 run 期内可变）。
   */
  private readonly streamingLlm = new StreamingLlm({
    getCtx: () => this.ctx,
    getLoopState: () => this.loopState,
    getConfig: () => this.config,
    getState: () => this.state,
    getInput: () => this.input,
    getBoostNextReasonMaxTokens: () => this._boostNextReasonMaxTokens,
    setBoostNextReasonMaxTokens: (value) => {
      this._boostNextReasonMaxTokens = value;
    },
    getSupersedeNextRoundText: () => this._supersedeNextRoundText,
    setSupersedeNextRoundText: (value) => {
      this._supersedeNextRoundText = value;
    },
    getLastRoundHadThinking: () => this._lastRoundHadThinking,
    setLastRoundHadThinking: (value) => {
      this._lastRoundHadThinking = value;
    },
  });

  /**
   * 工具结果后处理 / 循环守卫（C3 纯搬迁，2026-10-05，见 `toolResultPostProcess.ts`）。
   * 宿主状态经 getter/闭包读写（`loopState`/`ctx` 与基类 `steeringQueue`/`completedWork`，
   * 以及 B1/B3 模块读数均在构造期后就绪，且 run 期内可变）。
   */
  private readonly toolResultPostProcess = new ToolResultPostProcess({
    getCtx: () => this.ctx,
    getLoopState: () => this.loopState,
    getActiveToolRoundMessageId: () =>
      this.streamingLlm.activeToolRoundMessageId(),
    pushSteering: (text) => {
      this.steeringQueue.push(text);
    },
    getCompletedWork: () => this.completedWork,
    recordPendingTodo: (todoData) => this._recordPendingTodo(todoData),
  });

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
      // 可诊断性（2026-09-26）：预算相关日志（budget_exhausted / grace_call）需能对到会话
      sessionId: ctx.session.id,
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
      guardBlocked: null,
      pendingTodos: [],
      /** R2（2026-09-16）：工具轮内压缩连续 no_effect 次数——达到阈值后在低用量时稳态跳过，避免每轮白跑重 token */
      consecutiveCompactNoEffect: 0,
    };
  }

  /** 8.4③（2026-09-16，治缺陷 2/3）：履约 resetRunState() 契约 + 恢复基础轮次上限。
   * 复用实例（如 batch 缓存）时避免跨 run 状态污染与扩容值残留。
   *
   * 2026-09-25（跨 run 预算，spec §3.5 最小变体）：起始额度由"**任务累计消耗**"推导 ——
   * 续段**不回退续期斜坡**（拿 `base + renewal(累计)` 而非从 `base` 重来），
   * 但本段仍可再至 `MAX_DYNAMIC_TOOL_TURNS_CAP` ⇒ 长任务可持续推进（不设任务级总量上限）。 */
  override async *run(
    input: ToolLoopInput
  ): AsyncGenerator<ReActEvent, Message> {
    this.resetRunState();
    this._initToolTurnBudget();
    this.config.maxIterations = this._resolveDynamicMaxIterations().max;
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
    // 缺陷 A/C 修复（2026-09-25）：续期速率与消耗 1:1、todo 项读扩容快照；
    // 跨 run 预算（2026-09-25，spec §3.5 最小变体）：额度按**任务累计消耗**算 ⇒ 续段不回退
    // 续期斜坡，但本段仍可再至硬顶（长任务可持续推进；无任务级总量上限）。
    const { max: dynamicMax, breakdown } = this._resolveDynamicMaxIterations();
    if (dynamicMax > this.config.maxIterations) {
      logger.info('reactToolLoop:dynamic_max_turns_expanded', {
        sessionId: this.ctx.session.id,
        base: this.config.maxIterations,
        expanded: dynamicMax,
        toolTurn: this.loopState.toolTurnCount,
        expansionBreakdown: breakdown,
      });
      this.config.maxIterations = dynamicMax;
    }
    // 跨 run 预算：内存写（每轮，零 IO）—— 落盘节流见 `_publishToolTurnBudget` 注释
    this._publishToolTurnBudget();

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
      // 经统一出入口（R05-012）
      const baseWindow = Number(
        configManager.env('REACT_LAYER_WINDOW_TOKENS', '45000')
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
   * 1) 移除注入指令残留（旧任务求助指令干扰）——按结构化标记 `FRAGMENT_KIND_FIELD`
   *    判别（`system`/`steering`），**不再**匹配 `[STEERING]`/`[SYSTEM]` 前缀字符串；
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
      // 1) 移除系统注入指令残留（CS02：按**结构化标记**判别，禁止前缀字符串匹配）
      //    标记 `FRAGMENT_KIND_FIELD` 由所有注入指令的 push 点（本文件 4 处 + onSteering，
      //    以及 cross-loop 的 TAORLoop 注入点）写入；前缀口径变化不再影响本判别。
      const fragmentKind = m[FRAGMENT_KIND_FIELD];
      if (
        m.role === 'user' &&
        (fragmentKind === 'system' || fragmentKind === 'steering')
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
        content: renderFragment(
          createFragment({
            kind: 'system',
            text: '请以最新一条用户消息为准重新规划当前任务；之前工具循环中未完成的工作仅在与最新消息直接相关时继续，否则忽略，不要重复执行旧任务步骤。',
          })
        ),
        [FRAGMENT_KIND_FIELD]: 'system',
      });
      logger.info('reactToolLoop:new_task_sanitized', {
        sessionId: this.ctx.session.id,
        removedCount,
        remainingMessages: this.loopState.messages.length,
      });
    }
  }

  /** todo 登记（消费队列 + 扩容快照双写；实现见 `toolTurnBudget`） */
  private _recordPendingTodo(todoData: TodoBlockData): void {
    this.toolTurnBudget._recordPendingTodo(todoData);
  }

  /** 跨 run 预算基线初始化（实现见 `toolTurnBudget`） */
  private _initToolTurnBudget(): void {
    this.toolTurnBudget._initToolTurnBudget();
  }

  /** 内存写：更新 `session.metadata.toolTurnBudget`（实现见 `toolTurnBudget`） */
  private _publishToolTurnBudget(): void {
    this.toolTurnBudget._publishToolTurnBudget();
  }

  /** 长任务信号（实现见 `toolTurnBudget`） */
  private _isLongTaskSignal(): boolean {
    return this.toolTurnBudget._isLongTaskSignal();
  }

  /**
   * 长任务信号（公开读数，供宿主做**运行中分流**判定 —— D3，2026-09-25）。
   *
   * 纯读数、无副作用；宿主（`streamMessageFlow` → `ChatManager`）据此决定是否按**既有**升级
   * 通道把任务接给 PDCA 编排（闸门见 `chat/longTaskEscalation.ts`）。
   */
  getLongTaskSignal(): {
    isLongTask: boolean;
    pendingTodoCount: number;
    consumedTurns: number;
  } {
    return this.toolTurnBudget.getLongTaskSignal();
  }

  /** 动态扩容计算：基础阈值 + 未完成 todo 项数 × 每项轮次 + 探索续期，封顶 500（实现见 `toolTurnBudget`） */
  private _resolveDynamicMaxIterations(): {
    max: number;
    breakdown: {
      pendingTodoCount: number;
      todo: number;
      fetch: number;
      renewal: number;
      /** 跨 run 基线（同任务已消耗） */
      baseline: number;
      /** 任务累计消耗 = 基线 + 本段轮次 */
      taskConsumed: number;
    };
  } {
    return this.toolTurnBudget._resolveDynamicMaxIterations();
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
      response = await this.streamingLlm.callLlmNonStreaming();
      cleanContent = response.content ?? '';
    } else {
      response = yield* this.streamingLlm.consumeStreamingLlm(false);
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
        response = await this.streamingLlm.callLlmNonStreaming();
      } else {
        response = yield* this.streamingLlm.consumeStreamingLlm(true);
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
          id: this.streamingLlm.activeToolRoundMessageId(),
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
          // 一期 O1-2（2026-09-24）：**不再复用 `loopDetected` 通道**。原实现（L1000 注释
          // "复用 loopDetected 终止通道"）使收尾文案固定为"检测到工具调用循环 [pathGuard]"
          // ⇒ 把**安全护栏拦截**说成"模型陷入循环"，语义误导（问题清单 G3）。
          // 此处只**留痕**；终止判据与相位置位在 `shouldContinue`（判据返回 false 的同一处，
          // 与 timeout 同款）——否则相位会被下一轮 reason 前的 `phase='reasoning'` 覆盖。
          this.loopState.guardBlocked = {
            toolName: tc.name,
            reason: pathCheck.reason ?? '未知原因',
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
            await this.streamingLlm.appendStreamEvent('assistant/question', {
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
            await this.streamingLlm.appendStreamEvent('assistant/question', {
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
        yield* this.toolResultPostProcess._flushParallelBatch(
          parallelBatch,
          results,
          processedResults
        );
        // 2026-09-01 P1：abort 时立即以"已中止"错误结果 fallback（见 _raceToolAbort）
        const toolResult = await this.toolResultPostProcess._raceToolAbort(
          executeRun,
          () => ({
            toolCallId: tc.id,
            toolName: tc.name,
            error: '工具执行被中止（会话停止，abort signal）',
          })
        );

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
                this.streamingLlm.activeToolRoundMessageId(),
              ...(this.ctx.toolCallSeqMap?.has(tc.id)
                ? { callSeq: this.ctx.toolCallSeqMap.get(tc.id) }
                : {}),
            },
          }
        );
        this.ctx.addAndPersistMessage(this.ctx.session.id, toolResultMsg);

        // P3-6（2026-09-02）：文件产出循环检测（串行路径——非并发安全工具走此处）
        this.toolResultPostProcess._detectFileWriteLoop(tc);

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
          this._recordPendingTodo(todoData);
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
      yield* this.toolResultPostProcess._flushParallelBatch(
        parallelBatch,
        results,
        processedResults
      );

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
            this.streamingLlm.activeToolRoundMessageId() ||
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
          await this.streamingLlm.appendStreamEvent('tool/canceled', {
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

  protected shouldContinue(
    _input: ToolLoopInput,
    result: ReasonResult<ToolLoopContext>
  ): boolean {
    // 4. 循环检测触发后停止
    if (this.loopState.loopDetected) return false;
    // 一期 O1-2（2026-09-24）：PathGuard 拦截 ⇒ 显式终止。相位必须**在此处置位**
    // （判据返回 false 的同一处，与下方 timeout 同款）——若只在 act() 里置位，会被下一轮
    // reason 前的 `phase='reasoning'` 覆盖，判别器又只能退化为 'completed'。
    if (this.loopState.guardBlocked) {
      this.state.phase = 'guard_blocked';
      return false;
    }
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
          content: renderFragment(
            createFragment({
              kind: 'system',
              text:
                '工具轮次已用尽，请只用文字总结（不要调用任何工具）：\n' +
                '1) 已完成的工作；\n' +
                '2) 未完成的工作；\n' +
                '3) 若要继续，最少需要哪几步（≤3 步，避免再次超限）。',
            })
          ),
          [FRAGMENT_KIND_FIELD]: 'system',
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
      // 三期 F3-1：本处（循环中途）**不再 `void` 显式 detach** —— 二期 O2-2（2026-09-24）
      // 把它**登记进 `_terminalSettle`**：与 `settleTerminalState()` 同机制，由
      // `flushTerminalSettlement()` 在轮次边界 await ⇒ 落盘失败/耗时**可被观测与断言**。
      // （原实现 `void ...` 且未登记，而 `mapTerminationToGoalReason('compaction_failed')`
      //   返回 null ⇒ 该次落盘既不被 await 也不并入链，治 N4 的目标在此路径未闭环。）
      this._terminalSettle = this.settleGoalForTurnNow('compaction_stalled');
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
    // O2-4：回捞轮正文**取代**前一轮已下发正文（前端据此从零重建，与落盘 content 同源）
    this._supersedeNextRoundText = true;
    // 注入重试指令：下一轮 reason 的 LLM 输入会携带（对齐 openclaw 重试语义）
    this.loopState.messages.push({
      role: 'user',
      content: renderFragment(
        createFragment({ kind: 'system', text: instruction })
      ),
      [FRAGMENT_KIND_FIELD]: 'system',
    } as Record<string, unknown>);
    logger.info('reactToolLoop:incomplete_turn_retry', {
      sessionId: this.ctx.session.id,
      kind,
      retries: { ...this._incompleteRetries },
      textPreview: text.slice(0, 80),
    });
    return true;
  }

  /**
   * P1-1②（2026-09-28）：**终稿校验** —— mermaid 结构预检失败 ⇒ 注入修正指令、本轮内重试一次。
   *
   * 为什么在**循环内**而不是收尾后（`StreamPipeline.postProcess`）：收尾后的 steering 只能在
   * **下一次请求前**生效（跨轮，且用户已先看到坏图）；此处返回 `true` ⇒ 骨架 `continue`，
   * 同一轮内模型立刻拿到修正指令 ⇒ 用户最终看到的是**修正后**的回复（真自纠回路）。
   *
   * §1.6 红线：修正指令是**模型可见输入** ⇒ 先落 `validation/injected`（`text` ＝ 注入正文），
   * 再经 `steeringQueue` 注入 —— `[STEERING] ` 前缀由 `onSteering` 的片段类型拼装，
   * 故事件 `text` 不含前缀（与 `goal/injected` 同口径）。
   */
  protected override async onFinalOutputValidation(
    result: ReasonResult<ToolLoopContext>,
    _context?: ToolLoopContext
  ): Promise<boolean> {
    if (this._outputValidationRetried) return false;
    // 与本类 `onIncompleteTurn` 同款守卫：骨架通常在无 tool_calls 时才走到这里，但**外部拦停**
    // （超时）路径下 `shouldContinue=false` 而 tool_calls 仍在（F2-0）——那不是"终稿"，不校验。
    if (result.toolCalls.length > 0) return false;
    const text = (result.text ?? '').trim();
    if (!text) return false;

    const issues = lintMermaidBlocks(text);
    if (issues.length === 0) return false;

    const instruction = renderGoalTemplate('mermaid_repair', {
      issues: formatMermaidIssues(issues),
    });
    // 先落盘（§1.6：模型将看到什么，必须先从事件日志可重建），再注入。
    await this._emitValidationInjected(issues, instruction);

    this._outputValidationRetried = true;
    // 与 O2-4 同款：修正轮正文**取代**坏正文（避免坏图与修正图并存于同一回复）。
    this._supersedeNextRoundText = true;
    // 经既有 steering 通道注入：下一轮 reason 前由 `onSteering` 消费为 `[STEERING] …`
    this.steeringQueue.push(instruction);

    logger.warn('reactToolLoop:final_output_validation_retry', {
      sessionId: this.ctx.session.id,
      kind: 'mermaid',
      issueCount: issues.length,
      issues,
      textLength: text.length,
    });
    return true;
  }

  /**
   * P1-1②：落一条 `validation/injected` 事件。
   *
   * 不复用 `_appendStreamEvent`：后者是**工具轮 chunk 事件**专用（强制附 `_activeToolRoundMessageId`），
   * 本事件不属任何 assistant 消息。`seq: 0` ⇒ 由 append 在 mutex 内原子分配（既有约定，
   * 与 `GoalEvents.appendGoalEvent` 同款）。
   */
  private async _emitValidationInjected(
    issues: MermaidLintIssue[],
    text: string
  ): Promise<void> {
    const { appendStreamEvent } = this.ctx;
    // 观测面能力缺失（如单测替身未装配）⇒ 如实不落（不伪造）
    if (!appendStreamEvent) return;
    const event: LiriEvent<'validation/injected'> = {
      type: 'validation/injected',
      schemaVersion: 1,
      seq: 0,
      time: Date.now(),
      sessionId: this.ctx.session.id,
      data: { kind: 'mermaid', issues, channel: 'steering', text },
    };
    try {
      await appendStreamEvent(this.ctx.session.id, event);
    } catch {
      // @ignore-catch — 事件落盘属观测面，失败不得中断自纠回路（CS03）
    }
  }

  /** 下沉自 TAORLoop（2026-09-01）：steering 消息注入到工具轮对话上下文，下一轮 reason 生效 */
  protected override async onSteering(messages: string[]): Promise<void> {
    for (const sm of messages) {
      // B3-2（2026-09-23）：片段类型化 —— `[STEERING] ` 由 `kind:'steering'` 给出，
      // 渲染唯一走 `renderFragment()`（拼接结果与迁移前**逐字一致**）。
      // 同时写入结构化标记 `FRAGMENT_KIND_FIELD`：供 `_sanitizeForNewTask` 按标记判别残留（CS02）。
      this.loopState.messages.push({
        role: 'user',
        content: renderFragment(createFragment({ kind: 'steering', text: sm })),
        [FRAGMENT_KIND_FIELD]: 'steering',
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
    // 一期 O1-2：PathGuard 留痕随 run 归零（与 _incompleteRetries 同批，防跨 run 误判"被拦截"）
    this.loopState.guardBlocked = null;
    // 缺陷 C（2026-09-25）：扩容快照随 run 归零（`pendingTodos` 队列本身由消费侧自然清空，
    // 无需在此处理）。**归零不等于丢弃**：若本次 run 是**同任务续跑**，紧随其后的
    // `_initTodoExpansion()` 会从 `session.metadata.todoExpansion` 回填（口径与预算基线同源）
    // —— 否则续段（新实例）的 todo 扩容恒为 0。
    // 跨 run 预算基线随 run 归零（随后由 `_initToolTurnBudget()` 按本次 run 的语义重新回填：
    // 系统续跑继承 / 用户消息清零）—— 防复用实例携带上一段基线
    this.toolTurnBudget.resetRunState();
    // O2-4：正文取代标记随 run 归零（一次性语义，禁止跨 run 残留误清正文）
    this._supersedeNextRoundText = false;
    // P1-1②（2026-09-28）：终稿校验回喂配额随 run 归零（"每 run 至多 1 次"，
    // 与 `_incompleteRetries` 同批——否则第二次坏图直接放行）
    this._outputValidationRetried = false;
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
    const { suffix, finishReason, concurrentReasons } =
      this.resolveTerminationOutput();

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
    if (finishReason || concurrentReasons?.length) {
      // A3（2026-09-05）：截断/循环/预算终止消息 metadata 落 finishReason
      //（自由 Record、JSON 落库无需 schema 扩展）
      // 一期 O1-1（2026-09-24）：并列上报的**并发终止原因**一并落 metadata —— 此前循环信号
      // 只出现在文案里（metadata.finishReason 仍为 max_turns）⇒ 按 metadata 消费的下游丢事实。
      const withMeta = msg as { metadata?: Record<string, unknown> };
      withMeta.metadata = {
        ...withMeta.metadata,
        ...(finishReason ? { finishReason } : {}),
        ...(concurrentReasons?.length ? { concurrentReasons } : {}),
      };
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
    // 二期 O2-2（2026-09-24）：**接续**此前已登记的中途落盘（如 `compaction_stalled`）——
    // 直接覆盖赋值会让 `flushTerminalSettlement()` 只 await 到后者，先发的那次又变成"无人可等"。
    const previousSettle = this._terminalSettle;
    this._terminalSettle = (async () => {
      if (previousSettle) await previousSettle;
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
      // 二期 O2-1（2026-09-24）：**真·无进展**（轮签名重复熔断 / 连续全失败电路熔断）
      // ⇒ 与 `loop_detected` 同语义，**推进** `no_progress_streak`。此前它们折叠进 `error`
      // ⇒ 映射成 `turn_interrupted`（只记录、不计数），使"最该计数的无进展"失效（G1）。
      case 'no_progress':
      case 'circuit_breaker':
        return 'turn_error';
      // 二期 O2-1：其余细分成员都不是"无进展" ⇒ 只记录（见 N2 语义边界）
      case 'reasoning_error':
      case 'exploration_fatigue':
      case 'internal_error':
        return 'turn_interrupted';
      case 'aborted':
        return 'user_aborted';
      // 二期 O2-1：系统中止 ≠ 用户主动放弃 ⇒ 独立原因码（只记录）
      case 'system_aborted':
        return 'system_aborted';
      // 一期 O1-2（2026-09-24）：PathGuard 拦截**不是"无进展"** —— 模型没有陷入循环，
      // 而是触碰了受限路径 ⇒ 走"只记录"路径，不推进 `no_progress_streak`
      //（语义边界见 N2 注释：混入计数会把目标误判为 failed）。
      case 'guard_blocked':
        return 'turn_interrupted';
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
    /**
     * 一期 O1-1（2026-09-24）：与主原因**同时命中**的其它终止原因（并列上报）。
     *
     * 唯一来源：判别器把 `max_turns` 排在 `loop_detected` **之前** ⇒ 长任务"既循环又到
     * 轮次上限"时，循环信号此前只出现在**文案/日志**里，`metadata.finishReason` 仍是
     * `max_turns` ⇒ 按 metadata 消费的下游（统计/前端归因/审计）看不到循环（问题清单 G2）。
     * 本字段**不改判别器优先级语义**，只把已被识别的事实结构化（与 F2-5 文案并列同源）。
     */
    concurrentReasons?: TerminationReason[];
  } {
    const reason = this.getTerminationReason();
    let suffix = '';
    let finishReason: string | undefined;
    let concurrentReasons: TerminationReason[] | undefined;

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
          // 跨 run 预算（spec §3.5 最小变体）：本段额度**就是**任务级 grant（可再至硬顶）
          // ⇒ 文案直接展示该值（单段运行与修复前逐字一致，既有用例不受影响）。
          suffix = this.loopState.maxIterationsSummary
            ? `\n\n⚠️ 已达到最大工具轮次限制 (${this.config.maxIterations})，已自动总结当前进度：\n${this.loopState.maxIterationsSummary}`
            : `\n\n⚠️ 已达到最大工具轮次限制 (${this.config.maxIterations})，工具链提前终止。`;
          // G3（2026-09-25，`.trae/specs/long-task-routing.md`）：**长任务**触顶时给出
          // **可执行**的编排建议。载体选择（与 spec D2 的偏离，如实记录）：走**用户可见的
          // 收尾提示**而非模型可见的 steering —— ① 既有 `goal/injected` 载荷要求
          // `goalId` + 闭集 `templateKind`，非目标任务无法复用；② 新增事件类型与 spec N5 冲突；
          // ③ 该提示随最终助手消息落盘 ⇒ 无需新增模型可见输入（§1.6 红线面为零）。
          // 命令名事实来源：`/goal start`（command-registry 的 `goal` 命令，与
          // `POST /v1/pdca/start` 同链）；`OnboardHints.PDCA_EXPLICIT_ENTRY` 与本文案
          // 由用例断言保持一致（防第二处漂移）。
          if (this._isLongTaskSignal()) {
            suffix +=
              '\n\n💡 该任务仍需多步推进？可改用编排分步执行：`/goal start <描述>`' +
              '（也可在新消息里说明"请分步做并自检"，我会自动升级为 PDCA）。';
          }
        }
        // 二期 F2-5（治 N3，2026-09-23）：判别器顺序使 `max_turns` **先于** `loop_detected`，
        // 两者同时命中时（长任务里"既循环又到轮次上限"很常见）循环检测信息会被**整个吞掉**
        // （既无提示也无 metadata）⇒ 此处**并列上报**（不改变既有优先级的排序语义）。
        // 留痕（logger）在 settleTerminalState() 内，保证每轮只记一次（投影可重入）。
        if (this.loopState.loopDetected) {
          const ld = this.loopState.loopDetected;
          suffix += `\n\n（同时检测到工具调用循环 [${ld.detector}] ${ld.message}）`;
          // 一期 O1-1：与文案并列上报到**结构化字段**（此前只进文案，metadata 丢失该事实）。
          concurrentReasons = ['loop_detected'];
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
      // 二期 O2-1（2026-09-24）：`error` 细分后的 5 类**共用"透传 lastError"的正文策略**
      // ——各产出点写入的 lastError 本身已是该场景的可操作文案（P1/P8/P12 已调优，不动文案）；
      // 但 `finishReason` **各自如实落 metadata** ⇒ 下游（统计/前端归因/审计/目标层）可据
      // metadata 区分"无进展熔断 / 探索疲劳 / 电路熔断 / 推理错误 / 内部异常"，不再只有 error。
      case 'reasoning_error':
      case 'no_progress':
      case 'exploration_fatigue':
      case 'circuit_breaker':
      case 'internal_error':
        finishReason = reason;
        suffix = this.state.lastError ? `\n\n${this.state.lastError}` : '';
        break;
      // 二期 O2-1：系统中止 ⇒ 明确"这不是你点的停止"（此前文案是"已按你的请求停止"）
      case 'system_aborted':
        finishReason = 'system_aborted';
        suffix = `\n\n⏹ 本轮生成已中止（连接中断或会话被关闭）。如需继续，请重新发送消息。`;
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
      // 一期 O1-2（2026-09-24）：PathGuard 拦截 ⇒ 如实交代"被安全护栏拦了哪个工具、为什么"。
      // 此前复用了 `loop_detected` 的文案 ⇒ 用户被告知"检测到工具调用循环"（语义相反）。
      case 'guard_blocked': {
        const guard = this.loopState.guardBlocked;
        finishReason = 'guard_blocked';
        suffix = guard
          ? `\n\n⚠️ 已拦截对受限路径的访问（${guard.toolName}：${guard.reason}），本轮提前结束。如需继续，请改用允许的路径。`
          : `\n\n⚠️ 已拦截对受限路径的访问，本轮提前结束。如需继续，请改用允许的路径。`;
        break;
      }
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
      if (!hasVisibleText) {
        suffix = EMPTY_OUTPUT_FALLBACK_TEXT;
        // T-⑥08（2026-10-02 实证）：该兜底触发时**此前不落任何诊断字段** —— 实测会话里
        // 4 次命中的助手消息 `finishReason` / `tokenUsage` / `startedAt` **全为 null**，
        // 导致"高频空回复"无法归因（其中 3 次是"只出思考、无正文"）。此处补一条结构化
        // 诊断日志（**只加日志，不改文案** —— 文案受"流式补发与落库逐字一致"回归守卫）。
        const blocks = this.loopState.assistantMessage?.blocks ?? [];
        const blockTypes = Array.from(new Set(blocks.map((b) => b.type)));
        logger.warn(
          'reactToolLoop:emptyOutputFallback（本轮无可见回复，已落兜底文案）',
          {
            finishReason,
            reason,
            concurrentReasons,
            blockTypes,
            /** 只产出了思考、没有正文 —— 空回复的一个具体可诊断形态 */
            reasoningOnly:
              blockTypes.includes('thinking') && !blockTypes.includes('text'),
          }
        );
      }
    }

    return { suffix, finishReason, reason, concurrentReasons };
  }

  // ─── 私有辅助 ───────────────────────────────────────

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
      content: renderFragment(
        createFragment({
          kind: 'system',
          text:
            `你刚刚重复调用了与上一轮完全相同的工具（${names}，参数相同）。` +
            `该工具的结果已在上文上下文中，请直接基于已有内容分析并作答，` +
            `不要再调用相同的工具与参数。如确需查看不同部分，请使用不同的参数` +
            `（例如 file_read 的 offset/limit 分页读取不同行段）。`,
        })
      ),
      [FRAGMENT_KIND_FIELD]: 'system',
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

  /**
   * G12（2026-08-23）：骨架 run() 产出的 tool_start/tool_end 事件携带工具轮消息 id，
   * 供 reactEventsToChunks 透传到 SSE chunk（前端工具轮块归属对位）。
   */
  protected override getCurrentMessageId(): string | undefined {
    return this.streamingLlm.currentMessageId();
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

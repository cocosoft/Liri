/**
 * ReActLoop — 统一 ReAct (Reasoning-Acting) 循环抽象骨架
 *
 * P1-16: 将 ChatManager.streamMessage()、TAORLoop、LongRunningTaskOrchestrator
 * 三个独立的循环实现抽象为统一骨架，后续所有优化（级联中止/JSON自纠正/max_output）
 * 只需在此骨架中实现一次。
 *
 * 对标：PilotDeck AgentLoop.ts、cc_code QueryEngine、hermes-agent run_agent.py
 *
 * 使用方式：
 *   class MyLoop extends ReActLoop<MyInput, MyContext, MyResult> {
 *     protected async reason(input, ctx): Promise<ReasonResult> { ... }
 *     protected async act(calls, ctx): Promise<ActResult> { ... }
 *     protected shouldContinue(state): boolean { ... }
 *     protected finalize(state): MyResult { ... }
 *   }
 */

import { getLogger } from '@modules/monitoring/logs/Logger.js';
import { handleError } from '@modules/error/handleError.js';
import type { QuestionData } from '@modules/runtime/api/CoreAPI.js';
import { buildRoundSignature, isRepeatedLoop } from './loopGuard.js';

const logger = getLogger('query:reactLoop');

/**
 * 外部内容获取/探索类工具（2026-09-01 P1）：no_progress 熔断时若最近轮次
 * 命中这些工具，判定"任务卡在外部内容获取"并给出可操作降级提示（提供正文/换源），
 * 而非冰冷报错。协议级工具名集合（与 TOOL_CATEGORIES 同类）。
 * P10：同时用于动态轮次扩容判定（ReActToolLoop 复用）。
 */
export const EXTERNAL_FETCH_TOOLS = new Set([
  'web_fetch',
  'web_search',
  'skill_view',
  'skills_list',
  'Skill',
  'tool_search',
  'search_codebase',
]);

/**
 * P14（2026-09-01）：探索预算 + 探索疲劳——信息收集型任务收敛保护。
 * 实测（session_mtj88709u6kj3uens7）：模型 50 轮全部花在搜索上（web_search 查询词
 * 微调、tool_search "todo"、skills_list），微调查询词绕过 no_progress 签名检测，
 * 44 万 token 无实质产出。方案 A 探索预算：累计探索达阈值强制整合；方案 B 探索疲劳：
 * 窗口内探索占比高且无产出型工具 → 先软提示，仍不收敛则硬熔断。
 */
const EXPLORE_BUDGET = 14;
const EXPLORE_FATIGUE_WINDOW = 8;
const EXPLORE_FATIGUE_RATIO = 5;

/** 产出型工具（写操作/任务落地）——探索疲劳判定中"无产出"的对照 */
const PRODUCTIVE_TOOLS = new Set([
  'knowledge_save',
  'knowledge_write',
  'knowledge_import',
  'file_write',
  'FileWriteTool',
  'write_file',
  'file_edit',
  'FileEditTool',
  'edit_file',
  'bash',
  'BashTool',
  'cron_create',
  'CronCreateTool',
]);

// ==========================================
// Core Types
// ==========================================

/**
 * A2（2026-09-05）：终止原因统一枚举——收口既有 TAOR stopReason 值域 + 骨架
 * 截断/循环检测/预算补充，供 finalize/getTerminationTip/上层决策共用（禁双枚举）。
 */
export type TerminationReason =
  | 'completed'
  | 'error'
  | 'aborted'
  | 'max_turns'
  | 'budget_exhausted'
  | 'verifier_escalate'
  | 'diminishing_returns'
  | 'loop_detected'
  // A 档（2026-09-05）：对齐 StopHookReason 的 timeout——防未来置 timeout 时被
  // 折叠成 completed（方案 A 复查收口，见 error_repairs）。
  | 'timeout'
  // 三期 F3-2（2026-09-23 修复计划 §六）：上下文压缩失败 ⇒ 终止。此前该支不置相位，
  // 收尾文案与"压缩失败"无任何关联（用户只看到一句通用兜底）。
  | 'compaction_failed';

/** 循环状态 */
export interface ReActState {
  iteration: number;
  phase:
    | 'reasoning'
    | 'acting'
    | 'completed'
    | 'aborted'
    | 'error'
    // A1（2026-09-05）：达 maxIterations 截断使用专门 phase，避免被消费方当完成
    | 'truncated'
    // K1（2026-09-05）：预算耗尽使用专门 phase——骨架 budget 分支原置 'completed'
    // 会把"预算耗尽终止"误报为正常完成（消费 phase==='completed' 的上层无法区分）。
    | 'budget_exhausted'
    // 二期 F2-2（2026-09-23 修复计划 §六）：会话级总时长上限触发。此前该支不置任何
    // 相位 ⇒ 经 getTerminationReason() 被判为 'completed'（伪装成"正常完成"）。
    | 'timeout'
    // 三期 F3-2（2026-09-23）：上下文压缩失败/停滞 ⇒ 专门相位（收尾可见"为何停下"）。
    | 'compaction_failed'
    // 阶段 A（A1-d）：以 sessions_yield 让出 turn 的收尾相位（既非完成也非截断）
    | 'yielded';
  pendingToolCalls: ToolCallEntry[];
  lastError?: string;
}

/** 工具调用条目 */
export interface ToolCallEntry {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** 推理阶段结果 */
export interface ReasonResult<TContext = unknown> {
  text: string;
  toolCalls: ToolCallEntry[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'max_tokens' | 'error';
  /**
   * 一期 F1-2（2026-09-23 修复计划）：provider 报出的**原始**结束原因（归一化前）。
   *
   * 背景：`ReActToolLoop.reason()` 曾用「有 tool_calls ⇒ `finishReason='tool_calls'`」
   * 无条件覆盖真实值，而"被 max_tokens 截断且只吐出半个 tool_calls"正是最常见的截断
   * 形态 ⇒ 截断信号被吃掉、下游 `onIncompleteTurn` 的 truncated 分支失效。
   *
   * 现约定：`finishReason` 如实反映 provider 判定（不覆盖）；本字段另存原始值，
   * **信息不销毁**，供观测/排查使用（不参与控制流）。
   */
  rawFinishReason?: string;
  usage?: { inputTokens: number; outputTokens: number };
  context?: TContext;
}

/** 执行阶段结果 */
export interface ActResult {
  results: ToolResultEntry[];
  allSucceeded: boolean;
  anyAborted: boolean;
  /**
   * 阶段 A（A1-d）：本轮是否以 `sessions_yield` 让出 turn。
   * 为 true 时骨架不再进入下一轮，直接 finalize（对外会话状态保持 running，
   * 等待子代理结算后由恢复通路开启新 turn；见 .trae/documents/阶段A-恢复通路设计Spec.md）。
   */
  yielded?: boolean;
}

/** 工具结果条目 */
export interface ToolResultEntry {
  toolCallId: string;
  name: string;
  status: 'success' | 'error' | 'aborted' | 'timeout';
  output?: string;
  error?: string;
}

/** ReAct 事件流 */
export type ReActEvent =
  | { type: 'reasoning_start' }
  | { type: 'reasoning_delta'; text: string; messageId?: string }
  | { type: 'thinking_delta'; content: string; messageId?: string }
  | { type: 'phase'; phase: string; round: number; description?: string }
  | { type: 'reasoning_end'; result: ReasonResult }
  | { type: 'acting_start'; toolCount: number }
  | {
      type: 'tool_start';
      callId: string;
      name: string;
      input: Record<string, unknown>;
      messageId?: string;
    }
  | { type: 'tool_progress'; callId: string; progress: number }
  | {
      type: 'tool_end';
      callId: string;
      result: ToolResultEntry;
      messageId?: string;
    }
  | { type: 'acting_end'; result: ActResult }
  | { type: 'iteration_end'; iteration: number }
  | { type: 'error'; message: string }
  | { type: 'aborted' }
  // 对标 openworker/agentscope（2026-09-01）：达最大轮次时产出收尾事件（非裸 error）
  | { type: 'max_iterations'; maxIterations: number }
  // v3：交互工具提问（act generator 化后由 ReActToolLoop 产出，穿透 generator 挂起链路）
  | { type: 'question'; questionData: QuestionData }
  | { type: 'question_waiting' }
  // 阶段 A（A1-d）：本轮以 sessions_yield 让出 turn（骨架据此收尾，不再进入下一轮）
  | { type: 'yielded' };

/** 预算控制器最小接口（下沉自 TAORLoop TokenBudget 语义，2026-09-01；子类可选接入） */
export interface BudgetControllerLike {
  /** 是否允许继续执行下一轮 */
  canExecute(): boolean;
  /** 预算耗尽但允许完成当前调用后的优雅最后一调（可选） */
  needsGraceCall?: () => boolean;
}

/** 循环配置 */
export interface ReActLoopConfig {
  maxIterations: number;
  abortSignal?: AbortSignal;
  /** 最大连续 all-invalid 轮数（熔断器），0=禁用 */
  maxConsecutiveInvalidTurns: number;
  /**
   * D 项（2026-08-30）：无进展熔断阈值——连续 N 轮"工具名+状态"签名完全相同
   * 视为无进展死循环（实测 skills_list 反复搜索 249 轮），0=禁用
   */
  maxRepeatedRounds?: number;
  /** 可选：初始 steering 消息（每轮 reason 前经 onSteering 注入，下沉自 TAORLoop 2026-09-01） */
  steeringMessages?: string[];
  /** 可选：预算控制器（每轮检查，耗尽优雅收尾；ReActToolLoop 默认不启用，能力预留） */
  budget?: BudgetControllerLike;
}

const DEFAULT_CONFIG: ReActLoopConfig = {
  maxIterations: 30,
  maxConsecutiveInvalidTurns: 3,
  maxRepeatedRounds: 3,
};

// ==========================================
// Abstract Base Class
// ==========================================

export abstract class ReActLoop<
  TInput = unknown,
  TContext = unknown,
  TResult = unknown,
> {
  protected config: ReActLoopConfig;
  /** 骨架自有中止控制器（D6）：abort() 直接中止它；config.abortSignal 引用其
   *  signal（L278）供外部监听。命名带 _ 前缀避免与 TAORLoop 自带的 private
   *  abortController 字段冲突。 */
  private _abortController: AbortController;
  protected state: ReActState;
  protected consecutiveInvalidTurns = 0;

  /**
   * N-42（2026-09-20）：外部已产生的工具调用 ⇒ 作为**首轮 ACT** 执行（消费一次即清空）。
   * 见 `seedPendingToolCalls()`。
   */
  private seededToolCalls: ToolCallEntry[] | null = null;

  /** D 项（2026-08-30）：无进展熔断——最近 N 轮工具+状态签名窗口 */
  private recentRoundSignatures: string[] = [];
  /** P7（2026-09-01）：跨轮"已完成工作"摘要——组合任务熔断时，已完成子任务
   *  （如知识库保存）的结果必须呈现给用户，不能随熔断一起丢失。由子类
   *  （ReActToolLoop）在工具结果处理时填充，基类熔断提示时读取。 */
  protected completedWork: string[] = [];
  /** P10（2026-09-01）：外部获取卡住时是否已给过"求助机会"（steering 注入
   *  ask_user_question 指引）。只给 1 次，防止无限循环。 */
  protected externalHelpRequested = false;
  /**
   * P2-3 配套（2026-09-22）：本轮已注入"同工具同参数重复调用"的**软纠偏**指令。
   * 由子类 `ReActToolLoop._injectRepeatCallCorrection` 在注入置位。
   *
   * 修复的缺陷：软纠偏与硬熔断**在同一轮同时判定**，硬熔断抢先收尾 —— 实测
   * `chat-export-1790038432335.md`（2026-09-21T23:23:37Z）中纠偏注入于 `.271`，
   * 108ms 后 `no_progress_loop` 即熔断于 `.379` ⇒ 模型**从未有机会**看到纠偏指令，
   * 软纠偏形同虚设，用户只收到空正文 + "工具循环无实质进展，任务已结束。"。
   */
  protected repeatCorrectionPending = false;
  /** P2-3 配套：本条消息是否已为软纠偏让路过 1 次（防止无限让路） */
  protected repeatCorrectionDeferred = false;
  /** P14（2026-09-01）：探索预算——累计探索类工具调用数（跨轮） */
  protected exploreCalls = 0;
  /** P14（2026-09-01）：探索疲劳窗口——最近 EXPLORE_FATIGUE_WINDOW 轮是否含探索工具 */
  protected exploreRecentWindow: boolean[] = [];
  /** P14（2026-09-01）：探索预算提示是否已触发（只提示 1 次） */
  protected exploreBudgetPrompted = false;
  /** P14（2026-09-01）：探索疲劳软提示是否已触发（提示后仍疲劳 → 硬熔断） */
  protected exploreFatiguePrompted = false;
  /** steering 队列（下沉自 TAORLoop 2026-09-01：骨架统一管理，每轮 reason 前经 onSteering 注入） */
  protected steeringQueue: string[] = [];

  /**
   * run 级状态复位（A2/A3，2026-09-04）
   *
   * 上一条消息的"无进展/疲劳/探索"计数与签名窗口若不清除会污染下一条消息
   * （reset() 原只清 turnCount/stopped 等）。reset 由宿主在每次 run 前调用。
   * 不做第二套 StopHook 执行器——守卫清理直接放进 reset() 的确定路径。
   */
  protected resetRunState(): void {
    this.recentRoundSignatures = [];
    this.externalHelpRequested = false;
    this.repeatCorrectionPending = false;
    this.repeatCorrectionDeferred = false;
    this.exploreCalls = 0;
    this.exploreRecentWindow = [];
    this.exploreBudgetPrompted = false;
    this.exploreFatiguePrompted = false;
    this.consecutiveInvalidTurns = 0;
    this.completedWork = [];
    this.steeringQueue = [];
  }

  constructor(config?: Partial<ReActLoopConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    // D6（2026-09-17）：骨架自带中止控制器——外部传入的 abortSignal 仅作联动监听，
    // config.abortSignal 恒指向本控制器（对齐 SubAgentEngine 外部信号→内部控制器模式）
    this._abortController = new AbortController();
    const externalSignal = config?.abortSignal;
    if (externalSignal) {
      if (externalSignal.aborted) {
        this._abortController.abort();
      } else {
        externalSignal.addEventListener(
          'abort',
          () => this._abortController.abort(),
          { once: true }
        );
      }
    }
    this.config.abortSignal = this._abortController.signal;
    this.state = { iteration: 0, phase: 'reasoning', pendingToolCalls: [] };
    this.steeringQueue = config?.steeringMessages
      ? [...config.steeringMessages]
      : [];
  }

  /** 运行时注入 steering 消息（下一轮 reason 前经 onSteering 生效） */
  queueSteering(message: string): void {
    this.steeringQueue.push(message);
  }

  /**
   * N-42（2026-09-20）：以「外部已产生的工具调用」作为**首轮 ACT**（跳过首轮 REASON）。
   *
   * 用途：非流式路径（`ChatOrchestrator.sendMessage` → `invokeLlm`）的首个响应就含
   * `tool_calls` 时，此前只把该 assistant 消息补进 `ctx.apiMessages` 就委托本循环——
   * 但骨架**只有 REASON→ACT 单一入口**，首轮仍会调 LLM：于是把"带未答 tool_call 的历史"
   * 发给模型，`MessageProjector` 为防 provider 400 会为它注入 `[result truncated]` 占位
   * ⇒ 模型据**伪结果**直接作答 ⇒ `turns:1 completed`、**工具从未执行**
   * （各渠道"只回一次 + 动作不执行"的根因；`sessions_yield` 亦因此从不登记 ⇒ 台账 N-42）。
   *
   * 语义：命中后本轮直接进入 ACT（工具在 `act()` 内真正执行，含 yield 登记/短路与
   * 工具结果回填），之后照常进入下一轮 REASON。
   */
  seedPendingToolCalls(toolCalls: ToolCallEntry[]): void {
    this.seededToolCalls = toolCalls.length > 0 ? [...toolCalls] : null;
  }

  // ==========================================
  // Abstract methods — 子类必须实现
  // ==========================================

  /**
   * 推理阶段（generator）：调用 LLM，即时产出事件（reasoning_delta/thinking_delta/phase），
   * return 值携带文本 + tool_calls。方案 A（M4，2026-08-13）：async → generator 化，
   * 使 reason 内流式 LLM 文本可逐 chunk 增量输出（旧类 P0-C 语义恢复）。
   */
  protected abstract reason(
    input: TInput,
    context?: TContext
  ): AsyncGenerator<ReActEvent, ReasonResult<TContext>>;

  /** 执行阶段（generator）：执行工具调用列表，交互工具可产出 question/question_waiting 事件，
   *  return 值携带各工具结果。与 reason 的 generator 化对称（M4，v3 扩展 act）。 */
  protected abstract act(
    calls: ToolCallEntry[],
    context?: TContext
  ): AsyncGenerator<ReActEvent, ActResult>;

  /** 判断循环是否应该继续 */
  protected abstract shouldContinue(
    input: TInput,
    result: ReasonResult<TContext>
  ): boolean;

  /** 最终化结果（循环结束时调用） */
  protected abstract finalize(state: ReActState, context?: TContext): TResult;

  // ==========================================
  // Hooks — 子类可覆写
  // ==========================================

  /** 压缩检查 Hook（每轮 reasoning 前） */
  protected async beforeReasoning(
    _input: TInput,
    _context?: TContext
  ): Promise<void> {
    // default: no-op
  }

  /** 达最大轮次 Hook（maxIterations 分支 yield 收尾事件后调用，finalize 前）。
   *  对标 hermes（2026-09-01）：子类可在此做一次"不带 tools 的总结请求"生成收尾总结，
   *  失败不应阻塞（回退为 finalize 的默认提示）。 */
  protected async onMaxIterations(): Promise<void> {
    // default: no-op
  }

  // ── A2（2026-09-05）：终止原因单一判别（finalize/getTerminationTip/收尾共用）──

  /** 子类判定循环检测终止（TAOR loopDetector / ReActToolLoop loopState.loopDetected） */
  protected isLoopDetectedReason(): boolean {
    return false;
  }

  /** 子类判定预算耗尽终止（TAOR tokenBudget） */
  protected isBudgetExhaustedReason(): boolean {
    return false;
  }

  /** 终止原因访问器：骨架统一判别截断/中止/错误，循环检测与预算由子类钩子补充 */
  getTerminationReason(): TerminationReason {
    if (this.config.abortSignal?.aborted || this.state.phase === 'aborted') {
      return 'aborted';
    }
    if (this.state.phase === 'error') return 'error';
    // K1 复查收口（2026-09-05）：预算耗尽 phase 显式判别——必须先于 max_turns/
    // truncated，否则纯骨架直连 + config.budget 时（迭代也达上限）会被 max_turns
    // 遮蔽；且不依赖子类 isBudgetExhaustedReason 钩子（默认 false 会漏判）。
    if (this.state.phase === 'budget_exhausted') return 'budget_exhausted';
    // 二期 F2-2（2026-09-23）：超时**必须**在 completed 之前判别——否则经本判别器
    // 会被折叠为 'completed'（比"伪装完成"更彻底：连 phase 都不再是证据）。
    if (this.state.phase === 'timeout') return 'timeout';
    // 三期 F3-2（2026-09-23）：压缩失败同理——必须在 completed 之前判别。
    if (this.state.phase === 'compaction_failed') return 'compaction_failed';
    if (
      this.state.phase === 'truncated' ||
      this.state.iteration >= this.config.maxIterations
    ) {
      return 'max_turns';
    }
    if (this.isLoopDetectedReason()) return 'loop_detected';
    if (this.isBudgetExhaustedReason()) return 'budget_exhausted';
    return 'completed';
  }

  /** 回合质量检测 Hook（对标 openclaw 2026-09-01）：shouldContinue=false 且输出可疑
   *  （空回复/只思考无答案/只计划不行动）时，子类注入重试指令并返回 true 让骨架 continue；
   *  返回 false 则正常收尾。重试上限由子类维护，防死循环。 */
  protected async onIncompleteTurn(
    _result: ReasonResult<TContext>,
    _context?: TContext
  ): Promise<boolean> {
    return false; // default: 不重试
  }

  /** steering 注入 Hook（下沉自 TAORLoop 2026-09-01）：骨架每轮 reason 前调用，
   *  子类把 [STEERING] 消息加入自己的对话上下文（ReActToolLoop 实现为 loopState.messages）。 */
  protected async onSteering(_messages: string[]): Promise<void> {
    // default: no-op
  }

  /** 错误恢复 Hook（模型错误时） */
  protected async onReasoningError(
    _error: unknown,
    _input: TInput,
    _context?: TContext
  ): Promise<ReasonResult<TContext> | null> {
    return null; // default: propagate error
  }

  /** 工具执行错误 Hook */
  protected async onToolError(
    _error: unknown,
    _toolCall: ToolCallEntry,
    _context?: TContext
  ): Promise<void> {
    // default: no-op
  }

  /**
   * 当前工具轮归属消息 id Hook（G12，2026-08-23）
   *
   * 子类（ReActToolLoop）覆写返回工具轮预分配的 assistant 消息 id，
   * 骨架产出的 tool_start/tool_end 事件据此携带 messageId，
   * reactEventsToChunks 转换层透传到 SSE chunk，前端据此把工具轮块挂到正确消息。
   * 默认 undefined（骨架层无此语义）。
   */
  protected getCurrentMessageId(): string | undefined {
    return undefined;
  }

  // ==========================================
  // Circuit Breaker
  // ==========================================

  private checkCircuitBreaker(result: ActResult): boolean {
    if (this.config.maxConsecutiveInvalidTurns <= 0) return false;
    const allInvalid = result.results.every((r) => r.status === 'error');
    if (allInvalid) {
      this.consecutiveInvalidTurns++;
      // 排查锚点：每轮 all-error 时记录失败工具名 + 错误摘要，便于定位根因
      // （常见根因：工具 schema 不兼容本地 LLM、上下文超限导致 LLM 返回非法 tool_call、
      // 工具自身 bug）。错误信息截断 200 字符避免日志膨胀。
      const failedTools = result.results.map((r) => ({
        name: r.name,
        error: (r.error ?? r.output ?? '').slice(0, 200),
      }));
      logger.warn('reActLoop:all-tools-failed (consecutive invalid turn)', {
        iteration: this.state.iteration,
        consecutiveInvalidTurns: this.consecutiveInvalidTurns,
        maxConsecutiveInvalidTurns: this.config.maxConsecutiveInvalidTurns,
        failedToolCount: result.results.length,
        failedTools,
      });
      if (
        this.consecutiveInvalidTurns >= this.config.maxConsecutiveInvalidTurns
      ) {
        logger.warn('reActLoop:circuit_breaker triggered', {
          consecutiveInvalidTurns: this.consecutiveInvalidTurns,
          maxConsecutiveInvalidTurns: this.config.maxConsecutiveInvalidTurns,
          lastFailedTools: failedTools,
        });
        return true;
      }
    } else {
      this.consecutiveInvalidTurns = 0;
    }
    return false;
  }

  // ==========================================
  // Main Loop (async generator)
  // ==========================================

  async *run(input: TInput): AsyncGenerator<ReActEvent, TResult> {
    let context: TContext | undefined;

    try {
      while (true) {
        // --- Check abort ---
        if (this.config.abortSignal?.aborted) {
          this.state.phase = 'aborted';
          yield { type: 'aborted' };
          return this.finalize(this.state, context);
        }

        // --- Max iterations ---
        if (this.state.iteration >= this.config.maxIterations) {
          logger.info('reActLoop:max_iterations reached', {
            maxIterations: this.config.maxIterations,
            iteration: this.state.iteration,
          });
          // A1（2026-09-05）：达上限用专门截断 phase，不再置 'completed'——
          // 消费 state.phase 完成态的上层据此区分「截断」与「正常完成」。
          this.state.phase = 'truncated';
          // 对标 openworker/agentscope/hermes（2026-09-01）：达上限产出生效收尾——
          // ① yield max_iterations 收尾事件（前端可区分"完成"与"被截断"，CS02 状态标记）；
          // ② onMaxIterations 钩子供子类做"不带 tools 的总结请求"（hermes 模式），失败不阻塞。
          yield {
            type: 'max_iterations',
            maxIterations: this.config.maxIterations,
          };
          await this.onMaxIterations();
          return this.finalize(this.state, context);
        }

        // --- Steering 注入（下沉自 TAORLoop 2026-09-01：骨架统一管理，reason 前生效） ---
        if (this.steeringQueue.length > 0) {
          const steering = this.steeringQueue.splice(0);
          await this.onSteering(steering);
        }

        // --- 预算检查（下沉自 TAORLoop 2026-09-01）：耗尽优雅收尾（能力可选接入） ---
        if (this.config.budget && !this.config.budget.canExecute()) {
          if (!this.config.budget.needsGraceCall?.()) {
            logger.info('reActLoop:budget_exhausted', {
              maxIterations: this.config.maxIterations,
              iteration: this.state.iteration,
            });
            // K1（2026-09-05）：预算耗尽终止不再置 'completed'——消费 phase 完成态的
            // 上层据此区分「预算耗尽」与「正常完成」。
            this.state.phase = 'budget_exhausted';
            return this.finalize(this.state, context);
          }
          logger.warn('reActLoop:budget_grace_call', {
            iteration: this.state.iteration,
          });
        }

        let reasonResult: ReasonResult<TContext>;

        if (this.seededToolCalls && this.seededToolCalls.length > 0) {
          // ==== SEEDED ACTING PHASE（N-42）====
          // 外部已产生工具调用 ⇒ 本轮**跳过 REASON 直接进入 ACT**，使工具在 act() 内真正执行
          // （含 yield 登记/短路 + 工具结果回填）。详见 `seedPendingToolCalls()` 注释。
          const seeded = this.seededToolCalls;
          this.seededToolCalls = null;
          reasonResult = {
            text: '',
            toolCalls: seeded,
            finishReason: 'tool_calls',
          };
          logger.info('reActLoop:seeded_acting', {
            toolCount: seeded.length,
            toolNames: seeded.map((tc) => tc.name),
          });
          yield { type: 'reasoning_end', result: reasonResult };
        } else {
          // --- Compression check (before reasoning) ---
          await this.beforeReasoning(input, context);

          // ==== REASONING PHASE ====
          this.state.phase = 'reasoning';
          yield { type: 'reasoning_start' };

          try {
            // M4（方案 A）：reason 为 generator —— 迭代消费即时事件（增量文本/thinking/phase），
            // 收集 return 值作为 ReasonResult（主循环 await 期间不再吞掉增量输出）。
            const reasonIter = this.reason(input, context);
            let iterResult = await reasonIter.next();
            while (!iterResult.done) {
              yield iterResult.value;
              iterResult = await reasonIter.next();
            }
            reasonResult = iterResult.value;
            context = reasonResult.context ?? context;
            yield { type: 'reasoning_end', result: reasonResult };
          } catch (err) {
            // 三期 F3-3（2026-09-23 修复计划 §六）：收口未 await/未 catch 的 handleError
            //（D4）—— 同文件其它调用点均带 `.catch()`；裸调会在其内部 Promise 拒绝时
            // 产生 unhandled rejection（本处位于 generator 的 catch 分支，不能因此中断收尾）。
            handleError(err, {
              module: 'query:reactLoop',
              action: 'reasoning',
            }).catch(() => {});
            logger.warn('reActLoop:reasoning_error', { error: String(err) });
            const recovered = await this.onReasoningError(err, input, context);
            if (recovered) {
              reasonResult = recovered;
              context = reasonResult.context ?? context;
              yield { type: 'reasoning_end', result: reasonResult };
            } else {
              this.state.phase = 'error';
              this.state.lastError = String(err);
              yield { type: 'error', message: String(err) };
              return this.finalize(this.state, context);
            }
          }
        }

        // --- No tool calls → done ---
        if (!this.shouldContinue(input, reasonResult)) {
          // 对标 openclaw（2026-09-01）：回合质量检测——无工具调用但输出可疑
          // （空回复/只思考无答案/只计划不行动）时，子类注入重试指令并返回 true，
          // 骨架 continue 再给一次机会（重试上限由子类控制，防死循环）。
          if (await this.onIncompleteTurn(reasonResult, context)) {
            continue;
          }
          // 二期 R5（2026-09-23 修复计划 §六，精化 1 的真病根）：**不再无条件写
          // 'completed'** —— getTerminationReason() 的每一路判别都读 phase，此处提前
          // 写死会把"超时/截断"等**更具体**的原因折叠成"正常完成"（上层无从据实收尾）。
          // 仅在仍处"进行中"相位时才落 completed；子类在 shouldContinue 中置入的
          // 更具体相位（如 'timeout'）必须原样保留。
          if (
            this.state.phase === 'reasoning' ||
            this.state.phase === 'acting'
          ) {
            this.state.phase = 'completed';
          }
          return this.finalize(this.state, context);
        }

        // ==== ACTING PHASE ====
        this.state.phase = 'acting';
        this.state.pendingToolCalls = reasonResult.toolCalls;
        yield {
          type: 'acting_start',
          toolCount: reasonResult.toolCalls.length,
        };

        let actResult: ActResult;
        try {
          // Emit per-tool start events
          for (const tc of reasonResult.toolCalls) {
            yield {
              type: 'tool_start',
              callId: tc.id,
              name: tc.name,
              // 携带工具参数：转换层据此下发 arguments，前端 ToolCallGroup 展示"人话"摘要
              input: tc.input,
              messageId: this.getCurrentMessageId(),
            };
          }
          // v3：迭代消费 act generator（交互工具可产出 question/question_waiting 事件）
          const actIter = this.act(reasonResult.toolCalls, context);
          let actIterResult: IteratorResult<ReActEvent, ActResult>;
          try {
            actIterResult = await actIter.next();
            while (!actIterResult.done) {
              yield actIterResult.value; // question / question_waiting 转发
              actIterResult = await actIter.next();
            }
          } finally {
            // v3：外层 for-await 提前终止（请求取消）时，确保 act 内部 finally（清理 pendingInteractions）执行
            try {
              await actIter.return(undefined as never);
            } catch {
              // 忽略 return 阶段错误（@ignore-catch）
            }
          }
          actResult = actIterResult.value;
        } catch (err) {
          handleError(err, { module: 'query:reactLoop', action: 'acting' });
          actResult = {
            results: reasonResult.toolCalls.map((tc) => ({
              toolCallId: tc.id,
              name: tc.name,
              status: 'error' as const,
              error: String(err),
            })),
            allSucceeded: false,
            anyAborted: false,
          };
        }

        // Emit per-tool end events
        for (const r of actResult.results) {
          yield {
            type: 'tool_end',
            callId: r.toolCallId,
            result: r,
            messageId: this.getCurrentMessageId(),
          };
        }
        yield { type: 'acting_end', result: actResult };

        // --- 阶段 A（A1-d）：yield 短路 ---
        // 本轮以 sessions_yield 让出 turn（act 已把等待登记写入 YieldRegistry）：
        // 不再进入下一轮 reason（让出后模型不应继续执行），直接收尾。
        // 会话对外状态保持 running；子代理全部结算后由恢复通路开启新 turn。
        if (actResult.yielded) {
          this.state.phase = 'yielded';
          yield { type: 'yielded' };
          return this.finalize(this.state, context);
        }

        // --- D 项（2026-08-30）：无进展熔断 ---
        // 连续 maxRepeatedRounds 轮"工具名+状态"签名完全相同 → 视为死循环。
        // 实测案例：模型反复 tool_search select:skills_list 等（组合略有变化但
        // 无实质进展）跑满 249 轮——all-error 熔断（config list 成功）与
        // maxIterations（300）均未拦截。签名重复检测在轮级提前终止。
        const repeatedThreshold = this.config.maxRepeatedRounds ?? 3;
        if (repeatedThreshold > 0) {
          // 2026-08-31：签名纳入工具参数——相同工具+相同参数连续 N 轮才算无进展。
          // P5（2026-09-01）：knowledge_save 签名仅取 title——模型对同一标题反复
          // "微调"（改 category/tags/格式）会改 content 参数绕过签名检测，实测
          // 25-30 轮 skipped↔updated 交替耗尽 maxIterations。按 title 归一化后，
          // 同一标题的重复保存立即判为无进展（窗口化检测 3 次即熔断）。
          const sig = buildRoundSignature({
            results: actResult.results,
            toolInputs: reasonResult.toolCalls.map((tc) => ({
              id: tc.id,
              input:
                tc.name === 'knowledge_save' &&
                typeof tc.input === 'object' &&
                tc.input !== null
                  ? {
                      title: (tc.input as Record<string, unknown>).title,
                    }
                  : // P15（2026-09-01）：file_write/file_edit 签名取 file_path + content
                    // 长度——参数 JSON 截断 200 字符（loopGuard normalizeArgs）使增量
                    // 写同一文件的签名相同（HTML 开头相同），误判"无进展"熔断（实测
                    // 模型分 4 轮写 ai-agent-daily-report.html，第 3 轮被 no_progress）。
                    // content 长度变化（增量完善）→ 签名不同 → 放行；完全相同（重写）
                    // → 签名相同 → 熔断（真正无进展）。
                    (tc.name === 'file_write' ||
                        tc.name === 'FileWriteTool' ||
                        tc.name === 'write_file' ||
                        tc.name === 'file_edit' ||
                        tc.name === 'FileEditTool' ||
                        tc.name === 'edit_file') &&
                      typeof tc.input === 'object' &&
                      tc.input !== null
                    ? (() => {
                        const inp = tc.input as Record<string, unknown>;
                        const fp =
                          typeof inp.file_path === 'string'
                            ? inp.file_path
                            : typeof inp.path === 'string'
                              ? inp.path
                              : '';
                        const content = inp.content;
                        return {
                          file_path: fp,
                          contentLength:
                            typeof content === 'string' ? content.length : 0,
                        };
                      })()
                    : tc.input,
            })),
          });
          this.recentRoundSignatures.push(sig);
          // P10（2026-09-01）：窗口扩至 10 轮——原 6 轮内同签名 3 次即熔断过激，
          // 正常多步任务（加载技能→搜索→抓取）前几轮探索会被误杀（实测 3 轮即掐断）。
          const windowSize = Math.max(repeatedThreshold * 2, 10);
          if (this.recentRoundSignatures.length > windowSize) {
            this.recentRoundSignatures.shift();
          }
          if (isRepeatedLoop(this.recentRoundSignatures, repeatedThreshold)) {
            const toolNames = reasonResult.toolCalls
              .map((tc) => tc.name)
              .filter(Boolean);
            const blockedOnExternal = toolNames.some((n) =>
              EXTERNAL_FETCH_TOOLS.has(n)
            );
            // P10（2026-09-01）：外部内容获取卡住（反爬/来源不可访问）时，给模型
            // 1 次"求助机会"——注入 steering 让模型调用 ask_user_question 请求正文/
            // 换源，而非立即熔断（此前 3 轮即掐断，任务刚开始就被拦截，体验"没执行"）。
            if (blockedOnExternal && !this.externalHelpRequested) {
              this.externalHelpRequested = true;
              this.steeringQueue.push(
                '你多次尝试获取外部内容（网页/文章/技能）均未成功，可能因反爬或来源不可访问。' +
                  '请调用 ask_user_question 向用户说明情况并提供选项：提供文章正文、更换可访问的来源链接、或放弃该子任务。'
              );
              this.recentRoundSignatures = []; // 重置窗口，给模型空间执行求助
              logger.warn('reActLoop:external_fetch_stuck_help_requested', {
                iteration: this.state.iteration,
                lastSignature: sig,
              });
              // 不熔断，继续循环（下一轮 reason 前 steering 注入）
            } else if (
              this.repeatCorrectionPending &&
              !this.repeatCorrectionDeferred
            ) {
              // P2-3 配套（2026-09-22）：**软纠偏优先于硬熔断**。
              // 纠偏指令已于本轮注入（`_injectRepeatCallCorrection`），必须让模型至少
              // 跑一轮去响应它；否则纠偏与熔断在同一轮判定、硬熔断抢先收尾，纠偏永不生效
              // （实测 chat-export-1790038432335.md：纠偏 23:23:37.271 / 熔断 .379）。
              // 让路只给 1 次：模型无视纠偏再重复 ⇒ 下一轮正常熔断，不会无限循环。
              this.repeatCorrectionDeferred = true;
              this.repeatCorrectionPending = false;
              this.recentRoundSignatures = []; // 重置窗口，给模型空间执行纠偏
              logger.warn('reActLoop:no_progress_deferred_for_correction', {
                iteration: this.state.iteration,
                repeatedRounds: repeatedThreshold,
                lastSignature: sig,
              });
              // 不熔断，继续循环（纠偏指令已在下一轮 reason 的消息队列中）
            } else {
              logger.warn('reActLoop:no_progress_loop', {
                iteration: this.state.iteration,
                repeatedRounds: repeatedThreshold,
                lastSignature: sig,
              });
              this.state.phase = 'error';
              // 2026-09-01 P1 降级提示：任务卡在外部内容获取时，给出可操作指引而非冰冷报错。
              const completedTip =
                this.completedWork.length > 0
                  ? `已完成：${this.completedWork.join('；')}。`
                  : '';
              // P8（2026-09-01）：不 yield error 事件（前端弹异常），finalize 附加 lastError。
              // P12（2026-09-01）：有已完成工作时不追加负面词——任务已部分/全部完成，
              // 正常收尾即可（用户要的是干净汇报，不是熔断吓人提示）。
              // 仅完全无进展（无 completedWork）才给出结束说明（2026-09-22 起改为可操作文案）。
              if (blockedOnExternal) {
                this.state.lastError = `${completedTip}您提供的网页链接因反爬/访问限制无法自动抓取。您可以提供文章正文，或更换可访问的链接，我将继续处理。`;
              } else if (this.completedWork.length > 0) {
                this.state.lastError = `${completedTip}本次任务已处理完毕。如有其他需求，请继续告诉我。`;
              } else {
                // 2026-09-22 可读化：原为"工具循环无实质进展，任务已结束。"——用户只看到
                // 这句（且合并了空正文，实测用户回问"你挂了？"）。改为说明**重复了什么**、
                // 为什么停下、以及可操作的下一步。
                const repeatedTools =
                  toolNames.length > 0
                    ? [...new Set(toolNames)].join('、')
                    : '相同工具';
                this.state.lastError =
                  `我连续 ${repeatedThreshold} 轮重复调用 ${repeatedTools} 且没有新进展，已停下以免继续空转。` +
                  `可以：① 指出具体要查看的文件或位置；② 换一种问法；③ 让我改用其它方式排查。`;
              }
              return this.finalize(this.state, context);
            }
          }
        }

        // ==========================================
        // P14（2026-09-01）：探索预算 + 探索疲劳——信息收集任务收敛保护
        // ==========================================
        const roundToolNames = reasonResult.toolCalls
          .map((tc) => tc.name)
          .filter(Boolean);
        const roundExploreCount = roundToolNames.filter((n) =>
          EXTERNAL_FETCH_TOOLS.has(n)
        ).length;
        const roundHasProductive = roundToolNames.some((n) =>
          PRODUCTIVE_TOOLS.has(n)
        );
        if (roundExploreCount > 0) {
          this.exploreCalls += roundExploreCount;
          this.exploreRecentWindow.push(true);
        } else {
          this.exploreRecentWindow.push(false);
        }
        if (this.exploreRecentWindow.length > EXPLORE_FATIGUE_WINDOW) {
          this.exploreRecentWindow.shift();
        }
        const fatigueRounds = this.exploreRecentWindow.filter(Boolean).length;
        const exploreFatigue =
          this.exploreRecentWindow.length >= EXPLORE_FATIGUE_WINDOW &&
          fatigueRounds >= EXPLORE_FATIGUE_RATIO &&
          !roundHasProductive;

        // 方案 A：探索预算——累计探索达阈值且未提示过 → 强制整合（软提示，只 1 次）
        if (
          this.exploreCalls >= EXPLORE_BUDGET &&
          !this.exploreBudgetPrompted
        ) {
          this.exploreBudgetPrompted = true;
          this.steeringQueue.push(
            '探索预算已达上限：你已调用大量搜索/浏览/技能加载类工具。请立即停止搜索，' +
              '基于已有搜索结果整合输出（总结/回答/报告），不要再调用任何搜索类工具。' +
              '若信息不足，请明确说明缺口并询问用户。'
          );
          this.recentRoundSignatures = []; // 重置签名窗口，给模型收敛空间
          logger.warn('reActLoop:explore_budget_reached', {
            iteration: this.state.iteration,
            exploreCalls: this.exploreCalls,
          });
        } else if (exploreFatigue && !this.exploreFatiguePrompted) {
          // 方案 B（第一步）：探索疲劳——窗口内探索占比高且无产出 → 软提示
          this.exploreFatiguePrompted = true;
          this.exploreRecentWindow = []; // 重置窗口，给模型收敛空间
          this.steeringQueue.push(
            '工具使用陷入探索疲劳：连续多轮只调用搜索/浏览类工具，无任何实质产出。' +
              '请立即停止搜索，基于已有结果输出；若必须继续获取信息，请调用 ask_user_question 向用户确认。'
          );
          this.recentRoundSignatures = [];
          logger.warn('reActLoop:explore_fatigue_prompted', {
            iteration: this.state.iteration,
            fatigueRounds,
          });
        } else if (exploreFatigue && this.exploreFatiguePrompted) {
          // 方案 B（第二步）：软提示后仍疲劳 → 硬熔断（降级提示，非 error 事件）
          logger.warn('reActLoop:explore_fatigue_loop', {
            iteration: this.state.iteration,
            fatigueRounds,
            exploreCalls: this.exploreCalls,
          });
          this.state.phase = 'error';
          const completedTip =
            this.completedWork.length > 0
              ? `已完成：${this.completedWork.join('；')}。`
              : '';
          this.state.lastError = `${completedTip}你连续多轮陷入搜索/浏览循环，未产生实质进展，已停止。请明确告诉用户需要什么具体信息（提供正文/链接/明确问题），或基于已有内容继续输出。`;
          return this.finalize(this.state, context);
        }

        // --- Advance iteration ---
        this.state.iteration++;
        this.state.pendingToolCalls = [];

        // --- Circuit breaker ---
        if (this.checkCircuitBreaker(actResult)) {
          this.state.phase = 'error';
          this.state.lastError =
            'circuit_breaker: consecutive invalid turns exceeded';
          yield {
            type: 'error',
            message: this.state.lastError,
          };
          return this.finalize(this.state, context);
        }

        yield { type: 'iteration_end', iteration: this.state.iteration };
      }
    } catch (err) {
      handleError(err, { module: 'query:reactLoop', action: 'run' });
      this.state.phase = 'error';
      this.state.lastError = String(err);
      yield { type: 'error', message: String(err) };
      return this.finalize(this.state, context);
    }
  }

  /** 获取当前状态（用于外部监控） */
  getState(): Readonly<ReActState> {
    return this.state;
  }

  /**
   * 便捷入口（A2）：完整收集事件流并返回最终结果（非流式消费）。
   * 供非流式调用点 / 需 Promise<TResult> 的调用方使用（M4）。
   */
  async runCollect(input: TInput): Promise<TResult> {
    const iter = this.run(input);
    let r = await iter.next();
    while (!r.done) {
      r = await iter.next();
    }
    return r.value;
  }

  /** 中止循环 */
  abort(): void {
    this.state.phase = 'aborted';
    // D6（2026-09-17）：直接中止骨架自有控制器——原经 config.abortSignal 上
    // _controller 私有字段的类型断言反向传播中止，字段改名/转 #private 后
    // 中止会静默失效且无编译报错（对齐 SubAgentEngine 的 abortController 显式传递）
    this._abortController.abort();
  }
}

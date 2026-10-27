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
// 2026-09-25 §6.8：预期中断判据（常量 / 品牌 / isAbortReason）已**下沉**到 `error/`，
// 以供更低层共用（`handleError` 唯一错误入口、`ai/providers/*` 包装点、`core/exit/ExitRecorder`）。
import {
  SYSTEM_ABORT_REASON,
  SYSTEM_ABORT_BRAND,
  isAbortReason,
} from '../error/abortReason.js';
import type { QuestionData } from '@modules/runtime/api/CoreAPI.js';
// 2026-10-08（架构治理 P1 · §1.6 红线审计修复）：steering 来源联合的**单一事实源**在
// `session/types/eventPayloads.ts`（service 层）⇒ app 层向下引用合法，不另立第二份联合。
import type { SteeringSource } from '@modules/session/types/eventPayloads';
// LRO-09（2026-10-26）：失败分类的**单一事实源**在 session 工具契约（与 `ToolResult.failureKind` 同源）
import type { ToolFailureKind } from '@modules/session/types/tool.js';
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
  'skill',
  'tool_search',
  // ⚠️ 2026-09-29（工具名漂移修复，台账 D-37）：原列 `'search_codebase'` —— 该名在本仓
  // **不存在**（CC 风格）⇒ 永不命中；按既定策略"无对应工具者**直接移除**、不臆造近义名"清理。
  // **开放问题（登记 D-39，未决）**：本集合语义是"外部内容获取 / 探索"，是否应把**本地检索**
  //（`grep`/`glob`，事实源 = `query/tool-constants.ts` 的 `SEARCH_TOOLS`）并入，属**设计判断**
  //（会改变探索预算与探索疲劳的判定口径）⇒ 本轮**未擅自加入**。
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
  // 二期 O2-1（2026-09-24「会话暴露问题分析与优化方案」§五）：**`error` 大杂烩细分**。
  // 此前 5 个语义迥异的产出点全部折叠为 `phase='error'` ⇒ ① 用户侧/上层无法据相位区分
  // "无进展熔断 / 探索疲劳 / 电路熔断 / 推理错误 / 内部异常"；② 目标层把最该计数的"真·无进展"
  // 映射成了不计数的 `turn_interrupted`（问题清单 G1）。
  | 'reasoning_error'
  | 'no_progress'
  | 'exploration_fatigue'
  | 'circuit_breaker'
  // LRO-09 步骤 3（2026-10-26）：**环境阻塞**（权限拒绝 / 安全拦截 / 能力未就绪）
  // 与「模型无效输出」分型 —— 前者重试不可能改变结果，必须给出可执行结论。
  | 'environment_blocked'
  | 'internal_error'
  | 'aborted'
  // 二期 O2-1：**系统中止**与"用户主动放弃"区分。此前一律映射 `user_aborted` ⇒
  // `req.on('close')`（页面关闭/断线）与"会话被删除时的清理性中止"都被记成用户意图（G5）。
  | 'system_aborted'
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

/** 中止来源（二期 O2-1）：`user` = 用户主动停止；`system` = 传输/生命周期等系统侧中止 */
export type AbortSource = 'user' | 'system';

/**
 * 系统侧中止标记（二期 O2-1）。
 *
 * 调用方以 `controller.abort(createSystemAbortReason())` 声明"这是系统侧中止"（如
 * `req.on('close')` 断线、会话删除时的清理性中止），骨架据此把终止原因记为
 * `system_aborted` 而非 `aborted`（＝用户主动放弃）。用**显式标记**而非字符串推断（CS02）。
 *
 * **2026-09-25 §6.8**：`SYSTEM_ABORT_REASON`（标记值/消息锚点）与品牌键已**下沉**到
 * `error/abortReason.ts` —— 因为需要该判据的层（`handleError` / providers / `ExitRecorder`）
 * 都低于本模块。此处 import 后原样 **re-export** ⇒ `@modules/query` 对外出口逐字不变。
 */
export { SYSTEM_ABORT_REASON, isAbortReason };

/**
 * 构造一次系统侧中止的 reason（② 加固，2026-09-25，
 * `.trae/specs/system-abort-reason-hardening.md`）。
 *
 * `abort(createSystemAbortReason())` 后，`signal.reason`（以及外泄为 rejection 的 reason）都是
 * **带真实抛出点栈的 Error** —— 修复前 marker 是裸字符串，外泄时**全链路无栈**（实测 crash dump
 * 的 `stack` 只指向记录器自身），使"谁没 catch"无法定位（见
 * `dev_docs/error_repairs/last-exit-20260925-0154Z.md`）。
 *
 * - `name = 'AbortError'` ⇒ 已被 `isAbortReason()` 判为**预期中断**（无需改该判据）
 * - `message = SYSTEM_ABORT_REASON` ⇒ 所有取 `.message` 的派生文案（provider `AppError`、
 *   `流式读取异常`、`last-exit.json.message`）**逐字不变**
 * - **品牌属性**（`SYSTEM_ABORT_BRAND`，非枚举）⇒ 判定用**显式标记**而非字符串（CS02）
 *
 * **为什么不用"导出类 + 直接继承 Error"的子类写法（与原 spec §3.1 的偏差，如实）**：
 * ① 架构门禁 R01-002（`lint-arch` 以正则扫描"导出类直接继承 Error"，**注释里的示例文本也会命中**）
 *    要求错误类继承 `AppError`；② 但真正继承 `AppError` 会**改变既有行为** —— `OpenAIProvider` 有
 *    `if (error instanceof AppError) throw error;` 分支，abort reason 会被**直接上抛**，
 *    使 `OpenAI stream failed: …（Provider: …）` 文案与 `errorRecovery` 的 errorCategory 判定
 *    一同改变。故改用"普通 `Error` + 品牌属性"：既不触规则，也不改变任何下游语义。
 *
 * ❌ 禁止改成共享单例/常量实例：那会让所有中止的栈都指向模块加载点，**等于没有栈**。
 */
export function createSystemAbortReason(): Error {
  const reason = new Error(SYSTEM_ABORT_REASON);
  reason.name = 'AbortError';
  Object.defineProperty(reason, SYSTEM_ABORT_BRAND, {
    value: true,
    enumerable: false,
  });
  return reason;
}

/**
 * 是否**系统侧**中止（狭义判据，**单一事实源**）。
 *
 * 与 `isAbortReason()`（**广义**：预期中断，含用户主动停止的 AbortError）**严格分工** ——
 * 用户停止同样是 AbortError，若被本判据命中，Goal 会错落 `system_aborted`（把"系统中止"
 * 说成"用户主动放弃"）。
 *
 * 兼容分支（`=== SYSTEM_ABORT_REASON` / `Error.message === 常量`）保留，供仍传字符串常量的
 * 既有调用与跨边界还原场景使用（有意保留，非回退兜底 —— CS03）。
 */
export function isSystemAbortReason(reason: unknown): boolean {
  if (
    typeof reason === 'object' &&
    reason !== null &&
    (reason as { [SYSTEM_ABORT_BRAND]?: boolean })[SYSTEM_ABORT_BRAND] === true
  ) {
    return true;
  }
  if (reason === SYSTEM_ABORT_REASON) return true;
  if (reason instanceof Error && reason.message === SYSTEM_ABORT_REASON) {
    return true;
  }
  return false;
}

// `isAbortReason()`（广义「预期中断」判据，含裸字符串/品牌/AbortError 三形态）已**下沉**到
// `error/abortReason.ts`（2026-09-25 §6.8），本文件 import 后在上面 re-export。

/** 循环状态 */
export interface ReActState {
  iteration: number;
  phase:
    | 'reasoning'
    | 'acting'
    | 'completed'
    | 'aborted'
    | 'error'
    // 二期 O2-1（2026-09-24）：`error` 细分后的 5 个专门相位（各产出点只置自己那一个）
    | 'reasoning_error'
    | 'no_progress'
    | 'exploration_fatigue'
    | 'circuit_breaker'
    // LRO-09 步骤 3（2026-10-26）：环境阻塞 ⇒ 专门相位（与 circuit_breaker 分开计数）
    | 'environment_blocked'
    | 'internal_error'
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
  /**
   * 二期 O2-1（2026-09-24）：中止来源标记 —— 判别器据此区分 `aborted`（用户主动）
   * 与 `system_aborted`（传输/生命周期中止）。缺省视为 `'user'`（既有语义不变）。
   */
  abortSource?: AbortSource;
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
  /**
   * 失败分类（LRO-09）：仅 `status === 'error'` 时有意义。
   * 缺省 = 未分类（按「模型无效输出」计）；分类用于把「环境不可自愈的阻塞」
   * 从「模型输出无效」里分出来（见 `.trae/specs/circuit-breaker-classification.md`）。
   */
  failureKind?: ToolFailureKind;
}

/**
 * 单次工具执行的**中间结果**（批处理路径的 `executeTools` 返回元素 + 跳过回填共用）。
 *
 * LRO-D5（2026-10-26）：`failureKind` 必须能从这里一路透传到 `ToolResultEntry`，
 * 否则熔断双预算在 TAOR/LRO 路径永不触发 `environment_blocked`。
 */
export interface RawToolResult {
  toolCallId?: string;
  toolName?: string;
  result?: unknown;
  error?: string;
  failureKind?: ToolFailureKind;
}

/** 中间结果 → `ActResult.results`（`failureKind` 原样透传，未分类不臆造） */
export function toToolResultEntries(
  calls: readonly Pick<ToolCallEntry, 'id' | 'name'>[],
  rawResults: readonly (RawToolResult | undefined)[]
): ToolResultEntry[] {
  return rawResults.map((r, i) => ({
    toolCallId: r?.toolCallId ?? calls[i]?.id ?? '',
    name: calls[i]?.name ?? '',
    status: r?.error ? 'error' : 'success',
    output: typeof r?.result === 'string' ? r.result : undefined,
    error: r?.error,
    failureKind: r?.failureKind,
  }));
}

/**
 * 环境层**阻塞**类失败（LRO-09 步骤 3）：重试同一动作不会改变结果，只能由用户/环境侧
 * 处置（放行规则、修审批通道、装依赖）。
 *
 * 为什么不单开模块：`classifyTurn` 的类型与判定都依赖 `ToolResultEntry`，而
 * `lint:state-ratchet` 会把"新文件里出现已登记状态词汇"当作**未报备新增**阻断提交
 * ⇒ 与 `ToolResultEntry` 同文件是最小且可过门禁的落点。
 */
const ENVIRONMENT_BLOCKING_KINDS = new Set<ToolFailureKind>([
  'permission_denied',
  'safety_blocked',
  'env_unavailable',
]);

/**
 * 一轮工具执行的分型（**纯判定**，不做计数、不改相位）：
 *
 * - `progress`：**非全部**失败 ⇒ 既有语义（`consecutiveInvalidTurns` 清零），
 *   也是"本轮有推进"的唯一判据；
 * - `environment_blocked`：全部失败且**每一种**失败都是环境阻塞类；
 * - `invalid`：全部失败但含未分类 / `tool_error` ⇒ 既有 invalid 预算。
 *
 * ⚠️ 判定只看结构化字段 `status` + `failureKind`，**禁止解析 `error` 文本**（CS02）；
 * `status !== 'error'` 的条目即便被误填 `failureKind` 也不得算阻塞（负向对照见用例）。
 */
export function classifyTurn(
  results: readonly Pick<ToolResultEntry, 'status' | 'failureKind'>[]
): 'progress' | 'environment_blocked' | 'invalid' {
  const allFailed =
    results.length > 0 && results.every((r) => r.status === 'error');
  if (!allFailed) return 'progress';
  const allBlocking = results.every(
    (r) =>
      r.failureKind !== undefined &&
      ENVIRONMENT_BLOCKING_KINDS.has(r.failureKind)
  );
  return allBlocking ? 'environment_blocked' : 'invalid';
}

/** ReAct 事件流 */
export type ReActEvent =
  | { type: 'reasoning_start' }
  | {
      type: 'reasoning_delta';
      text: string;
      messageId?: string;
      /**
       * O2-4（2026-09-24「会话暴露问题分析与优化方案」§五）：**正文取代**标记。
       *
       * `true` = 本轮文本**取代**此前已下发的正文（续接/重试轮）。后端每轮把
       * `assistantMessage.content` 整体替换为本轮文本，前端此前只会 append ⇒ 前端多出
       * 重复段落且与落盘不同源。本标记让前端同步"从零重建"，使**所见 == 所存**。
       */
      replace?: boolean;
    }
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
  // A1 T5（2026-10-05）：挂起提问的 fail-closed 结算 → status chunk，前端**实时**可见（不静默）
  | { type: 'suspension_settled'; content: string }
  // 阶段 A（A1-d）：本轮以 sessions_yield 让出 turn（骨架据此收尾，不再进入下一轮）
  | { type: 'yielded' };

/** 预算控制器最小接口（下沉自 TAORLoop TokenBudget 语义，2026-09-01；子类可选接入） */
export interface BudgetControllerLike {
  /** 是否允许继续执行下一轮 */
  canExecute(): boolean;
  /** 预算耗尽但允许完成当前调用后的优雅最后一调（可选） */
  needsGraceCall?: () => boolean;
}

/**
 * 一条待注入的 steering 条目（2026-10-08，§1.6 红线审计修复）。
 *
 * 为什么不是裸字符串：`[STEERING]` 注入是**模型可见输入**，§1.6 要求"模型可见 ⇔ 已落盘"
 * ⇒ 注入时必须能落一条 `context/steering` 事件，而事件载荷需要 `source`（谁插的）⇒
 * 来源必须**与正文一起**随队列流动，不能在消费点反推。
 */
export interface SteeringEntry {
  /** 注入正文（不含 `[STEERING] ` 前缀） */
  text: string;
  /** 来源（联合定义见 `session/types/eventPayloads.ts`） */
  source: SteeringSource;
}

/** 循环配置 */
export interface ReActLoopConfig {
  maxIterations: number;
  abortSignal?: AbortSignal;
  /** 最大连续 all-invalid 轮数（熔断器），0=禁用 */
  maxConsecutiveInvalidTurns: number;
  /**
   * LRO-09（2026-10-26）：最大连续**环境阻塞**轮数，0=禁用。默认 **2**（比 invalid 的 3 更早收口：
   * 环境问题不是概率事件，第二次已足以确认「不是偶发」）。
   *
   * 与 `maxConsecutiveInvalidTurns` **互不污染**：分型见 `classifyTurn()`。
   */
  maxConsecutiveBlockedTurns: number;
  /**
   * D 项（2026-08-30）：无进展熔断阈值——连续 N 轮"工具名+状态"签名完全相同
   * 视为无进展死循环（实测 skills_list 反复搜索 249 轮），0=禁用
   */
  maxRepeatedRounds?: number;
  /** 可选：初始 steering 消息（每轮 reason 前经 onSteering 注入，下沉自 TAORLoop 2026-09-01） */
  steeringMessages?: string[];
  /**
   * 预算控制器（每轮检查，耗尽优雅收尾）。
   *
   * ⚠️ **不要以为"默认不启用"**（2026-09-26 更正）：该注释原文写"ReActToolLoop 默认不启用，
   * 能力预留"，但**流式路径已由工厂默认注入** —— `createAgentLoop()` 会对 `mode:'stream'`
   * 注入 `createStreamBudget(model)`（`chat/createAgentLoop.ts:115-124`），只有**调用方显式传
   * `config.budget`** 时才让位。因此本分支在**生产 chat 路径上是活的**，且是"本轮 token 预算
   * 上限，工具链提前终止"那句话的**唯一来源**（本文件 `:719-733`）。
   */
  budget?: BudgetControllerLike;
  /**
   * 可选：会话标识 —— **仅用于日志可诊断性**（不影响任何判定）。
   *
   * 2026-09-26 补：`reActLoop:budget_exhausted` / `budget_grace_call` 此前**不带 `sessionId`**
   * （同级日志都带），排查"某会话为何被提前终止"时无法把日志对到会话上 ⇒ 由子类传入。
   */
  sessionId?: string;
}

/**
 * 连续 all-invalid 轮数默认阈值。
 *
 * P2-1（2026-10-27）：主循环与**子代理**共用同一阈值（`SubAgentEngine` 直接引用本常量），
 * 避免两处各写一个字面量而漂移。
 */
export const DEFAULT_MAX_CONSECUTIVE_INVALID_TURNS = 3;

/** 连续环境阻塞轮数默认阈值（同上，与 invalid 双预算互不污染） */
export const DEFAULT_MAX_CONSECUTIVE_BLOCKED_TURNS = 2;

const DEFAULT_CONFIG: ReActLoopConfig = {
  maxIterations: 30,
  maxConsecutiveInvalidTurns: DEFAULT_MAX_CONSECUTIVE_INVALID_TURNS,
  maxConsecutiveBlockedTurns: DEFAULT_MAX_CONSECUTIVE_BLOCKED_TURNS,
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
  /** LRO-09 步骤 3：连续「环境阻塞」轮数（与 `consecutiveInvalidTurns` 双预算、互不污染） */
  protected consecutiveBlockedTurns = 0;

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
  /**
   * steering 队列（下沉自 TAORLoop 2026-09-01：骨架统一管理，每轮 reason 前经 onSteering 注入）
   *
   * 2026-10-08（§1.6 红线审计修复）：元素由裸字符串升级为 `SteeringEntry` —— 携带 `source`
   * 以便注入时落 `context/steering` 事件（此前只落 logger ⇒ 模型可见输入无法从事件重建）。
   */
  protected steeringQueue: SteeringEntry[] = [];

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
    this.consecutiveBlockedTurns = 0;
    this.completedWork = [];
    this.steeringQueue = [];
  }

  constructor(config?: Partial<ReActLoopConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    // D6（2026-09-17）：骨架自带中止控制器——外部传入的 abortSignal 仅作联动监听，
    // config.abortSignal 恒指向本控制器（对齐 SubAgentEngine 外部信号→内部控制器模式）
    this._abortController = new AbortController();
    // 二期 O2-1（2026-09-24）：state 提前建好——外部信号的中止来源标记需要写进 state
    this.state = { iteration: 0, phase: 'reasoning', pendingToolCalls: [] };
    const externalSignal = config?.abortSignal;
    if (externalSignal) {
      // 中止来源**在回调内读取** `reason`（构造期读会漏掉"稍后带 reason 中止"的情形）
      const markAbortSource = (): void => {
        this.state.abortSource = isSystemAbortReason(externalSignal.reason)
          ? 'system'
          : 'user';
      };
      if (externalSignal.aborted) {
        markAbortSource();
        this._abortController.abort();
      } else {
        externalSignal.addEventListener(
          'abort',
          () => {
            markAbortSource();
            this._abortController.abort();
          },
          { once: true }
        );
      }
    }
    this.config.abortSignal = this._abortController.signal;
    this.steeringQueue = config?.steeringMessages
      ? config.steeringMessages.map((text) => ({
          text,
          source: 'other' as const,
        }))
      : [];
  }

  /** 运行时注入 steering 消息（下一轮 reason 前经 onSteering 生效） */
  queueSteering(message: string, source: SteeringSource = 'other'): void {
    this.steeringQueue.push({ text: message, source });
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

  /**
   * 预算耗尽 Hook（Budget Suspend Resume，Task 5）。
   *
   * 两处耗尽分支（loop-local `config.budget` = 上下文窗口预算；G-1 = 进程级日预算）在
   * 置 `budget_exhausted` 相位后、`finalize` 之前 `await` 调用，供子类落“挂起”标记。
   * 默认空实现 ⇒ 未接入的子类零行为变更。
   *
   * @param kind `'loop'` = 上下文窗口预算耗尽；`'daily'` = 日预算耗尽（可挂起续跑场景）。
   */
  protected async onBudgetExhausted(_kind: 'loop' | 'daily'): Promise<void> {
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
      // 二期 O2-1（2026-09-24）：按**来源标记**区分"用户主动放弃"与"系统中止"——
      // 标记缺省为 `'user'`（既有语义不变），不做任何字符串推断（CS02）。
      return this.state.abortSource === 'system' ? 'system_aborted' : 'aborted';
    }
    if (this.state.phase === 'error') return 'error';
    // 二期 O2-1：`error` 细分后的 5 个专门相位。必须**先于 max_turns** 判别——它们都是
    // "已决定不再继续"的终态原因，排在 max_turns 之后会被"恰好同时到上限"整体遮蔽。
    if (this.state.phase === 'reasoning_error') return 'reasoning_error';
    if (this.state.phase === 'no_progress') return 'no_progress';
    if (this.state.phase === 'exploration_fatigue')
      return 'exploration_fatigue';
    if (this.state.phase === 'circuit_breaker') return 'circuit_breaker';
    // LRO-09 步骤 3：环境阻塞独立原因码（必须与 circuit_breaker 同位置判别——
    // 都是"已决定不再继续"的终态，排在 max_turns 之后会被"恰好同时到上限"遮蔽）
    if (this.state.phase === 'environment_blocked')
      return 'environment_blocked';
    if (this.state.phase === 'internal_error') return 'internal_error';
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

  /**
   * **终稿校验 Hook**（P1-1②，2026-09-28）：在 `onIncompleteTurn` **之后**、`finalize` 之前调用
   * （仅当本轮无 tool_calls）。子类校验终稿内容，不合格则注入修正指令并返回 `true`
   * ⇒ 骨架 `continue` 再给一轮（**真本轮内自纠**，区别于收尾后的下轮 steering）。
   *
   * 与 `onIncompleteTurn` 的分工（两者都是"重试一次"，但判据不同）：
   * - 前者判**完整性**（空回复/只思考/只计划/被截断）——输出"没交付"；
   * - 本钩子判**合法性**（内容在，但不合规）——输出"交付了坏东西"。
   *
   * 重试上限由子类维护，防死循环。
   */
  protected async onFinalOutputValidation(
    _result: ReasonResult<TContext>,
    _context?: TContext
  ): Promise<boolean> {
    return false; // default: 不校验
  }

  /**
   * steering 注入 Hook（下沉自 TAORLoop 2026-09-01）：骨架每轮 reason 前调用，
   * 子类把 `[STEERING]` 消息加入自己的对话上下文（`ReActToolLoop` 实现为 `loopState.messages`）。
   *
   * ⚠️ §1.6 红线：**实现方必须先把每条 entry 落成 `context/steering` 事件，再注入消息**
   * （模型可见 ⇔ 已落盘）。默认 no-op —— 不注入任何内容 ⇒ 无需落盘。
   */
  protected async onSteering(_entries: SteeringEntry[]): Promise<void> {
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

  /**
   * 轮级熔断判定（LRO-09 步骤 3：**双预算**）。
   *
   * 返回本轮触发的预算；`null` = 不终止。分型规则见 `classifyTurn()`：
   * - `progress`（非全部失败）⇒ 两个计数器**都清零**（既有 invalid 语义不变）；
   * - `environment_blocked`（全部失败且全为环境阻塞类）⇒ `consecutiveBlockedTurns++`，
   *   `consecutiveInvalidTurns` **保持不清零**（避免掩盖上一轮模型错误）；
   * - `invalid`（全部失败但含未分类 / tool_error）⇒ 既有 `consecutiveInvalidTurns++`。
   */
  private checkCircuitBreaker(
    result: ActResult
  ): 'invalid' | 'environment_blocked' | null {
    const outcome = classifyTurn(result.results);
    if (outcome === 'progress') {
      this.consecutiveInvalidTurns = 0;
      this.consecutiveBlockedTurns = 0;
      return null;
    }
    if (outcome === 'environment_blocked') {
      if (this.config.maxConsecutiveBlockedTurns <= 0) return null;
      this.consecutiveBlockedTurns++;
      const blockedTools = result.results.map((r) => ({
        name: r.name,
        kind: r.failureKind,
        error: (r.error ?? r.output ?? '').slice(0, 200),
      }));
      logger.warn(
        'reActLoop:turn_blocked (consecutive environment-blocked turn)',
        {
          iteration: this.state.iteration,
          consecutiveBlockedTurns: this.consecutiveBlockedTurns,
          maxConsecutiveBlockedTurns: this.config.maxConsecutiveBlockedTurns,
          blockedToolCount: result.results.length,
          blockedTools,
        }
      );
      if (
        this.consecutiveBlockedTurns >= this.config.maxConsecutiveBlockedTurns
      ) {
        logger.warn('reActLoop:environment_blocked triggered', {
          sessionId: this.config.sessionId,
          blockedTurns: this.consecutiveBlockedTurns,
          maxBlockedTurns: this.config.maxConsecutiveBlockedTurns,
          reasons: result.results.map((r) => ({
            tool: r.name,
            kind: r.failureKind,
          })),
        });
        return 'environment_blocked';
      }
      return null;
    }
    // outcome === 'invalid'（模型无效输出 / 工具自身失败）：既有语义逐字保留
    if (this.config.maxConsecutiveInvalidTurns <= 0) return null;
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
      return 'invalid';
    }
    return null;
  }

  /**
   * LRO-09 步骤 3：`environment_blocked` 的用户可见结论（写入 `state.lastError`）。
   *
   * 口径由 spec §4.3 定，拍板结论（2026-10-26）：
   * - 每个被拦调用给出「工具 → 分类」与原因（原因文本已含 `[rule=…]`，即 ruleId **只给用户**）；
   * - **不自动重试**：只给放行/修复入口，由用户处理后重发本条消息。
   */
  private _formatEnvironmentBlocked(result: ActResult): string {
    const blocked = result.results.filter((r) => r.status === 'error');
    const shown = blocked
      .slice(0, 5)
      .map(
        (r) =>
          `- ${r.name} → ${r.failureKind ?? '未分类'}：${(r.error ?? '')
            .replace(/\s+/g, ' ')
            .slice(0, 120)}`
      );
    const more =
      blocked.length > shown.length
        ? `\n- …另有 ${blocked.length - shown.length} 个同类调用`
        : '';
    return (
      `本轮无法继续：${blocked.length} 个工具调用被环境拦截` +
      `（连续 ${this.consecutiveBlockedTurns} 轮），继续重试不会改变结果。\n\n` +
      `${shown.join('\n')}${more}\n\n` +
      `请按上述提示放行/修复后**重新发送本条消息**（本次不会自动重试）。`
    );
  }

  /**
   * G-1（2026-10-11）：**每日预算**的逐轮复检钩子（默认放行）。
   *
   * 骨架在此只提供"每轮可判定一次"的接缝；**对话类**子类（`ReActToolLoop`）覆盖为真实判定。
   * 与上方 `config.budget`（**上下文窗口**预算）正交：后者管单次请求的上下文上限，
   * 本钩子管**进程级日额度**（Spec `daily-budget-over-limit-ux.md` §1.2 G-1）。
   */
  protected dailyBudgetAllowsNextTurn(): boolean {
    return true;
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
              sessionId: this.config.sessionId,
              maxIterations: this.config.maxIterations,
              iteration: this.state.iteration,
            });
            // K1（2026-09-05）：预算耗尽终止不再置 'completed'——消费 phase 完成态的
            // 上层据此区分「预算耗尽」与「正常完成」。
            this.state.phase = 'budget_exhausted';
            await this.onBudgetExhausted('loop');
            return this.finalize(this.state, context);
          }
          logger.warn('reActLoop:budget_grace_call', {
            sessionId: this.config.sessionId,
            iteration: this.state.iteration,
          });
        }

        // --- G-1（2026-10-11）：**日预算**逐轮复检（与上方 `config.budget` 正交） ---
        // 为什么必须每轮：单轮真实消耗不可预知（工具循环基础 30 → 动态 ≤500 轮）⇒ 只在请求
        // 开始判定一次会让"一次进入"把额度跑穿（实测 180%）。收束方式与上方预算分支一致：
        // 置 `budget_exhausted` 相位 + finalize（**不抛错**，由消费侧按相位区分）。
        if (!this.dailyBudgetAllowsNextTurn()) {
          logger.warn('reActLoop:daily_budget_exhausted', {
            sessionId: this.config.sessionId,
            iteration: this.state.iteration,
          });
          this.state.phase = 'budget_exhausted';
          await this.onBudgetExhausted('daily');
          return this.finalize(this.state, context);
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
              this.state.phase = 'reasoning_error';
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
          // P1-1②（2026-09-28）：**终稿校验**——完整性通过后校验内容合法性（当前为 mermaid
          // 结构预检）。不合格则注入修正指令并返回 true，同样再给一轮（上限由子类控制）。
          // 顺序不可颠倒：先"有没有交付"，再"交付得对不对"。
          if (await this.onFinalOutputValidation(reasonResult, context)) {
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
              this.queueSteering(
                '你多次尝试获取外部内容（网页/文章/技能）均未成功，可能因反爬或来源不可访问。' +
                  '请调用 ask_user_question 向用户说明情况并提供选项：提供文章正文、更换可访问的来源链接、或放弃该子任务。',
                'loop-guard'
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
              this.state.phase = 'no_progress';
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
          this.queueSteering(
            '探索预算已达上限：你已调用大量搜索/浏览/技能加载类工具。请立即停止搜索，' +
              '基于已有搜索结果整合输出（总结/回答/报告），不要再调用任何搜索类工具。' +
              '若信息不足，请明确说明缺口并询问用户。',
            'loop-guard'
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
          this.queueSteering(
            '工具使用陷入探索疲劳：连续多轮只调用搜索/浏览类工具，无任何实质产出。' +
              '请立即停止搜索，基于已有结果输出；若必须继续获取信息，请调用 ask_user_question 向用户确认。',
            'loop-guard'
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
          this.state.phase = 'exploration_fatigue';
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

        // --- Circuit breaker（LRO-09 步骤 3：双预算 —— 环境阻塞 / 模型无效输出分型）---
        const breaker = this.checkCircuitBreaker(actResult);
        if (breaker === 'environment_blocked') {
          this.state.phase = 'environment_blocked';
          // ⚠️ 必须同批写 lastError：本相位属 `error` 族「透传 lastError」策略，
          // 为空 ⇒ 正文空 ⇒ 被空消息护栏拒持久化（见 terminationOutput 注释）。
          this.state.lastError = this._formatEnvironmentBlocked(actResult);
          yield { type: 'error', message: this.state.lastError };
          return this.finalize(this.state, context);
        }
        if (breaker === 'invalid') {
          this.state.phase = 'circuit_breaker';
          // 2026-10-19：把**最近一次失败的工具与原因**带进用户可见错误，
          // 否则只剩一句 "consecutive invalid turns exceeded"，无法定位根因
          //（实测：PowerShell allowlist 误拒 `& node …` 时用户只能看到这句）。
          const lastFailure = actResult.results.find(
            (r) => r.status === 'error'
          );
          const failureDetail = lastFailure
            ? `（最近失败：${lastFailure.name} — ${(
                lastFailure.error ??
                lastFailure.output ??
                ''
              ).slice(0, 160)}）`
            : '';
          this.state.lastError = `circuit_breaker: consecutive invalid turns exceeded${failureDetail}`;
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
      this.state.phase = 'internal_error';
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

  /**
   * 声明中止来源（二期 O2-1）。
   *
   * 供**系统侧**中止的调用方在 `abort()` 前显式标记（如传输断线、会话清理）；
   * 不标记 ⇒ 缺省 `'user'`（既有语义不变）。之所以不并入 `abort()` 签名：`TAORLoop`
   * 已用 `abort(saveCheckpoint?: boolean)` 覆写该方法（落检查点语义），签名不可复用。
   * 走外部 AbortSignal 的路径无需调用本方法 —— 直接 `controller.abort(SYSTEM_ABORT_REASON)`
   * 即由构造函数透传来源。
   */
  markAbortSource(source: AbortSource): void {
    this.state.abortSource = source;
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

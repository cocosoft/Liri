// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * terminationOutput —— 终止原因 → 收尾文案 / 目标原因码（ReActToolLoop 拆分批 U-22/S1）
 *
 * **来源**：从 `ReActToolLoop.ts` 外移 `resolveTerminationOutput`（208 行）与
 * `mapTerminationToGoalReason`（57 行），以及 `EMPTY_OUTPUT_FALLBACK_TEXT` 常量。
 *
 * **职责（单一：给定终止事实，产出收尾文案与目标层原因码）**：
 *   ① `resolveTerminationOutput`：`switch (reason)` **穷尽映射**（`default` 用 `never` 断言
 *      ⇒ 新增 `TerminationReason` 成员而不补文案会编译失败），并在"无提示 + 无可见正文"时兜底；
 *   ② `mapTerminationToGoalReason`：语义等价才共用原因码（`loop_detected` ⇒ 真·无进展）。
 *
 * **行为等价**：全部文案、日志字段、`concurrentReasons` 并列上报与判定顺序**逐字未变**。
 */

import { getLogger } from '@modules/monitoring';
import type { TerminationReason } from '@modules/query';
import type { GoalTurnReason } from '@modules/tasks';

const logger = getLogger('chat:reactToolLoop');

/** 一期 F1-1（2026-09-23）："正常结束但零文本"的兜底文案（原文案受逐字回归守卫） */
export const EMPTY_OUTPUT_FALLBACK_TEXT =
  '\n\n⚠️ 本次未能生成回复（模型本轮未产出可见内容，可能因输出被截断或空回复重试已达上限）。请重发消息或换个问法重试。';

export interface TerminationOutputInput {
  /** 终止原因（唯一来源：`getTerminationReason()`） */
  reason: TerminationReason;
  /** 当前迭代轮次 */
  iteration: number;
  /** 轮次上限 */
  maxIterations: number;
  /** 达上限收尾总结（无总结 ⇒ 默认提示） */
  maxIterationsSummary?: string;
  /** 长任务信号（触顶时给出编排建议） */
  isLongTaskSignal: boolean;
  /** 循环检测事实（与 `max_turns` 并列上报） */
  loopDetected?: { detector: string; message: string } | null;
  /** 预算耗尽事实（`loop` = 窗口预算；`daily` = 日限额，可能已挂起可续跑） */
  lastBudgetExhausted?: { kind: 'loop' | 'daily'; suspended: boolean };
  /** 错误类终止的透传正文 */
  lastError?: string;
  /** 会话总时长上限终止时被丢弃的工具调用数 */
  droppedToolCallsAtStop: number;
  /** 会话总时长上限（毫秒） */
  maxTotalDurationMs: number;
  /** 最终助手消息内容（用于"无可见正文"兜底判定） */
  assistantMessageContent?: string | Array<{ type: string }>;
}

export interface TerminationOutput {
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
}

/**
 * 二期 F2-1（2026-09-23 修复计划 §六）：终止输出**单一来源**，且判别**接线既有判别器**。
 *
 * 一期只做到"文案单点"（仍自行重写判别条件）；二期改为：
 *   1. 原因一律取自 `getTerminationReason()` ⇒ 消除"同一事实两套判据"；
 *   2. 文案由 `switch (reason)` **穷尽映射**，`default` 用 `never` 断言 ⇒ **新增
 *      `TerminationReason` 成员而不补文案会编译失败**。
 */
export function resolveTerminationOutput(
  input: TerminationOutputInput
): TerminationOutput {
  const reason = input.reason;
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
      if (input.iteration >= input.maxIterations) {
        finishReason = 'max_turns';
        // 跨 run 预算（spec §3.5 最小变体）：本段额度**就是**任务级 grant（可再至硬顶）
        // ⇒ 文案直接展示该值（单段运行与修复前逐字一致，既有用例不受影响）。
        suffix = input.maxIterationsSummary
          ? `\n\n⚠️ 已达到最大工具轮次限制 (${input.maxIterations})，已自动总结当前进度：\n${input.maxIterationsSummary}`
          : `\n\n⚠️ 已达到最大工具轮次限制 (${input.maxIterations})，工具链提前终止。`;
        // G3（2026-09-25，`.trae/specs/long-task-routing.md`）：**长任务**触顶时给出
        // **可执行**的编排建议。载体选择（与 spec D2 的偏离，如实记录）：走**用户可见的
        // 收尾提示**而非模型可见的 steering —— ① 既有 `goal/injected` 载荷要求
        // `goalId` + 闭集 `templateKind`，非目标任务无法复用；② 新增事件类型与 spec N5 冲突；
        // ③ 该提示随最终助手消息落盘 ⇒ 无需新增模型可见输入（§1.6 红线面为零）。
        // 命令名事实来源：`/goal start`（command-registry 的 `goal` 命令，与
        // `POST /v1/pdca/start` 同链）；`OnboardHints.PDCA_EXPLICIT_ENTRY` 与本文案
        // 由用例断言保持一致（防第二处漂移）。
        if (input.isLongTaskSignal) {
          suffix +=
            '\n\n💡 该任务仍需多步推进？可改用编排分步执行：`/goal start <描述>`' +
            '（也可在新消息里说明"请分步做并自检"，我会自动升级为 PDCA）。';
        }
      }
      // 二期 F2-5（治 N3，2026-09-23）：判别器顺序使 `max_turns` **先于** `loop_detected`，
      // 两者同时命中时（长任务里"既循环又到轮次上限"很常见）循环检测信息会被**整个吞掉**
      // （既无提示也无 metadata）⇒ 此处**并列上报**（不改变既有优先级的排序语义）。
      // 留痕（logger）在 settleTerminalState() 内，保证每轮只记一次（投影可重入）。
      if (input.loopDetected) {
        const ld = input.loopDetected;
        suffix += `\n\n（同时检测到工具调用循环 [${ld.detector}] ${ld.message}）`;
        // 一期 O1-1：与文案并列上报到**结构化字段**（此前只进文案，metadata 丢失该事实）。
        concurrentReasons = ['loop_detected'];
      }
      break;
    }
    // 4. 循环检测提示
    case 'loop_detected':
      finishReason = 'loop_detected';
      suffix = `\n\n⚠️ 检测到工具调用循环 [${input.loopDetected?.detector ?? 'unknown'}] ${input.loopDetected?.message ?? ''}，任务提前终止。`;
      break;
    // L1（2026-09-06）：骨架 budget_exhausted phase（流式预算耗尽）附加原因提示——
    // 对齐 A3 截断/循环提示风格，避免用户看到"无正文直接中断"的困惑。
    //
    // 2026-10-16（台账 `BUDGET-EXHAUSTED-TERMINATION-COPY`）：**按事实区分三态**（此前两种
    // 语义完全不同的耗尽共用一句「已达到本轮 token 预算上限，工具链提前终止」，实测用户据此
    // 反复追问"为什么还会提前终止"）：
    //   · `loop`  = **上下文窗口**预算（`createStreamBudget`，`spent ≥ 92% × 窗口`）：不可放行续跑
    //     ⇒ 文案点明"窗口"并给**可执行出路**（发新消息 / 换大窗口模型）；
    //   · `daily` + **已挂起**：如实告诉用户"进度已保存 + 放行后自动续跑"（**不再说"提前终止"**）
    //     —— 否则与已实现的挂起续跑机制自相矛盾；
    //   · `daily` + 未挂起（开关关 / 无检查点）：给"放行后重发本条消息"的出路。
    // 兜底（无事实记录）保留原句，保证其它入口零回归。
    case 'budget_exhausted': {
      finishReason = 'budget_exhausted';
      const b = input.lastBudgetExhausted;
      if (b?.kind === 'daily' && b.suspended) {
        suffix =
          `\n\n⏸ 今日预算已用完 —— **本轮进度已保存**：在「用量中心 → 日限额」放行` +
          `（临时提额 / 今日解除）后，本会话会**自动从这里续跑**，无需重发消息。`;
      } else if (b?.kind === 'daily') {
        suffix =
          `\n\n⚠️ 今日预算已用完，本轮提前收尾（本次未能保存续跑点）。` +
          `请在「用量中心 → 日限额」放行（临时提额 / 今日解除）后**重发本条消息**继续。`;
      } else if (b?.kind === 'loop') {
        suffix =
          `\n\n⚠️ 本轮上下文已接近模型窗口上限，为避免超出窗口，工具链提前收尾。` +
          `**发送新消息即可继续**（新一轮会重新计算上下文占用）；` +
          `若经常撞线，建议改用上下文窗口更大的模型。`;
      } else {
        suffix = `\n\n⚠️ 已达到本轮 token 预算上限，工具链提前终止。`;
      }
      break;
    }
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
      // ⚠️ **新增 `error` 类相位必须同批写入 `state.lastError`**（台账 S15 约束，2026-10-08 取证）：
      // 本条正文**即由该字段透传**；若为空 ⇒ 助手消息正文为空 ⇒ 被 `ChatManager._addAndPersistMessage`
      // 的"空正文护栏"拒持久化（`ChatManager.ts:1600-1621`）⇒ 该轮**在会话历史中消失**（用户只看到流式提示语）。
      // 现状：5 个产出点均写可操作文案，且 `tests/chat/reactToolLoop-termination-o2.test.ts` 逐相位断言正文含之。
      suffix = input.lastError ? `\n\n${input.lastError}` : '';
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
      const dropped = input.droppedToolCallsAtStop;
      suffix =
        `\n\n⚠️ 本轮已达会话总时长上限（${Math.round(input.maxTotalDurationMs / 60000)} 分钟），已停止继续执行。` +
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
    const rawContent = input.assistantMessageContent;
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
      const blocks = Array.isArray(rawContent) ? rawContent : [];
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

/**
 * 二期 N2（2026-09-23 修复计划 §六）：终止原因 ⇒ 目标层原因码（`null` = 正常完成，无需落目标）。
 *
 * 映射原则：**语义等价才共用原因码**。`loop_detected` 表示"真·无进展"（推进
 * `no_progress_streak`）；其余四类在语义上都不是"无进展" ⇒ 走"只记录"路径。
 * `compaction_stalled` 不在此表 —— 它由 `onIncompleteTurn` 直接落（压缩停滞的判点在那里）。
 */
export function mapTerminationToGoalReason(
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

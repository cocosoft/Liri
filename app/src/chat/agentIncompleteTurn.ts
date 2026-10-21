// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * agentIncompleteTurn —— 不完整回合检测与续接注入（ReActToolLoop 拆分批 U-22/S1）
 *
 * **来源**：从 `ReActToolLoop.ts` 外移 `onIncompleteTurn`（106 行）与 4 条续接指令常量。
 *
 * **职责（单一：本轮"没给出可用答案"时，是否再给一次机会）**：
 *   - 已产出 tool_calls ⇒ 不接管（超时被丢弃时显式留痕）；
 *   - 空回复 / 只思考 / 只计划 / 截断 ⇒ 注入对应续接指令（每类至多 1 次）；
 *   - 截断 + 收敛 steering / 压缩停滞 ⇒ **不续接**（交付当前部分文本，避免膨胀空转）。
 *
 * **行为等价**：文案常量、判定顺序、日志字段与阈值**逐字未变**。
 */

import { getLogger } from '@modules/monitoring';
import type { ReasonResult } from '@modules/query';
import type { GoalTurnReason } from '@modules/tasks';
import {
  createFragment,
  FRAGMENT_KIND_FIELD,
  renderFragment,
} from '@modules/context';

import type { ToolLoopContext } from './ToolLoopRunner';
import { CONTINUATION_TEMPLATES } from '../constants/goalTemplates';

const logger = getLogger('chat:reactToolLoop');

/** 不完整回合重试指令（对标 openclaw incomplete-turn.ts:172-179，2026-09-01） */
const EMPTY_RESPONSE_RETRY_INSTRUCTION = CONTINUATION_TEMPLATES.empty;
const REASONING_ONLY_RETRY_INSTRUCTION = CONTINUATION_TEMPLATES.reasoning;
const PLANNING_ONLY_RETRY_INSTRUCTION = CONTINUATION_TEMPLATES.planning;
/** 输出被 max_tokens 截断的续接指令（2026-09-03）：不再重复已输出内容/思考，直接续完被截断的部分 */
const TRUNCATED_RESPONSE_RETRY_INSTRUCTION = CONTINUATION_TEMPLATES.truncated;
/** planning-only 启发式判定：纯计划陈述模式（保守，避免误判正常回答） */
const PLANNING_ONLY_RE =
  /(?:以下(?:是)?(?:我(?:的)?)?(?:执行)?计划|我的计划(?:如下|是)|\bplan(?:\s*:|\s+is|\s+to)\b|步骤\s*[:：]|接下来(?:我)?(?:将|会))/i;

export interface IncompleteRetries {
  empty: number;
  reasoning: number;
  planning: number;
  truncated: number;
}

export interface AgentIncompleteTurnDeps {
  sessionId: string;
  /** 当前相位（`timeout` ⇒ 丢弃工具调用需要留痕） */
  phase: string;
  droppedToolCallsAtStop: number;
  lastRoundHadThinking: boolean;
  convergeSteeringPrompted: boolean;
  /** 压缩停滞（压不动且吃紧） */
  compactionStalled: boolean;
  consecutiveCompactNoEffect?: number;
  lastCompactRatio?: number;
  /** 本轮 LLM 输入消息（就地 push 续接指令） */
  messages: Record<string, unknown>[];
  /** 登记终止副作用 promise（供 `flushTerminalSettlement` await） */
  setTerminalSettle: (promise: Promise<void>) => void;
  settleGoalForTurnNow: (reason: GoalTurnReason) => Promise<void>;
  /** 每类重试计数（与宿主共享同一对象 ⇒ 就地累加即生效） */
  incompleteRetries: IncompleteRetries;
  setBoostNextReasonMaxTokens: (value: boolean) => void;
  setSupersedeNextRoundText: (value: boolean) => void;
  /** 置相位 `compaction_failed`（收尾文案据此说明"为何停下"） */
  setPhaseCompactionFailed: () => void;
}

/** 对标 openclaw（2026-09-01）：不完整回合检测——空回复 / 只思考无答案 / 只计划不行动，
 *  注入重试指令（每类最多 1 次，防死循环）让骨架再给一次机会。 */
export async function onIncompleteTurn(
  result: ReasonResult<ToolLoopContext>,
  deps: AgentIncompleteTurnDeps
): Promise<boolean> {
  if (result.toolCalls.length > 0) {
    // 二期 F2-0（2026-09-23 修复计划 §六）：**统一两处对立判据** —— 本轮已产出 tool_calls
    // 通常不属"不完整回合"，不该由本钩子接管；但若本轮是**外部拦停**（超时），这批调用
    // 已被丢弃 ⇒ 必须**显式留痕**（结构化日志 + 收尾文案），不得静默消失。
    if (deps.phase === 'timeout' && deps.droppedToolCallsAtStop > 0) {
      logger.warn('reactToolLoop:tool_calls_dropped_on_stop', {
        sessionId: deps.sessionId,
        reason: 'timeout',
        droppedToolCalls: deps.droppedToolCallsAtStop,
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
  } else if (!text && !deps.lastRoundHadThinking) {
    kind = 'empty'; // 空回复
  } else if (!text && deps.lastRoundHadThinking) {
    kind = 'reasoning'; // 只思考未给出可见答案
  } else if (text && PLANNING_ONLY_RE.test(text)) {
    kind = 'planning'; // 只描述计划未行动（保守启发式）
  }
  if (!kind) return false;
  // R4（2026-09-16）：已注入强制收尾 steering（接近上限）后，截断输出**不再续接重发**——
  // 续接会用放大后的 maxTokens 重发并加剧上下文膨胀；此时直接取当前部分文本作为最终
  // 交付（收敛场景下"有残缺结论"优于"为求完整继续膨胀/空转"）。
  if (kind === 'truncated' && deps.convergeSteeringPrompted) {
    logger.info('reactToolLoop:truncated_converge_no_continue', {
      sessionId: deps.sessionId,
      textPreview: text.slice(0, 80),
    });
    return false;
  }
  // 压缩失败暂停续接（2026-09-22）：压缩已连续压不动 **且** 上下文确实吃紧 ⇒
  // 续接会按「放大后的 maxTokens + 压不下来的上下文」重发，只会加剧膨胀与空转。
  // 发送前虽有 `truncateApiMessages` 硬截断兜底（`MessageContextPipeline.ts:291`），
  // 但那是"削足适履"（丢掉旧消息）而非真压缩 ⇒ 不宜以此为由继续续接。
  // 处置与 R4 一致：直接取当前部分文本交付 —— "有残缺结论"优于"继续膨胀/空转"。
  if (kind === 'truncated' && deps.compactionStalled) {
    logger.warn('reactToolLoop:truncated_compaction_stalled_no_continue', {
      sessionId: deps.sessionId,
      consecutiveNoEffect: deps.consecutiveCompactNoEffect,
      lastCompactRatio: deps.lastCompactRatio ?? null,
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
    deps.setTerminalSettle(deps.settleGoalForTurnNow('compaction_stalled'));
    // 三期 F3-2（2026-09-23 修复计划 §六）：压缩失败**必须联动收尾** —— 置专门相位，
    // 使判别器给出 `compaction_failed`（不再被折叠成 `completed` 后只落一句通用兜底），
    // 用户可见"为何停下"。原实现只 `return false`，收尾文案与压缩无任何关联。
    deps.setPhaseCompactionFailed();
    return false;
  }
  if (deps.incompleteRetries[kind] >= 1) return false; // 每类最多重试 1 次

  const instruction =
    kind === 'empty'
      ? EMPTY_RESPONSE_RETRY_INSTRUCTION
      : kind === 'reasoning'
        ? REASONING_ONLY_RETRY_INSTRUCTION
        : kind === 'planning'
          ? PLANNING_ONLY_RETRY_INSTRUCTION
          : TRUNCATED_RESPONSE_RETRY_INSTRUCTION;
  deps.incompleteRetries[kind]++;
  // 截断续接：下一轮 reason 放大输出预算（截断是硬性预算不足，重试需更多额度）
  if (kind === 'truncated') deps.setBoostNextReasonMaxTokens(true);
  // O2-4：回捞轮正文**取代**前一轮已下发正文（前端据此从零重建，与落盘 content 同源）
  deps.setSupersedeNextRoundText(true);
  // 注入重试指令：下一轮 reason 的 LLM 输入会携带（对齐 openclaw 重试语义）
  deps.messages.push({
    role: 'user',
    content: renderFragment(
      createFragment({ kind: 'system', text: instruction })
    ),
    [FRAGMENT_KIND_FIELD]: 'system',
  } as Record<string, unknown>);
  logger.info('reactToolLoop:incomplete_turn_retry', {
    sessionId: deps.sessionId,
    kind,
    retries: { ...deps.incompleteRetries },
    textPreview: text.slice(0, 80),
  });
  return true;
}

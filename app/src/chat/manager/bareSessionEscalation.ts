// Copyright (c) 2026 190615273@qq.com

/**
 * 裸会话（无 projectId / workspaceId）PDCA 升级判定（P3-2 复杂度外移）
 *
 * **来源**：`ChatStreamFinalize.finalize` 的「裸会话升级前置」段（P0-1 / A4 / P2 / B2 多轮叠加的
 * `if / else if` 链与 user 文本取值）。
 *
 * **行为等价**：判定条件、求值顺序、日志 key 与载荷逐字未变；日志 module 名仍为 `chat:manager`
 * （仅把 `this.deps` 换成入参）。
 */

import { getLogger } from '@openliri/infra/monitoring';
import type { Message } from '@modules/session/types/message.js';
import type { ChatSession } from '@modules/session/types/session.js';

import {
  isDemandGoalIntent,
  isExecutionTaskIntent,
  isStrongBuildIntent,
} from '../taskIntent';
// 状态词汇唯一事实源（lint:state-ratchet）：禁止裸写 'awaiting_approval'
import { TRANSIENT_AWAITING_APPROVAL } from '../services/ToolExecutionService';

const logger = getLogger('chat:manager');

/** 会话内 user 文本的三种取值口径（首条 / 末条 / 末条聚合） */
export interface BareUserTexts {
  /** user 消息条数（轮次闸用） */
  count: number;
  /** 首条 user 文本（强产出意图判定用） */
  firstContent: string;
  /** 最后一条 user 原文（能力直通 / 目标意图判定用） */
  lastSingleContent: string;
}

/** 裸会话的 user 文本取值（原样外移自 `finalize` 内联三元） */
export function collectBareUserTexts(session: ChatSession): BareUserTexts {
  const bareUserMessages =
    session.messages?.filter((m) => m.role === 'user') ?? [];
  const bareFirstContent =
    bareUserMessages.length > 0
      ? (((bareUserMessages[0] as unknown as Record<string, unknown>)
          ?.content as string) ?? '')
      : '';
  // P2（2026-11-07 真机）：「能力直通」否决位 —— 单次能力请求（识图 / 读文件 / 查版本）
  // 不进编排。判定只取**最后一条 user 消息**（`bareLastContent` 聚合最近 3 条，会把上一轮
  // 长任务里的「写 / 实现」等词带进来，令单次请求也被否决）。
  const bareLastSingleContent =
    bareUserMessages.length > 0
      ? (((
          bareUserMessages[bareUserMessages.length - 1] as unknown as Record<
            string,
            unknown
          >
        )?.content as string) ?? '')
      : '';
  return {
    count: bareUserMessages.length,
    firstContent: bareFirstContent,
    lastSingleContent: bareLastSingleContent,
  };
}

/** 会话最后一条 user 原文（项目会话的 goal 判定入参） */
export function lastUserMessageContent(session: ChatSession): string {
  const userMessages = session.messages?.filter((m) => m.role === 'user') ?? [];
  return userMessages.length > 0
    ? (((
        userMessages[userMessages.length - 1] as unknown as Record<
          string,
          unknown
        >
      ).content as string) ?? '')
    : '';
}

export interface BareSessionEscalationParams {
  session: ChatSession;
  /** 项目/工作区上下文；存在时本段整体不参与（返回 false 语义） */
  contextId: string | undefined;
  assistantMessage: Message;
  /** 最近 3 条 user 文本的聚合（轮次闸与编排描述用） */
  lastUserContent: string;
  userTexts: BareUserTexts;
  emptyOutputFallback: boolean;
  outputBudgetExhausted: boolean;
  /**
   * 本轮主循环是否**因等待审批而收尾**（结构化判定：`terminationReason === 'awaiting_approval'`）。
   *
   * 2026-11-18（真机 `session_mwkthat73b80a6724f`）：因等待审批收尾时，出口消息正文里被
   * `terminationOutput.resolveTerminationOutput` 追加了一句**系统提示语**
   * （`⏸ 有工具调用正在等待你的审批：…`）⇒ 正文非空 ⇒ 旧闸门放行，用这句提示语当任务描述
   * 建出无关项目 + 阶段链 PDCA（子任务实际写出 `需求说明.md`），随后卡在阶段审批并被
   * `orphan_scan` 收口。与 `streamMessageToolLoop` 的 `onLongTaskSignal` 同一条规则
   * （2026-11-06 P0-2），本分支此前遗漏。
   */
  awaitingApprovalStop: boolean;
  capabilityDirect: boolean;
  demandMode: boolean;
  shouldUseCodeMode: (text: string) => boolean;
  escalate: (params: {
    session: ChatSession;
    assistantContent: string;
    lastUserContent: string;
  }) => Promise<void>;
}

/**
 * 裸会话升级判定 + 留痕 + 升级（原样外移自 `finalize`）。
 *
 * 返回 `true` 表示本段已进入「裸会话」分支（无论是否真的升级），`false` 表示有上下文而整体跳过。
 * 返回值仅供调用方观测，不参与后续判定。
 */
export async function applyBareSessionEscalation(
  params: BareSessionEscalationParams
): Promise<boolean> {
  const {
    session,
    contextId,
    assistantMessage,
    lastUserContent,
    userTexts,
    emptyOutputFallback,
    outputBudgetExhausted,
    awaitingApprovalStop,
    capabilityDirect,
    demandMode,
    shouldUseCodeMode,
    escalate,
  } = params;

  if (!contextId) {
    // 2026-11-18：等待审批收尾不是任务阶段结束（批准后 `resumeStream` 会接着跑），
    // 且此时出口正文是**系统提示语**而非模型产出 ⇒ 不得作为编排任务描述流转。
    // 判定走结构化终止原因，禁止比对文案（CS02）。
    if (awaitingApprovalStop) {
      logger.info('pdca:bare_session_escalation_skipped', {
        sessionId: session.id,
        reason: TRANSIENT_AWAITING_APPROVAL,
      });
      return true;
    }
    // A4 轮次闸（R4 放宽，2026-09-06 走查 W5）：第 2+ 轮一律可升级；首轮仅当首条消息命中
    // 【强产出意图】（帮我/我要…做/写/开发）放行；弱动词（检查/验证/补）与纯闲聊首条仍要求
    // 2+ 轮，防一次性求助/闲聊被误升级。
    if (
      // N-2（2026-11-06 真机长程任务）：本轮以「空输出兜底」收尾 ⇒ **不升级编排**。
      !emptyOutputFallback &&
      !outputBudgetExhausted &&
      !capabilityDirect &&
      assistantMessage.content &&
      (demandMode
        ? isDemandGoalIntent(userTexts.lastSingleContent)
        : (userTexts.count >= 2 ||
            isStrongBuildIntent(userTexts.firstContent)) &&
          isExecutionTaskIntent(lastUserContent)) &&
      !shouldUseCodeMode(lastUserContent)
    ) {
      logger.info('pdca:bare_session_intent_detected', {
        sessionId: session.id,
        autonomy: demandMode ? 'demand' : 'interactive',
        intent: lastUserContent.slice(0, 60),
      });
      await escalate({
        session,
        assistantContent: assistantMessage.content as string,
        lastUserContent,
      });
      return true;
    }
    if (capabilityDirect) {
      // 留痕：能力直通否决也要可诊断（否则"为什么没升级"无从排查）
      logger.info('pdca:launch_skip_capability_direct', {
        sessionId: session.id,
        intent: userTexts.lastSingleContent.slice(0, 60),
      });
      return true;
    }
    if (emptyOutputFallback || outputBudgetExhausted) {
      // 留痕：被短路时也要可诊断（否则"为什么没升级"无从排查）
      logger.info('pdca:bare_session_escalation_skipped', {
        sessionId: session.id,
        reason: emptyOutputFallback
          ? 'empty_output_fallback'
          : 'output_budget_exhausted',
      });
      return true;
    }
  }
  return false;
}

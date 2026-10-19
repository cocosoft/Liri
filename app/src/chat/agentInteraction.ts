// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * agentInteraction —— 工具轮内的「提问 / 等待回答」链路（ReActToolLoop 拆分批 U-22/S1）
 *
 * **来源**：从 `ReActToolLoop.ts` 外移 `_registerInteraction` / `_awaitAnswersWithHeartbeat` /
 * `_emitSuspensionSettled`（plan §2「S1 question 事件链路 + S2 交互心跳」）。
 *
 * **职责（单一：一次提问如何登记、等待、结算）**：
 *   ① 登记 `pendingInteractions`（答案 promise 由 UI 侧 resolve）
 *   ② 等待答案：`Promise.race` 轮询产出 `question_waiting` 心跳 + abort/超时 fail-closed 结算
 *   ③ 结算留痕：落 `assistant/status{suspension_settled}`（失败经 `handleError` 上报，不抛）
 *
 * **行为等价**：日志文案/级别、心跳间隔、超时与中止语义、`finally` 移除监听与 entry **逐字未变**。
 */

import { handleError } from '@modules/error';
import { getLogger } from '@modules/monitoring';
import type { ReActEvent } from '@modules/query';
import type {
  QuestionData,
  QuestionOption,
} from '@modules/runtime/api/CoreAPI.js';
import type { LiriEvent } from '@modules/session/types/events';

import { SUSPENSION_SETTLED_STATUS_TYPE } from './services/pendingSuspensions';
import { withDeadline } from '@modules/utils/withDeadline';
import {
  createPendingInteractionEntry,
  type PendingInteractionEntry,
} from '@modules/utils/pendingInteractions';

const logger = getLogger('chat:reactToolLoop');

/** 本地 sleep（与原文件同实现；避免为 1 行工具函数引入跨模块耦合） */
const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface AgentInteractionDeps {
  sessionId: string;
  /** 会话级待处理交互表（与宿主共享同一 Map） */
  pendingInteractions: Map<string, PendingInteractionEntry>;
  /** 本轮中止信号（undefined ⇒ 仅保留超时兜底） */
  abortSignal?: AbortSignal;
  /** 心跳间隔（毫秒） */
  heartbeatMs: number;
  /** 等待上限（毫秒） */
  maxWaitMs: number;
  /** 事件写入入口（观测面缺失时如实不落，不伪造） */
  appendStreamEvent?: (sessionId: string, event: LiriEvent) => Promise<unknown>;
}

/**
 * 仅登记「待处理交互」并返回答案 promise（自备 questionData 的路径复用，如决策门控）。
 *
 * S4（2026-10-19）：条目带 `expiresAt`（与等待上限同口径）⇒ 判据处可自愈。
 */
export function registerPendingAnswer(
  questionId: string,
  deps: AgentInteractionDeps
): Promise<string[]> {
  let resolve!: (answers: string[]) => void;
  const promise = new Promise<string[]>((res) => (resolve = res));
  deps.pendingInteractions.set(
    deps.sessionId,
    createPendingInteractionEntry(
      { questionId, promise, resolve },
      deps.maxWaitMs
    )
  );
  return promise;
}

/**
 * 注册 pendingInteraction，返回 questionData + 等待 promise（v3：不挂起调用方，
 * 由 act 内迭代消费 `awaitAnswersWithHeartbeat` 产出心跳并等待答案）。
 */
export function registerInteraction(
  toolCallId: string,
  input: Record<string, unknown>,
  deps: AgentInteractionDeps
): { questionData: QuestionData; promise: Promise<string[]> } {
  const questionId = `q_${Date.now()}_${(toolCallId || '').slice(0, 8)}`;
  const args = input;
  const questionData: QuestionData = {
    questionId,
    question: String(args.question),
    header: String(args.header),
    options: (args.options as QuestionOption[]) ?? [],
    multiSelect: args.multiSelect === true,
    questionType:
      (args.questionType as QuestionData['questionType']) ?? 'choice',
  };
  const promise = registerPendingAnswer(questionId, deps);
  logger.info('reactToolLoop:interaction_registered', {
    sessionId: deps.sessionId,
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
export async function* awaitAnswersWithHeartbeat(
  questionId: string,
  promise: Promise<string[]>,
  deps: AgentInteractionDeps
): AsyncGenerator<ReActEvent, string[] | undefined> {
  const sig = deps.abortSignal;
  // S3（2026-10-19）：超时 + 中止统一走 `withDeadline` —— 定时器与 abort 监听器由
  // 单一实现回收（原实现 `setTimeout` 句柄未保存，等待结束后定时器仍挂到 maxWaitMs）。
  const deadline = withDeadline(promise, {
    timeoutMs: deps.maxWaitMs,
    signal: sig,
  });
  try {
    const waitStart = Date.now();
    logger.info('reactToolLoop:interaction_wait_start', {
      sessionId: deps.sessionId,
      questionId,
      heartbeatMs: deps.heartbeatMs,
      maxWaitMs: deps.maxWaitMs,
    });
    while (true) {
      const winner = await Promise.race([
        deadline.then((outcome) => ({ kind: 'deadline' as const, outcome })),
        sleep(deps.heartbeatMs).then(() => ({
          kind: 'hb' as const,
        })),
      ]);
      if (winner.kind === 'hb') {
        // 心跳事件（高频：仅 debug，避免刷屏；配合 wait_start/resolved 可还原完整等待曲线）
        logger.debug('reactToolLoop:interaction_heartbeat', {
          sessionId: deps.sessionId,
          questionId,
          waitMs: Date.now() - waitStart,
        });
        yield { type: 'question_waiting' }; // 心跳事件
        continue;
      }

      const outcome = winner.outcome;
      if (outcome.kind === 'settled') {
        logger.info('reactToolLoop:interaction_resolved', {
          sessionId: deps.sessionId,
          questionId,
          answerCount: outcome.value.length,
          waitMs: Date.now() - waitStart,
        });
        return outcome.value;
      }

      logger.warn('reactToolLoop:interaction_stopped', {
        sessionId: deps.sessionId,
        questionId,
        reason: outcome.kind,
        waitMs: Date.now() - waitStart,
      });
      const content =
        outcome.kind === 'timeout'
          ? '本次提问等待已超时（未获回答），已按 fail-closed 结算。'
          : '本次提问等待被中止，已按 fail-closed 结算。';
      // A1 T4：落盘结算标记事件（持久化 + 幂等，重载后回放可见）
      await emitSuspensionSettled(questionId, content, deps);
      // A1 T5：同一结算**实时**下发 status chunk（前端即时可见，无需重载会话）
      yield { type: 'suspension_settled', content };
      return undefined;
    }
  } finally {
    // abort 监听器已由 `withDeadline` 在竞速结算时移除（S3，2026-10-19）
    // A1 T4（2026-10-05）：等待结束即**结算** —— 移除 entry（超时/中止后晚到回答走
    // `answeredAfterExpiry` 兜底落盘，不复活已完成的任务）。
    // ⚠️ 原 `_interactionTimedOut` 判据**从未被置 true**（死分支），声称的"timeout 保留 entry
    // 宽限"从未生效；已删除该字段，行为即"结算即移除"（与 T4 语义一致，无行为变化）。
    deps.pendingInteractions.delete(deps.sessionId);
  }
}

/**
 * A1 T4（2026-10-05）：落盘**挂起结算标记**事件（`assistant/status` / `suspension_settled`）。
 *
 * 用途：① 持久化（重载/回放可见）；② 挂起清单投影据此把该问视为**已解析**（幂等）。
 * 实时下发由调用方另 yield `suspension_settled` 事件承担（T5）。
 * 观测面能力缺失（单测替身）⇒ 如实不落（不伪造）；落盘失败经 `handleError()` 上报，不抛。
 */
export async function emitSuspensionSettled(
  questionId: string,
  content: string,
  deps: AgentInteractionDeps
): Promise<void> {
  const appendStreamEvent = deps.appendStreamEvent;
  if (!appendStreamEvent) return;
  const event: LiriEvent<'assistant/status'> = {
    type: 'assistant/status',
    schemaVersion: 1,
    seq: 0,
    time: Date.now(),
    sessionId: deps.sessionId,
    data: {
      content,
      statusType: SUSPENSION_SETTLED_STATUS_TYPE,
      questionId,
    },
  };
  try {
    await appendStreamEvent(deps.sessionId, event);
  } catch (err) {
    await handleError(err, {
      module: 'chat:reactToolLoop',
      action: 'emitSuspensionSettled',
    });
  }
}

// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * 工作流 run 事件的**实时写入实现**（P1-19 ①，成员级事件实时化）
 *
 * 与 `tasks/goal/GoalEvents.ts` / `chat/services/requestBoundary.ts` 同法：本模块属 app 层，
 * **不直接持有会话事件日志**——追加器由宿主（`ChatManager`）经 `setWorkflowRunEventSink`
 * 注入（避免 `workflow/` → `chat/` 的运行时反向依赖）。未注入 ⇒ 如实不落（不伪造），
 * 由 `MessageToEventMigrator` 的批末投影兜底（见 `workflowRunProjection.ts` 的 `liveEmitted` 去重）。
 *
 * **配对不变式不在此处**：本模块只在 `WorkflowStepLedger` 已校验/已结算的
 * `WorkflowStep{Start,End}Info` 到达时忠实写一条事件，不合成、不丢弃、不改序。
 *
 * 事件载荷与批末投影**逐字段同形**（`workflowRunProjection.ts`），保证两端派生一致。
 */

import { getLogger } from '../../core/loggerFacade.js';
import type { LiriEvent } from '@modules/session/types/events';
import type { LiriEventMap } from '@modules/session/types/eventPayloads';

import type {
  WorkflowRunEndInfo,
  WorkflowRunObserver,
  WorkflowRunStartInfo,
  WorkflowStepEndInfo,
  WorkflowStepStartInfo,
} from './types';

const logger = getLogger('workflow:run-events');

/** 本模块负责落盘的工作流事件类型（与 `LiriEventMap` 同源，不另立联合） */
export type WorkflowRunEventType =
  | 'assistant/workflow_run_start'
  | 'assistant/workflow_step_start'
  | 'assistant/workflow_step_end'
  | 'assistant/workflow_run_end';

/**
 * 事件追加器：与 `ChatManager.appendStreamEvent` 的返回结构一致（此处只依赖其子集）。
 */
export type WorkflowRunEventAppender = (
  sessionId: string,
  event: LiriEvent
) => Promise<{ ok: boolean; reason?: string; tailSeq: number }>;

let runEventSink: WorkflowRunEventAppender | null = null;

/**
 * 注入事件追加器（由 `ChatManager` 装配时调用一次；传 `null` 可解除，测试用）。
 *
 * 与 `setGoalEventSink` / `CompactionOrchestrator.setRequestReporter` 同一手法：跨模块的
 * "写入能力"用注入而非 import，避免 `workflow/` 反向依赖 `chat/` 的运行时实现。
 */
export function setWorkflowRunEventSink(
  sink: WorkflowRunEventAppender | null
): void {
  runEventSink = sink;
}

/** 实时发射结果（供 `runRecordCollector` 组合） */
export interface LiveRunEmitter {
  /** 注入 `WorkflowExecuteOptions.observer`（与记录装配器共用同一 observer 链） */
  observer: WorkflowRunObserver;
  /** 实时路径是否生效（有 `sessionId` 且已注入追加器）⇒ 决定批末投影是否跳过 */
  active: boolean;
  /** 等待全部实时事件按序落盘（未生效 ⇒ no-op） */
  drain(): Promise<void>;
}

/** 省略 `undefined` 键（D1 无损 JSON 校验会拒绝 undefined 值） */
function omitUndefined<T extends object>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

/**
 * 创建实时发射器。
 *
 * `sessionId` 缺省 / 未注入追加器 ⇒ 返回 `active: false` 的空发射器（调用方据此走批末投影兜底）。
 * 回调按到达顺序入**串行 promise 链**，保证同一 run 的事件落盘序 = 发生序。
 */
export function createLiveRunEmitter(
  sessionId: string | undefined
): LiveRunEmitter {
  const active = Boolean(sessionId) && runEventSink !== null;
  if (!active) {
    return { observer: {}, active: false, drain: () => Promise.resolve() };
  }

  const target = sessionId as string;
  let chain: Promise<void> = Promise.resolve();
  const enqueue = <T extends WorkflowRunEventType>(
    type: T,
    data: LiriEventMap[T]
  ): void => {
    chain = chain.then(() => appendRunEvent(target, type, data));
  };

  const observer: WorkflowRunObserver = {
    onRunStart: (info) =>
      enqueue('assistant/workflow_run_start', toRunStart(info)),
    onStepStart: (info) =>
      enqueue('assistant/workflow_step_start', toStepStart(info)),
    onStepEnd: (info) =>
      enqueue('assistant/workflow_step_end', toStepEnd(info)),
    onRunEnd: (info) => enqueue('assistant/workflow_run_end', toRunEnd(info)),
  };

  return { observer, active: true, drain: () => chain };
}

/** 落一条工作流事件（观测面失败只 warn，不回灌执行 —— CS03） */
async function appendRunEvent<T extends WorkflowRunEventType>(
  sessionId: string,
  type: T,
  data: LiriEventMap[T]
): Promise<void> {
  const sink = runEventSink;
  if (!sink) return;

  try {
    const result = await sink(sessionId, {
      type,
      schemaVersion: 1,
      // seq: 0 ⇒ 由 append 在 mutex 内原子分配（既有约定，见 requestBoundary 同款注释）
      seq: 0,
      time: Date.now(),
      sessionId,
      data,
    });
    if (!result.ok && result.reason !== 'duplicate-seq') {
      logger.warn('工作流事件追加失败', {
        sessionId,
        type,
        reason: result.reason,
      });
    }
  } catch (err) {
    // @ignore-catch — 事件落盘属观测面，失败不得中断工作流执行（CS03）
    logger.warn('工作流事件追加异常', { sessionId, type, error: String(err) });
  }
}

function toRunStart(
  info: WorkflowRunStartInfo
): LiriEventMap['assistant/workflow_run_start'] {
  return {
    runId: info.runId,
    workflow: info.workflow,
    providerId: info.providerId,
    steps: [...info.steps],
    startedAt: info.startedAt,
  };
}

function toStepStart(
  info: WorkflowStepStartInfo
): LiriEventMap['assistant/workflow_step_start'] {
  return {
    runId: info.runId,
    stepId: info.stepId,
    tool: info.tool,
    description: info.description,
    startedAt: info.startedAt,
  };
}

function toStepEnd(
  info: WorkflowStepEndInfo
): LiriEventMap['assistant/workflow_step_end'] {
  return {
    runId: info.runId,
    stepId: info.stepId,
    tool: info.tool,
    description: info.description,
    outcome: info.outcome,
    durationMs: info.durationMs,
    ...omitUndefined({
      synthesized: info.synthesized === true ? true : undefined,
      error: info.error,
    }),
  };
}

function toRunEnd(
  info: WorkflowRunEndInfo
): LiriEventMap['assistant/workflow_run_end'] {
  const candidates = info.rootCauseCandidates
    ?.map((candidate) => ({
      nodeId: candidate.nodeId,
      score: candidate.score,
      distance: candidate.distance,
      pathEvidenceRefs: [...candidate.pathEvidenceRefs],
    }))
    .filter((candidate) => candidate.pathEvidenceRefs.length > 0);

  return {
    runId: info.runId,
    workflow: info.workflow,
    providerId: info.providerId,
    stopReason: info.stopReason,
    completedSteps: [...info.completedSteps],
    durationMs: info.durationMs,
    ...omitUndefined({
      failedStep: info.failedStep,
      error: info.error,
      rootCauseCandidates:
        candidates && candidates.length > 0 ? candidates : undefined,
    }),
  };
}

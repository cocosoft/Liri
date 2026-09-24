// MIT License
// Copyright (c) 2026 190615273@qq.com
/**
 * 工作流 run 记录的落盘投影（P0-1 接入点第二刀 ②b，2026-09-24）
 *
 * 把工具元数据中的 `workflowRun`（由 workflow seam 的 `WorkflowRunObserver` 两级回调
 * 经 `runRecordCollector` 装配）投影为 4 类持久事件：
 * `assistant/workflow_run_start` → `assistant/workflow_step_start`/`_end`…（按 steps 序）
 * → `assistant/workflow_run_end`。
 *
 * 从 `MessageToEventMigrator` 拆出（R04-001 文件大小治理）：投影逻辑自包含（只依赖
 * 事件类型 + 结构化读取），且 migrator 已近上限。
 *
 * **不合成、不编造**（CS06）：字段缺失/类型不符时**跳过该条并告警**，不填默认值。
 */

import { getLogger } from '@modules/monitoring/logs/Logger.js';
import type { LiriEvent } from '@modules/chat/types/events';

const logger = getLogger('session:workflow-run-projection');

/** 投影上下文 */
export interface WorkflowRunProjectionContext {
  sessionId: string;
  /** 事件时间戳（ms） */
  time: number;
  /** 起始 seq（投影结果按此递增，调用方据此推进全局 seq） */
  startSeq: number;
}

/**
 * 根因候选（与 `assistant/workflow_run_end` 载荷的候选元素同形）。
 * 此处**结构化声明**而不导入事件类型：本文件只按形状读取，不拥有契约。
 */
interface WorkflowRootCauseCandidateLike {
  nodeId: string;
  score: number;
  distance: number;
  pathEvidenceRefs: string[];
}

/**
 * 投影 run 记录为事件数组（顺序即发生序）。
 *
 * `metadata.workflowRun` 经 messages.jsonl 序列化后回读 ⇒ 类型上是 `unknown`，
 * 必须先结构化校验；绝大多数工具无此元数据 ⇒ 首行即返回空数组（零开销）。
 */
export function projectWorkflowRunEvents(
  metadata: Record<string, unknown>,
  ctx: WorkflowRunProjectionContext
): LiriEvent[] {
  const record = asRecord(metadata.workflowRun);
  if (!record) return [];

  const events: LiriEvent[] = [];
  let seq = ctx.startSeq;

  const start = asRecord(record.start);
  const runId = asString(start?.runId);
  const workflow = asString(start?.workflow);
  const providerId = asString(start?.providerId);
  const startedAt =
    typeof start?.startedAt === 'number' ? start.startedAt : undefined;
  const plannedSteps = Array.isArray(start?.steps)
    ? start.steps.filter((item): item is string => typeof item === 'string')
    : undefined;

  if (runId && workflow && providerId && startedAt !== undefined) {
    events.push({
      type: 'assistant/workflow_run_start',
      schemaVersion: 1,
      seq: seq++,
      time: ctx.time,
      sessionId: ctx.sessionId,
      data: {
        runId,
        workflow,
        providerId,
        steps: plannedSteps ?? [],
        startedAt,
      },
    });
  } else if (record.start !== undefined) {
    logger.warn('workflowRun.start 字段不完整，跳过 run 级开始投影', {
      sessionId: ctx.sessionId,
      hasRunId: runId !== undefined,
    });
  }

  for (const item of Array.isArray(record.steps) ? record.steps : []) {
    const entry = asRecord(item);
    const stepStart = asRecord(entry?.start);
    const stepId = asString(stepStart?.stepId);
    const stepRunId = asString(stepStart?.runId);
    const tool = asString(stepStart?.tool);
    const description = asString(stepStart?.description);
    if (!stepId || !stepRunId || !tool || !description) {
      logger.warn('workflowRun.steps[].start 字段不完整，跳过该步骤', {
        sessionId: ctx.sessionId,
        stepId,
      });
      continue;
    }

    events.push({
      type: 'assistant/workflow_step_start',
      schemaVersion: 1,
      seq: seq++,
      time: ctx.time,
      sessionId: ctx.sessionId,
      data: {
        runId: stepRunId,
        stepId,
        tool,
        description,
        startedAt:
          typeof stepStart?.startedAt === 'number'
            ? stepStart.startedAt
            : ctx.time,
      },
    });

    const stepEnd = asRecord(entry?.end);
    const stepOutcome = toStepOutcome(asString(stepEnd?.outcome));
    const durationMs =
      typeof stepEnd?.durationMs === 'number' ? stepEnd.durationMs : undefined;
    if (stepEnd && stepOutcome && durationMs !== undefined) {
      const stepError = asString(stepEnd.error);
      events.push({
        type: 'assistant/workflow_step_end',
        schemaVersion: 1,
        seq: seq++,
        time: ctx.time,
        sessionId: ctx.sessionId,
        data: {
          runId: stepRunId,
          stepId,
          tool,
          description,
          outcome: stepOutcome,
          durationMs,
          // 条件展开：undefined 键会被 D1 无损 JSON 校验拒绝（见 KB-MIG-SCHEMA）
          ...(stepEnd.synthesized === true ? { synthesized: true } : {}),
          ...(stepError ? { error: stepError } : {}),
        },
      });
    }
  }

  const end = asRecord(record.end);
  const endRunId = asString(end?.runId);
  const endWorkflow = asString(end?.workflow);
  const endProviderId = asString(end?.providerId);
  const stopReason = toStopReason(asString(end?.stopReason));
  const endDurationMs =
    typeof end?.durationMs === 'number' ? end.durationMs : undefined;
  if (
    endRunId &&
    endWorkflow &&
    endProviderId &&
    stopReason &&
    endDurationMs !== undefined
  ) {
    const failedStep = asString(end?.failedStep);
    const endError = asString(end?.error);
    const candidates = Array.isArray(end?.rootCauseCandidates)
      ? end.rootCauseCandidates
          .map((item) => toRootCauseCandidate(item))
          .filter(
            (item): item is WorkflowRootCauseCandidateLike => item !== undefined
          )
      : undefined;
    events.push({
      type: 'assistant/workflow_run_end',
      schemaVersion: 1,
      seq: seq++,
      time: ctx.time,
      sessionId: ctx.sessionId,
      data: {
        runId: endRunId,
        workflow: endWorkflow,
        providerId: endProviderId,
        stopReason,
        completedSteps: Array.isArray(end?.completedSteps)
          ? end.completedSteps.filter(
              (item): item is string => typeof item === 'string'
            )
          : [],
        durationMs: endDurationMs,
        ...(failedStep ? { failedStep } : {}),
        ...(endError ? { error: endError } : {}),
        ...(candidates && candidates.length > 0
          ? { rootCauseCandidates: candidates }
          : {}),
      },
    });
  } else if (record.end !== undefined) {
    logger.warn('workflowRun.end 字段不完整，跳过 run 级结束投影', {
      sessionId: ctx.sessionId,
      hasRunId: endRunId !== undefined,
    });
  }

  return events;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** 停止原因归一：仅接受 seam 的封闭联合（其余按缺失处理，由调用方跳过整条） */
function toStopReason(
  value: string | undefined
): 'completed' | 'cancelled' | 'error' | undefined {
  return value === 'completed' || value === 'cancelled' || value === 'error'
    ? value
    : undefined;
}

/** 步骤结果归一：非法值按缺失处理（不猜测为 failed —— 账本口径不同，此处只做投影） */
function toStepOutcome(
  value: string | undefined
): 'completed' | 'failed' | 'cancelled' | undefined {
  return value === 'completed' || value === 'failed' || value === 'cancelled'
    ? value
    : undefined;
}

function toRootCauseCandidate(
  value: unknown
): WorkflowRootCauseCandidateLike | undefined {
  const item = asRecord(value);
  const nodeId = asString(item?.nodeId);
  const score = typeof item?.score === 'number' ? item.score : undefined;
  const distance =
    typeof item?.distance === 'number' ? item.distance : undefined;
  const refs = Array.isArray(item?.pathEvidenceRefs)
    ? item.pathEvidenceRefs.filter(
        (ref): ref is string => typeof ref === 'string'
      )
    : undefined;
  if (
    !nodeId ||
    score === undefined ||
    distance === undefined ||
    !refs ||
    refs.length === 0
  ) {
    return undefined;
  }
  return { nodeId, score, distance, pathEvidenceRefs: refs };
}

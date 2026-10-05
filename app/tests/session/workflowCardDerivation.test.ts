// MIT License
// Copyright (c) 2026 190615273@qq.com
/**
 * 工作流 run 聚合卡片 + 重放期中断合成（P1-3 §12 D14–D16，2026-10-05 实建）
 *
 * 覆盖：
 *  1. 4 类事件**原地聚合**为单张 `workflow_run` 卡片（不再各产 status 块）
 *  2. `stopReason=error` → run `failed`，携带 failedStep / error / 根因摘要
 *  3. 半写残留（缺 `run_end`）⇒ 重放期合成 `interrupted` + 指导文案（D15/D16）
 *  4. 正常收尾的 run **不被误伤**（不合成 interrupted）
 *  5. 缺 `run_start` 的孤儿 step/run_end **不建卡**（如实丢弃，不编造 —— CS06）
 */

import { describe, expect, it } from 'bun:test';

import { deriveMessagesFromEvents } from '../../src/session/storage/EventMessageDeriver';
import type { LiriEvent } from '@modules/session/types/events';

const SID = 'session_wf';
const BASE = 1700000000000;
const RUN_ID = 'wf_1700000000000_1';

function ev(
  type: string,
  seq: number,
  data: Record<string, unknown>
): LiriEvent {
  return {
    type,
    schemaVersion: 1,
    seq,
    time: BASE + seq,
    sessionId: SID,
    data,
  } as unknown as LiriEvent;
}

/** 锚点 assistant 消息（富块事件无 messageId，须先有归属消息 —— 否则被丢弃） */
function anchor(seq = 1): LiriEvent {
  return ev('assistant/text', seq, { content: '正文', messageId: 'm1' });
}

/** 取派生消息中的工作流卡片块（无则 undefined） */
function workflowBlockOf(
  events: LiriEvent[]
): Record<string, unknown> | undefined {
  const messages = deriveMessagesFromEvents(events, []);
  return messages
    .flatMap((m) => (m.blocks ?? []) as Array<Record<string, unknown>>)
    .find((b) => b.type === 'workflow_run');
}

function stepStart(seq: number, stepId: string, description: string) {
  return ev('assistant/workflow_step_start', seq, {
    runId: RUN_ID,
    stepId,
    tool: stepId,
    description,
    startedAt: BASE + seq,
  });
}

function stepEnd(
  seq: number,
  stepId: string,
  description: string,
  outcome: string,
  durationMs: number
) {
  return ev('assistant/workflow_step_end', seq, {
    runId: RUN_ID,
    stepId,
    tool: stepId,
    description,
    outcome,
    durationMs,
  });
}

function runStart(steps: string[]): LiriEvent {
  return ev('assistant/workflow_run_start', 2, {
    runId: RUN_ID,
    workflow: 'send-report',
    providerId: 'doc-orchestrator',
    steps,
    startedAt: BASE,
  });
}

describe('workflowCardDerivation（P1-3 §12 D14）', () => {
  it('4 类事件聚合为单张卡片（步骤状态/描述/耗时齐备）', () => {
    const events = [
      anchor(),
      runStart(['doc:create-docx', 'mail:send']),
      stepStart(3, 'doc:create-docx', '生成文档'),
      stepEnd(4, 'doc:create-docx', '生成文档', 'completed', 5),
      stepStart(5, 'mail:send', '发送邮件'),
      stepEnd(6, 'mail:send', '发送邮件', 'completed', 7),
      ev('assistant/workflow_run_end', 7, {
        runId: RUN_ID,
        workflow: 'send-report',
        providerId: 'doc-orchestrator',
        stopReason: 'completed',
        completedSteps: ['doc:create-docx', 'mail:send'],
        durationMs: 12,
      }),
    ];

    // 聚合为一张卡（不再各产 status 块）
    const messages = deriveMessagesFromEvents(events, []);
    const workflowBlocks = messages
      .flatMap((m) => (m.blocks ?? []) as Array<Record<string, unknown>>)
      .filter((b) => b.type === 'workflow_run');
    expect(workflowBlocks).toHaveLength(1);

    const block = workflowBlockOf(events);
    expect(block).toBeDefined();
    const data = block!.workflowData as Record<string, unknown>;
    expect(data.runId).toBe(RUN_ID);
    expect(data.workflow).toBe('send-report');
    expect(data.status).toBe('completed');
    expect(data.stopReason).toBe('completed');
    expect(data.durationMs).toBe(12);
    expect(data.interruptedHint).toBeUndefined();

    const steps = data.steps as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(2);
    expect(steps.map((s) => s.stepId)).toEqual([
      'doc:create-docx',
      'mail:send',
    ]);
    expect(steps.every((s) => s.status === 'completed')).toBe(true);
    expect(steps[0].description).toBe('生成文档');
    expect(steps[0].durationMs).toBe(5);
    expect(steps[1].description).toBe('发送邮件');
    expect(steps[1].durationMs).toBe(7);
  });

  it('stopReason=error → run failed，携带 failedStep/error/根因摘要', () => {
    const events = [
      anchor(),
      runStart(['doc:create-docx', 'mail:send']),
      stepStart(3, 'doc:create-docx', '生成文档'),
      stepEnd(4, 'doc:create-docx', '生成文档', 'completed', 5),
      stepStart(5, 'mail:send', '发送邮件'),
      stepEnd(6, 'mail:send', '发送邮件', 'failed', 3),
      ev('assistant/workflow_run_end', 7, {
        runId: RUN_ID,
        workflow: 'send-report',
        providerId: 'doc-orchestrator',
        stopReason: 'error',
        completedSteps: ['doc:create-docx'],
        durationMs: 20,
        failedStep: 'mail:send',
        error: 'smtp down',
        rootCauseCandidates: [
          {
            nodeId: 'doc:create-docx',
            score: 0.9,
            distance: 1,
            pathEvidenceRefs: ['e1'],
          },
        ],
      }),
    ];

    const data = workflowBlockOf(events)!.workflowData as Record<
      string,
      unknown
    >;
    expect(data.status).toBe('failed');
    expect(data.stopReason).toBe('error');
    expect(data.failedStep).toBe('mail:send');
    expect(data.error).toBe('smtp down');
    expect(data.rootCauseSummary).toBe('上游可疑：doc:create-docx');
    expect(data.interruptedHint).toBeUndefined();

    const steps = data.steps as Array<Record<string, unknown>>;
    expect(steps[1].status).toBe('failed');
  });

  it('半写残留（缺 run_end）⇒ 重放期合成 interrupted（运行中步骤标记，未开始保持 pending）', () => {
    const events = [
      anchor(),
      runStart(['a', 'b', 'c']),
      stepStart(3, 'a', '步骤 a'),
      stepEnd(4, 'a', '步骤 a', 'completed', 5),
      stepStart(5, 'b', '步骤 b'),
    ];

    const data = workflowBlockOf(events)!.workflowData as Record<
      string,
      unknown
    >;
    expect(data.status).toBe('interrupted');
    expect(typeof data.interruptedHint).toBe('string');
    expect(data.interruptedHint).not.toBe('');

    const steps = data.steps as Array<Record<string, unknown>>;
    expect(steps.map((s) => s.status)).toEqual([
      'completed',
      'interrupted',
      'pending',
    ]);
  });

  it('正常收尾的 run 不被误伤（不合成 interrupted）', () => {
    const events = [
      anchor(),
      runStart(['a']),
      stepStart(3, 'a', '步骤 a'),
      stepEnd(4, 'a', '步骤 a', 'completed', 5),
      ev('assistant/workflow_run_end', 5, {
        runId: RUN_ID,
        workflow: 'send-report',
        providerId: 'doc-orchestrator',
        stopReason: 'cancelled',
        completedSteps: ['a'],
        durationMs: 9,
      }),
    ];
    const data = workflowBlockOf(events)!.workflowData as Record<
      string,
      unknown
    >;
    expect(data.status).toBe('cancelled');
    expect(data.interruptedHint).toBeUndefined();
    expect((data.steps as Array<Record<string, unknown>>)[0].status).toBe(
      'completed'
    );
  });

  it('缺 run_start 的孤儿 step/run_end 不建卡（CS06：如实丢弃，不编造）', () => {
    const events = [
      anchor(),
      stepStart(2, 'a', '步骤 a'),
      ev('assistant/workflow_run_end', 3, {
        runId: 'wf_orphan',
        workflow: 'send-report',
        providerId: 'doc-orchestrator',
        stopReason: 'completed',
        completedSteps: [],
        durationMs: 1,
      }),
    ];
    expect(workflowBlockOf(events)).toBeUndefined();
  });
});

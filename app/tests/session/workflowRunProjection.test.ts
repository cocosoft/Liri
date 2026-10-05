// MIT License
// Copyright (c) 2026 190615273@qq.com
/**
 * 工作流 run 记录：落盘投影 + 派生（P0-1 接入点第二刀 ②b，2026-09-24）
 *
 * 链路：工具 `metadata.workflowRun`（seam 观察者装配）→ `MessageToEventMigrator`
 * 投影为 4 类持久事件 → `EventMessageDeriver` 派生为 `workflow_run` 聚合卡片（D14）。
 *
 * 覆盖：投影顺序与 seq 单调 / 无元数据零额外事件 / 失败 run 携带 failedStep + 根因候选 /
 * 形状不合法则跳过（不编造）/ 派生聚合卡片。
 */

import { describe, expect, it } from 'bun:test';

import { MessageToEventMigrator } from '../../src/session/storage/MessageToEventMigrator';
import { deriveMessagesFromEvents } from '../../src/session/storage/EventMessageDeriver';
import type { Message } from '@modules/session/types/message';
import type { LiriEvent } from '@modules/session/types/events';

/** EventLogStorage 实例仅满足构造签名，convertMessage 不触达存储层 */
const stubStorage = {} as unknown as ConstructorParameters<
  typeof MessageToEventMigrator
>[0];

const RUN_ID = 'wf_1700000000000_1';

function convert(metadata: Record<string, unknown> | undefined) {
  const migrator = new MessageToEventMigrator(
    stubStorage,
    'session_wf',
    'default'
  );
  return migrator.convertMessage(
    {
      id: 'm1',
      role: 'tool',
      toolCallId: 'call_1',
      content: '工作流 send-report 执行完成',
      ...(metadata === undefined ? {} : { metadata }),
    } as Message,
    1,
    1700000000000
  );
}

function stepRecord(stepId: string, outcome: 'completed' | 'failed') {
  return {
    start: {
      runId: RUN_ID,
      stepId,
      tool: stepId,
      description: `${stepId} 步骤`,
      startedAt: 1700000000000,
    },
    end: {
      runId: RUN_ID,
      stepId,
      tool: stepId,
      description: `${stepId} 步骤`,
      outcome,
      durationMs: 5,
    },
  };
}

/** 与 `runRecordCollector` 装配结果同形（2 步，全部完成） */
function runRecord(overrides: Record<string, unknown> = {}) {
  return {
    start: {
      runId: RUN_ID,
      workflow: 'send-report',
      providerId: 'doc-orchestrator',
      steps: ['doc:create-docx', 'mail:send'],
      startedAt: 1700000000000,
    },
    steps: [
      stepRecord('doc:create-docx', 'completed'),
      stepRecord('mail:send', 'completed'),
    ],
    end: {
      runId: RUN_ID,
      workflow: 'send-report',
      providerId: 'doc-orchestrator',
      stopReason: 'completed',
      completedSteps: ['doc:create-docx', 'mail:send'],
      durationMs: 12,
    },
    ...overrides,
  };
}

const EXPECTED_TYPES = [
  'assistant/workflow_run_start',
  'assistant/workflow_step_start',
  'assistant/workflow_step_end',
  'assistant/workflow_step_start',
  'assistant/workflow_step_end',
  'assistant/workflow_run_end',
  'tool/result',
];

describe('workflowRun 落盘投影（MessageToEventMigrator）', () => {
  it('按发生序投影 4 类事件，恒排在 tool/result 之前，seq 连续单调', () => {
    const { events } = convert({ workflowRun: runRecord() });

    expect(events.map((e) => e.type)).toEqual(EXPECTED_TYPES);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // 投影出的 6 条工作流事件均标记 schemaVersion=1
    // （tool/result 的该字段取决于是否有 parentMsgId，属既有行为，不在本断言内）
    const workflowEvents = events.filter((e) =>
      e.type.startsWith('assistant/workflow_')
    );
    expect(workflowEvents).toHaveLength(6);
    expect(workflowEvents.every((e) => e.schemaVersion === 1)).toBe(true);
    // D1 无损：不含 undefined 键（undefined 会被 sanitize 拒绝 → 迁移死锁）
    expect(JSON.parse(JSON.stringify(events))).toEqual(events);
  });

  it('run 级事件携带计划步骤；步骤事件成对（stepId 一一对应）', () => {
    const { events } = convert({ workflowRun: runRecord() });

    const start = events.find((e) => e.type === 'assistant/workflow_run_start');
    expect((start!.data as { steps: string[] }).steps).toEqual([
      'doc:create-docx',
      'mail:send',
    ]);

    const stepStarts = events
      .filter((e) => e.type === 'assistant/workflow_step_start')
      .map((e) => (e.data as { stepId: string }).stepId);
    const stepEnds = events
      .filter((e) => e.type === 'assistant/workflow_step_end')
      .map((e) => (e.data as { stepId: string }).stepId);
    expect(stepStarts).toEqual(stepEnds);
  });

  it('无 workflowRun 元数据（绝大多数工具）⇒ 仅 tool/result，零额外事件', () => {
    const { events } = convert(undefined);
    expect(events.map((e) => e.type)).toEqual(['tool/result']);
  });

  it('实时已落盘（liveEmitted=true）⇒ 批末投影整体跳过，去重不重复（P1-19 ①）', () => {
    const { events } = convert({
      workflowRun: runRecord({ liveEmitted: true }),
    });
    // 同 runId+stepId 的 6 条工作流事件已由实时路径写入 ⇒ 批末不得再产（否则重复落盘）
    expect(events.map((e) => e.type)).toEqual(['tool/result']);
  });

  it('liveEmitted 非布尔真值（如 false / 缺省）⇒ 仍走批末兜底投影', () => {
    const { events } = convert({
      workflowRun: runRecord({ liveEmitted: false }),
    });
    expect(events.map((e) => e.type)).toEqual(EXPECTED_TYPES);
  });

  it('失败 run ⇒ run_end 携带 failedStep 与上游根因候选（P0-2 端到端）', () => {
    const { events } = convert({
      workflowRun: runRecord({
        end: {
          runId: RUN_ID,
          workflow: 'send-report',
          providerId: 'doc-orchestrator',
          stopReason: 'error',
          completedSteps: ['doc:create-docx'],
          failedStep: 'mail:send',
          error: 'mail:send 失败',
          durationMs: 30,
          rootCauseCandidates: [
            {
              nodeId: 'doc:create-docx',
              score: 1,
              distance: 1,
              pathEvidenceRefs: [`run:${RUN_ID}#step:doc:create-docx`],
            },
          ],
        },
      }),
    });

    const end = events.find((e) => e.type === 'assistant/workflow_run_end');
    const data = end!.data as {
      stopReason: string;
      failedStep: string;
      rootCauseCandidates: Array<{ nodeId: string }>;
    };
    expect(data.stopReason).toBe('error');
    expect(data.failedStep).toBe('mail:send');
    expect(data.rootCauseCandidates.map((c) => c.nodeId)).toEqual([
      'doc:create-docx',
    ]);
  });

  it('形状不合法 ⇒ 跳过对应事件且不编造（缺 runId 的 start / 缺 tool 的步骤）', () => {
    const { events } = convert({
      workflowRun: {
        // 缺 runId ⇒ run 级开始投影应整体跳过
        start: { workflow: 'send-report', providerId: 'p', startedAt: 1 },
        // 缺 tool ⇒ 该步骤跳过（含其 end）
        steps: [
          {
            start: { runId: RUN_ID, stepId: 's1', startedAt: 1 },
            end: {
              runId: RUN_ID,
              stepId: 's1',
              outcome: 'completed',
              durationMs: 1,
            },
          },
        ],
        // 非法 stopReason ⇒ run 级结束投影跳过
        end: {
          runId: RUN_ID,
          workflow: 'send-report',
          providerId: 'p',
          stopReason: 'whatever',
          completedSteps: [],
          durationMs: 1,
        },
      },
    });

    expect(events.map((e) => e.type)).toEqual(['tool/result']);
  });

  it('派生为 workflow_run 聚合卡片（单块，含步骤与失败根因；不再各产 status 行）', () => {
    const { events } = convert({
      workflowRun: runRecord({
        end: {
          runId: RUN_ID,
          workflow: 'send-report',
          providerId: 'doc-orchestrator',
          stopReason: 'error',
          completedSteps: ['doc:create-docx'],
          failedStep: 'mail:send',
          error: 'mail:send 失败',
          durationMs: 30,
          rootCauseCandidates: [
            {
              nodeId: 'doc:create-docx',
              score: 1,
              distance: 1,
              pathEvidenceRefs: [`run:${RUN_ID}#step:doc:create-docx`],
            },
          ],
        },
      }),
    });
    // 富块事件无 messageId，按事件流归属最近的 assistant 消息 ⇒ 补锚点
    const projection: LiriEvent[] = [
      {
        type: 'assistant/text',
        schemaVersion: 1,
        seq: 0,
        time: 1700000000000,
        sessionId: 'session_wf',
        data: { content: '好的', messageId: 'asst-1' },
      },
      ...events.map((e) => ({ ...e, seq: e.seq + 1 })),
    ];

    const messages = deriveMessagesFromEvents(projection, []);
    const asst = messages.find((m) => m.id === 'asst-1');

    // 4 类事件聚合为单张卡片（D14），不再各产一条 status 提示行
    const cards = asst?.blocks?.filter((b) => b.type === 'workflow_run');
    expect(cards).toHaveLength(1);
    expect(asst?.blocks?.filter((b) => b.type === 'status')).toHaveLength(0);

    const data = cards![0].workflowData as {
      runId: string;
      workflow: string;
      status: string;
      stopReason: string;
      durationMs: number;
      failedStep: string;
      error: string;
      rootCauseSummary: string;
      steps: Array<{ stepId: string; status: string; durationMs?: number }>;
    };
    expect(data.runId).toBe(RUN_ID);
    expect(data.workflow).toBe('send-report');
    expect(data.status).toBe('failed');
    expect(data.stopReason).toBe('error');
    expect(data.durationMs).toBe(30);
    expect(data.failedStep).toBe('mail:send');
    expect(data.error).toBe('mail:send 失败');
    expect(data.rootCauseSummary).toBe('上游可疑：doc:create-docx');
    expect(data.steps.map((s) => s.stepId)).toEqual([
      'doc:create-docx',
      'mail:send',
    ]);
    expect(data.steps.every((s) => s.status === 'completed')).toBe(true);
  });
});

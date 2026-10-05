// MIT License
// Copyright (c) 2026 190615273@qq.com
/**
 * 工作流成员级事件**实时化**（P1-19 ①，2026-10-05）。
 *
 * 覆盖：①实时顺序（run_start 先于 step_*，run_end 恒最后）②去重（实时 + 批末兜底并存不重复）
 * ③封闭（结算后晚到上报被丢弃 —— D11）④未注入追加器/无 sessionId ⇒ 如实不落、走批末兜底。
 */

import { describe, it, expect, afterEach } from 'bun:test';

import {
  WorkflowEngine,
  createRunRecordCollector,
  setWorkflowRunEventSink,
} from '../../../src/modules/workflow/index.js';
import { WorkflowStepLedger } from '../../../src/modules/workflow/WorkflowStepLedger.js';
import type {
  WorkflowStepObserver,
  WorkflowStepStartInfo,
  WorkflowStepEndInfo,
} from '../../../src/modules/workflow/index.js';
import { DocOrchestrator } from '../../../src/modules/doc/orchestration/DocOrchestrator.js';
import { DocOrchestratorProvider } from '../../../src/modules/doc/orchestration/DocOrchestratorProvider.js';
import { MessageToEventMigrator } from '../../../src/session/storage/MessageToEventMigrator.js';
import type { LiriEvent } from '@modules/session/types/events';
import type { Message } from '@modules/session/types/message';

afterEach(() => {
  setWorkflowRunEventSink(null);
});

/** 组装 seam：桩执行器按序返回成功 */
function setupEngine(engine = new WorkflowEngine()) {
  const orchestrator = new DocOrchestrator();
  orchestrator.setToolExecutor(async (tool) => ({
    status: 'success',
    output: `${tool} 完成`,
  }));
  engine.registerProvider(new DocOrchestratorProvider(orchestrator));
  return engine;
}

/** 捕获实时事件的桩追加器 */
function captureSink(events: LiriEvent[]) {
  return async (sessionId: string, event: LiriEvent) => {
    void sessionId;
    events.push(event);
    return { ok: true, tailSeq: events.length };
  };
}

describe('工作流成员级事件实时化（P1-19 ①）', () => {
  it('run 执行期即落 4 类事件：run_start 先于 step_*，run_end 恒最后', async () => {
    const events: LiriEvent[] = [];
    setWorkflowRunEventSink(captureSink(events));
    const engine = setupEngine();
    const { observer, record, liveActive, drain } = createRunRecordCollector({
      sessionId: 's1',
    });

    const result = await engine.execute('send-report', {}, { observer });
    await drain();

    expect(result.stopReason).toBe('completed');
    expect(liveActive).toBe(true);
    // 实时生效 ⇒ 记录带去重标记
    expect(record.liveEmitted).toBe(true);
    expect(events.map((e) => e.type)).toEqual([
      'assistant/workflow_run_start',
      'assistant/workflow_step_start',
      'assistant/workflow_step_end',
      'assistant/workflow_step_start',
      'assistant/workflow_step_end',
      'assistant/workflow_run_end',
    ]);
    // run_end 为该 run 的最后一条；其前必有配对的 step_start
    const last = events[events.length - 1];
    expect(last.type).toBe('assistant/workflow_run_end');
    const firstStepStart = events.findIndex(
      (e) => e.type === 'assistant/workflow_step_start'
    );
    const runStartIdx = events.findIndex(
      (e) => e.type === 'assistant/workflow_run_start'
    );
    expect(runStartIdx).toBeLessThan(firstStepStart);
    // D1 无损：无 undefined 键（会被 sanitize 拒绝 → append 失败）
    expect(JSON.parse(JSON.stringify(events))).toEqual(events);
    // 同一 runId 贯穿
    const runIds = new Set(
      events.map((e) => (e.data as { runId: string }).runId)
    );
    expect(runIds.size).toBe(1);
  });

  it('去重：实时已落盘 ⇒ 批末投影不再产工作流事件（仅 tool/result）', async () => {
    const events: LiriEvent[] = [];
    setWorkflowRunEventSink(captureSink(events));
    const engine = setupEngine();
    const { observer, record, drain } = createRunRecordCollector({
      sessionId: 's1',
    });
    await engine.execute('send-report', {}, { observer });
    await drain();
    expect(events).toHaveLength(6);

    // 工具消息携带同一份 record（liveEmitted=true）→ 批末投影跳过
    const migrator = new MessageToEventMigrator(
      {} as unknown as ConstructorParameters<typeof MessageToEventMigrator>[0],
      's1',
      'default'
    );
    const { events: projected } = migrator.convertMessage(
      {
        id: 'm1',
        role: 'tool',
        toolCallId: 'call_1',
        content: 'done',
        metadata: { workflowRun: record },
      } as unknown as Message,
      1,
      Date.now()
    );
    expect(projected.map((e) => e.type)).toEqual(['tool/result']);
  });

  it('兜底：未注入追加器 ⇒ 如实不落实时事件，批末投影仍完整', async () => {
    setWorkflowRunEventSink(null);
    const engine = setupEngine();
    const { observer, record, liveActive, drain } = createRunRecordCollector({
      sessionId: 's1',
    });

    await engine.execute('send-report', {}, { observer });
    await drain();

    expect(liveActive).toBe(false);
    expect(record.liveEmitted).toBeUndefined();
    expect(record.steps).toHaveLength(2);

    const migrator = new MessageToEventMigrator(
      {} as unknown as ConstructorParameters<typeof MessageToEventMigrator>[0],
      's1',
      'default'
    );
    const { events: projected } = migrator.convertMessage(
      {
        id: 'm1',
        role: 'tool',
        toolCallId: 'call_1',
        content: 'done',
        metadata: { workflowRun: record },
      } as unknown as Message,
      1,
      Date.now()
    );
    // 兜底完整：6 条工作流事件 + tool/result
    expect(projected).toHaveLength(7);
    expect(projected[projected.length - 1].type).toBe('tool/result');
  });

  it('无 sessionId ⇒ 不激活实时路径（CLI / 单测等无会话语境）', async () => {
    const events: LiriEvent[] = [];
    setWorkflowRunEventSink(captureSink(events));
    const engine = setupEngine();
    const { observer, record, liveActive } = createRunRecordCollector({});

    await engine.execute('send-report', {}, { observer });

    expect(liveActive).toBe(false);
    expect(events).toHaveLength(0);
    expect(record.liveEmitted).toBeUndefined();
  });
});

describe('账本结算即封闭（D11，实时化不得削弱）', () => {
  it('close() 后晚到的 start/end 上报一律丢弃', () => {
    const emittedEnds: WorkflowStepEndInfo[] = [];
    const emittedStarts: WorkflowStepStartInfo[] = [];
    const observer: WorkflowStepObserver = {
      onStepStart: (info) => emittedStarts.push(info),
      onStepEnd: (info) => emittedEnds.push(info),
    };
    const ledger = new WorkflowStepLedger('wf_1_1', observer, ['a']);

    ledger.onStepStart({
      stepId: 'a',
      tool: 'a',
      description: '步骤 a',
      startedAt: 1000,
    });
    // 结算：为 live 步骤合成 end，并封闭
    ledger.close('cancelled');
    expect(emittedEnds).toHaveLength(1);
    expect(emittedEnds[0].synthesized).toBe(true);

    // 晚到上报（宽限期后 Provider 仍在跑的回调）一律丢弃
    ledger.onStepEnd({ stepId: 'a', outcome: 'completed' });
    ledger.onStepStart({
      stepId: 'b',
      tool: 'b',
      description: '步骤 b',
      startedAt: 2000,
    });

    expect(emittedEnds).toHaveLength(1);
    expect(emittedStarts).toHaveLength(1);
  });
});

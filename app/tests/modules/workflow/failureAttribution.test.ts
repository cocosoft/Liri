/**
 * P0-2 接线期② 单测：失败归因（上游根因候选）+ 引擎接线（run_end 携带候选集）。
 *
 * 依据 `.trae/specs/graph-engineering-p0.md` §2.4：把 run 事实投影为任务子图，
 * 沿**反向依赖**回溯给出可复核的根因候选（每条自带 `pathEvidenceRefs`）。
 */

import { describe, it, expect } from 'bun:test';

import { WorkflowEngine } from '../../../src/modules/workflow/index.js';
import type {
  WorkflowDefinition,
  WorkflowProvider,
  WorkflowRunEndInfo,
  WorkflowRunObserver,
  WorkflowRunResult,
  WorkflowStepSpec,
} from '../../../src/modules/workflow/index.js';
import { attributeFailure } from '../../../src/modules/workflow/failureAttribution.js';

function step(id: string, dependsOn?: string[]): WorkflowStepSpec {
  return {
    id,
    description: `步骤 ${id}`,
    tool: 'noop',
    ...(dependsOn ? { dependsOn } : {}),
  };
}

describe('attributeFailure：沿上游依赖回溯', () => {
  it('链式失败 ⇒ 直接前提在前、更远前提在后，并带 run 内证据引用', () => {
    const result = attributeFailure({
      runId: 'wf_1_1',
      steps: [step('a'), step('b', ['a']), step('c', ['b'])],
      failedStep: 'c',
    })!;
    expect(result.candidates.map((c) => [c.nodeId, c.distance])).toEqual([
      ['b', 1],
      ['a', 2],
    ]);
    expect(result.candidates[0].pathEvidenceRefs).toEqual([
      'run:wf_1_1#step:b',
    ]);
    expect(result.candidates[1].pathEvidenceRefs).toEqual([
      'run:wf_1_1#step:b',
      'run:wf_1_1#step:a',
    ]);
  });

  it('菱形失败 ⇒ 两条直接前提并列在前（插入序），汇聚点上游排后', () => {
    const result = attributeFailure({
      runId: 'wf_2_1',
      steps: [
        step('root'),
        step('left', ['root']),
        step('right', ['root']),
        step('join', ['left', 'right']),
      ],
      failedStep: 'join',
    })!;
    expect(result.candidates.map((c) => [c.nodeId, c.distance])).toEqual([
      ['left', 1],
      ['right', 1],
      ['root', 2],
    ]);
  });

  it('失败步骤没有已声明上游 ⇒ 候选为空（不下结论，也不编造）', () => {
    const result = attributeFailure({
      runId: 'wf_3_1',
      steps: [step('a'), step('b', ['a'])],
      failedStep: 'a',
    })!;
    expect(result.candidates).toEqual([]);
  });

  it('失败步骤不在计划内 ⇒ undefined（调用方据此不下发该字段）', () => {
    expect(
      attributeFailure({
        runId: 'wf_4_1',
        steps: [step('a')],
        failedStep: 'ghost',
      })
    ).toBeUndefined();
  });

  it('limit 生效（有界输出）', () => {
    const result = attributeFailure({
      runId: 'wf_5_1',
      steps: [
        step('a'),
        step('b', ['a']),
        step('c', ['b']),
        step('d', ['c']),
      ],
      failedStep: 'd',
      limit: 2,
    })!;
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0].nodeId).toBe('c');
  });
});

describe('引擎接线：run 失败时把根因候选交给观察者', () => {
  const definition: WorkflowDefinition = {
    name: 'attr-flow',
    description: '归因接线',
    steps: [step('a'), step('b', ['a']), step('c', ['b'])],
  };

  function engineWith(result: WorkflowRunResult): WorkflowEngine {
    const provider: WorkflowProvider = {
      providerId: 'fake-provider',
      listWorkflows: () => [definition],
      execute: async () => result,
    };
    const engine = new WorkflowEngine();
    engine.registerProvider(provider);
    return engine;
  }

  async function runAndCapture(
    engine: WorkflowEngine
  ): Promise<WorkflowRunEndInfo> {
    let end: WorkflowRunEndInfo | undefined;
    const observer: WorkflowRunObserver = { onRunEnd: (info) => { end = info; } };
    await engine.execute('attr-flow', {}, { observer });
    if (!end) throw new Error('观察者未收到 onRunEnd');
    return end;
  }

  it('失败（c 未完成）⇒ 候选为上游 b、a，证据引用指向本 run 的步骤记录', async () => {
    const end = await runAndCapture(
      engineWith({
        stopReason: 'error',
        completedSteps: ['a', 'b'],
        error: '步骤 c 失败',
      })
    );
    expect(end.failedStep).toBe('c');
    expect(end.rootCauseCandidates?.map((c) => c.nodeId)).toEqual(['b', 'a']);
    for (const candidate of end.rootCauseCandidates ?? []) {
      for (const ref of candidate.pathEvidenceRefs) {
        expect(ref).toMatch(/^run:wf_\d+_\d+#step:[ab]$/);
      }
    }
  });

  it('成功 ⇒ 不带根因候选（不做无谓计算，也不给误导性字段）', async () => {
    const end = await runAndCapture(
      engineWith({ stopReason: 'completed', completedSteps: ['a', 'b', 'c'] })
    );
    expect(end.failedStep).toBeUndefined();
    expect(end.rootCauseCandidates).toBeUndefined();
  });
});

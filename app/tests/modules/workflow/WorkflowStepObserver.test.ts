// MIT License
// Copyright (c) 2026 190615273@qq.com
/**
 * 成员级步骤观察 + 配对不变式（P1-3 §11 D7–D13，2026-10-05 实建）
 *
 * 不变式执行者是 `WorkflowStepLedger`（宿主侧单点）：**每个 `onStepStart` 在一次 run 内
 * 恰好对应一次 `onStepEnd`**（Provider 少报则合成 `synthesized`，错报则丢弃且不编造）。
 *
 * 覆盖 10 例：正常配对（runId 注入 + tool/description 回填 + durationMs）/ 少报合成 /
 * 抛错路径 / 宽限期强结算 + 封闭 / 计划外 stepId / 重复 start / 孤儿 end / 预检取消 /
 * 未注入观察者 / 观察者自身抛错。
 */

import { describe, it, expect } from 'bun:test';

import {
  WorkflowEngine,
  type WorkflowDefinition,
  type WorkflowProvider,
  type WorkflowRunEndInfo,
  type WorkflowRunObserver,
  type WorkflowRunResult,
  type WorkflowStepEndInfo,
  type WorkflowStepReporter,
  type WorkflowStepStartInfo,
} from '../../../src/modules/workflow/index.js';
import { WorkflowStepLedger } from '../../../src/modules/workflow/WorkflowStepLedger.js';

/** Provider 行为模式（桩：精确控制上报以验证账本不变式） */
type StubMode = 'pair' | 'no-end' | 'throw' | 'hang' | 'slow';

class StubProvider implements WorkflowProvider {
  readonly providerId = 'stub-provider';
  /** 最近一次注入的步骤上报端口（供"封闭后晚到上报"断言） */
  reporter: WorkflowStepReporter | undefined;
  executeCalled = 0;

  constructor(
    private readonly stepIds: string[],
    private readonly mode: StubMode,
    /** `slow` 模式的单步耗时（ms） */
    private readonly stepDelayMs = 0
  ) {}

  listWorkflows(): WorkflowDefinition[] {
    return [
      {
        name: 'stub-wf',
        description: '桩工作流',
        steps: this.stepIds.map((id) => ({
          id,
          tool: id,
          description: `${id} 描述`,
        })),
      },
    ];
  }

  async execute(
    definition: WorkflowDefinition,
    _params: Record<string, unknown>,
    _signal?: AbortSignal,
    stepReporter?: WorkflowStepReporter
  ): Promise<WorkflowRunResult> {
    this.executeCalled += 1;
    this.reporter = stepReporter;
    const first = definition.steps[0];

    if (this.mode === 'hang') {
      stepReporter?.onStepStart?.({
        stepId: first.id,
        tool: first.tool,
        description: first.description,
        startedAt: Date.now(),
      });
      // 永不结算（模拟"宽限期到期后被放弃的 Provider"）
      return new Promise<never>(() => {});
    }

    if (this.mode === 'throw') {
      stepReporter?.onStepStart?.({
        stepId: first.id,
        tool: first.tool,
        description: first.description,
        startedAt: Date.now(),
      });
      throw new Error('boom');
    }

    const completed: string[] = [];
    for (const step of definition.steps) {
      stepReporter?.onStepStart?.({
        stepId: step.id,
        tool: step.tool,
        description: step.description,
        startedAt: Date.now(),
      });
      // slow：步骤耗时可控（用于验证"宽限期 vs Provider 速度"的取消语义）
      if (this.mode === 'slow' && this.stepDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.stepDelayMs));
      }
      // 少报：只上报 start，不上报 end（由账本在 run 出口合成）
      if (this.mode !== 'no-end') {
        stepReporter?.onStepEnd?.({
          stepId: step.id,
          outcome: 'completed',
        });
      }
      completed.push(step.id);
    }
    return { stopReason: 'completed', completedSteps: completed };
  }
}

function engineWith(provider: WorkflowProvider): WorkflowEngine {
  const engine = new WorkflowEngine();
  engine.registerProvider(provider);
  return engine;
}

/** 记录所有观察回调 */
function recorder(): {
  observer: WorkflowRunObserver;
  starts: WorkflowStepStartInfo[];
  ends: WorkflowStepEndInfo[];
  runEvents: Array<{ kind: 'start' | 'end'; info: unknown }>;
} {
  const starts: WorkflowStepStartInfo[] = [];
  const ends: WorkflowStepEndInfo[] = [];
  const runEvents: Array<{ kind: 'start' | 'end'; info: unknown }> = [];
  return {
    observer: {
      onRunStart: (info) => runEvents.push({ kind: 'start', info }),
      onRunEnd: (info) => runEvents.push({ kind: 'end', info }),
      onStepStart: (info) => starts.push(info),
      onStepEnd: (info) => ends.push(info),
    },
    starts,
    ends,
    runEvents,
  };
}

async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor 超时');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('WorkflowStepObserver（成员级配对不变式）', () => {
  it('正常配对：runId 注入 + tool/description 回填 + durationMs 由账本计算', async () => {
    const provider = new StubProvider(['a', 'b'], 'pair');
    const r = recorder();
    const result = await engineWith(provider).execute(
      'stub-wf',
      {},
      {
        observer: r.observer,
      }
    );

    expect(result.stopReason).toBe('completed');
    expect(r.starts.map((s) => s.stepId)).toEqual(['a', 'b']);
    expect(r.ends.map((e) => e.stepId)).toEqual(['a', 'b']);

    // runId 由账本注入（Provider 不上报 runId），start/end 同一 runId
    expect(r.starts[0].runId).toMatch(/^wf_/);
    expect(r.ends[0].runId).toBe(r.starts[0].runId);
    // end 自包含：回填 start 的 tool/description
    expect(r.ends[0].tool).toBe('a');
    expect(r.ends[0].description).toBe('a 描述');
    expect(typeof r.ends[0].durationMs).toBe('number');
    expect(r.ends[0].durationMs).toBeGreaterThanOrEqual(0);
    // 真实结束，非合成
    expect(r.ends[0].synthesized).toBeUndefined();
  });

  it('少报 → 合成：Provider 只报 start ⇒ 账本在 run 出口合成 end（synthesized=true）', async () => {
    const provider = new StubProvider(['a', 'b'], 'no-end');
    const r = recorder();
    const result = await engineWith(provider).execute(
      'stub-wf',
      {},
      {
        observer: r.observer,
      }
    );

    expect(result.stopReason).toBe('completed');
    expect(r.starts.map((s) => s.stepId)).toEqual(['a', 'b']);
    expect(r.ends.map((e) => e.stepId)).toEqual(['a', 'b']);
    expect(r.ends.every((e) => e.synthesized === true)).toBe(true);
    // 合成 outcome 按 stopReason 映射（completed ⇒ completed）
    expect(r.ends.every((e) => e.outcome === 'completed')).toBe(true);
  });

  it('抛错路径：先结算 live 步骤（failed）再通知 run_end(error)，异常原样上抛', async () => {
    const provider = new StubProvider(['a', 'b'], 'throw');
    const r = recorder();
    await expect(
      engineWith(provider).execute('stub-wf', {}, { observer: r.observer })
    ).rejects.toThrow('boom');

    expect(r.starts.map((s) => s.stepId)).toEqual(['a']);
    expect(r.ends).toHaveLength(1);
    expect(r.ends[0].synthesized).toBe(true);
    expect(r.ends[0].outcome).toBe('failed');
    const runEnd = r.runEvents.at(-1)?.info as WorkflowRunEndInfo;
    expect(runEnd.stopReason).toBe('error');
    expect(runEnd.error).toContain('boom');
  });

  it('宽限期强结算 + 结算即封闭（晚到上报被丢弃 —— D11）', async () => {
    const provider = new StubProvider(['a', 'b'], 'hang');
    const r = recorder();
    const controller = new AbortController();
    const exec = engineWith(provider).execute(
      'stub-wf',
      {},
      {
        observer: r.observer,
        signal: controller.signal,
        gracePeriodMs: 10,
      }
    );

    await waitFor(() => r.starts.length === 1);
    controller.abort();
    const result = await exec;

    expect(result.stopReason).toBe('cancelled');
    expect(r.ends).toHaveLength(1);
    expect(r.ends[0].synthesized).toBe(true);
    expect(r.ends[0].outcome).toBe('cancelled');

    // 被放弃的 Provider 之后继续上报 ⇒ 一律丢弃（run_end 之后不得再有 step 事件）
    provider.reporter?.onStepEnd?.({ stepId: 'a', outcome: 'completed' });
    provider.reporter?.onStepStart?.({
      stepId: 'b',
      tool: 'b',
      description: 'b 描述',
      startedAt: Date.now(),
    });
    expect(r.starts).toHaveLength(1);
    expect(r.ends).toHaveLength(1);
  });

  it('计划外 stepId ⇒ 丢弃其开始上报（不产生孤儿事件）', () => {
    const starts: WorkflowStepStartInfo[] = [];
    const ledger = new WorkflowStepLedger(
      'wf_x',
      { onStepStart: (info) => starts.push(info) },
      ['a']
    );
    ledger.onStepStart({
      stepId: 'not-planned',
      tool: 'not-planned',
      description: '计划外',
      startedAt: 1,
    });
    expect(starts).toHaveLength(0);
  });

  it('重复 start ⇒ 只发一次（后一次丢弃）', () => {
    const starts: WorkflowStepStartInfo[] = [];
    const ledger = new WorkflowStepLedger(
      'wf_x',
      { onStepStart: (info) => starts.push(info) },
      ['a']
    );
    ledger.onStepStart({
      stepId: 'a',
      tool: 'a',
      description: 'a',
      startedAt: 1,
    });
    ledger.onStepStart({
      stepId: 'a',
      tool: 'a',
      description: 'a',
      startedAt: 2,
    });
    expect(starts).toHaveLength(1);
  });

  it('孤儿 end（无配对 start）⇒ 丢弃且不编造', () => {
    const ends: WorkflowStepEndInfo[] = [];
    const ledger = new WorkflowStepLedger(
      'wf_x',
      { onStepEnd: (info) => ends.push(info) },
      ['a']
    );
    ledger.onStepEnd({ stepId: 'a', outcome: 'completed' });
    expect(ends).toHaveLength(0);
  });

  it('预检取消：不进入 Provider，仍发成对 run start/end（cancelled）', async () => {
    const provider = new StubProvider(['a'], 'pair');
    const r = recorder();
    const controller = new AbortController();
    controller.abort();

    const result = await engineWith(provider).execute(
      'stub-wf',
      {},
      {
        observer: r.observer,
        signal: controller.signal,
      }
    );

    expect(result.stopReason).toBe('cancelled');
    expect(provider.executeCalled).toBe(0);
    expect(r.starts).toHaveLength(0);
    expect(r.ends).toHaveLength(0);
    expect(r.runEvents.map((e) => e.kind)).toEqual(['start', 'end']);
    expect((r.runEvents[1].info as WorkflowRunEndInfo).stopReason).toBe(
      'cancelled'
    );
  });

  it('未注入观察者 ⇒ 不创建账本（Provider 收到的 reporter 为 undefined，零步骤开销）', async () => {
    const provider = new StubProvider(['a'], 'pair');
    const result = await engineWith(provider).execute('stub-wf', {});

    expect(result.stopReason).toBe('completed');
    expect(provider.executeCalled).toBe(1);
    expect(provider.reporter).toBeUndefined();
  });

  it('观察者自身抛错不得污染执行结果（监听器包含语义）', async () => {
    const provider = new StubProvider(['a'], 'pair');
    let runEndCalled = 0;
    const observer: WorkflowRunObserver = {
      onRunStart: () => {
        throw new Error('observer boom');
      },
      onStepStart: () => {
        throw new Error('observer boom');
      },
      onStepEnd: () => {
        throw new Error('observer boom');
      },
      onRunEnd: () => {
        runEndCalled += 1;
      },
    };

    const result = await engineWith(provider).execute(
      'stub-wf',
      {},
      {
        observer,
      }
    );

    expect(result.stopReason).toBe('completed');
    expect(runEndCalled).toBe(1);
  });

  it('宽限语义①：Provider 快于宽限期（默认 5000ms）⇒ 中止后 Provider 结果取胜（非 cancelled）', async () => {
    const provider = new StubProvider(['a'], 'slow', 150);
    const r = recorder();
    const controller = new AbortController();
    const exec = engineWith(provider).execute(
      'stub-wf',
      {},
      { observer: r.observer, signal: controller.signal }
    );
    await waitFor(() => r.starts.length === 1);
    controller.abort();
    const result = await exec;

    // ⚠️ P1-19 ⑤b 的根因：默认宽限 5000ms 下，快工作流（实测 ~200ms）的"中止"
    //    **不会**变成 cancelled —— 中止只起计时，Provider 先返回则其结果取胜。
    expect(result.stopReason).toBe('completed');
    expect(r.ends).toHaveLength(1);
    expect(r.ends[0].synthesized).toBeUndefined();
  });

  it('宽限语义②：gracePeriodMs=0 ⇒ 中止即结算为 cancelled（在飞步骤被强制结算并封闭）', async () => {
    const provider = new StubProvider(['a'], 'slow', 150);
    const r = recorder();
    const controller = new AbortController();
    const exec = engineWith(provider).execute(
      'stub-wf',
      {},
      { observer: r.observer, signal: controller.signal, gracePeriodMs: 0 }
    );
    await waitFor(() => r.starts.length === 1);
    controller.abort();
    const result = await exec;

    expect(result.stopReason).toBe('cancelled');
    expect(r.ends).toHaveLength(1);
    expect(r.ends[0].synthesized).toBe(true);
    expect(r.ends[0].outcome).toBe('cancelled');
  });
});

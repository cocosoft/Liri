/**
 * 判分器自身回归（D2 第 3 批，2026-09-12）
 *
 * 目的：证明**判分器被放水/被调松时能被自身用例捕获**（计划 §D2 第 6 点），
 * 并锁定 R12-001 门禁的比对语义。
 *
 * 覆盖：
 * - 期望语义：控制任务（expect='fail'）"断言失败"才算符合期望
 * - 指标口径：pass^1 / pass^k（k=0 不算通过）
 * - 判分器自检：缺控制任务 / 控制任务意外通过（放水）→ 不通过
 * - 门禁比对：未登记任务、pass^k 未达标、pass^1 低于基线、自检失败
 * - L2 轨迹抽取：三种持久化形态、JSON 字符串参数、按 id 去重、空输入
 */
import { describe, test, expect } from 'bun:test';
import {
  checkGate,
  isAsExpected,
  judgeSanityOk,
  summarizeRun,
  summarizeSecurity,
  summarizeTask,
} from '../../src/evals/scoring';
import { extractToolCalls, toolCallNames } from '../../src/evals/trace';
import type { Baseline } from '../../src/evals/scoring';
import type { EvalAttempt, EvalTask } from '../../src/evals/types';

function makeTask(over: Partial<EvalTask> = {}): EvalTask {
  return {
    id: 'task-a',
    name: '任务 A',
    level: 'L1',
    prompt: () => 'noop',
    assert: async () => ({ pass: true }),
    ...over,
  };
}

function makeAttempt(pass: boolean, asExpected: boolean): EvalAttempt {
  return { index: 1, assertion: { pass }, asExpected, durationMs: 1 };
}

describe('判分期望语义（控制任务）', () => {
  test('普通任务：断言通过 = 符合期望', () => {
    const task = makeTask();
    expect(isAsExpected(task, { pass: true })).toBe(true);
    expect(isAsExpected(task, { pass: false })).toBe(false);
  });

  test('控制任务（expect=fail）：断言失败才符合期望', () => {
    const control = makeTask({ expect: 'fail' });
    expect(isAsExpected(control, { pass: false })).toBe(true);
    expect(isAsExpected(control, { pass: true })).toBe(false);
  });
});

describe('指标口径 pass^1 / pass^k', () => {
  test('k=2 全符合期望 → pass^k 通过', () => {
    const result = summarizeTask(makeTask(), [
      makeAttempt(true, true),
      makeAttempt(true, true),
    ]);
    expect(result.pass1).toBe(1);
    expect(result.passK).toBe(true);
    expect(result.assertPassCount).toBe(2);
  });

  test('k=2 其中一次不符合期望 → pass^k 不通过（稳定性失败）', () => {
    const result = summarizeTask(makeTask(), [
      makeAttempt(true, true),
      makeAttempt(false, false),
    ]);
    expect(result.pass1).toBe(0.5);
    expect(result.passK).toBe(false);
  });

  test('零次尝试不算通过（防止"没跑就算过"）', () => {
    const result = summarizeTask(makeTask(), []);
    expect(result.pass1).toBe(0);
    expect(result.passK).toBe(false);
  });
});

describe('判分器自检（防放水）', () => {
  const control = makeTask({ id: 'control', expect: 'fail' });

  test('整轮运行缺少控制任务 → 自检不通过', () => {
    const result = summarizeTask(makeTask(), [makeAttempt(true, true)]);
    expect(judgeSanityOk([result], true)).toBe(false);
  });

  test('控制任务按设计被判失败 → 自检通过', () => {
    const result = summarizeTask(control, [makeAttempt(false, true)]);
    expect(judgeSanityOk([result], true)).toBe(true);
  });

  test('控制任务意外通过（判分器放水）→ 自检不通过', () => {
    const result = summarizeTask(control, [makeAttempt(true, false)]);
    expect(judgeSanityOk([result], true)).toBe(false);
  });

  test('--task= 子集运行（不应期待控制任务）→ 无控制任务也通过', () => {
    const result = summarizeTask(makeTask(), [makeAttempt(true, true)]);
    expect(judgeSanityOk([result], false)).toBe(true);
  });
});

describe('R12-001 门禁比对', () => {
  const baseline: Baseline = {
    requireJudgeSanity: true,
    tasks: {
      'task-a': { requirePassK: true, minPass1: 1 },
      control: { requirePassK: true, minPass1: 1 },
    },
  };

  function summaryOf(attempts: EvalAttempt[], expectControls = true) {
    const byTask = new Map<string, EvalAttempt[]>();
    for (const a of attempts) {
      const key = a.assertion.pass ? 'task-a' : 'control';
      byTask.set(key, [...(byTask.get(key) ?? []), a]);
    }
    const results = ['task-a', 'control'].map((id) =>
      summarizeTask(
        id === 'control' ? makeTask({ id, expect: 'fail' }) : makeTask({ id }),
        byTask.get(id) ?? []
      )
    );
    return summarizeRun({
      startedAt: 't0',
      finishedAt: 't1',
      model: 'm',
      k: 1,
      tasks: results,
      expectControls,
    });
  }

  test('全部达标 → 无回归', () => {
    const failures = checkGate(
      summaryOf([makeAttempt(true, true), makeAttempt(false, true)]),
      baseline
    );
    expect(failures).toEqual([]);
  });

  test('pass^k 未达标 → 报告回归', () => {
    const failures = checkGate(
      summaryOf([makeAttempt(true, false), makeAttempt(false, true)]),
      baseline
    );
    expect(failures.some((f) => f.includes('pass^k 未达标'))).toBe(true);
  });

  test('基线未登记该任务 → 报告回归（新增任务须显式登记）', () => {
    const results = [
      summarizeTask(makeTask({ id: 'brand-new' }), [makeAttempt(true, true)]),
    ];
    const failures = checkGate(
      summarizeRun({
        startedAt: 't0',
        finishedAt: 't1',
        model: 'm',
        k: 1,
        tasks: results,
        expectControls: false,
      }),
      { requireJudgeSanity: false, tasks: {} }
    );
    expect(failures.some((f) => f.includes('未登记'))).toBe(true);
  });

  test('判分器自检失败 → 门禁不通过', () => {
    const failures = checkGate(summaryOf([makeAttempt(true, true)]), baseline);
    expect(failures.some((f) => f.includes('判分器自检未通过'))).toBe(true);
  });
});

describe('安全指标（D9：ASR 与误伤同时上报）', () => {
  const attackTask = makeTask({
    id: 'atk',
    security: { kind: 'attack', pair: 'p' },
  });
  const benignTask = makeTask({
    id: 'ben',
    security: { kind: 'benign', pair: 'p' },
  });

  test('攻击全被挡住 → ASR 0%；benign 通过 → 误伤 0', () => {
    const s = summarizeSecurity([
      summarizeTask(attackTask, [makeAttempt(true, true)]),
      summarizeTask(benignTask, [makeAttempt(true, true)]),
    ]);
    expect(s).toEqual({ pairs: 1, asr: 0, benignPassRate: 1 });
  });

  test('k=2 有一次注入得手 → ASR 50%（不是"有/无"二值）', () => {
    const s = summarizeSecurity([
      summarizeTask(attackTask, [
        makeAttempt(true, true),
        makeAttempt(false, false),
      ]),
      summarizeTask(benignTask, [
        makeAttempt(true, true),
        makeAttempt(true, true),
      ]),
    ]);
    expect(s?.asr).toBe(0.5);
    expect(s?.benignPassRate).toBe(1);
  });

  test('benign 未完成 → 误伤可观测（不会被掩盖为 100%）', () => {
    const s = summarizeSecurity([
      summarizeTask(attackTask, [makeAttempt(true, true)]),
      summarizeTask(benignTask, [makeAttempt(false, false)]),
    ]);
    expect(s?.asr).toBe(0);
    expect(s?.benignPassRate).toBe(0);
  });

  test('同一 pair 多个攻击变体 → ASR 取平均（AgentDojo 式一场景多载荷）', () => {
    const atkA = makeTask({
      id: 'atk-a',
      security: { kind: 'attack', pair: 'p' },
    });
    const atkB = makeTask({
      id: 'atk-b',
      security: { kind: 'attack', pair: 'p' },
    });
    const s = summarizeSecurity([
      summarizeTask(atkA, [makeAttempt(true, true)]), // 未得手
      summarizeTask(atkB, [makeAttempt(false, false)]), // 得手
      summarizeTask(benignTask, [makeAttempt(true, true)]),
    ]);
    expect(s?.pairs).toBe(1);
    expect(s?.asr).toBe(0.5); // (0 + 1) / 2
    expect(s?.benignPassRate).toBe(1);
  });

  test('题集无安全任务 → undefined（避免"0% ASR"的假安全感）', () => {
    expect(
      summarizeSecurity([summarizeTask(makeTask(), [makeAttempt(true, true)])])
    ).toBeUndefined();
  });
});

describe('L2 轨迹抽取（工具调用序列）', () => {
  test('形态 1：assistant.tool_calls[]（含 JSON 字符串参数）', () => {
    const calls = extractToolCalls({
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          tool_calls: [
            {
              id: 'c1',
              type: 'function',
              function: {
                name: 'file_write',
                arguments: '{"file_path":"a.txt","content":"x"}',
              },
            },
          ],
        },
      ],
    });
    expect(toolCallNames(calls)).toEqual(['file_write']);
    expect(calls[0].args?.file_path).toBe('a.txt');
  });

  test('形态 2：content[] 的 tool_call 块；形态 3：blocks[]', () => {
    const calls = extractToolCalls([
      {
        role: 'assistant',
        content: [
          { type: 'tool_call', toolName: 'grep', toolArgs: { pattern: 'x' } },
        ],
        blocks: [{ type: 'tool_call', toolName: 'file_read', toolArgs: {} }],
      },
    ]);
    expect(toolCallNames(calls)).toEqual(['grep', 'file_read']);
  });

  test('按 id 去重（防历史双写/SSE 重复计数）', () => {
    const dup = {
      role: 'assistant',
      tool_calls: [
        { id: 'same', function: { name: 'glob', arguments: '{}' } },
        { id: 'same', function: { name: 'glob', arguments: '{}' } },
      ],
    };
    expect(toolCallNames(extractToolCalls({ messages: [dup] }))).toEqual([
      'glob',
    ]);
  });

  test('空输入 / 无工具调用 → 空序列（不抛错）', () => {
    expect(extractToolCalls(null)).toEqual([]);
    expect(
      extractToolCalls({ messages: [{ role: 'user', content: 'hi' }] })
    ).toEqual([]);
  });
});

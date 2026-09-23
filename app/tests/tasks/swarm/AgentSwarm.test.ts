/**
 * AgentSwarm 多代理并行编排测试（P1-6，对标 Hermes kanban_swarm create_swarm）
 *
 * 覆盖：
 * - 并行 workers 全部执行（每个子任务产出独立结果）
 * - verifier 门禁：失败 worker 被标记 `verify='failed'`
 * - synthesizer 合成全部结果
 * - worker 抛错降级：不阻断整体
 * - B-4 契约：`signal` 取消短路、`enableVerify`/`enableSynthesize` 门控、`agentType` 透传
 * - **O4（2026-09-21）**：executor 契约携带真实成败与超时；门禁 **fail-closed**；
 *   `ok = success ∧ verify ≠ failed ∧ ¬timedOut` 正向合取；`allPassed = every(ok)`
 */
import { describe, test, expect } from 'bun:test';
import { AgentSwarm } from '../../../src/tasks/swarm/AgentSwarm';
import type {
  AgentSwarmOptions,
  SwarmExecutorResult,
} from '../../../src/tasks/swarm/AgentSwarm';
import type { AgentIsolation } from '@modules/agent';

const swarm = new AgentSwarm();

const isolation = {
  abortController: new AbortController(),
} as unknown as AgentIsolation;

/** 按 userPrompt 内容路由的 fake executor（worker / verifier / synthesizer） */
function routedExecutor(
  options: {
    verifyPass?: boolean;
    /** verifier 返回的原始文本（用于构造"不可解析"场景） */
    verifyRawText?: string;
    workerOk?: boolean;
    workerTimedOut?: boolean;
  } = {}
) {
  const calls: string[] = [];
  const executor: AgentSwarmOptions['executor'] = async ({ userPrompt }) => {
    calls.push(userPrompt.slice(0, 30));
    if (userPrompt.includes('你的子任务')) {
      const m = userPrompt.match(/你的子任务: (.+)/);
      return {
        output: `worker-output:${m?.[1]?.slice(0, 10) ?? '?'}`,
        ok: options.workerOk ?? true,
        timedOut: options.workerTimedOut ?? false,
      };
    }
    if (userPrompt.includes('worker 输出')) {
      return {
        output:
          options.verifyRawText ??
          JSON.stringify({
            pass: options.verifyPass ?? true,
            feedback: options.verifyPass === false ? '不通过' : '通过',
          }),
        ok: true,
      };
    }
    if (userPrompt.includes('worker 结果汇总')) {
      return { output: 'synthesized-final-report', ok: true };
    }
    return { output: 'unknown', ok: true };
  };
  return { executor, calls };
}

const baseOptions: Omit<AgentSwarmOptions, 'executor' | 'isolation'> = {
  tasks: [
    { id: 'w1', description: '分析需求 A' },
    { id: 'w2', description: '设计模块 B' },
    { id: 'w3', description: '梳理接口 C' },
  ],
  goal: '完成系统重构',
};

describe('AgentSwarm（P1-6）', () => {
  test('并行 workers 全部执行 + synthesizer 合成', async () => {
    const { executor, calls } = routedExecutor();
    const r = await swarm.run({ ...baseOptions, executor, isolation });
    expect(r.workers.length).toBe(3);
    expect(r.workers.every((w) => w.output.startsWith('worker-output:'))).toBe(
      true
    );
    expect(r.workers.every((w) => w.verify === 'passed')).toBe(true);
    expect(r.workers.every((w) => w.ok)).toBe(true);
    expect(r.synthesized).toBe('synthesized-final-report');
    expect(r.allPassed).toBe(true);
    // 3 worker + 3 verifier + 1 synthesizer = 7 次 executor 调用
    expect(calls.length).toBe(7);
  });

  test('verifier 门禁：失败 worker 被标记 verify=failed', async () => {
    const { executor } = routedExecutor({ verifyPass: false });
    const r = await swarm.run({ ...baseOptions, executor, isolation });
    expect(r.workers.every((w) => w.verify === 'failed')).toBe(true);
    expect(r.workers.every((w) => w.feedback === '不通过')).toBe(true);
    expect(r.workers.every((w) => w.ok)).toBe(false);
    expect(r.allPassed).toBe(false);
  });

  test('worker 抛错降级：success=false 且不阻断整体', async () => {
    let count = 0;
    const executor: AgentSwarmOptions['executor'] = async ({ userPrompt }) => {
      if (userPrompt.includes('你的子任务') && ++count === 2) {
        throw new Error('worker crash');
      }
      if (userPrompt.includes('worker 输出')) {
        return { output: JSON.stringify({ pass: true }), ok: true };
      }
      if (userPrompt.includes('worker 结果汇总')) {
        return { output: 'synthesized', ok: true };
      }
      return { output: 'ok', ok: true };
    };
    const r = await swarm.run({ ...baseOptions, executor, isolation });
    expect(r.workers.length).toBe(3);
    // 崩溃的 worker（第二个）：未执行成功、未跑门禁、ok=false
    expect(r.workers[1].success).toBe(false);
    expect(r.workers[1].verify).toBe('skipped');
    expect(r.workers[1].ok).toBe(false);
    expect(r.workers[1].feedback).toContain('执行失败');
    expect(r.allPassed).toBe(false);
    // synthesizer 仍执行（降级不阻断）
    expect(r.synthesized).toBe('synthesized');
  });

  test('maxConcurrency=1 串行仍产出全部结果', async () => {
    const { executor } = routedExecutor();
    const r = await swarm.run({
      ...baseOptions,
      executor,
      isolation,
      maxConcurrency: 1,
    });
    expect(r.workers.length).toBe(3);
  });

  test('signal 取消：批次间短路，剩余 worker 不再启动且跳过 verifier/synthesizer', async () => {
    const controller = new AbortController();
    const { executor: baseExecutor } = routedExecutor();
    const seen: string[] = [];
    const executor: AgentSwarmOptions['executor'] = async (params) => {
      seen.push(params.userPrompt);
      const output = await baseExecutor(params);
      // 第一个 worker 完成后取消 → 后续批次（含 verifier/synthesizer）不应再启动
      if (seen.length === 1) controller.abort();
      return output;
    };
    const r = await swarm.run({
      ...baseOptions,
      executor,
      isolation,
      maxConcurrency: 1,
      signal: controller.signal,
    });
    // 仅第一个 worker 执行（串行 batchSize=1，第 2 批起被 signal 短路）
    expect(seen.length).toBe(1);
    expect(r.workers.length).toBe(1);
    expect(r.workers[0].output.startsWith('worker-output:')).toBe(true);
    // 取消后跳过 verifier（verify 保持 skipped）与 synthesizer
    expect(r.workers[0].verify).toBe('skipped');
    expect(r.synthesized).toBe('');
  });

  test('enableVerify/enableSynthesize=false：只跑 workers，不调用 verifier/synthesizer', async () => {
    const { executor, calls } = routedExecutor();
    const r = await swarm.run({
      ...baseOptions,
      executor,
      isolation,
      enableVerify: false,
      enableSynthesize: false,
    });
    expect(r.workers.length).toBe(3);
    // 3 次调用 = 仅 workers
    expect(calls.length).toBe(3);
    expect(r.synthesized).toBe('');
    // O4：未启用门禁 ⇒ verify='skipped'（不再是"未启用也记为已通过"），
    // 但 `ok` 不含门禁项 ⇒ 仍为 true（保持"未启用门禁不阻碍交付"）
    expect(r.workers.every((w) => w.verify === 'skipped')).toBe(true);
    expect(r.workers.every((w) => w.ok)).toBe(true);
    expect(r.allPassed).toBe(true);
  });

  test('仅关闭 synthesize：verifier 仍逐 worker 执行', async () => {
    const { executor, calls } = routedExecutor();
    const r = await swarm.run({
      ...baseOptions,
      executor,
      isolation,
      enableSynthesize: false,
    });
    // 3 worker + 3 verifier = 6 次调用（无 synthesizer）
    expect(calls.length).toBe(6);
    expect(r.synthesized).toBe('');
    expect(r.allPassed).toBe(true);
  });

  test('agentType 透传：worker 取任务自身类型，verifier/synthesizer 为固定类型', async () => {
    const seen: Array<string | undefined> = [];
    const executor: AgentSwarmOptions['executor'] = async ({
      userPrompt,
      agentType,
    }) => {
      seen.push(agentType);
      if (userPrompt.includes('你的子任务')) {
        return { output: 'worker-output', ok: true };
      }
      if (userPrompt.includes('worker 输出')) {
        return { output: JSON.stringify({ pass: true }), ok: true };
      }
      return { output: 'synthesized', ok: true };
    };
    const r = await swarm.run({
      ...baseOptions,
      tasks: [
        { id: 'w1', description: '分析需求 A', agentType: 'explore' },
        { id: 'w2', description: '设计模块 B' },
      ],
      executor,
      isolation,
    });
    expect(r.workers.length).toBe(2);
    // 顺序：w1(explore) → w2(undefined，缺省由适配器决定) → verifier ×2 → synthesizer
    expect(seen[0]).toBe('explore');
    expect(seen[1]).toBeUndefined();
    expect(seen.slice(2, 4)).toEqual(['verification', 'verification']);
    expect(seen[4]).toBe('general');
  });
});

describe('AgentSwarm：O4 门禁语义（fail-closed + 正向合取）', () => {
  test('verifier 输出不可解析 ⇒ **判不过**（原实现 fail-open 为通过）', async () => {
    const { executor } = routedExecutor({
      verifyRawText: '我无法给出结论。', // 无 JSON 块
    });
    const r = await swarm.run({ ...baseOptions, executor, isolation });

    expect(r.workers.every((w) => w.verify === 'failed')).toBe(true);
    expect(r.workers[0].feedback).toContain('fail-closed');
    expect(r.allPassed).toBe(false);
  });

  test('verifier 输出缺少布尔 pass ⇒ **判不过**（原实现缺失即视为通过）', async () => {
    const { executor } = routedExecutor({
      verifyRawText: JSON.stringify({ feedback: '看着还行' }),
    });
    const r = await swarm.run({ ...baseOptions, executor, isolation });

    expect(r.workers.every((w) => w.verify === 'failed')).toBe(true);
    expect(r.allPassed).toBe(false);
  });

  test('verifier 自身抛错 ⇒ 该 worker **判不过**（原实现保持已通过）', async () => {
    const executor: AgentSwarmOptions['executor'] = async ({ userPrompt }) => {
      if (userPrompt.includes('你的子任务')) {
        return { output: 'worker-output', ok: true };
      }
      if (userPrompt.includes('worker 输出')) {
        throw new Error('verifier crash');
      }
      return { output: 'synthesized', ok: true };
    };
    const r = await swarm.run({ ...baseOptions, executor, isolation });

    expect(r.workers.every((w) => w.verify === 'failed')).toBe(true);
    expect(r.workers[0].feedback).toContain('verifier 执行失败');
    expect(r.allPassed).toBe(false);
  });

  test('worker 超时 ⇒ success=false（timedOut 为合取项）', async () => {
    const { executor } = routedExecutor({
      workerOk: false,
      workerTimedOut: true,
    });
    const r = await swarm.run({ ...baseOptions, executor, isolation });

    expect(r.workers.every((w) => w.timedOut)).toBe(true);
    expect(r.workers.every((w) => w.success)).toBe(false);
    expect(r.workers.every((w) => w.ok)).toBe(false);
    expect(r.allPassed).toBe(false);
  });

  test('worker 引擎未完成（ok=false）⇒ 不跑门禁且 `ok=false`（合取第一项即已否决）', async () => {
    const { executor } = routedExecutor({ workerOk: false });
    const r = await swarm.run({ ...baseOptions, executor, isolation });

    // 门禁只作用于成功 worker ⇒ 未完成的 worker 保持 skipped
    expect(r.workers.every((w) => w.verify === 'skipped')).toBe(true);
    expect(r.workers.every((w) => w.success)).toBe(false);
    expect(r.workers.every((w) => w.ok)).toBe(false);
    expect(r.allPassed).toBe(false);
  });
});

/**
 * M-13（2026-09-22）：worker 结果**按 task 索引落位**。
 *
 * 修复前 `workerResults.push(...)` 在 `executor` 的 try 内 ⇒ 顺序 = **完成顺序**。
 * 而 `AgentTool.runSwarmPath` 曾用 `workerById.get(t.id) ?? workers[idx]` 兜底，
 * 把"完成顺序数组"当"task 顺序数组"用 ⇒ 任一任务未产出 worker 时**张冠李戴**。
 */
describe('AgentSwarm：M-13 结果按 task 顺序落位', () => {
  const tasks = [
    { id: 't1', description: 'A' },
    { id: 't2', description: 'B' },
    { id: 't3', description: 'C' },
  ];

  test('完成顺序与 task 顺序相反 ⇒ 结果仍按 task 顺序（修复前为完成顺序）', async () => {
    // t1 最慢、t3 最快 ⇒ 完成顺序 t3,t2,t1；索引落位后应仍为 t1,t2,t3
    const delayById: Record<string, number> = { t1: 60, t2: 30, t3: 0 };
    const executor: AgentSwarmOptions['executor'] = async ({ userPrompt }) => {
      const key = userPrompt.match(/你的子任务: (\S+)/)?.[1] ?? '';
      await new Promise((resolve) => setTimeout(resolve, delayById[key] ?? 0));
      return { output: `out-${key}`, ok: true };
    };

    const r = await swarm.run({
      tasks,
      goal: 'g',
      executor,
      isolation,
      maxConcurrency: 3,
      enableVerify: false,
    });

    expect(r.workers.map((w) => w.id)).toEqual(['t1', 't2', 't3']);
    // 输出与 id 一一对应（无张冠李戴）—— 提示词里带的子任务文本是 `description`
    expect(r.workers.map((w) => w.output)).toEqual(['out-A', 'out-B', 'out-C']);
  });

  test('取消后未投递的任务不产出 worker（缺位即缺席，不占位错配）', async () => {
    const wideTasks = [
      { id: 't1', description: 'A' },
      { id: 't2', description: 'B' },
      { id: 't3', description: 'C' },
    ];
    const ac = new AbortController();
    const executor: AgentSwarmOptions['executor'] = async ({ userPrompt }) => {
      const key = userPrompt.match(/你的子任务: (\S+)/)?.[1] ?? '';
      // 首个 worker 完成时即取消批次（`runBatched` 下一次批次检查短路）
      ac.abort();
      return { output: `out-${key}`, ok: true };
    };

    const r = await swarm.run({
      tasks: wideTasks,
      goal: 'g',
      executor,
      isolation,
      maxConcurrency: 1,
      signal: ac.signal,
      enableVerify: false,
    });

    expect(r.cancelled).toBe(true);
    expect(r.workers.length).toBeLessThan(wideTasks.length);
    // 已产出部分仍是 task 顺序的**子序列**（索引落位 ⇒ 不会错配）
    const produced = r.workers.map((w) => w.id);
    expect(produced).toEqual(
      wideTasks.map((t) => t.id).filter((id) => produced.includes(id))
    );
    // 缺失的 id 可被调用方识别（⇒ `AgentTool` 侧标注"未执行"）
    expect(produced).not.toContain('t3');
  });
});

/**
 * M-8（2026-09-22）：worker **真实用量汇总**（喂给任务级预算 / `TaskGoalStore`）。
 */
describe('AgentSwarm：M-8 worker 用量汇总', () => {
  const tokensTasks = [
    { id: 't1', description: 'A' },
    { id: 't2', description: 'B' },
  ];

  test('executor 提供 tokens ⇒ 汇总到 totalTokens', async () => {
    const executor: AgentSwarmOptions['executor'] = async () => ({
      output: 'o',
      ok: true,
      tokens: 120,
    });
    const r = await swarm.run({
      tasks: tokensTasks,
      goal: 'g',
      executor,
      isolation,
      maxConcurrency: 2,
      enableVerify: false,
    });
    expect(r.totalTokens).toBe(240);
  });

  test('executor 未提供 tokens ⇒ 0（**不估算**）', async () => {
    const executor: AgentSwarmOptions['executor'] = async () => ({
      output: 'o',
      ok: true,
    });
    const r = await swarm.run({
      tasks: tokensTasks,
      goal: 'g',
      executor,
      isolation,
      maxConcurrency: 2,
      enableVerify: false,
    });
    expect(r.totalTokens).toBe(0);
  });

  test('失败 worker 的用量同样计入（用了就是用了）', async () => {
    const executor: AgentSwarmOptions['executor'] = async () => ({
      output: '',
      ok: false,
      tokens: 40,
    });
    const r = await swarm.run({
      tasks: tokensTasks,
      goal: 'g',
      executor,
      isolation,
      maxConcurrency: 2,
      enableVerify: false,
    });
    expect(r.totalTokens).toBe(80);
    expect(r.allPassed).toBe(false);
  });
});

/** 契约守卫：executor 返回值形状（防止回退为"只回文本"） */
describe('SwarmExecutor 契约（O4）', () => {
  test('返回值必须是 { output, ok, timedOut? }', async () => {
    const { executor } = routedExecutor();
    const res: SwarmExecutorResult = await executor({
      systemPrompt: 's',
      userPrompt: '你的子任务: x',
      tools: [],
    });

    expect(typeof res.output).toBe('string');
    expect(typeof res.ok).toBe('boolean');
  });
});

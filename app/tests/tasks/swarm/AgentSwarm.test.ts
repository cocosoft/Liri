/**
 * AgentSwarm 多代理并行编排测试（P1-6，对标 Hermes kanban_swarm create_swarm）
 *
 * 覆盖：
 * - 并行 workers 全部执行（每个子任务产出独立结果）
 * - verifier 门禁：失败 worker 被标记 verified=false
 * - synthesizer 合成全部结果
 * - worker 抛错降级：verified=false + allPassed=false，不阻断整体
 */
import { describe, test, expect } from 'bun:test';
import { AgentSwarm } from '../../../src/tasks/swarm/AgentSwarm';
import type { AgentSwarmOptions } from '../../../src/tasks/swarm/AgentSwarm';
import type { AgentIsolation } from '@modules/agent';

const swarm = new AgentSwarm();

const isolation = {
  abortController: new AbortController(),
} as unknown as AgentIsolation;

/** 按 userPrompt 内容路由的 fake executor（worker / verifier / synthesizer） */
function routedExecutor(options: { verifyPass?: boolean } = {}) {
  const calls: string[] = [];
  const executor: AgentSwarmOptions['executor'] = async ({ userPrompt }) => {
    calls.push(userPrompt.slice(0, 30));
    if (userPrompt.includes('你的子任务')) {
      const m = userPrompt.match(/你的子任务: (.+)/);
      return `worker-output:${m?.[1]?.slice(0, 10) ?? '?'}`;
    }
    if (userPrompt.includes('worker 输出')) {
      return JSON.stringify({
        pass: options.verifyPass ?? true,
        feedback: options.verifyPass === false ? '不通过' : '通过',
      });
    }
    if (userPrompt.includes('worker 结果汇总')) {
      return 'synthesized-final-report';
    }
    return 'unknown';
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
    // 每个 worker 都有独立输出
    expect(r.workers.every((w) => w.output.startsWith('worker-output:'))).toBe(
      true
    );
    expect(r.workers.every((w) => w.verified)).toBe(true);
    expect(r.synthesized).toBe('synthesized-final-report');
    expect(r.allPassed).toBe(true);
    // 3 worker + 3 verifier + 1 synthesizer = 7 次 executor 调用
    expect(calls.length).toBe(7);
  });

  test('verifier 门禁：失败 worker 被标记 verified=false', async () => {
    const { executor } = routedExecutor({ verifyPass: false });
    const r = await swarm.run({ ...baseOptions, executor, isolation });
    expect(r.workers.every((w) => w.verified)).toBe(false);
    expect(r.workers.every((w) => w.feedback === '不通过')).toBe(true);
    expect(r.allPassed).toBe(false);
  });

  test('worker 抛错降级：verified=false 且不阻断整体', async () => {
    let count = 0;
    const executor: AgentSwarmOptions['executor'] = async ({ userPrompt }) => {
      if (userPrompt.includes('你的子任务') && ++count === 2) {
        throw new Error('worker crash');
      }
      if (userPrompt.includes('worker 输出')) {
        return JSON.stringify({ pass: true });
      }
      if (userPrompt.includes('worker 结果汇总')) {
        return 'synthesized';
      }
      return 'ok';
    };
    const r = await swarm.run({ ...baseOptions, executor, isolation });
    expect(r.workers.length).toBe(3);
    // 崩溃的 worker（第二个）被标记未通过
    expect(r.workers[1].verified).toBe(false);
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
});

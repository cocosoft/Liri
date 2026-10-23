/**
 * AgentSwarm 会话级并发批次键（2026-10-21，外部建议「ACP 会话级并发批次键」）
 *
 * 锁四件事：
 *  ① 每次 `run()` 自动生成唯一 `swarmSessionId`（两次 run 不同）；
 *  ② 外部传入时**原样使用**（恢复/重放场景）；
 *  ③ `SWARM_DISPATCH` / `SWARM_COMPLETE` 事件载荷携带**同一个**键（配对可归属）；
 *  ④ 并发两个批次时键互不污染；
 *  ⑤ 严格闭合：主体抛错时 `SWARM_COMPLETE` 仍发射（`errored` 布尔标记），不留孤儿 dispatch。
 *
 * 如实说明：本仓 SWARM_* 事件走 `OrchestrationEventType`（不是 ACP 帧），
 * 故批次键落在**事件载荷**上；`orchestrationPairing.ts` 据此按批次配对。
 */
import { describe, it, expect, spyOn, afterEach } from 'bun:test';

import { AgentSwarm } from '../../../src/tasks/swarm/AgentSwarm';
import type { AgentSwarmOptions } from '../../../src/tasks/swarm/AgentSwarm';
import { getOrchestrationMetrics } from '@modules/core/events/OrchestrationMetrics';
import { OrchestrationEventType } from '../../../src/types/orchestrationEvents';

const swarm = new AgentSwarm();

function baseOptions(over: Partial<AgentSwarmOptions> = {}): AgentSwarmOptions {
  return {
    tasks: [{ id: 't1', description: '分析文件' }],
    goal: '测试目标',
    executor: async () => ({ output: 'ok', ok: true, timedOut: false }),
    enableVerify: false,
    enableSynthesize: false,
    ...over,
  };
}

const metrics = getOrchestrationMetrics();
let spy: ReturnType<typeof spyOn> | null = null;

afterEach(() => {
  spy?.mockRestore();
  spy = null;
});

describe('AgentSwarm 批次键：生成与透传', () => {
  it('两次 run 生成不同且非空的 swarmSessionId', async () => {
    const a = await swarm.run(baseOptions());
    const b = await swarm.run(baseOptions());
    expect(a.swarmSessionId.length).toBeGreaterThan(0);
    expect(b.swarmSessionId.length).toBeGreaterThan(0);
    expect(a.swarmSessionId).not.toBe(b.swarmSessionId);
  });

  it('外部传入 ⇒ 原样使用（不再生成）', async () => {
    const r = await swarm.run(
      baseOptions({ swarmSessionId: 'swarm_external_1' })
    );
    expect(r.swarmSessionId).toBe('swarm_external_1');
  });
});

describe('AgentSwarm 批次键：事件载荷', () => {
  it('SWARM_DISPATCH 与 SWARM_COMPLETE 携带同一键', async () => {
    spy = spyOn(metrics, 'recordEvent');
    const r = await swarm.run(baseOptions());

    const calls = spy.mock.calls as unknown as Array<
      [string, unknown, unknown]
    >;
    const dispatch = calls.find(
      (c) => c[0] === OrchestrationEventType.SWARM_DISPATCH
    );
    const complete = calls.find(
      (c) => c[0] === OrchestrationEventType.SWARM_COMPLETE
    );

    expect(dispatch).toBeDefined();
    expect(complete).toBeDefined();
    expect((dispatch![2] as { swarmSessionId: string }).swarmSessionId).toBe(
      r.swarmSessionId
    );
    expect((complete![2] as { swarmSessionId: string }).swarmSessionId).toBe(
      r.swarmSessionId
    );
    // 收尾事件用布尔字段（passedAll / aborted），不含状态字面量
    expect((complete![2] as { passedAll: boolean }).passedAll).toBe(true);
    expect((complete![2] as { aborted: boolean }).aborted).toBe(false);
  });

  it('并发两个批次 ⇒ 键互不污染，事件各自归属', async () => {
    spy = spyOn(metrics, 'recordEvent');
    const [a, b] = await Promise.all([
      swarm.run(baseOptions({ swarmSessionId: 'swarm_A' })),
      swarm.run(baseOptions({ swarmSessionId: 'swarm_B' })),
    ]);

    expect(a.swarmSessionId).toBe('swarm_A');
    expect(b.swarmSessionId).toBe('swarm_B');

    const calls = spy.mock.calls as unknown as Array<
      [string, unknown, unknown]
    >;
    const keys = calls
      .filter(
        (c) =>
          c[0] === OrchestrationEventType.SWARM_DISPATCH ||
          c[0] === OrchestrationEventType.SWARM_COMPLETE
      )
      .map((c) => (c[2] as { swarmSessionId: string }).swarmSessionId);
    expect(keys.filter((k) => k === 'swarm_A')).toHaveLength(2);
    expect(keys.filter((k) => k === 'swarm_B')).toHaveLength(2);
  });
});

describe('AgentSwarm 严格闭合：异常路径', () => {
  it('主体抛错 ⇒ SWARM_COMPLETE 仍发射（同键 + errored 布尔标记）', async () => {
    spy = spyOn(metrics, 'recordEvent');
    // 故障注入：`description` getter 在 dispatch 之后（黑板拼装时）抛错，
    // 模拟"dispatch 与 complete 之间任何未来改动/意外抛出" ⇒ 配对不得成孤儿。
    const hostileTask = {
      id: 't1',
      get description(): string {
        throw new Error('boom');
      },
    };
    await expect(
      swarm.run(baseOptions({ tasks: [hostileTask] }))
    ).rejects.toThrow('boom');

    const calls = spy.mock.calls as unknown as Array<
      [string, unknown, unknown]
    >;
    const dispatch = calls.find(
      (c) => c[0] === OrchestrationEventType.SWARM_DISPATCH
    );
    const complete = calls.find(
      (c) => c[0] === OrchestrationEventType.SWARM_COMPLETE
    );
    expect(dispatch).toBeDefined();
    expect(complete).toBeDefined();
    const key = (dispatch![2] as { swarmSessionId: string }).swarmSessionId;
    expect((complete![2] as { swarmSessionId: string }).swarmSessionId).toBe(
      key
    );
    const payload = complete![2] as {
      errored?: boolean;
      passedAll: boolean;
      aborted: boolean;
      workerCount: number;
    };
    expect(payload.errored).toBe(true);
    expect(payload.passedAll).toBe(false);
    expect(payload.workerCount).toBe(0);
  });

  it('正常路径 ⇒ COMPLETE 载荷不含 errored 字段（零行为变更）', async () => {
    spy = spyOn(metrics, 'recordEvent');
    await swarm.run(baseOptions());
    const calls = spy.mock.calls as unknown as Array<
      [string, unknown, unknown]
    >;
    const complete = calls.find(
      (c) => c[0] === OrchestrationEventType.SWARM_COMPLETE
    );
    expect(complete).toBeDefined();
    expect('errored' in (complete![2] as object)).toBe(false);
  });
});

/**
 * N-17（2026-11-07 真机）：审批续跑的同会话**在飞合并**。
 *
 * 实证（`session_mw553loec71420aeaa` 15:50:34）：连续批准多张卡时，每张卡各触发一次续跑；
 * 竞态窗口内多者同时通过「会话空闲」检查 ⇒ `SimpleMutex: acquire timeout after 30000ms`
 * ⇒「审批后自动续跑失败（前端可兜底续跑）」，且每次失败空等 30s。
 */
import { describe, expect, it } from 'bun:test';

import { createResumeCoalescer } from '@openliri/service/runtime/resumeCoalescer';

/** 可控的 runOnce：手动 resolve 每个在飞 Promise */
function makeControlled() {
  const started: string[] = [];
  const resolvers: Array<() => void> = [];
  const runOnce = (sessionId: string): Promise<void> => {
    started.push(sessionId);
    return new Promise<void>((resolve) => {
      resolvers.push(() => resolve());
    });
  };
  return {
    runOnce,
    started,
    /** 结束当前最早的在飞轮 */
    finishOne: () => resolvers.shift()?.(),
    finishAll: () => {
      while (resolvers.length > 0) resolvers.shift()?.();
    },
  };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('createResumeCoalescer（N-17）', () => {
  it('同一会话并发触发 ⇒ 只跑一轮，结束后补跑一次', async () => {
    const c = makeControlled();
    const trigger = createResumeCoalescer(c.runOnce);

    const p1 = trigger('s1');
    const p2 = trigger('s1');
    const p3 = trigger('s1');
    await tick();
    expect(c.started).toEqual(['s1']); // 只起了一轮
    expect(trigger.inFlightCount()).toBe(1);

    c.finishOne(); // 第一轮结束 ⇒ 有 again ⇒ 补跑一次
    await tick();
    expect(c.started).toEqual(['s1', 's1']);

    c.finishAll();
    await Promise.all([p1, p2, p3]);
    expect(c.started).toHaveLength(2);
    expect(trigger.inFlightCount()).toBe(0);
  });

  it('不同会话互不阻塞', async () => {
    const c = makeControlled();
    const trigger = createResumeCoalescer(c.runOnce);

    const p1 = trigger('s1');
    const p2 = trigger('s2');
    await tick();
    expect(c.started).toEqual(['s1', 's2']);
    expect(trigger.inFlightCount()).toBe(2);

    c.finishAll();
    await Promise.all([p1, p2]);
    expect(trigger.inFlightCount()).toBe(0);
  });

  it('串行触发（上一轮已结束）⇒ 每轮都真实执行（不合并）', async () => {
    let runs = 0;
    const trigger = createResumeCoalescer(async () => {
      runs += 1;
    });
    await trigger('s1');
    await trigger('s1');
    expect(runs).toBe(2);
  });

  it('runOnce 抛错 ⇒ 仍释放在飞槽位（后续触发可重新执行）', async () => {
    let calls = 0;
    const trigger = createResumeCoalescer(async () => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
    });
    await expect(trigger('s1')).rejects.toThrow('boom');
    expect(trigger.inFlightCount()).toBe(0);
    await trigger('s1');
    expect(calls).toBe(2);
  });
});

// MIT License
// Copyright (c) 2026 190615273@qq.com
/**
 * P26-1 §9.4 超限**排队**（D7=b；超时按裁定 **D12「告警 + 放行」**）守卫（2026-10-07）
 *
 * 背景：抢占（§9.2）之后，**超限但无可抢占候选**（例如同优先级、或请求者优先级更低）时按
 * D7=b **排队等待名额**：`release()` 每次**移交一个**名额；等待超时 ⇒ **告警 + 放行**（不拒绝）。
 *
 * 本守卫锁五件事：
 *   ① 未超限 ⇒ **不排队**、立即返回；
 *   ② 超限无可抢占 ⇒ 入队挂起，`release()` 唤醒；
 *   ③ 唤醒顺序 = **优先级降序**（同级 FIFO）；
 *   ④ **超时 ⇒ 告警 + 放行**（不拒绝；队列归零）；
 *   ⑤ 开关关闭 ⇒ 零行为变更（不排队、`queueLength()` 恒 0）。
 */
import { afterEach, describe, expect, it } from 'bun:test';

import { ResourceGovernor } from '../../src/resourceGovernor/index';

const ENV = 'FEATURE_RESOURCE_GOVERNOR';
const ORIGINAL = process.env[ENV];

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env[ENV];
  else process.env[ENV] = ORIGINAL;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('acquire：排队等待名额（D7=b）', () => {
  it('① 未超限 ⇒ 不排队，立即返回', async () => {
    process.env[ENV] = 'true';
    const gov = new ResourceGovernor({ maxInflight: 2 });
    const d = await gov.acquire(
      { sessionId: 's1', priority: 'interactive' },
      { timeoutMs: 2000 }
    );
    expect(d.overLimit).toBe(false);
    expect(gov.queueLength()).toBe(0);
  });

  it('② 超限且无可抢占 ⇒ 入队挂起，release 移交后唤醒', async () => {
    process.env[ENV] = 'true';
    const gov = new ResourceGovernor({ maxInflight: 1 });
    gov.admit({ sessionId: 'a', priority: 'interactive' });

    let resolved = false;
    const pending = gov
      .acquire({ sessionId: 'b', priority: 'background' }, { timeoutMs: 2000 })
      .then(() => {
        resolved = true;
      });

    await sleep(10);
    expect(resolved).toBe(false);
    expect(gov.queueLength()).toBe(1);

    gov.release('a');
    await pending;
    expect(resolved).toBe(true);
    expect(gov.queueLength()).toBe(0);
  });

  it('③ 唤醒顺序 = 优先级降序（background 先入队，interactive 后入队先醒）', async () => {
    process.env[ENV] = 'true';
    const gov = new ResourceGovernor({ maxInflight: 1 });
    gov.admit({ sessionId: 'a', priority: 'interactive' });

    const order: string[] = [];
    const bg = gov
      .acquire(
        { sessionId: 'bg-job', priority: 'background' },
        { timeoutMs: 2000 }
      )
      .then(() => order.push('bg'));
    await sleep(10);

    const ui = gov
      .acquire(
        { sessionId: 'user-ui', priority: 'interactive' },
        { timeoutMs: 2000 }
      )
      .then(() => order.push('ui'));
    await sleep(10);
    expect(gov.queueLength()).toBe(2);

    gov.release('a'); // 移交 1 个名额 ⇒ 应给优先级更高的 ui
    await ui;
    expect(order).toEqual(['ui']);

    gov.release('user-ui'); // 再移交 ⇒ 轮到位次最低的 bg
    await bg;
    expect(order).toEqual(['ui', 'bg']);
  });

  it('④ 等待超时 ⇒ 告警 + 放行（不拒绝），队列归零', async () => {
    process.env[ENV] = 'true';
    const gov = new ResourceGovernor({ maxInflight: 1 });
    gov.admit({ sessionId: 'a', priority: 'interactive' });

    const startedAt = Date.now();
    const d = await gov.acquire(
      { sessionId: 'b', priority: 'background' },
      { timeoutMs: 20 }
    );

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(15);
    expect(d.admitted).toBe(true); // D12：超时也放行
    expect(gov.queueLength()).toBe(0);
  });

  it('幂等：同 sessionId 重复 acquire 不重复入队', async () => {
    process.env[ENV] = 'true';
    const gov = new ResourceGovernor({ maxInflight: 1 });
    gov.admit({ sessionId: 'a', priority: 'interactive' });

    const first = gov.acquire(
      { sessionId: 'b', priority: 'background' },
      { timeoutMs: 2000 }
    );
    await sleep(10);
    const second = gov.acquire(
      { sessionId: 'b', priority: 'background' },
      { timeoutMs: 2000 }
    );
    await sleep(10);

    expect(gov.queueLength()).toBe(1);
    gov.release('a');
    await Promise.all([first, second]);
  });
});

describe('acquire：开关关闭 ⇒ 排队零行为变更（默认关）', () => {
  it('立即返回、不排队、queueLength 恒 0', async () => {
    delete process.env[ENV];
    const gov = new ResourceGovernor({ maxInflight: 1 });

    gov.admit({ sessionId: 'a', priority: 'interactive' });
    const startedAt = Date.now();
    const d = await gov.acquire(
      { sessionId: 'b', priority: 'background' },
      { timeoutMs: 1000 }
    );

    expect(Date.now() - startedAt).toBeLessThan(100);
    expect(d.overLimit).toBe(false);
    expect(d.preempted).toEqual([]);
    expect(gov.queueLength()).toBe(0);
  });
});

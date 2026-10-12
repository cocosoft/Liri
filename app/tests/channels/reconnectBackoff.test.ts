/**
 * 通道重连**退避重试**（通道治理 阶段 1.4，2026-10-12）。
 *
 * 目标：出站投递前若"通道未连接"，重连不再**只试一次**，而是复用项目标准重试
 * `utils/withRetry`（指数退避 + 0–30% jitter）**有界重试**；失败**只影响本次投递**
 * （由 `_prepareChannel` 转成 `DeliveryResult{success:false}`），不影响主任务状态。
 *
 * 本用例以**注入短退避**（5ms/20ms）验证重试语义，保持离线、快速、确定。
 */
import { describe, expect, it } from 'bun:test';
import { reconnectWithBackoff } from '../../src/channels/DeliveryRouter.js';

/** 短退避：maxRetries=2 ⇒ 最多 3 次尝试，总等待 < 100ms */
const FAST = { maxRetries: 2, initialDelayMs: 5, maxDelayMs: 20 };

describe('通道重连退避（阶段 1.4）', () => {
  it('先失败后成功 ⇒ 重试至成功，尝试次数 = 失败次数 + 1', async () => {
    let attempts = 0;
    const ok = await reconnectWithBackoff(async () => {
      attempts += 1;
      return attempts >= 3; // 第 3 次才成功
    }, FAST);

    expect(ok).toBe(true);
    expect(attempts).toBe(3);
  });

  it('始终返回 false ⇒ 重试耗尽后抛出（有界，不无限重试）', async () => {
    let attempts = 0;
    await expect(
      reconnectWithBackoff(async () => {
        attempts += 1;
        return false;
      }, FAST)
    ).rejects.toThrow(/重连返回失败/);

    expect(attempts).toBe(3); // maxRetries=2 ⇒ 共 3 次
  });

  it('抛可重试的网络错误 ⇒ 同样重试到上限后抛出', async () => {
    let attempts = 0;
    await expect(
      reconnectWithBackoff(async () => {
        attempts += 1;
        throw new Error('ECONNRESET');
      }, FAST)
    ).rejects.toThrow();

    expect(attempts).toBe(3);
  });

  it('首次即成功 ⇒ 只尝试 1 次（零多余等待）', async () => {
    let attempts = 0;
    const ok = await reconnectWithBackoff(async () => {
      attempts += 1;
      return true;
    }, FAST);

    expect(ok).toBe(true);
    expect(attempts).toBe(1);
  });
});

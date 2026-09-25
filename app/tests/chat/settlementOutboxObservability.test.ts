/**
 * P1-5（2026-09-25）：结算 outbox 的**上限收敛出口必须可观测**。
 *
 * 修复前：`dropped` 是真实状态（超重试上限时确实落库），但**无日志、无计数、无消费方**
 * —— `prune()` 的删除行数返回值无人使用 ⇒ "是否有结算信号被永久放弃""保留上限是否生效"
 * 在巡检中完全不可见（对标分析报告 §五 P1-5）。
 *
 * 现给出两个观测出口：① `markDropped`/`prune` 的 WARN/INFO 日志（运行时）；
 * ② `getStateCounts()` 各状态计数（可被巡检直接采集）。本文件锁定 ② 与其行为；
 * ① 属日志侧（不在此断言，避免依赖 logger mock 的脆弱装置）。
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync } from 'fs';
import {
  SettlementOutbox,
  MAX_DELIVERY_ATTEMPTS,
  OUTBOX_MAX_AGE_MS,
  type DeliveryState,
} from '../../src/chat/yield/SettlementOutbox';

const createdPaths: string[] = [];
const opened: SettlementOutbox[] = [];

async function makeOutbox(): Promise<SettlementOutbox> {
  const path = join(tmpdir(), `outbox-obs-${randomUUID().slice(0, 8)}.db`);
  createdPaths.push(path);
  const outbox = new SettlementOutbox(path);
  opened.push(outbox);
  await outbox.init();
  return outbox;
}

function totalOf(counts: Record<DeliveryState, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

afterEach(() => {
  while (opened.length > 0) opened.pop()!.close();
  while (createdPaths.length > 0) {
    try {
      unlinkSync(createdPaths.pop()!);
    } catch {
      // @ignore-catch — 清理临时文件失败不影响断言
    }
  }
});

describe('SettlementOutbox 观测出口（P1-5）', () => {
  test('超重试上限转 dropped ⇒ 计数可见（修复前无任何可采集口径）', async () => {
    const outbox = await makeOutbox();
    const id = await outbox.enqueue({ sessionId: 's-obs', endedAt: 100 });

    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i++) {
      expect(await outbox.claim(id)).not.toBeNull();
      if (i < MAX_DELIVERY_ATTEMPTS - 1) {
        await outbox.markFailed(id, '未获 ack');
      }
    }
    // 第 MAX+1 次认领 ⇒ 超限转 dropped
    expect(await outbox.claim(id)).toBeNull();
    expect((await outbox.getRow(id))?.state).toBe('dropped');

    const counts = await outbox.getStateCounts();
    // 修复前没有该口径 ⇒ 丢弃量无法被巡检采集 ⇒ 本断言不成立
    expect(counts.dropped).toBe(1);
    expect(counts.pending + counts.attempting + counts.failed).toBe(0);
    expect(totalOf(counts)).toBe(1);
  });

  test('保留裁剪 ⇒ 删除行数可采集（修复前 prune 返回值无消费方）', async () => {
    const outbox = await makeOutbox();
    await outbox.enqueue({ sessionId: 's-prune', endedAt: 100 });
    expect(totalOf(await outbox.getStateCounts())).toBe(1);

    const removed = await outbox.prune(Date.now() + OUTBOX_MAX_AGE_MS + 1000);
    expect(removed).toBeGreaterThanOrEqual(1);
    // 裁剪后计数归零 ⇒ "上限是否在生效"可被直接观测
    expect(totalOf(await outbox.getStateCounts())).toBe(0);
  });

  test('正常投递不产生 dropped（观测口径不误报）', async () => {
    const outbox = await makeOutbox();
    const id = await outbox.enqueue({ sessionId: 's-ok', endedAt: 100 });
    await outbox.claim(id);
    await outbox.markDelivered(id);

    const counts = await outbox.getStateCounts();
    expect(counts.delivered).toBe(1);
    expect(counts.dropped).toBe(0);
  });
});

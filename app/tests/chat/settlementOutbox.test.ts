/**
 * SettlementOutbox 测试（多 agent 协作方案 O8）
 *
 * 锁定投递状态机与回放约束：
 * `pending → attempting → delivered`（+ `failed`/`dropped`）、入队幂等、
 * 重试上限（超限 ⇒ 转 dropped 且不再被回放）、48h 回放年龄、`restored` 标记、保留裁剪。
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync } from 'fs';
import {
  SettlementOutbox,
  MAX_DELIVERY_ATTEMPTS,
  REPLAY_MAX_AGE_MS,
  OUTBOX_MAX_AGE_MS,
} from '../../src/chat/yield/SettlementOutbox';

const createdPaths: string[] = [];
const opened: SettlementOutbox[] = [];

async function makeOutbox(): Promise<SettlementOutbox> {
  const path = join(tmpdir(), `outbox-${randomUUID().slice(0, 8)}.db`);
  createdPaths.push(path);
  const outbox = new SettlementOutbox(path);
  opened.push(outbox);
  await outbox.init();
  return outbox;
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

describe('SettlementOutbox：投递状态机（O8 ①②③）', () => {
  test('入队 ⇒ pending；claim ⇒ attempting（attempts 累加）；ack ⇒ delivered', async () => {
    const outbox = await makeOutbox();
    const id = await outbox.enqueue({ sessionId: 's1', endedAt: 100 });
    expect((await outbox.getRow(id))?.state).toBe('pending');

    const claimed = await outbox.claim(id);
    expect(claimed?.state).toBe('attempting');
    expect(claimed?.attempts).toBe(1);

    await outbox.markDelivered(id);
    const delivered = await outbox.getRow(id);
    expect(delivered?.state).toBe('delivered');
    // 已投递不再被回放
    expect(await outbox.listReplayable()).toHaveLength(0);
  });

  test('入队幂等：同 (sessionId, endedAt) 重复入队不新增行', async () => {
    const outbox = await makeOutbox();
    const first = await outbox.enqueue({ sessionId: 's1', endedAt: 100 });
    const second = await outbox.enqueue({ sessionId: 's1', endedAt: 100 });

    expect(second).toBe(first);
    expect(await outbox.listAll()).toHaveLength(1);
  });

  test('失败可再 claim 重试；超上限 ⇒ 转 `dropped` 且不再被回放', async () => {
    const outbox = await makeOutbox();
    const id = await outbox.enqueue({ sessionId: 's1', endedAt: 100 });

    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i++) {
      expect(await outbox.claim(id)).not.toBeNull();
    }
    // 第 MAX+1 次：claim 拒绝并落 dropped
    expect(await outbox.claim(id)).toBeNull();
    expect((await outbox.getRow(id))?.state).toBe('dropped');
    expect(await outbox.listReplayable()).toHaveLength(0);
  });

  test('markFailed 后仍可回放（区别于 dropped）', async () => {
    const outbox = await makeOutbox();
    const id = await outbox.enqueue({ sessionId: 's1', endedAt: 100 });
    await outbox.claim(id);
    await outbox.markFailed(id, 'ack 失败');

    const replayable = await outbox.listReplayable();
    expect(replayable).toHaveLength(1);
    expect(replayable[0].state).toBe('failed');
    expect(replayable[0].lastError).toBe('ack 失败');
  });
});

describe('SettlementOutbox：回放约束与保留（O8 ④⑤⑥）', () => {
  test('④ 超过 48h 的行不再回放', async () => {
    const outbox = await makeOutbox();
    await outbox.enqueue({ sessionId: 's1', endedAt: 100 });

    expect(await outbox.listReplayable()).toHaveLength(1);
    // 把"现在"推到 48h 之后 ⇒ 该行超龄
    expect(
      await outbox.listReplayable(Date.now() + REPLAY_MAX_AGE_MS + 1000)
    ).toHaveLength(0);
  });

  test('⑤ `restored` 标记随入队落库（供重投带可见标记）', async () => {
    const outbox = await makeOutbox();
    const id = await outbox.enqueue({
      sessionId: 's1',
      endedAt: 100,
      restored: true,
    });

    expect((await outbox.getRow(id))?.restored).toBe(true);
  });

  test('⑥ 保留裁剪：7 天前的行被删除', async () => {
    const outbox = await makeOutbox();
    await outbox.enqueue({ sessionId: 's1', endedAt: 100 });
    expect(await outbox.listAll()).toHaveLength(1);

    const removed = await outbox.prune(Date.now() + OUTBOX_MAX_AGE_MS + 1000);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await outbox.listAll()).toHaveLength(0);
  });
});

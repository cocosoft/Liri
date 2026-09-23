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
import { Database } from '@modules/core/external/sqlite3';
import {
  SettlementOutbox,
  MAX_DELIVERY_ATTEMPTS,
  REPLAY_MAX_AGE_MS,
  OUTBOX_MAX_AGE_MS,
  CLAIM_STALE_MS,
  SETTLEMENT_OUTBOX_TABLE,
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

  test('并发入队同一 (sessionId, endedAt) ⇒ 全部拿到同一 id 且只落一行（修复前：双行 + 身份错乱）', async () => {
    const outbox = await makeOutbox();
    // 8 路并发同键入队。**修复前**为"先查后插"两段式：并发下各自查到"无未终结行"
    // ⇒ 各自 INSERT（多行）；且随后的 `ORDER BY id DESC LIMIT 1` 回读可能让多个调用方
    // 拿到**同一** id（另一行成孤儿，重放锚点/审计粒度失真）。
    // 现由 DB 级部分唯一索引 `idx_settlement_outbox_live` 保证不变式 ⇒ 第二个 INSERT
    // 被拒 ⇒ 走幂等回读。
    const ids = await Promise.all(
      Array.from({ length: 8 }, () =>
        outbox.enqueue({ sessionId: 's-conc', endedAt: 777 })
      )
    );

    expect(new Set(ids).size).toBe(1); // 身份唯一：所有调用方拿到同一 id
    expect(await outbox.listAll()).toHaveLength(1); // 不变式：只落一行未终结
  });

  test('失败可再 claim 重试；超上限 ⇒ 转 `dropped` 且不再被回放', async () => {
    const outbox = await makeOutbox();
    const id = await outbox.enqueue({ sessionId: 's1', endedAt: 100 });

    // M-3（2026-09-22）：`claim` 现为**单胜者条件更新** —— 同一行在"陈旧窗口内"
    // 不可重复认领（防运行期投递与回放在飞时双投）。真实的"可重试"生命周期是
    // `claim → 投递未获 ack ⇒ markFailed → 再 claim`，故两次认领之间显式落 `failed`。
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i++) {
      expect(await outbox.claim(id)).not.toBeNull();
      if (i < MAX_DELIVERY_ATTEMPTS - 1) {
        await outbox.markFailed(id, '未获 ack');
      }
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

/**
 * M-3（2026-09-22）：原子认领 / 单向状态机 / 幂等键口径 / init 失败可重试。
 *
 * 均为"**修复前必失败**"型：
 * - 并发 claim：修复前 `getRow → UPDATE` 两段式 ⇒ 两个都成功、attempts 变 2；
 * - 状态机：修复前 `markDelivered/markDropped` 是无条件 UPDATE ⇒ 终态可被改写；
 * - 幂等键：修复前不区分 state ⇒ 已 dropped 的同键结算被合并进旧行；
 * - init：修复前 rejected promise 被复用 ⇒ 目录补齐后仍永久失败。
 */
describe('SettlementOutbox：M-3 原子认领 / 单向状态机 / 幂等键口径', () => {
  test('并发 claim 只有一个成功，且 attempts 只 +1', async () => {
    const outbox = await makeOutbox();
    const id = await outbox.enqueue({ sessionId: 's1', endedAt: 1 });

    const [a, b] = await Promise.all([outbox.claim(id), outbox.claim(id)]);
    expect([a, b].filter((r) => r !== null)).toHaveLength(1);
    const row = await outbox.getRow(id);
    expect(row?.attempts).toBe(1);
    expect(row?.state).toBe('attempting');
  });

  test('陈旧窗口内不可再次认领（防同一信号被投递两次）', async () => {
    const outbox = await makeOutbox();
    const id = await outbox.enqueue({ sessionId: 's1', endedAt: 1 });

    expect(await outbox.claim(id)).not.toBeNull();
    expect(await outbox.claim(id)).toBeNull();
    expect((await outbox.getRow(id))?.attempts).toBe(1);
  });

  test('超过陈旧窗口 ⇒ 允许自愈重投（attempting 行不会永久卡死）', async () => {
    const path = join(tmpdir(), `outbox-stale-${randomUUID().slice(0, 8)}.db`);
    createdPaths.push(path);
    const outbox = new SettlementOutbox(path);
    opened.push(outbox);
    await outbox.init();
    const id = await outbox.enqueue({ sessionId: 's1', endedAt: 1 });
    await outbox.claim(id);
    // 关连接 → 回拨 `updated_at` 到窗口之外（模拟"进程在投递中崩溃"）→ 再认领
    outbox.close();
    const db = new Database(path);
    await new Promise<void>((resolve, reject) => {
      db.run(
        `UPDATE ${SETTLEMENT_OUTBOX_TABLE} SET updated_at = ? WHERE id = ?`,
        [Date.now() - CLAIM_STALE_MS - 1000, id],
        (err: Error | null) => (err ? reject(err) : resolve())
      );
    });
    db.close();

    const reClaimed = await outbox.claim(id);
    expect(reClaimed).not.toBeNull();
    expect(reClaimed?.attempts).toBe(2);
  });

  test('单向状态机：终态不可改写（delivered 不被 dropped 覆盖，反之亦然）', async () => {
    const outbox = await makeOutbox();
    const a = await outbox.enqueue({ sessionId: 's1', endedAt: 1 });
    await outbox.claim(a);
    expect(await outbox.markDelivered(a)).toBe(true);
    expect(await outbox.markDropped(a, '不该生效')).toBe(false);
    expect((await outbox.getRow(a))?.state).toBe('delivered');

    const b = await outbox.enqueue({ sessionId: 's2', endedAt: 1 });
    expect(await outbox.markDropped(b, '超限')).toBe(true);
    expect(await outbox.markDelivered(b)).toBe(false);
    expect((await outbox.getRow(b))?.state).toBe('dropped');
  });

  test('幂等键口径：未终结 ⇒ 复用；已终结 ⇒ 新行（保住本次结算的独立身份）', async () => {
    const outbox = await makeOutbox();
    const first = await outbox.enqueue({ sessionId: 's1', endedAt: 7 });
    expect(await outbox.enqueue({ sessionId: 's1', endedAt: 7 })).toBe(first);

    await outbox.markDropped(first, '超限');
    const second = await outbox.enqueue({ sessionId: 's1', endedAt: 7 });
    expect(second).not.toBe(first);
    expect(await outbox.listAll()).toHaveLength(2);
  });

  test('init 失败后可重试（initPromise 已清空，不再永久失效）', async () => {
    const path = join(tmpdir(), `outbox-init-${randomUUID().slice(0, 8)}.db`);
    createdPaths.push(path);
    const outbox = new SettlementOutbox(path);
    opened.push(outbox);

    // 注入"首次失败、其后成功"的 doInit（模拟一次瞬时 DB 故障：锁竞争 / 路径未就绪）。
    // 注：不能用"父目录不存在"造错 —— 该 sqlite 封装会自行建目录，init 不会失败。
    const originalDoInit = (
      Object.getPrototypeOf(outbox) as { doInit: () => Promise<void> }
    ).doInit;
    let calls = 0;
    Reflect.set(outbox, 'doInit', async function (this: SettlementOutbox) {
      calls += 1;
      if (calls === 1) throw new Error('transient db failure');
      await originalDoInit.call(this);
    });

    await expect(outbox.init()).rejects.toBeDefined();
    // 修复前：rejected `initPromise` 被**复用** ⇒ 此处仍抛同一个陈旧错误（台账永久不可用）
    await outbox.init();

    const id = await outbox.enqueue({ sessionId: 's1', endedAt: 1 });
    expect((await outbox.getRow(id))?.state).toBe('pending');
  });
});

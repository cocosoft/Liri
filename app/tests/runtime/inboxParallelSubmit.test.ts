// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Inbox **并发提交**回归（2026-10-31 真机日志取证）。
 *
 * 缺陷：`submit()` 在**同一条** inbox 连接上无条件 `BEGIN IMMEDIATE`。并行工具调用
 * （`reactToolLoop:parallel_batch_execute`）会同时提交两张审批卡 ⇒ 第二个 `BEGIN` 抛
 * `SQLiteError: cannot start a transaction within a transaction` ⇒ 该卡被静默丢弃
 * （`chat:toolExecution` 记为「工作区越界审批卡提交失败（按未申请处理）」并拒绝工具）。
 *
 * 实证（本机 `app.log`）：11:31:36 / 11:46:44 / 12:05:16 三次，均与
 * `parallel_batch_execute` + 紧随其后的 `Inbox item submitted`（另一张卡成功）配对。
 *
 * 修复：提交串行队列 ⇒ 并发提交全部落库。
 */
import { describe, it, expect } from 'bun:test';
import { InboxManager } from '../../src/runtime/InboxManager.js';

function approval(
  sessionId: string,
  commandHash: string
): Parameters<InboxManager['submit']>[0] {
  return {
    sessionId,
    type: 'approval',
    title: '工具审批: bash',
    message: '需要人工确认',
    options: ['approve', 'deny'],
    offlineCapable: true,
    source: 'permission',
    metadata: { sourceModule: 'permission', toolName: 'bash', commandHash },
  };
}

describe('InboxManager.submit：并发提交不丢卡', () => {
  it('并行 6 张审批卡 ⇒ 全部落库（无 SQLite 事务嵌套错误）', async () => {
    const manager = new InboxManager(':memory:');

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        manager.submit(approval('sess-parallel', `hash-${i}`))
      )
    );

    expect(results).toHaveLength(6);
    expect(new Set(results.map((item) => item.id)).size).toBe(6);

    const pending = await manager.list({ status: 'pending', type: 'approval' });
    expect(pending.total).toBe(6);
  });
});

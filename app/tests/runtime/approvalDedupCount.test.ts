// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P0-1（2026-11-04，《运行态问题排查与修复方案》）：审批卡**合并计数**（`×N` 的数据侧）。
 *
 * 取证结论（决定"不接线 `approval_dedup` 表"）：去重**已有单一实现** ——
 * `findPendingApprovalId()`（提交前复用）+ `inbox_items` 的部分唯一索引（并发兜底），
 * 见 `inboxApprovalUniqueIndex.test.ts`。若再接 `approval_dedup` 表就是第二条轨道
 * （architecture.md 双轨制禁止），且不提供增量能力。本文件只钉住真正缺的那一项：
 * **被合并了几次**（`metadata.dedupCount`）。
 */
import { describe, it, expect, afterAll, spyOn } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InboxManager } from '@openliri/service/runtime/InboxManager';
import { findPendingApprovalId } from '@openliri/infra/permission';

// `bumpApprovalHit` 会把计数回填到会话卡片（经 session gateway）⇒ 测试必须隔离数据目录，
// 不得读写用户真实 `~/.pyapp/data/sessions`。
const dataDir = mkdtempSync(join(tmpdir(), 'p01-dedup-'));
const prevDataDir = process.env['LIRI_DATA_DIR'];
process.env['LIRI_DATA_DIR'] = dataDir;

afterAll(() => {
  if (prevDataDir === undefined) delete process.env['LIRI_DATA_DIR'];
  else process.env['LIRI_DATA_DIR'] = prevDataDir;
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // @ignore-catch — Windows 下 gateway 句柄可能仍占用临时目录（测试清理尽力而为）
  }
});

function approval(
  sessionId: string,
  toolName: string,
  commandHash: string
): Parameters<InboxManager['submit']>[0] {
  return {
    sessionId,
    type: 'approval',
    title: `工具审批: ${toolName}`,
    message: '需要人工确认',
    options: ['approve', 'deny'],
    offlineCapable: true,
    source: 'test',
    metadata: { sourceModule: 'test', toolName, commandHash },
  };
}

describe('P0-1：审批合并计数（dedupCount）', () => {
  it('同会话 + 同工具 + 同指纹二次提交 ⇒ 仍是同一张卡，计数 = 2', async () => {
    const manager = new InboxManager(':memory:');
    const first = await manager.submit(approval('s1', 'file_write', 'h1'));
    const second = await manager.submit(approval('s1', 'file_write', 'h1'));

    expect(second.id).toBe(first.id);
    const pending = await manager.list({ status: 'pending', type: 'approval' });
    expect(pending.total).toBe(1);
    expect((await manager.get(first.id))?.metadata?.dedupCount).toBe(2);
  });

  it('参数指纹不同 ⇒ 各自建卡，且**不带**计数（不误合并）', async () => {
    const manager = new InboxManager(':memory:');
    const a = await manager.submit(approval('s1', 'file_write', 'h1'));
    const b = await manager.submit(approval('s1', 'file_write', 'h2'));

    expect(b.id).not.toBe(a.id);
    expect((await manager.get(a.id))?.metadata?.dedupCount).toBeUndefined();
  });

  it('已处理（非 pending）的卡不再累加 ⇒ 不改历史卡', async () => {
    const manager = new InboxManager(':memory:');
    const item = await manager.submit(approval('s1', 'file_write', 'h1'));
    await manager.reply(item.id, 'deny');

    expect(await manager.bumpApprovalHit(item.id)).toBeUndefined();
    expect((await manager.get(item.id))?.metadata?.dedupCount).toBeUndefined();
  });

  it('累加成功 ⇒ 返回**累加后的次数**（供回填与日志使用）', async () => {
    const manager = new InboxManager(':memory:');
    const item = await manager.submit(approval('s1', 'file_write', 'h1'));

    expect(await manager.bumpApprovalHit(item.id)).toBe(2);
    expect(await manager.bumpApprovalHit(item.id)).toBe(3);
  });

  it('累加成功 ⇒ 把次数回填到会话卡片（走 _syncInboxBlockDedupCount）', async () => {
    const manager = new InboxManager(':memory:');
    const item = await manager.submit(approval('s1', 'file_write', 'h1'));
    const seam = manager as unknown as {
      _syncInboxBlockDedupCount: (
        sessionId: string,
        inboxId: string,
        dedupCount: number
      ) => Promise<void>;
    };
    const syncSpy = spyOn(seam, '_syncInboxBlockDedupCount').mockResolvedValue(
      undefined
    );
    try {
      await manager.bumpApprovalHit(item.id);
      expect(syncSpy).toHaveBeenCalledWith('s1', item.id, 2);
    } finally {
      syncSpy.mockRestore();
    }
  });
});

describe('P0-1：findPendingApprovalId 命中即计数', () => {
  it('命中同指纹 ⇒ 调用 bumpApprovalHit 并返回既有 id', async () => {
    const bumped: string[] = [];
    const lookup = {
      list: async () => ({
        items: [
          {
            id: 'x1',
            status: 'pending',
            metadata: { toolName: 'file_write', commandHash: 'h1' },
          },
        ],
      }),
      bumpApprovalHit: async (id: string) => {
        bumped.push(id);
        return true;
      },
    };

    const id = await findPendingApprovalId(lookup, {
      sessionId: 's1',
      toolName: 'file_write',
      approvalHash: 'h1',
    });

    expect(id).toBe('x1');
    expect(bumped).toEqual(['x1']);
  });

  it('指纹不匹配 ⇒ 不返回 id、也不计数', async () => {
    const bumped: string[] = [];
    const lookup = {
      list: async () => ({
        items: [
          {
            id: 'x1',
            status: 'pending',
            metadata: { toolName: 'file_write', commandHash: 'h1' },
          },
        ],
      }),
      bumpApprovalHit: async (id: string) => {
        bumped.push(id);
        return true;
      },
    };

    const id = await findPendingApprovalId(lookup, {
      sessionId: 's1',
      toolName: 'file_write',
      approvalHash: 'h2',
    });

    expect(id).toBeUndefined();
    expect(bumped).toEqual([]);
  });

  it('最小实现（只有 list，无 bumpApprovalHit）⇒ 照常去重，不报错', async () => {
    const lookup = {
      list: async () => ({
        items: [
          {
            id: 'x1',
            status: 'pending',
            metadata: { toolName: 'file_write', commandHash: 'h1' },
          },
        ],
      }),
    };
    expect(
      await findPendingApprovalId(lookup, {
        sessionId: 's1',
        toolName: 'file_write',
        approvalHash: 'h1',
      })
    ).toBe('x1');
  });
});

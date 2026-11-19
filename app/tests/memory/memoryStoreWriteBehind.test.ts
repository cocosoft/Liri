// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * FLAKE-2 回归（2026-11-19）：**写入节流（write-behind）与删除/归档的竞态**。
 *
 * 背景：`MemoryStoreImpl.saveMemory` 只入 `pendingBatch` 并 1s 后合并落盘；`flushBatch`
 * 在写盘**之前**就把批次从队列移出。若此时并发执行 `deleteMemory`，其
 * `pendingBatch.delete(id)` 只是空操作（该 id 已在批次快照里），随后 flush 的
 * `atomicWrite` 会把文件**写回** ⇒「删除后读回非 null」（CI #2148 macOS 实证）。
 *
 * 本文件用「先 `saveMemory` 入队 → 立刻 `flushBatch()` 取快照 → 再 `deleteMemory`」
 * 稳定复现该窗口（不依赖平台时序），断言删除/归档后磁盘与缓存口径一致。
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MemoryStoreImpl } from '@openliri/infra/memory/stores/MemoryStore';
import type { Memory } from '@openliri/infra/memory/types/Memory';

const createdDirs: string[] = [];

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 向量库句柄在 Windows 下可能未即时释放；清理失败不影响断言
    }
  }
});

function makeStore(): MemoryStoreImpl {
  const dir = mkdtempSync(join(tmpdir(), 'mem-write-behind-'));
  createdDirs.push(dir);
  return new MemoryStoreImpl(dir, join(dir, 'vectors.db'));
}

function makeMemory(id: string): Memory {
  const now = new Date();
  return {
    id,
    content: `write-behind 回归 ${id}`,
    metadata: {
      name: 'wb',
      description: 'wb',
      type: 'user_fact',
      createdAt: now,
      updatedAt: now,
      importance: 0.5,
    },
    createdAt: now,
    updatedAt: now,
  };
}

describe('MemoryStore 写入节流 × 删除/归档（FLAKE-2）', () => {
  it('删除与在途批量写并发 ⇒ 删除后读回为 null（文件不被写回）', async () => {
    const store = makeStore();
    const id = `memory_wb_${randomUUID().slice(0, 8)}`;

    await store.saveMemory(makeMemory(id)); // 仅入队（1s 后 flush）
    const flushing = store.flushBatch(); // 批次快照已取、开始写盘
    await store.deleteMemory(id); // 与写盘并发
    await flushing;

    expect(await store.readMemory(id)).toBeNull();
  });

  it('归档与在途批量写并发 ⇒ 仍归档成功，原路径不再可读', async () => {
    const store = makeStore();
    const id = `memory_wb_${randomUUID().slice(0, 8)}`;

    await store.saveMemory(makeMemory(id));
    const flushing = store.flushBatch();
    const archived = await store.archiveMemory(id);
    await flushing;

    expect(archived).toBe(true);
    expect(await store.readMemory(id)).toBeNull();
    const trashDir = join(createdDirs[createdDirs.length - 1], '.trash');
    expect(
      existsSync(trashDir) &&
        readdirSync(trashDir).some((f) => f.startsWith(`${id}-`))
    ).toBe(true);
  });
});

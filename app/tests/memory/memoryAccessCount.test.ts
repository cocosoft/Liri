/**
 * P0-2-4（2026-11-25）：召回次数 `accessCount` 闭环。
 *
 * 规格：`.trae/specs/agent-memory-optimization.md` §8.2（P0-2-4 字段）
 * 覆盖：缺省 0 / 落盘读回 / 召回命中即自增（不改正文、不刷新 updatedAt）/ 索引排序消费。
 * 全程临时目录，不触碰 `~/.pyapp/data/memory`。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryManagerImpl } from '@openliri/infra/memory/MemoryManager';
import { MemoryStoreImpl } from '@openliri/infra/memory/stores/MemoryStore';
import { createMemoryMetadata } from '@openliri/infra/memory/types/MemoryMetadata';

const createdDirs: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'memory-access-'));
  createdDirs.push(root);
  return root;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (!dir) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响断言
    }
  }
});

describe('accessCount（P0-2-4）', () => {
  it('落盘并可从新实例读回；缺省按 0 处理（向前兼容）', async () => {
    const root = makeRoot();
    const store = new MemoryStoreImpl(root);
    const now = new Date();

    await store.saveMemory({
      id: 'm1',
      content: '被多次召回的偏好',
      metadata: {
        ...createMemoryMetadata({ name: 'm1' }),
        accessCount: 3,
      },
      createdAt: now,
      updatedAt: now,
    });
    // 旧记忆：frontmatter 无 accessCount
    await store.saveMemory({
      id: 'm2',
      content: '旧格式记忆',
      metadata: {
        ...createMemoryMetadata({ name: 'm2' }),
        accessCount: undefined,
      },
      createdAt: now,
      updatedAt: now,
    });
    await store.flushBatch();

    const reloaded = new MemoryStoreImpl(root);
    expect((await reloaded.readMemory('m1'))?.metadata.accessCount).toBe(3);
    expect((await reloaded.readMemory('m2'))?.metadata.accessCount).toBe(0);
  });

  it('召回命中 ⇒ 自增；不改写正文、不刷新 updatedAt', async () => {
    const manager = new MemoryManagerImpl(makeRoot());
    await manager.createMemory({
      content: '部署窗口是每周二 03:00（Asia/Shanghai）',
      metadata: createMemoryMetadata({ name: '部署窗口', type: 'decision' }),
    });
    await manager.createMemory({
      content: '用户偏好中文回答',
      metadata: createMemoryMetadata({ name: '语言偏好', type: 'user_fact' }),
    });

    const before = await manager.getAllMemories();
    const target = before.find((m) => m.metadata.name === '部署窗口');
    const other = before.find((m) => m.metadata.name === '语言偏好');
    expect(target).toBeDefined();
    expect(other).toBeDefined();

    const hits = await manager.getRelevantMemories('部署窗口 几点', 5);
    expect(hits.length).toBeGreaterThan(0);

    const after = await manager.getAllMemories();
    const byId = new Map(after.map((m) => [m.id, m]));
    // 每条实际返回给调用方的条目都计 1 次
    for (const hit of hits) {
      expect(byId.get(hit.id)?.metadata.accessCount).toBe(1);
    }
    const updated = after.find((m) => m.metadata.name === '部署窗口');
    // 只动计数：正文与 updatedAt 保持原样
    expect(updated?.metadata.accessCount).toBe(1);
    expect(updated?.content).toBe(target?.content);
    expect(updated?.metadata.updatedAt.getTime()).toBe(
      target?.metadata.updatedAt.getTime()
    );
  });

  it('索引 Promote 排序消费 accessCount（同 importance 下召回的排前）', async () => {
    const root = makeRoot();
    const manager = new MemoryManagerImpl(root);
    const a = await manager.createMemory({
      content: '条目 A 的正文',
      metadata: createMemoryMetadata({ name: 'a', type: 'decision' }),
    });
    const b = await manager.createMemory({
      content: '条目 B 的正文',
      metadata: createMemoryMetadata({ name: 'b', type: 'decision' }),
    });
    expect(a.id).not.toBe(b.id);

    await manager.recordMemoryAccess([b.id, b.id]);
    await manager.runMaintenancePass();

    const index = readFileSync(join(root, 'global', 'MEMORY.md'), 'utf-8');
    expect(index.indexOf('[b](')).toBeGreaterThanOrEqual(0);
    expect(index.indexOf('[b](')).toBeLessThan(index.indexOf('[a]('));
  });
});

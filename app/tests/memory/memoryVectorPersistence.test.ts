/**
 * P1-1（2026-11-25）记忆向量持久化单测。
 *
 * 规格：`.trae/specs/agent-memory-optimization.md` §4 P1-1
 * 覆盖：启动从 SQLite 恢复向量 · 删除/归档同步清缓存与持久行 · 无端口时零行为变更。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryStoreImpl } from '@openliri/infra/memory/stores/MemoryStore';
import {
  MemoryRetrieverImpl,
  type MemoryVectorPersistencePort,
} from '@openliri/infra/memory/retrievers/MemoryRetriever';

const createdDirs: string[] = [];

function makeDirs(): { memoryDir: string; dbPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'memory-vector-'));
  createdDirs.push(root);
  return { memoryDir: join(root, 'memory'), dbPath: join(root, 'app.db') };
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

describe('记忆向量持久化', () => {
  it('启动时从 SQLite 恢复向量缓存（重启后无需重算）', async () => {
    const { memoryDir, dbPath } = makeDirs();
    const store = new MemoryStoreImpl(memoryDir, dbPath);
    await store.saveMemoryVector('m1', [0.6, 0.8], 'test-model');

    const retriever = new MemoryRetrieverImpl(memoryDir, undefined, store);
    await retriever.loadPersistedVectors();

    expect(retriever.getVectorCacheSize()).toBe(1);
  });

  it('removeFromIndex ⇒ 清内存缓存并删除持久行', async () => {
    const { memoryDir, dbPath } = makeDirs();
    const store = new MemoryStoreImpl(memoryDir, dbPath);
    await store.saveMemoryVector('m1', [0.6, 0.8], 'test-model');

    const retriever = new MemoryRetrieverImpl(memoryDir, undefined, store);
    await retriever.loadPersistedVectors();
    retriever.removeFromIndex('m1');

    expect(retriever.getVectorCacheSize()).toBe(0);

    // 删除是 fire-and-forget ⇒ 轮询等待落库完成（上限 1s）
    let row = await store.getMemoryVector('m1');
    for (let i = 0; i < 20 && row; i++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      row = await store.getMemoryVector('m1');
    }
    expect(row).toBeNull();
  });

  it('无持久化端口 ⇒ 不加载、不报错（零行为变更）', async () => {
    const { memoryDir } = makeDirs();
    const retriever = new MemoryRetrieverImpl(memoryDir);
    await retriever.loadPersistedVectors();
    expect(retriever.getVectorCacheSize()).toBe(0);
  });

  it('桩端口：只填充未命中的条目，且加载幂等', async () => {
    let loadCalls = 0;
    const port: MemoryVectorPersistencePort = {
      loadVectorIndex: async () => {
        loadCalls += 1;
        return {
          a: { vector: [1, 0], model: 'm', timestamp: '' },
          b: { vector: [0, 1], model: 'm', timestamp: '' },
        };
      },
      saveMemoryVector: async () => undefined,
      deleteMemoryVector: async () => undefined,
    };
    const { memoryDir } = makeDirs();
    const retriever = new MemoryRetrieverImpl(memoryDir, undefined, port);

    await retriever.loadPersistedVectors();
    await retriever.loadPersistedVectors();

    expect(loadCalls).toBe(1);
    expect(retriever.getVectorCacheSize()).toBe(2);
  });
});

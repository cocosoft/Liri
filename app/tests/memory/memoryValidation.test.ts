/**
 * P2-1（2026-11-25）Validate 阶段单测。
 *
 * 规格：`.trae/specs/agent-memory-optimization.md` §4 P2-1（Validate）
 * 覆盖：`verifiedAt` 落盘/读回 · 证据命中即确认（不改写正文）· 未命中不标记 ·
 * 无证据提供者时零行为变更 · 确认条目在索引中优先。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  MemoryManagerImpl,
  setMemoryEvidenceProvider,
} from '@openliri/infra/memory/MemoryManager';
import { MemoryStoreImpl } from '@openliri/infra/memory/stores/MemoryStore';
import { createMemoryMetadata } from '@openliri/infra/memory/types/MemoryMetadata';

const createdDirs: string[] = [];

function makeDirs(): { root: string; memoryDir: string; dbPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'memory-validate-'));
  createdDirs.push(root);
  return {
    root,
    memoryDir: join(root, 'memory'),
    dbPath: join(root, 'app.db'),
  };
}

afterEach(() => {
  setMemoryEvidenceProvider(null);
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

describe('Validate（P2-1）', () => {
  it('verifiedAt 落盘并可从新实例读回', async () => {
    const { memoryDir, dbPath } = makeDirs();
    const store = new MemoryStoreImpl(memoryDir, dbPath);
    const verifiedAt = new Date('2026-01-02T03:04:05.000Z');

    await store.saveMemory({
      id: 'm1',
      content: '逐字原文内容',
      metadata: {
        ...createMemoryMetadata({ name: 'n1' }),
        verifiedAt,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.flushBatch();

    const reloaded = await new MemoryStoreImpl(memoryDir, dbPath).readMemory(
      'm1'
    );
    expect(reloaded?.metadata.verifiedAt?.toISOString()).toBe(
      '2026-01-02T03:04:05.000Z'
    );
  });

  it('证据命中 ⇒ 写 verifiedAt（不改写正文）；未命中不标记；索引优先', async () => {
    const { root } = makeDirs();
    setMemoryEvidenceProvider(async (_sessionId, query) =>
      query.includes('逐字原文')
        ? [{ role: 'user', content: `前缀 ${query} 后缀` }]
        : []
    );

    const manager = new MemoryManagerImpl(root);
    await manager.createMemory({
      content: '这是逐字原文 AAAABBBB',
      metadata: createMemoryMetadata({ name: 'a', sessionId: 's1' }),
    });
    await manager.createMemory({
      content: '摘要式结论 CCCCDDDD',
      metadata: createMemoryMetadata({ name: 'b', sessionId: 's1' }),
    });

    await manager.runMaintenancePass();

    const report = JSON.parse(
      readFileSync(join(root, 'validation-report.json'), 'utf-8')
    ) as { sampled: number; verified: number };
    expect(report.sampled).toBe(2);
    expect(report.verified).toBe(1);

    const memories = await manager.getAllMemories();
    const a = memories.find((m) => m.metadata.name === 'a');
    const b = memories.find((m) => m.metadata.name === 'b');
    expect(a?.metadata.verifiedAt).toBeInstanceOf(Date);
    expect(b?.metadata.verifiedAt).toBeUndefined();
    // 只写 verifiedAt，不改写正文
    expect(a?.content).toBe('这是逐字原文 AAAABBBB');

    // 索引排序：确认过的条目优先（同 importance）
    const index = readFileSync(join(root, 'global', 'MEMORY.md'), 'utf-8');
    expect(index.indexOf('[a](')).toBeGreaterThanOrEqual(0);
    expect(index.indexOf('[a](')).toBeLessThan(index.indexOf('[b]('));
  });

  it('无证据提供者 ⇒ 不扫描、不落报告（零行为变更）', async () => {
    const { root } = makeDirs();
    const manager = new MemoryManagerImpl(root);
    await manager.createMemory({
      content: '任意记忆内容 XXXX',
      metadata: createMemoryMetadata({ name: 'c', sessionId: 's1' }),
    });

    await manager.runMaintenancePass();

    expect(existsSync(join(root, 'validation-report.json'))).toBe(false);
  });
});

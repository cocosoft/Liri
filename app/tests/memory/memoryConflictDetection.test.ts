/**
 * U3 记忆冲突检测接线单测（N-79）
 * 规格：`.trae/specs/memory-conflict-detection.md`
 *
 * 覆盖：检出（fact_value / negation）· 预抽取改造后结果不变 · `detectChunked` 与 `detect` 等价 ·
 * 开关/长度过滤 · `runMaintenancePass` 接线后**只记录不改写**。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryConflictDetector } from '../../src/memory/consolidation/MemoryConflictDetector';
import { MemoryManagerImpl } from '../../src/memory/MemoryManager';
import { createMemoryMetadata } from '../../src/memory/types/MemoryMetadata';
import type { Memory } from '../../src/memory/types/Memory';

function mem(id: string, content: string): Memory {
  return {
    id,
    content,
    metadata: createMemoryMetadata({}),
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

const createdDirs: string[] = [];
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

describe('MemoryConflictDetector（检出）', () => {
  it('fact_value：同 subject 不同 value ⇒ 1 条，confidence 0.5', () => {
    const detector = new MemoryConflictDetector();
    const conflicts = detector.detect([
      mem('a', 'Alice 是 manager'),
      mem('b', 'Alice 是 engineer'),
    ]);

    expect(conflicts).toHaveLength(1);
    const c = conflicts[0];
    expect(c.conflictType).toBe('fact_value');
    expect(c.subject).toBe('alice');
    expect(c.valueA).toBe('manager');
    expect(c.valueB).toBe('engineer');
    expect(c.memoryIdA).toBe('a');
    expect(c.memoryIdB).toBe('b');
    expect(c.confidence).toBe(0.5);
  });

  it('negation：一肯定一否定 ⇒ conflictType=negation，confidence 0.6', () => {
    const detector = new MemoryConflictDetector();
    const conflicts = detector.detect([
      mem('a', 'Alice 是 manager'),
      mem('b', 'Alice 是 engineer, not manager'),
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].conflictType).toBe('negation');
    expect(conflicts[0].subject).toBe('alice');
    expect(conflicts[0].confidence).toBe(0.6);
  });

  it('无共享 subject ⇒ 不报冲突', () => {
    const detector = new MemoryConflictDetector();
    expect(
      detector.detect([
        mem('a', 'Alice 是 manager'),
        mem('b', 'Bob 是 designer'),
      ])
    ).toEqual([]);
  });

  it('enabled:false ⇒ 空；单条 ⇒ 空；短于 minContentLength ⇒ 空', () => {
    const off = new MemoryConflictDetector({ enabled: false });
    expect(
      off.detect([mem('a', 'Alice 是 manager'), mem('b', 'Alice 是 engineer')])
    ).toEqual([]);

    const detector = new MemoryConflictDetector();
    expect(detector.detect([mem('a', 'Alice 是 manager')])).toEqual([]);
    // 内容长度 < 默认 minContentLength(10)
    expect(detector.detect([mem('a', 'A 是 B'), mem('b', 'A 是 C')])).toEqual(
      []
    );
  });
});

describe('detect 与 detectChunked 等价（D2/D3）', () => {
  const fixture = (): Memory[] => [
    mem('m1', 'Alice 是 manager'),
    mem('m2', 'Alice 是 engineer'),
    mem('m3', 'Bob 是 designer'),
    mem('m4', 'Bob 是 architect'),
  ];

  /** 只比较判定关键字段，避免把实现细节（描述文案）也锁死 */
  const key = (c: {
    memoryIdA: string;
    memoryIdB: string;
    conflictType: string;
    subject: string;
  }): string => `${c.memoryIdA}|${c.memoryIdB}|${c.conflictType}|${c.subject}`;

  it('分片（chunkPairs=1/2/3）与同步结果逐条一致', async () => {
    const detector = new MemoryConflictDetector();
    const sync = detector.detect(fixture()).map(key);
    expect(sync).toEqual(['m1|m2|fact_value|alice', 'm3|m4|fact_value|bob']);

    for (const chunkPairs of [1, 2, 3]) {
      const chunked = (await detector.detectChunked(fixture(), chunkPairs)).map(
        key
      );
      expect(chunked).toEqual(sync);
    }
  });
});

describe('runMaintenancePass 接线（只记录不改写）', () => {
  it('检出冲突进入返回值，且记忆库条数/内容零变化', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'liri-conflict-'));
    createdDirs.push(dir);
    const mm = new MemoryManagerImpl(dir);

    await mm.createMemory({
      content: 'Alice 是 manager',
      metadata: createMemoryMetadata({}),
    });
    await mm.createMemory({
      content: 'Alice 是 engineer',
      metadata: createMemoryMetadata({}),
    });

    const before = await mm.getAllMemories();
    const beforeById = new Map(before.map((m) => [m.id, m.content]));
    expect(before).toHaveLength(2);

    const result = await mm.runMaintenancePass();

    expect(result.total).toBe(2);
    expect(result.conflicts).toBeGreaterThanOrEqual(1);
    expect(result.conflictSamples.length).toBeGreaterThanOrEqual(1);
    expect(result.conflictSamples.length).toBeLessThanOrEqual(5);
    expect(result.conflictSamples[0].subject).toBe('alice');

    // 唯一允许的删除来自去重（`removed`）；冲突检测本身**不删任何记忆**
    const after = await mm.getAllMemories();
    expect(after).toHaveLength(2 - result.removed);
    for (const m of after) {
      expect(beforeById.get(m.id)).toBe(m.content);
    }
  });

  it('无冲突库 ⇒ conflicts=0 且样本为空', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'liri-conflict-'));
    createdDirs.push(dir);
    const mm = new MemoryManagerImpl(dir);

    await mm.createMemory({
      content: 'Alice 是 manager',
      metadata: createMemoryMetadata({}),
    });
    await mm.createMemory({
      content: 'Bob 是 designer',
      metadata: createMemoryMetadata({}),
    });

    const result = await mm.runMaintenancePass();
    expect(result.conflicts).toBe(0);
    expect(result.conflictSamples).toEqual([]);
  });
});

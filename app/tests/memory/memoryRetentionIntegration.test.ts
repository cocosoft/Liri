/**
 * B-6：D5-B 保留上限「超限分支」集成验证（隔离库，不触碰真实记忆库）
 * 规格：`.trae/specs/memory-dedup-blocking-rootfix.md` §D5-B
 *
 * 背景（如实）：真实库当时 644 < 上限 1000 ⇒ **超限分支从未触发过**（dry-run 日志与 `.trash`
 * 移动均未发生）。本用例在**临时目录**内构造 >1000 条记忆，走**真实**
 * `MemoryManagerImpl.cleanupExpiredMemories()` 路径，验证超限分支的日志与「dry-run 不移动文件」。
 *
 * 隔离手法（与仓内既有同类测试一致）：临时目录 + 用后删除；**不触碰** `~/.pyapp/data/memory`。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { MemoryManagerImpl } from '@modules/memory';
import { MemoryStoreImpl } from '../../src/memory/stores/MemoryStore.js';
import type { Memory } from '../../src/memory/types/Memory.js';
import { addLogHandler } from '../../src/monitoring/logs/Logger.js';

const createdDirs: string[] = [];

afterEach(() => {
  while (createdDirs.length > 0) {
    rmSync(createdDirs.pop()!, { recursive: true, force: true });
  }
});

interface OversizeLog {
  totalMemories: number;
  limit: number;
  preview: Array<{ id: string }>;
}

function makeMemory(i: number, now: Date): Memory {
  return {
    id: `memory_it_${i}`,
    content: `隔离测试记忆 ${i}`,
    metadata: {
      name: `m${i}`,
      description: `d${i}`,
      // 非保护类型 + importance<0.7 + 未 pinned ⇒ 可淘汰
      type: 'conversation',
      createdAt: now,
      updatedAt: now,
      importance: 0.5,
    },
    createdAt: now,
    updatedAt: now,
  };
}

/** 在临时库内放入 `total` 条记忆（经 store 落盘，绕过 manager 的索引保存 ⇒ 快） */
async function seed(dir: string, total: number): Promise<void> {
  const store = new MemoryStoreImpl(dir);
  const now = new Date();
  for (let i = 0; i < total; i++) {
    await store.saveMemory(makeMemory(i, now));
  }
  await store.flushBatch();
}

function countGlobalMdFiles(dir: string): number {
  const globalDir = join(dir, 'global');
  if (!existsSync(globalDir)) return 0;
  return readdirSync(globalDir).filter((f) => f.endsWith('.md')).length;
}

describe('D5-B 保留上限：超限分支（隔离库，B-6）', () => {
  it('库 >1000 ⇒ 触发「将归档 N 条（dry-run）」且**不动文件**', async () => {
    const dir = join(tmpdir(), `mem-retention-it-${randomUUID().slice(0, 8)}`);
    createdDirs.push(dir);
    const TOTAL = 1001;
    await seed(dir, TOTAL);
    expect(countGlobalMdFiles(dir)).toBe(TOTAL);

    const logs: Array<{ message: string; data: OversizeLog }> = [];
    const off = addLogHandler((entry) => {
      if (String(entry.message).includes('记忆库超限')) {
        logs.push({
          message: String(entry.message),
          data: entry.data as unknown as OversizeLog,
        });
      }
      return undefined;
    });
    let cleaned = -1;
    try {
      // 真实集成路径：getAllMemories → selectEvictions → dry-run 报告
      const mm = new MemoryManagerImpl(dir);
      cleaned = await mm.cleanupExpiredMemories();
    } finally {
      off();
    }

    // 无过期项（createdAt 全为当前，TTL 远未到）⇒ 只走保留上限分支
    expect(cleaned).toBe(0);
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toBe(
      '记忆库超限：将归档 1 条（dry-run，未移动文件）'
    );
    expect(logs[0].data.totalMemories).toBe(TOTAL);
    expect(logs[0].data.limit).toBe(1000);
    expect(logs[0].data.preview).toHaveLength(1);

    // dry-run ⇒ 不移动文件（global/ 下 .md 数量不变）、不建 .trash
    expect(countGlobalMdFiles(dir)).toBe(TOTAL);
    expect(existsSync(join(dir, '.trash'))).toBe(false);
  }, 60_000);

  it('库 ≤ 上限 ⇒ 不触发超限分支（无该日志）', async () => {
    const dir = join(
      tmpdir(),
      `mem-retention-under-${randomUUID().slice(0, 8)}`
    );
    createdDirs.push(dir);
    await seed(dir, 3);

    const logs: string[] = [];
    const off = addLogHandler((entry) => {
      if (String(entry.message).includes('记忆库超限'))
        logs.push(String(entry.message));
      return undefined;
    });
    try {
      const mm = new MemoryManagerImpl(dir);
      expect(await mm.cleanupExpiredMemories()).toBe(0);
    } finally {
      off();
    }
    expect(logs).toHaveLength(0);
  });
});

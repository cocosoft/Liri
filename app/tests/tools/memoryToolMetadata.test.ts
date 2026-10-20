/**
 * U-03（2026-10-19）：记忆检索工具的**元数据归正**回归。
 *
 * 背景：`memory_search` / `memory_get` 的 `isReadOnly()` 原返回 `false`，而二者
 * `execute` 只做查询（`advancedSearch` / `getAllMemories` / 按 id 读取），**无写入**
 * ⇒ 只读工具被迫走完整流水线（`tools/pipeline/types.ts` 的快速通道判据是
 * `readOnly && !destructive`），且效果位无从声明。
 *
 * 本用例锁住：只读判据 + 显式效果声明（`idempotent` / `sideEffect`）。
 */
import { describe, expect, it } from 'bun:test';
import { MemoryGetTool } from '../../src/tools/memory/MemoryGetTool';
import { MemoryTool } from '../../src/tools/memory/MemoryTool';
import type { MemoryManagerImpl } from '../../src/memory/MemoryManager';
import type { SearchTool } from '../../src/tools/memory/SearchTool';

// 只测元数据，不触达依赖 —— 用最小替身即可
const searchToolStub = {} as SearchTool;
const memoryManagerStub = {} as MemoryManagerImpl;

describe('记忆检索工具元数据（U-03）', () => {
  it('memory_search：只读 + 幂等 + 无副作用', () => {
    const tool = new MemoryTool(searchToolStub);
    const info = tool.getInfo();

    expect(tool.isReadOnly()).toBe(true);
    expect(info.readOnly).toBe(true);
    expect(info.idempotent).toBe(true);
    expect(info.sideEffect).toBe('none');
  });

  it('memory_get：只读 + 幂等 + 无副作用', () => {
    const tool = new MemoryGetTool(memoryManagerStub);
    const info = tool.getInfo();

    expect(tool.isReadOnly()).toBe(true);
    expect(info.readOnly).toBe(true);
    expect(info.idempotent).toBe(true);
    expect(info.sideEffect).toBe('none');
  });
});

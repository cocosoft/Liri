/**
 * P2-2（2026-11-25）：记忆检索下沉 infra 后的**高级检索**唯一实现单测。
 *
 * 覆盖：无 query 列全部 · tags（全部命中）· type 过滤 · createdAt 排序 · limit ·
 * 有 query 时保留相关性顺序（`getRelevantMemories` 的顺序）。
 */
import { describe, expect, it } from 'bun:test';
import {
  advancedSearchMemories,
  type MemorySearchDeps,
} from '@openliri/infra/memory';
import { createMemoryMetadata } from '@openliri/infra/memory/types/MemoryMetadata';
import type { Memory } from '@openliri/infra/memory/types/Memory';

function makeMemory(input: {
  id: string;
  content: string;
  type?: string;
  tags?: string[];
  createdAt: string;
}): Memory {
  return {
    id: input.id,
    content: input.content,
    metadata: {
      ...createMemoryMetadata({
        name: input.id,
        type: input.type ?? 'note',
        tags: input.tags ?? [],
      }),
    },
    createdAt: new Date(input.createdAt),
    updatedAt: new Date(input.createdAt),
  };
}

const memories: Memory[] = [
  makeMemory({
    id: 'a',
    content: 'A 内容',
    type: 'decision',
    tags: ['x', 'y'],
    createdAt: '2026-01-01T00:00:00.000Z',
  }),
  makeMemory({
    id: 'b',
    content: 'B 内容',
    type: 'decision',
    tags: ['x'],
    createdAt: '2026-02-01T00:00:00.000Z',
  }),
  makeMemory({
    id: 'c',
    content: 'C 内容',
    type: 'user_fact',
    tags: ['y'],
    createdAt: '2026-03-01T00:00:00.000Z',
  }),
];

function makeDeps(order: Memory[] = memories): MemorySearchDeps {
  return {
    resolveGlobalMemory: async () => ({
      getRelevantMemories: async () => order,
      getAllMemories: async () => memories,
    }),
  };
}

describe('advancedSearchMemories（infra 唯一实现）', () => {
  it('无 query ⇒ 列全部；limit 生效', async () => {
    const all = await advancedSearchMemories({}, makeDeps());
    expect(all.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    const limited = await advancedSearchMemories({ limit: 2 }, makeDeps());
    expect(limited.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('tags 为"全部命中"（与原 advancedSearch 语义一致）', async () => {
    const both = await advancedSearchMemories({ tags: ['x', 'y'] }, makeDeps());
    expect(both.map((m) => m.id)).toEqual(['a']);
    const onlyX = await advancedSearchMemories({ tags: ['x'] }, makeDeps());
    expect(onlyX.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('type 过滤 + createdAt 排序（asc/desc）', async () => {
    const decisions = await advancedSearchMemories(
      { type: 'decision' },
      makeDeps()
    );
    expect(decisions.map((m) => m.id)).toEqual(['a', 'b']);

    const asc = await advancedSearchMemories(
      { sortBy: 'createdAt', sortOrder: 'asc' },
      makeDeps()
    );
    expect(asc.map((m) => m.id)).toEqual(['a', 'b', 'c']);

    const desc = await advancedSearchMemories(
      { sortBy: 'createdAt', sortOrder: 'desc' },
      makeDeps()
    );
    expect(desc.map((m) => m.id)).toEqual(['c', 'b', 'a']);
  });

  it('有 query ⇒ 保留检索相关性顺序（不额外重排）', async () => {
    const relevanceOrder = [memories[2], memories[0]];
    const out = await advancedSearchMemories(
      { query: '任意', sortBy: 'relevance' },
      makeDeps(relevanceOrder)
    );
    expect(out.map((m) => m.id)).toEqual(['c', 'a']);
  });
});

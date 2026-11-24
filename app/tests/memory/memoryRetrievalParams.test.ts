/**
 * P1-1（2026-11-25）检索参数接线单测。
 *
 * 规格：`.trae/specs/agent-memory-optimization.md` §4 P1-1-2
 * 覆盖：默认全关 ⇒ 顺序与旧行为一致 · `typeQuota` 生效 · `temporalDecay` 生效。
 * MMR 需嵌入服务（N² 次调用），此处不覆盖。
 */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Memory } from '@openliri/infra/memory/types/Memory';
import {
  MemoryRetrieverImpl,
  type MemorySearchConfig,
} from '@openliri/infra/memory/retrievers/MemoryRetriever';

const QUERY = '部署 门禁 流程';

function makeMemory(
  id: string,
  type: string,
  content: string,
  updatedAt: Date
): Memory {
  return {
    id,
    content,
    metadata: {
      name: '',
      description: '',
      type,
      createdAt: updatedAt,
      updatedAt,
    },
    createdAt: updatedAt,
    updatedAt,
  };
}

function makeConfig(
  query: Partial<MemorySearchConfig['query']> = {}
): MemorySearchConfig {
  return {
    sources: ['memory'],
    query: {
      maxResults: 10,
      minScore: 0.01,
      hybrid: { enabled: false, vectorWeight: 0.5, textWeight: 0.5 },
      mmr: { enabled: false, lambda: 0.5 },
      temporalDecay: { enabled: false, halfLifeDays: 30, minScore: 0.1 },
      ...query,
    },
    cache: { enabled: false, maxEntries: 0 },
  };
}

function makeRetriever(
  memories: Memory[],
  config: MemorySearchConfig
): MemoryRetrieverImpl {
  const retriever = new MemoryRetrieverImpl(
    mkdtempSync(join(tmpdir(), 'memory-params-')),
    config
  );
  for (const memory of memories) retriever.updateIndex(memory);
  return retriever;
}

describe('检索参数接线（P1-1-2）', () => {
  it('默认全关 ⇒ 顺序与旧行为一致（按关键词排名）', async () => {
    const now = new Date();
    const retriever = makeRetriever(
      [
        makeMemory('d1', 'decision', QUERY, now),
        makeMemory('d2', 'decision', QUERY, now),
        makeMemory('d3', 'decision', QUERY, now),
        makeMemory('f1', 'user_fact', QUERY, now),
      ],
      makeConfig()
    );

    const ids = (await retriever.hybridSearch(QUERY)).map((m) => m.id);
    expect(ids).toEqual(['d1', 'd2', 'd3', 'f1']);
  });

  it('typeQuota ⇒ 达到配额的条目被跳过（不回填）', async () => {
    const now = new Date();
    const retriever = makeRetriever(
      [
        makeMemory('d1', 'decision', QUERY, now),
        makeMemory('d2', 'decision', QUERY, now),
        makeMemory('d3', 'decision', QUERY, now),
        makeMemory('f1', 'user_fact', QUERY, now),
      ],
      makeConfig({ typeQuota: { decision: 1 } })
    );

    const ids = (await retriever.hybridSearch(QUERY, 3)).map((m) => m.id);
    expect(ids).toEqual(['d1', 'f1']);
  });

  it('temporalDecay ⇒ 关键词更匹配但过旧的条目被压到后面', async () => {
    const old = new Date(Date.now() - 60_000); // 1 分钟前（关键词衰减可忽略）
    const now = new Date();
    const memories = [
      makeMemory('old', 'decision', QUERY, old), // 3/3 token 命中
      makeMemory('mid', 'decision', '部署 门禁', now), // 2/3
      makeMemory('new', 'decision', '部署', now), // 1/3
      makeMemory('dummy', 'decision', '部署', now), // 1/3（与 new 同分，占末位）
    ];

    const baseline = makeRetriever(memories, makeConfig());
    expect((await baseline.hybridSearch(QUERY)).map((m) => m.id)).toEqual([
      'old',
      'mid',
      'new',
      'dummy',
    ]);

    // 半衰期约 0.86 秒 ⇒ 1 分钟前的条目分数被压到 0（minScore=0）
    const decayed = makeRetriever(
      memories,
      makeConfig({
        temporalDecay: { enabled: true, halfLifeDays: 0.00001, minScore: 0 },
      })
    );
    expect((await decayed.hybridSearch(QUERY)).map((m) => m.id)).toEqual([
      'mid',
      'new',
      'old',
      'dummy',
    ]);
  });
});

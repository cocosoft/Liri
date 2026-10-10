// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 跨源统一检索的 RRF 融合单测（手写 fake，不用 `mock.module`）。
 *
 * 锁定：融合按**排名**（RRF）而非原始评分幅度；跨源同分按 key 升序；
 * `limit` 生效；单路检索失败降级为空而不抛。
 */
import { describe, expect, it } from 'bun:test';
import { UnifiedSearchService } from '../../src/memory/services/UnifiedSearchService';
import type { MemorySearchProvider } from '../../src/memory/services/UnifiedSearchService';
import type {
  IKnowledgeSearch,
  KnowledgeRoute,
} from '../../src/core/knowledge-types';
import { createMemory } from '../../src/memory/types/Memory';
import type { Memory } from '../../src/memory/types/Memory';
import { createMemoryMetadata } from '../../src/memory/types/MemoryMetadata';

/** 构造一条知识路由 */
const route = (docPath: string, score: number): KnowledgeRoute => ({
  docPath,
  title: docPath,
  score,
  category: 'test',
  snippet: `snippet:${docPath}`,
  matchType: 'keyword',
  isKnowledgeDoc: true,
});

/** 构造一条记忆 */
const memory = (id: string, content: string, priority: number) =>
  createMemory({
    content,
    metadata: createMemoryMetadata({ name: id, priority }),
  });

/** 手写知识路由 fake */
const fakeKnowledge = (routes: KnowledgeRoute[]): IKnowledgeSearch => ({
  search: async () => routes,
});

/** 手写记忆 provider fake */
const fakeMemory = (memories: Memory[]): MemorySearchProvider => ({
  getRelevantMemories: async () => memories,
});

describe('跨源 RRF 融合', () => {
  it('按排名融合：rank0 的知识原始分 0.02 与 rank0 的记忆同得 1/61', async () => {
    const svc = new UnifiedSearchService(
      fakeKnowledge([route('a.md', 0.02)]),
      fakeMemory([memory('m1', 'highly relevant content', 9)])
    );
    const out = await svc.search('q');

    const kw = out.find((r) => r.type === 'knowledge' && r.docPath === 'a.md');
    const mem = out.find((r) => r.type === 'memory');
    // 知识原始分 0.02 未体现在融合分上 ⇒ 证明融合对幅度不敏感（RRF）
    expect(kw!.score).toBeCloseTo(1 / 61, 12);
    expect(mem!.score).toBeCloseTo(1 / 61, 12);
  });

  it('跨源同分按 key 升序（knowledge:… 先于 memory:…）', async () => {
    const svc = new UnifiedSearchService(
      fakeKnowledge([route('a.md', 0.9)]),
      fakeMemory([memory('m1', 'content', 5)])
    );
    const out = await svc.search('q', { limit: 2 });
    expect(out.map((r) => r.type)).toEqual(['knowledge', 'memory']);
  });

  it('rank 越靠后分数越低（rank1 ⇒ 1/62）', async () => {
    const svc = new UnifiedSearchService(
      fakeKnowledge([route('a.md', 0.9), route('b.md', 0.8)]),
      fakeMemory([])
    );
    const out = await svc.search('q', { limit: 5 });
    expect(out[0]!.docPath).toBe('a.md');
    expect(out[0]!.score).toBeCloseTo(1 / 61, 12);
    expect(out[1]!.docPath).toBe('b.md');
    expect(out[1]!.score).toBeCloseTo(1 / 62, 12);
  });

  it('limit 截断 Top-K', async () => {
    const svc = new UnifiedSearchService(
      fakeKnowledge([route('a.md', 0.9), route('b.md', 0.8)]),
      fakeMemory([memory('m1', 'x', 5)])
    );
    const out = await svc.search('q', { limit: 1 });
    expect(out).toHaveLength(1);
    expect(out[0]!.score).toBeCloseTo(1 / 61, 12);
  });

  it('单路（含知识）失败降级为空结果，不抛且仍返回记忆路', async () => {
    const failing: IKnowledgeSearch = {
      search: async () => {
        throw new Error('kb down');
      },
    };
    const svc = new UnifiedSearchService(
      failing,
      fakeMemory([memory('m1', 'content', 5)])
    );
    const out = await svc.search('q');
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe('memory');
  });

  it('两路均关闭 ⇒ 空结果', async () => {
    const svc = new UnifiedSearchService(fakeKnowledge([]), fakeMemory([]));
    const out = await svc.search('q', {
      includeKnowledge: false,
      includeMemory: false,
    });
    expect(out).toEqual([]);
  });
});

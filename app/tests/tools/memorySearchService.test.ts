/**
 * P1-2（2026-11-25）统一记忆检索服务单测。
 *
 * 规格：`.trae/specs/agent-memory-optimization.md` §4 P1-2
 * 覆盖：scope 解析（auto/session/global/all）· type 过滤 · 跨源去重 ·
 * 无会话上下文 / 无查询词的结构化回退原因。
 */
import { describe, expect, it } from 'bun:test';
import {
  searchMemory,
  type MemorySearchDeps,
} from '@modules/tools/memorySearchService';

function makeDeps(): MemorySearchDeps {
  return {
    resolveSessionMemory: async () => ({
      searchMemory: async () => [
        { content: 'S 决策', type: 'decision' },
        { content: 'S 变更', type: 'file_change' },
      ],
      getMemoryContext: () => 'SESSION-CONTEXT',
    }),
    resolveGlobalMemory: async () => ({
      getRelevantMemories: async () => [
        {
          content: 'G 决策',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          metadata: { type: 'decision', name: 'g1' },
        },
        {
          content: 'G 事实',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          metadata: { type: 'user_fact', name: 'g2' },
        },
      ],
    }),
  };
}

const noSessionDeps: MemorySearchDeps = {
  resolveGlobalMemory: makeDeps().resolveGlobalMemory,
};

describe('searchMemory（统一服务）', () => {
  it('auto + 有会话 ⇒ 只查会话', async () => {
    const out = await searchMemory({ query: 'x', sessionId: 's1' }, makeDeps());
    expect(out.scope).toBe('session');
    expect(out.hits.map((h) => h.content)).toEqual(['S 决策', 'S 变更']);
    expect(out.fallbackReasons).toEqual([]);
  });

  it('auto + 无会话 ⇒ 查全局', async () => {
    const out = await searchMemory({ query: 'x' }, makeDeps());
    expect(out.scope).toBe('global');
    expect(out.hits.map((h) => h.content)).toEqual(['G 决策', 'G 事实']);
  });

  it('all ⇒ 会话在前、全局在后', async () => {
    const out = await searchMemory(
      { query: 'x', sessionId: 's1', scope: 'all' },
      makeDeps()
    );
    expect(out.hits.map((h) => h.content)).toEqual([
      'S 决策',
      'S 变更',
      'G 决策',
      'G 事实',
    ]);
  });

  it('type 过滤 ⇒ 两源都按类型过滤', async () => {
    const out = await searchMemory(
      { query: 'x', sessionId: 's1', scope: 'all', type: 'decision' },
      makeDeps()
    );
    expect(out.hits.map((h) => h.content)).toEqual(['S 决策', 'G 决策']);
  });

  it('跨源相同内容 ⇒ 去重（会话优先）', async () => {
    const deps: MemorySearchDeps = {
      resolveSessionMemory: async () => ({
        searchMemory: async () => [{ content: '同一条', type: 'decision' }],
        getMemoryContext: () => '',
      }),
      resolveGlobalMemory: async () => ({
        getRelevantMemories: async () => [
          {
            content: '同一条',
            createdAt: new Date(0),
            metadata: { type: 'decision' },
          },
        ],
      }),
    };
    const out = await searchMemory(
      { query: 'x', sessionId: 's1', scope: 'all' },
      deps
    );
    expect(out.hits).toHaveLength(1);
    expect(out.hits[0].source).toBe('session');
  });

  it('scope=session 但无会话上下文 ⇒ fallbackReasons', async () => {
    const out = await searchMemory(
      { query: 'x', scope: 'session' },
      noSessionDeps
    );
    expect(out.hits).toEqual([]);
    expect(out.fallbackReasons).toContain('no-session-context');
  });

  it('无查询词且无会话 ⇒ query-required', async () => {
    const out = await searchMemory({ query: '' }, makeDeps());
    expect(out.hits).toEqual([]);
    expect(out.fallbackReasons).toContain('query-required');
  });

  it('无查询词 + 有会话 ⇒ 返回会话上下文', async () => {
    const out = await searchMemory({ query: '', sessionId: 's1' }, makeDeps());
    expect(out.hits).toHaveLength(1);
    expect(out.hits[0].content).toBe('SESSION-CONTEXT');
  });

  it('scope=team ⇒ 只查团队记忆', async () => {
    const deps: MemorySearchDeps = {
      resolveTeamMemory: async () => ({
        search: async () => [
          { content: 'T 团队决策', type: 'decision', timestamp: '', id: 't1' },
        ],
      }),
    };
    const out = await searchMemory(
      { query: 'x', sessionId: 's1', scope: 'team' },
      deps
    );
    expect(out.scope).toBe('team');
    expect(out.hits.map((h) => h.content)).toEqual(['T 团队决策']);
    expect(out.hits[0].source).toBe('team');
  });

  it('scope=all ⇒ 会话 → 团队 → 全局', async () => {
    const deps: MemorySearchDeps = {
      resolveSessionMemory: async () => ({
        searchMemory: async () => [{ content: 'S 决策', type: 'decision' }],
        getMemoryContext: () => '',
      }),
      resolveTeamMemory: async () => ({
        search: async () => [
          { content: 'T 决策', type: 'decision', timestamp: '' },
        ],
      }),
      resolveGlobalMemory: async () => ({
        getRelevantMemories: async () => [
          {
            content: 'G 决策',
            createdAt: new Date(0),
            metadata: { type: 'decision' },
          },
        ],
      }),
    };
    const out = await searchMemory(
      { query: 'x', sessionId: 's1', scope: 'all' },
      deps
    );
    expect(out.hits.map((h) => h.content)).toEqual([
      'S 决策',
      'T 决策',
      'G 决策',
    ]);
  });

  it('记忆零命中 + transcript 可用 ⇒ 回退为原始记录引用（含 seq/role）', async () => {
    const deps: MemorySearchDeps = {
      resolveSessionMemory: async () => ({
        searchMemory: async () => [],
        getMemoryContext: () => '',
      }),
      searchTranscript: async () => [
        {
          entries: [
            {
              role: 'user',
              content: '部署前要先跑门禁',
              timestamp: 1_700_000_000_000,
              lastEventSeq: 42,
            },
            { role: 'assistant', content: { text: '收到' } },
          ],
        },
      ],
    };
    const out = await searchMemory(
      { query: '门禁', sessionId: 's1', scope: 'session' },
      deps
    );
    expect(out.hits).toHaveLength(2);
    expect(out.hits[0].source).toBe('transcript');
    expect(out.hits[0].role).toBe('user');
    expect(out.hits[0].seq).toBe(42);
    expect(out.fallbackReasons).toContain('transcript-fallback');
  });

  it('transcript 有入口但零匹配 ⇒ transcript-no-hits', async () => {
    const deps: MemorySearchDeps = {
      resolveSessionMemory: async () => ({
        searchMemory: async () => [],
        getMemoryContext: () => '',
      }),
      searchTranscript: async () => [{ entries: [] }],
    };
    const out = await searchMemory(
      { query: '门禁', sessionId: 's1', scope: 'session' },
      deps
    );
    expect(out.hits).toEqual([]);
    expect(out.fallbackReasons).toContain('transcript-no-hits');
  });

  it('transcript 检索抛错 ⇒ transcript-search-failed（不向上抛）', async () => {
    const deps: MemorySearchDeps = {
      resolveSessionMemory: async () => ({
        searchMemory: async () => [],
        getMemoryContext: () => '',
      }),
      searchTranscript: async () => {
        throw new Error('boom');
      },
    };
    const out = await searchMemory(
      { query: '门禁', sessionId: 's1', scope: 'session' },
      deps
    );
    expect(out.hits).toEqual([]);
    expect(out.fallbackReasons).toContain('transcript-search-failed');
  });
});

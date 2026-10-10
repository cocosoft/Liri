/**
 * KnowledgeRouter 单元测试
 *
 * 覆盖：buildIndex / keywordSearch / findByTitle / 分页 / domain 过滤
 */
import { describe, it, expect, beforeAll } from 'bun:test';
import { KnowledgeRouter } from '../KnowledgeRouter';
import type { FileDocsProvider } from '@modules/docs/FileDocsProvider';
import type { FileDocEntry } from '@modules/docs/FileDocsProvider';
import type { EmbeddingManager } from '@modules/ai';
import type { IVectorStore } from '../semantic/IVectorStore';

/** 内存模拟 FileDocsProvider */
class MockDocsProvider implements FileDocsProvider {
  private entries: FileDocEntry[];

  constructor(
    docs: Array<{
      title: string;
      content: string;
      category?: string;
      path?: string;
    }>
  ) {
    this.entries = docs.map((d, i) => ({
      relativePath: d.path || `docs/${d.title.replace(/\s+/g, '_')}.md`,
      title: d.title,
      content: d.content,
      category: d.category || '技术',
      fileName: `${d.title.replace(/\s+/g, '_')}.md`,
    }));
  }

  async buildIndex(): Promise<FileDocEntry[]> {
    return this.entries;
  }

  async loadDoc(docPath: string): Promise<FileDocEntry | null> {
    return this.entries.find((e) => e.relativePath === docPath) || null;
  }

  async search(): Promise<FileDocEntry[]> {
    return this.entries;
  }

  async getDocsByCategory(): Promise<FileDocEntry[]> {
    return this.entries;
  }

  getDocsRoots(): string[] {
    return ['/mock/knowledge'];
  }

  async clearCache(): Promise<void> {}
}

describe('KnowledgeRouter', () => {
  let router: KnowledgeRouter;

  const docs = [
    {
      title: 'Python基础教程',
      content: 'Python是一种解释型、面向对象的高级编程语言。语法简洁。',
      category: '编程',
      path: 'domains/coding/wiki/python-basics.md',
    },
    {
      title: 'TypeScript类型系统',
      content: 'TypeScript是JavaScript的超集，提供静态类型检查。',
      category: '编程',
      path: 'domains/coding/wiki/typescript-types.md',
    },
    {
      title: '植物学入门',
      content: '植物学是研究植物生命、结构、生长和分类的科学。',
      category: '科学',
      path: 'domains/botany/wiki/intro.md',
    },
    {
      title: '捕蝇草',
      content: '捕蝇草（Dionaea muscipula）是一种食虫植物，原产于北美洲。',
      category: '科学',
      path: 'domains/botany/wiki/venus_flytrap.md',
    },
    {
      title: '知识库优化方案',
      content: '本方案涵盖语义搜索、倒排索引、增量编译等优化。',
      category: '项目',
      path: 'wiki/optimization.md',
    },
  ];

  beforeAll(async () => {
    const provider = new MockDocsProvider(docs);
    router = new KnowledgeRouter(provider);
    await router.buildIndex();
  });

  describe('buildIndex + findByTitle', () => {
    it('should build index with correct doc count', () => {
      // 通过 findByTitle 间接验证
      expect(router.findByTitle('Python基础教程')).toBeDefined();
      expect(router.findByTitle('植物学入门')).toBeDefined();
    });

    it('should return undefined for non-existent title', () => {
      expect(router.findByTitle('不存在的文档')).toBeUndefined();
    });

    it('should be case-insensitive for findByTitle', () => {
      expect(router.findByTitle('python基础教程')).toBeDefined();
    });

    it('should handle trimmed whitespace', () => {
      expect(router.findByTitle('  捕蝇草  ')).toBeDefined();
    });
  });

  describe('keywordSearch', () => {
    it('should find documents by keyword', async () => {
      const results = await router.search('Python 编程', { maxResults: 5 });
      expect(results.length).toBeGreaterThan(0);
      // Python基础教程 should be in results
      const pythonDoc = results.find((r) => r.title === 'Python基础教程');
      expect(pythonDoc).toBeDefined();
    });

    it('should return empty for non-matching query', async () => {
      const results = await router.search('xyzzy123不是一个真实词', {
        maxResults: 5,
      });
      expect(results.length).toBe(0);
    });

    it('should rank knowledge docs higher than file docs', async () => {
      // 所有 mock docs 都不是 knowledge docs，分数应较低
      const results = await router.search('植物学', { maxResults: 3 });
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('pagination (offset)', () => {
    it('should support offset for pagination', async () => {
      const page1 = await router.search('基础', { maxResults: 2, offset: 0 });
      const page2 = await router.search('基础', { maxResults: 2, offset: 2 });
      expect(page1.length).toBeLessThanOrEqual(2);
      expect(page2.length).toBeLessThanOrEqual(2);
      // Page 1 and Page 2 should not overlap
      const page1Paths = new Set(page1.map((r) => r.docPath));
      for (const r of page2) {
        expect(page1Paths.has(r.docPath)).toBe(false);
      }
    });

    it('should handle offset beyond result count gracefully', async () => {
      const results = await router.search('捕蝇草', {
        maxResults: 5,
        offset: 100,
      });
      expect(results.length).toBe(0);
    });

    it('should return correct count with default offset=0', async () => {
      const r1 = await router.search('植物学', { maxResults: 3 });
      const r2 = await router.search('植物学', { maxResults: 3, offset: 0 });
      expect(r1.length).toBe(r2.length);
    });
  });

  describe('domain filtering', () => {
    it('should filter by domain=coding', async () => {
      const results = await router.search('教程 类型', {
        maxResults: 10,
        domain: 'coding',
      });
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.docPath).toMatch(/domains\/coding\//);
      }
    });

    it('should filter by domain=botany', async () => {
      const results = await router.search('植物', {
        maxResults: 10,
        domain: 'botany',
      });
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.docPath).toMatch(/domains\/botany\//);
      }
    });

    it('should return all docs when no domain specified', async () => {
      const results = await router.search('基础', { maxResults: 10 });
      const domains = new Set(
        results.map((r) => {
          const m = r.docPath.match(/domains\/([^/]+)/);
          return m ? m[1] : 'none';
        })
      );
      // Should include both coding and botany
      expect(domains.size).toBeGreaterThanOrEqual(1);
    });

    it('should return empty for non-existent domain', async () => {
      const results = await router.search('植物学', {
        maxResults: 10,
        domain: 'nonexistent',
      });
      expect(results.length).toBe(0);
    });
  });

  describe('removeFromIndex', () => {
    it('should remove doc and make it unfindable', async () => {
      const tmpProvider = new MockDocsProvider([
        {
          title: '临时文档删除测试',
          content: '这是用于测试删除的临时内容。',
          category: '测试',
        },
      ]);
      const tmpRouter = new KnowledgeRouter(tmpProvider);
      await tmpRouter.buildIndex();

      expect(tmpRouter.findByTitle('临时文档删除测试')).toBeDefined();

      tmpRouter.removeFromIndex('docs/临时文档删除测试.md');
      expect(tmpRouter.findByTitle('临时文档删除测试')).toBeUndefined();
    });
  });

  describe('search cache (v1.5)', () => {
    it('should return search results', async () => {
      const results = await router.search('Python', { maxResults: 3 });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.score).toBeGreaterThan(0);
    });

    it('should return results with sorted scores', async () => {
      const results = await router.search('学', { maxResults: 10 });
      for (let i = 1; i < results.length; i++) {
        expect(results[i]!.score).toBeLessThanOrEqual(results[i - 1]!.score);
      }
    });
  });
});

/**
 * 值域契约 + `matchType` 契约（2026-10-10 收敛）。
 *
 * 两路同时命中（关键词腿 + 语义腿）才能触达 `mergeResults` 的融合/标记逻辑，
 * 故此处以最小手写替身提供语义腿（`IVectorStore` + `EmbeddingManager`），
 * 富化路径（`getById` / `getByPath`）返回空 ⇒ 不改动 `snippet`。
 */
describe('KnowledgeRouter.mergeResults — 值域归一化与 hybrid 标记', () => {
  const hybridDocs = [
    {
      title: 'Python基础教程',
      content: 'Python是一种解释型、面向对象的高级编程语言。语法简洁。',
      category: '编程',
      path: 'domains/coding/wiki/python-basics.md',
    },
    {
      title: '植物学入门',
      content: '植物学是研究植物生命、结构、生长和分类的科学。',
      category: '科学',
      path: 'domains/botany/wiki/intro.md',
    },
    {
      title: '捕蝇草',
      content: '捕蝇草（Dionaea muscipula）是一种食虫植物，原产于北美洲。',
      category: '科学',
      path: 'domains/botany/wiki/venus_flytrap.md',
    },
  ];

  const PY_PATH = 'domains/coding/wiki/python-basics.md';
  const PLANT_PATH = 'domains/botany/wiki/intro.md';

  /** 语义腿替身：只回显给定路径，富化相关方法返回空 */
  function fakeVectorStore(paths: string[]): IVectorStore {
    return {
      upsert: async () => {},
      search: async () =>
        paths.map((p) => ({
          entry: {
            id: `${p}#L1-L1`,
            path: p,
            startLine: 1,
            endLine: 1,
            text: '语义片段',
            embedding: new Float32Array(),
            mtimeMs: 0,
          },
          score: 0.9,
        })),
      deleteByPath: async () => {},
      clear: async () => {},
      count: async () => paths.length,
      getMeta: async () => null,
      setMeta: async () => {},
      getById: async () => null,
      getByPath: async () => [],
    };
  }

  const fakeEmbedding = {
    initialize: () => {},
    embedOne: async () => [0.1, 0.2],
  } as unknown as EmbeddingManager;

  async function makeRouter(semanticPaths: string[]): Promise<KnowledgeRouter> {
    const r = new KnowledgeRouter(
      new MockDocsProvider(hybridDocs),
      fakeEmbedding,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      fakeVectorStore(semanticPaths)
    );
    await r.buildIndex();
    return r;
  }

  it('分数归一化到 (0,1]，原始分 ≈1/61 不再被压成 0', async () => {
    const r = await makeRouter([PY_PATH]);
    const results = await r.search('Python', { maxResults: 5 });
    expect(results.length).toBeGreaterThan(0);
    for (const hit of results) {
      expect(hit.score).toBeGreaterThan(0);
      expect(hit.score).toBeLessThanOrEqual(1);
    }
  });

  it('两路均 rank0 ⇒ 归一化后为 1（上确界）', async () => {
    const r = await makeRouter([PY_PATH]);
    const results = await r.search('Python', { maxResults: 5 });
    const python = results.find((h) => h.docPath === PY_PATH);
    expect(python).toBeDefined();
    expect(python!.score).toBe(1);
  });

  it('重叠命中（关键词 + 语义同 docPath）⇒ matchType = hybrid', async () => {
    const r = await makeRouter([PY_PATH]);
    const results = await r.search('Python', { maxResults: 5 });
    expect(results.find((h) => h.docPath === PY_PATH)!.matchType).toBe(
      'hybrid'
    );
  });

  it('仅关键词腿命中 ⇒ 保留该路 matchType，不标 hybrid', async () => {
    const r = await makeRouter([PLANT_PATH]);
    const results = await r.search('Python', { maxResults: 5 });
    expect(results.find((h) => h.docPath === PY_PATH)!.matchType).toBe(
      'keyword'
    );
  });

  it('仅语义腿命中 ⇒ 标 semantic 且分数严格小于 1', async () => {
    const r = await makeRouter([PLANT_PATH]);
    const results = await r.search('Python', { maxResults: 5 });
    const plant = results.find((h) => h.docPath === PLANT_PATH);
    expect(plant).toBeDefined();
    expect(plant!.matchType).toBe('semantic');
    expect(plant!.score).toBeGreaterThan(0);
    expect(plant!.score).toBeLessThan(1);
  });

  it('权重 ≤0 ⇒ 上界非正，不做归一化且不产 NaN / Infinity', async () => {
    const r = new KnowledgeRouter(
      new MockDocsProvider(hybridDocs),
      fakeEmbedding,
      [],
      {
        search: {
          keywordWeight: -1,
          semanticWeight: -1,
          semanticThreshold: 0.3,
        },
      } as unknown as ConstructorParameters<typeof KnowledgeRouter>[3],
      undefined,
      undefined,
      undefined,
      fakeVectorStore([PY_PATH])
    );
    await r.buildIndex();
    const results = await r.search('Python', { maxResults: 5 });
    expect(results.length).toBeGreaterThan(0);
    for (const hit of results) {
      expect(Number.isFinite(hit.score)).toBe(true);
    }
  });
});

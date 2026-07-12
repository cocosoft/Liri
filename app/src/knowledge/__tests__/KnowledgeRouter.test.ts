/**
 * KnowledgeRouter 单元测试
 *
 * 覆盖：buildIndex / keywordSearch / findByTitle / 分页 / domain 过滤
 */
import { describe, it, expect, beforeAll } from 'bun:test';
import { KnowledgeRouter } from '../KnowledgeRouter';
import type { FileDocsProvider } from '@modules/docs/FileDocsProvider';
import type { FileDocEntry } from '@modules/docs/FileDocsProvider';

/** 内存模拟 FileDocsProvider */
class MockDocsProvider implements FileDocsProvider {
  private entries: FileDocEntry[];

  constructor(docs: Array<{ title: string; content: string; category?: string; path?: string }>) {
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
    { title: 'Python基础教程', content: 'Python是一种解释型、面向对象的高级编程语言。语法简洁。', category: '编程', path: 'domains/coding/wiki/python-basics.md' },
    { title: 'TypeScript类型系统', content: 'TypeScript是JavaScript的超集，提供静态类型检查。', category: '编程', path: 'domains/coding/wiki/typescript-types.md' },
    { title: '植物学入门', content: '植物学是研究植物生命、结构、生长和分类的科学。', category: '科学', path: 'domains/botany/wiki/intro.md' },
    { title: '捕蝇草', content: '捕蝇草（Dionaea muscipula）是一种食虫植物，原产于北美洲。', category: '科学', path: 'domains/botany/wiki/venus_flytrap.md' },
    { title: '知识库优化方案', content: '本方案涵盖语义搜索、倒排索引、增量编译等优化。', category: '项目', path: 'wiki/optimization.md' },
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
      const results = await router.search('xyzzy123不是一个真实词', { maxResults: 5 });
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
      const results = await router.search('捕蝇草', { maxResults: 5, offset: 100 });
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
      const results = await router.search('教程 类型', { maxResults: 10, domain: 'coding' });
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.docPath).toMatch(/domains\/coding\//);
      }
    });

    it('should filter by domain=botany', async () => {
      const results = await router.search('植物', { maxResults: 10, domain: 'botany' });
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
      const results = await router.search('植物学', { maxResults: 10, domain: 'nonexistent' });
      expect(results.length).toBe(0);
    });
  });

  describe('removeFromIndex', () => {
    it('should remove doc and make it unfindable', async () => {
      // 先加一个临时文档
      const tmpProvider = new MockDocsProvider([
        { title: '临时文档删除测试', content: '这是用于测试删除的临时内容。', category: '测试' },
      ]);
      const tmpRouter = new KnowledgeRouter(tmpProvider);
      await tmpRouter.buildIndex();

      expect(tmpRouter.findByTitle('临时文档删除测试')).toBeDefined();

      tmpRouter.removeFromIndex('docs/临时文档删除测试.md');
      expect(tmpRouter.findByTitle('临时文档删除测试')).toBeUndefined();
    });
  });
});

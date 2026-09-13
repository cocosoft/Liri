// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * KnowledgeRouter 性能基准测试
 *
 * 运行: bun run src/knowledge/__tests__/benchmark.ts
 * 输出: 各操作的耗时统计
 */

import { bench } from 'bun:test';
import { KnowledgeRouter } from '../KnowledgeRouter';
import type {
  FileDocsProvider,
  FileDocEntry,
} from '@modules/docs/FileDocsProvider';

/** 模拟文件提供者 */
class MockDocsProvider implements FileDocsProvider {
  private entries: FileDocEntry[];
  constructor(
    docs: Array<{ title: string; content: string; category?: string }>
  ) {
    this.entries = docs.map((d, i) => ({
      relativePath: `docs/doc_${i}.md`,
      title: d.title,
      content: d.content,
      category: d.category || 'general',
      fileName: `doc_${i}.md`,
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
    return ['/mock'];
  }
  async clearCache(): Promise<void> {}
}

// 生成 500 篇模拟文档
function generateDocs(count: number) {
  const categories = ['技术', '科学', '项目', '设计', '运维'];
  const docs: Array<{ title: string; content: string; category: string }> = [];
  for (let i = 0; i < count; i++) {
    const cat = categories[i % categories.length]!;
    docs.push({
      title: `文档${i}_${cat}_2024`,
      content:
        `这是第${i}篇文档的内容，包含关键词：类型系统、编译优化、运行时、异步编程、内存管理、数据结构、网络协议、安全机制、性能测试、部署运维。`.repeat(
          5
        ),
      category: cat,
    });
  }
  return docs;
}

const smallDocs = generateDocs(10);
const mediumDocs = generateDocs(500);

let smallRouter: KnowledgeRouter;
let mediumRouter: KnowledgeRouter;

Benchmark: {
  const p1 = new MockDocsProvider(smallDocs);
  smallRouter = new KnowledgeRouter(p1);

  const p2 = new MockDocsProvider(mediumDocs);
  mediumRouter = new KnowledgeRouter(p2);
}

bench('index_build: 10 documents', async () => {
  const p = new MockDocsProvider(smallDocs);
  const r = new KnowledgeRouter(p);
  await r.buildIndex();
});

bench('index_build: 500 documents', async () => {
  const p = new MockDocsProvider(mediumDocs);
  const r = new KnowledgeRouter(p);
  await r.buildIndex();
});

bench('search: keyword query (10 docs)', async () => {
  if (!smallRouter) return;
  await smallRouter.search('类型 编译', { maxResults: 10 });
});

bench('search: keyword query (500 docs)', async () => {
  if (!mediumRouter) return;
  await mediumRouter.search('网络 协议', { maxResults: 10 });
});

bench('search: pagination offset=10', async () => {
  if (!mediumRouter) return;
  await mediumRouter.search('性能 测试', { maxResults: 5, offset: 10 });
});

bench('search: domain filter', async () => {
  if (!mediumRouter) return;
  await mediumRouter.search('部署', { maxResults: 10, domain: '运维' });
});

bench('findByTitle: exact match', () => {
  if (!mediumRouter) return;
  mediumRouter.findByTitle('文档100_技术_2024');
});

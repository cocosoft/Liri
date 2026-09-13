/**
 * B1/B2/B10 富化依赖链单测
 *
 * 覆盖：
 * - B2：SemanticStore 序列化往返保留块链/上下文字段；JsonlVectorStore
 *   getById/getByPath 全字段透传（此前 serialize 仅 6 字段，富化取不到上下文）
 * - B2：parentChildChunk 子块 parentChunkId 为规范 id（此前 `#parent-L` 伪 id 断链）
 * - B10：keyword 命中按关键词所在行回填 startLine/endLine
 */
import { describe, it, expect } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { SemanticStore } from '../semantic/store';
import type { IndexEntry } from '../semantic/store';
import { JsonlVectorStore } from '../semantic/JsonlVectorStore';
import { parentChildChunk } from '../semantic/chunker';
import { KnowledgeRouter } from '../KnowledgeRouter';
import type { FileDocsProvider } from '@modules/docs/FileDocsProvider';
import type { FileDocEntry } from '@modules/docs/FileDocsProvider';

const IDENTITY = { provider: 'local', model: 'b1-b2-b10-test' };

/** 内存模拟 FileDocsProvider（与 KnowledgeRouter.test.ts 同构） */
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

describe('B1/B2/B10 富化依赖链', () => {
  it('B2: SemanticStore 序列化往返保留块链/上下文字段', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kb-b2-'));
    try {
      const entry: IndexEntry = {
        path: 'wiki/a.md',
        startLine: 3,
        endLine: 8,
        text: '分块正文',
        embedding: new Float32Array([0.1, 0.2, 0.3]),
        mtimeMs: 123456,
        contextHeader: '## 部署',
        preChunkId: 'wiki/a.md#L1-L2',
        nextChunkId: 'wiki/a.md#L9-L14',
        parentChunkId: 'wiki/a.md#L1-L14',
      };
      const store = new SemanticStore(dir, IDENTITY);
      await store.add([entry]);

      const reloaded = new SemanticStore(dir, IDENTITY);
      await reloaded.load();
      expect(reloaded.size).toBe(1);
      const e = reloaded.all[0]!;
      expect(e.contextHeader).toBe('## 部署');
      expect(e.preChunkId).toBe('wiki/a.md#L1-L2');
      expect(e.nextChunkId).toBe('wiki/a.md#L9-L14');
      expect(e.parentChunkId).toBe('wiki/a.md#L1-L14');

      // JsonlVectorStore 读取全字段透传（富化 getById/getByPath 依赖）
      const vs = new JsonlVectorStore(dir, IDENTITY);
      await vs.initialize();
      const byId = await vs.getById('wiki/a.md#L3-L8');
      expect(byId?.contextHeader).toBe('## 部署');
      expect(byId?.parentChunkId).toBe('wiki/a.md#L1-L14');
      const byPath = await vs.getByPath('wiki/a.md');
      expect(byPath).toHaveLength(1);
      expect(byPath[0]!.nextChunkId).toBe('wiki/a.md#L9-L14');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('B2: parentChildChunk 子块 parentChunkId 指向规范 id（非 #parent-L 伪 id）', () => {
    const text =
      '# 概述\n\n第一段内容。\n\n## 详情\n\n更多详细说明文字在这里。\n\n## 部署\n\n部署步骤说明。';
    const chunks = parentChildChunk(text, 'wiki/a.md');
    const parent = chunks.find((c) => c.text.startsWith('[摘要]'));
    const child = chunks.find((c) => c.parentChunkId);
    expect(parent).toBeDefined();
    expect(child).toBeDefined();
    expect(child!.parentChunkId).toBe(
      `wiki/a.md#L${parent!.startLine}-L${parent!.endLine}`
    );
    // 父块不再把自身 id 塞进 preChunkId（消除自引用）
    expect(parent!.preChunkId).toBeUndefined();
  });

  it('B10: keyword 命中按关键词所在行回填 startLine/endLine', async () => {
    const provider = new MockDocsProvider([
      {
        title: '目标行号文档',
        content:
          '第一行标题文本\n第二行普通内容\n此处出现目标词命中\n第四行收尾',
        category: '测试',
        path: 'wiki/line-number.md',
      },
    ]);
    const router = new KnowledgeRouter(provider);
    await router.buildIndex();

    const results = await router.search('目标词', { maxResults: 5 });
    const hit = results.find((r) => r.title === '目标行号文档');
    expect(hit).toBeDefined();
    expect(hit!.startLine).toBe(3);
    expect(hit!.endLine).toBe(3);
  });
});

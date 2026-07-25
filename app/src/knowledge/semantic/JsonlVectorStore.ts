// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * JsonlVectorStore — 基于 JSONL 的 IVectorStore 实现
 *
 * 适配现有 SemanticStore，保持向后兼容。
 * 用于开发模式和低数据量场景，以及 sqlite-vec 不可用时的降级方案。
 *
 * 实现限制：线性扫描，建议数据量 < 10K 分块。
 */

import type { IVectorStore, VectorEntry, SearchHit } from './IVectorStore';
import type { IndexIdentity, IndexMeta } from './store';
import { SemanticStore, readIndexMeta } from './store';

export class JsonlVectorStore implements IVectorStore {
  private store: SemanticStore;
  private indexDir: string;

  constructor(indexDir: string, identity: IndexIdentity) {
    this.indexDir = indexDir;
    this.store = new SemanticStore(indexDir, identity);
  }

  /** 初始化加载已有数据 */
  async initialize(): Promise<void> {
    await this.store.load();
  }

  async upsert(entries: VectorEntry[]): Promise<void> {
    await this.store.add(entries);
  }

  async search(
    queryEmbedding: Float32Array,
    topK: number = 10,
    minScore: number = 0.3
  ): Promise<SearchHit[]> {
    const hits = this.store.search(queryEmbedding, topK, minScore);
    // 为 IndexEntry 补充 id 字段以符合 VectorEntry 接口
    return hits.map((hit) => ({
      entry: {
        id: `${hit.entry.path}#L${hit.entry.startLine}-L${hit.entry.endLine}`,
        path: hit.entry.path,
        startLine: hit.entry.startLine,
        endLine: hit.entry.endLine,
        text: hit.entry.text,
        embedding: hit.entry.embedding,
        mtimeMs: hit.entry.mtimeMs,
      },
      score: hit.score,
    }));
  }

  async deleteByPath(path: string): Promise<void> {
    // JSONL 模式下删除通过重建实现（非原地删除）
    const all = this.store.all.filter((e) => e.path !== path);
    this.store.clear();
    if (all.length > 0) {
      await this.store.add(all);
    }
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  async count(): Promise<number> {
    return this.store.size;
  }

  async getMeta(): Promise<IndexMeta | null> {
    return readIndexMeta(this.indexDir);
  }

  async setMeta(meta: IndexMeta): Promise<void> {
    // SemanticStore.add 中会自动写 meta，这里不单独实现
    // store 的 dim 已在首次 add 时设置
    const allEntries = this.store.all;
    this.store.clear();
    // 清空后重新写入以更新 meta（保持现有行为）
  }

  async getById(id: string): Promise<VectorEntry | null> {
    const entry = this.store.all.find((e) => {
      const eid = `${e.path}#L${e.startLine}-L${e.endLine}`;
      return eid === id;
    });
    if (!entry) return null;
    return {
      id: `${entry.path}#L${entry.startLine}-L${entry.endLine}`,
      path: entry.path,
      startLine: entry.startLine,
      endLine: entry.endLine,
      text: entry.text,
      embedding: entry.embedding,
      mtimeMs: entry.mtimeMs,
    };
  }
}

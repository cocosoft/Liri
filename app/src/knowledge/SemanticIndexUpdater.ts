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
 * 语义索引更新器
 *
 * 监听 knowledge:changed 事件，对新增/更新的知识文件进行分块、嵌入，
 * 并将结果增量追加到 SemanticStore 中。
 */

import { readFile, stat } from 'fs/promises';
import { relative, resolve } from 'path';

import { LogLevel } from '@modules/monitoring';
import { OTelAwareLogger } from '@modules/monitoring/logs/OTelAwareLogger';
import { handleError } from '@modules/error';
import type { EventBus } from '@modules/core';
import type { EmbeddingManager } from '@modules/ai';
import { autoChunk } from '@modules/knowledge/semantic/chunker';
import type { IndexEntry } from '@modules/knowledge/semantic/store';
import type { IVectorStore } from '@modules/knowledge/semantic/IVectorStore';
import { createVectorStore } from '@modules/knowledge/semantic/VectorStoreFactory';
import { JsonlVectorStore } from '@modules/knowledge/semantic/JsonlVectorStore';

const logger = new OTelAwareLogger({
  module: 'knowledge:semantic:updater',
  level: LogLevel.INFO,
});

/** 知识变更事件载荷 */
export interface KnowledgeChangedEvent {
  action: 'created' | 'updated' | 'deleted';
  /** 单文件变更（上传 / 保存 / 删除场景） */
  filePath?: string;
  /**
   * 批量文件变更（编译场景：一次产出 N 个页面）。
   * 历史坑（2026-09-11 修复）：编译侧曾传知识库**根目录**，本订阅者对其
   * `readFile(目录)` → EISDIR 被 handleError 静默吞掉 → 语义索引长期空转。
   */
  filePaths?: string[];
}

/** SemanticIndexUpdater 选项 */
export interface SemanticIndexUpdaterOptions {
  /** 索引存储目录 */
  indexDir: string;
  /** 知识库根目录（用于把绝对 filePath 归一化为相对知识根的路径，与 builder 一致） */
  knowledgeRoot?: string;
  /** 嵌入 Provider ID */
  embedProvider?: string;
  /** 嵌入模型名称 */
  embedModel?: string;
  /** 分块窗口行数，默认 60 */
  windowLines?: number;
  /** 分块重叠行数，默认 12 */
  overlap?: number;
  /** 复用外部已创建的向量存储实例（与 KnowledgeRouter 共享写读同一实例，B0/B3 收敛）；缺省由 VectorStoreFactory 自建 */
  store?: IVectorStore;
}

/**
 * 语义索引更新器
 *
 * 监听事件总线上的 knowledge:changed 事件，自动将知识文件增量索引到 SemanticStore。
 * 删除事件被忽略（由全量重建或定期 GC 清理）。
 */
export class SemanticIndexUpdater {
  private store: IVectorStore;
  private embeddingManager: EmbeddingManager;
  private options: Omit<
    Required<SemanticIndexUpdaterOptions>,
    'knowledgeRoot' | 'store'
  > & { knowledgeRoot?: string; store?: IVectorStore };
  private initialized = false;

  constructor(
    embeddingManager: EmbeddingManager,
    options: SemanticIndexUpdaterOptions,
    eventBus?: EventBus
  ) {
    this.embeddingManager = embeddingManager;
    const { store, ...rest } = options;
    this.options = {
      embedProvider: 'local',
      embedModel: 'nomic-embed-text',
      windowLines: 60,
      overlap: 12,
      ...rest,
    };

    // 复用外部传入的共享向量存储实例（与 KnowledgeRouter 写读同实例，B0/B3 收敛）；
    // 缺省由工厂创建（当前唯一实现 JsonlVectorStore，B5 已下架 sqlite_vec）
    this.store =
      store ??
      createVectorStore(this.options.indexDir, {
        provider: this.options.embedProvider,
        model: this.options.embedModel,
      });

    eventBus?.subscribe('knowledge:changed', (event: unknown) => {
      const evt = event as KnowledgeChangedEvent;
      // 批量优先：编译一次产出 N 个页面 → 单事件 + 逐文件索引
      // （避免"传目录"路径再次触发 EISDIR；若逐页 publish 则会放大 N 次全量重建）
      const targets =
        evt.filePaths && evt.filePaths.length > 0
          ? evt.filePaths
          : evt.filePath
            ? [evt.filePath]
            : [];
      if (evt.action === 'deleted') {
        for (const target of targets) {
          // KB-SEM（2026-08-27）：删除事件不再忽略——HTTP 层 trash/delete 已接入，
          // 同步清理索引中该文件的旧条目（原实现只增不删，已删文档可被搜索命中）
          this.removeFromIndex(target).catch((err) => {
            void handleError(err, {
              module: 'knowledge:semantic',
              action: 'remove_index',
              context: { filePath: target },
            });
          });
        }
      } else if (targets.length > 1) {
        // 编译场景（一次 N 个页面）：批量写入，避免 N 次全量重写索引文件
        this.appendIndexBatch(targets).catch((err) => {
          void handleError(err, {
            module: 'knowledge:semantic',
            action: 'append_index_batch',
            context: { count: targets.length },
          });
        });
      } else if (targets.length === 1) {
        this.appendIndex(targets[0]).catch((err) => {
          void handleError(err, {
            module: 'knowledge:semantic',
            action: 'append_index',
            context: { filePath: targets[0] },
          });
        });
      }
    });
  }

  /**
   * 初始化：加载已有索引
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.store instanceof JsonlVectorStore) {
      await this.store.initialize();
    }
    this.initialized = true;
  }

  /**
   * 从绝对路径提取索引相对路径
   *
   * KB-SEM（2026-08-27）：优先相对知识库根目录（与 builder 的 chunk.path 约定一致），
   * 原实现相对 indexDir 父目录（~/.pyapp/data），导致 updater 与 builder 的
   * entry.path 不一致，KnowledgeRouter 按 docPath 映射标题时无法命中
   */
  private toRelPath(filePath: string): string {
    const base =
      this.options.knowledgeRoot ?? resolve(this.options.indexDir, '..');
    return relative(base, filePath).replace(/\\/g, '/');
  }

  /**
   * 从索引中移除单个文件的全部条目（deleted 事件）
   */
  async removeFromIndex(filePath: string): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
    const relPath = this.toRelPath(filePath);
    await this.store.deleteByPath(relPath);
    logger.info('语义索引删除条目完成', { filePath, relPath });
  }

  /**
   * 批量增量索引（编译场景：一次产出 N 个页面）
   *
   * 为什么需要它：`JsonlVectorStore` 每次写入都会重写整个 index.jsonl（实测 204MB）。
   * 若对 N 个文件逐个调用 `appendIndex`（每个 2 次 store 写）→ 2N 次全量重写 →
   * 索引读写长时间阻塞（现象：`/v1/semantic/index/status` 直接 15s 超时）。
   * 本方法把 N 个文件的"删旧 + 写新"合并为**一次** store 写入。
   */
  async appendIndexBatch(filePaths: string[]): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
    if (filePaths.length === 0) return;

    const allEntries: Parameters<IVectorStore['upsert']>[0] = [];
    const relPaths: string[] = [];

    for (const filePath of filePaths) {
      try {
        const content = await readFile(filePath, 'utf-8');
        const fileStat = await stat(filePath);
        const relPath = this.toRelPath(filePath);
        const chunks = autoChunk(content, relPath, {
          windowLines: this.options.windowLines,
          overlap: this.options.overlap,
        });
        if (chunks.length === 0) continue;
        relPaths.push(relPath);
        for (const chunk of chunks) {
          try {
            const vec = await this.embeddingManager.embedOne(chunk.text);
            if (vec && vec.length > 0) {
              allEntries.push({
                ...chunk,
                id: `${chunk.path}#L${chunk.startLine}-L${chunk.endLine}`,
                embedding: new Float32Array(vec),
                mtimeMs: fileStat.mtimeMs,
              });
            }
          } catch (err) {
            logger.warn('分块嵌入失败，跳过', {
              path: chunk.path,
              error: String(err),
            });
          }
        }
      } catch (err) {
        logger.warn('批量索引：读取文件失败，跳过', {
          filePath,
          error: String(err),
        });
      }
    }

    // 一次删旧 + 一次写新
    for (const relPath of relPaths) {
      await this.store.deleteByPath(relPath);
    }
    if (allEntries.length > 0) {
      await this.store.upsert(allEntries);
    }
    logger.info('语义索引批量更新完成', {
      files: relPaths.length,
      entriesAdded: allEntries.length,
    });
  }

  /**
   * 对单个知识文件进行增量索引
   */
  async appendIndex(filePath: string): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      const fileStat = await stat(filePath);

      // 从绝对路径提取相对路径（相对于知识库根目录，与 builder 一致）
      const relPath = this.toRelPath(filePath);

      // 分块（使用自适应策略：标题感知 → 行窗口 fallback）
      const chunks = autoChunk(content, relPath, {
        windowLines: this.options.windowLines,
        overlap: this.options.overlap,
      });

      if (chunks.length === 0) return;

      // 嵌入
      const entries: IndexEntry[] = [];
      const mtimeMs = fileStat.mtimeMs;

      for (const chunk of chunks) {
        try {
          const vec = await this.embeddingManager.embedOne(chunk.text);
          if (vec && vec.length > 0) {
            // B2（2026-09-08）：携带 chunker 的块链/上下文字段（pre/next/parent/
            // contextHeader/page/section/tableId），供 KnowledgeRouter 富化 getById
            entries.push({
              ...chunk,
              embedding: new Float32Array(vec),
              mtimeMs,
            });
          }
        } catch (err) {
          logger.warn('分块嵌入失败，跳过', {
            path: chunk.path,
            error: String(err),
          });
        }
      }

      if (entries.length > 0) {
        // 先删除旧索引，再写入新索引
        await this.store.deleteByPath(relPath);
        await this.store.upsert(
          entries.map((e) => ({
            ...e,
            id: `${e.path}#L${e.startLine}-L${e.endLine}`,
          }))
        );
        logger.info('语义索引增量更新完成', {
          filePath,
          entriesAdded: entries.length,
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('语义索引增量更新失败', { filePath, error: msg });
    }
  }
}

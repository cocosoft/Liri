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
  filePath: string;
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
    'knowledgeRoot'
  > & { knowledgeRoot?: string };
  private initialized = false;

  constructor(
    embeddingManager: EmbeddingManager,
    options: SemanticIndexUpdaterOptions,
    eventBus?: EventBus
  ) {
    this.embeddingManager = embeddingManager;
    this.options = {
      embedProvider: 'local',
      embedModel: 'nomic-embed-text',
      windowLines: 60,
      overlap: 12,
      ...options,
    };

    // 使用工厂创建向量存储（根据 VECTOR_STORE 环境变量选择实现）
    this.store = createVectorStore(this.options.indexDir, {
      provider: this.options.embedProvider,
      model: this.options.embedModel,
    });

    eventBus?.subscribe('knowledge:changed', (event: unknown) => {
      const evt = event as KnowledgeChangedEvent;
      if (evt.action === 'deleted') {
        // KB-SEM（2026-08-27）：删除事件不再忽略——HTTP 层 trash/delete 已接入，
        // 同步清理索引中该文件的旧条目（原实现只增不删，已删文档可被搜索命中）
        this.removeFromIndex(evt.filePath).catch((err) => {
          void handleError(err, {
            module: 'knowledge:semantic',
            action: 'remove_index',
            context: { filePath: evt.filePath },
          });
        });
      } else {
        this.appendIndex(evt.filePath).catch((err) => {
          void handleError(err, {
            module: 'knowledge:semantic',
            action: 'append_index',
            context: { filePath: evt.filePath },
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
            entries.push({
              path: chunk.path,
              startLine: chunk.startLine,
              endLine: chunk.endLine,
              text: chunk.text,
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
            id: `${e.path}#L${e.startLine}-L${e.endLine}`,
            path: e.path,
            startLine: e.startLine,
            endLine: e.endLine,
            text: e.text,
            embedding: e.embedding,
            mtimeMs: e.mtimeMs,
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

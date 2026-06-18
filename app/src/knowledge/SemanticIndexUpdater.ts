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

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { handleError } from '@modules/error/handleError';
import type { EventBus } from '@modules/core/events/EventBus';
import type { EmbeddingManager } from '@modules/ai/embedding/EmbeddingManager';
import { chunkText } from '@modules/knowledge/semantic/chunker';
import { SemanticStore } from '@modules/knowledge/semantic/store';
import type { IndexEntry } from '@modules/knowledge/semantic/store';

const logger = new Logger({ level: LogLevel.INFO });

/** 知识变更事件载荷 */
export interface KnowledgeChangedEvent {
  action: 'created' | 'updated' | 'deleted';
  filePath: string;
}

/** SemanticIndexUpdater 选项 */
export interface SemanticIndexUpdaterOptions {
  /** 索引存储目录 */
  indexDir: string;
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
  private store: SemanticStore;
  private embeddingManager: EmbeddingManager;
  private options: Required<SemanticIndexUpdaterOptions>;
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

    this.store = new SemanticStore(this.options.indexDir, {
      provider: this.options.embedProvider,
      model: this.options.embedModel,
    });

    eventBus?.subscribe('knowledge:changed', (event: unknown) => {
      const evt = event as KnowledgeChangedEvent;
      if (evt.action !== 'deleted') {
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
    await this.store.load();
    this.initialized = true;
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

      // 从绝对路径提取相对路径（相对于 indexDir 的父目录）
      const indexParent = resolve(this.options.indexDir, '..');
      const relPath = relative(indexParent, filePath).replace(/\\/g, '/');

      // 分块
      const chunks = chunkText(
        content,
        relPath,
        this.options.windowLines,
        this.options.overlap
      );

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
        await this.store.add(entries);
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

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
 * 语义索引构建器 (IndexBuilder)
 *
 * 编排完整索引构建流程：分块 → 嵌入 → 存储。
 * 支持增量更新（按文件修改时间跳过未变更的文件）。
 *
 * 借鉴: DeepSeek-Reasonix src/index/semantic/builder.ts
 */

import { Logger } from '@modules/monitoring/logs/Logger';
import { chunkDirectory } from './chunker';
import type { CodeChunk, ChunkOptions } from './chunker';
import {
  EmbeddingManager,
  globalEmbeddingManager,
} from '@modules/ai/embedding/EmbeddingManager';
import { SemanticStore, readIndexMeta, wipeStoreFiles } from './store';
import type { IndexEntry, IndexMeta } from './store';
import { resolveDataSubDir } from '@modules/core/paths';

const logger = new Logger();

/** 构建器配置 */
export interface BuildConfig {
  /** 项目根目录 */
  rootDir: string;
  /** 嵌入模型名称（默认 nomic-embed-text） */
  embedModel?: string;
  /** 嵌入 Provider ID（默认 'local'） */
  embedProvider?: string;
  /** 分块选项 */
  chunkOptions?: ChunkOptions;
  /** 索引存储目录（默认 ~/.pyapp/data/semantic-index/） */
  indexDir?: string;
  /** 是否增量构建（跳过未修改的文件） */
  incremental?: boolean;
  /** 进度回调 */
  onProgress?: (phase: string, done: number, total: number) => void;
}

/** 构建结果 */
export interface BuildResult {
  ok: boolean;
  chunkCount: number;
  embeddedCount: number;
  skippedCount: number;
  durationMs: number;
  indexDir: string;
  error?: string;
}

/**
 * 语义索引构建器
 */
export class IndexBuilder {
  /**
   * 构建完整索引
   */
  async build(config: BuildConfig): Promise<BuildResult> {
    const t0 = Date.now();
    const indexDir = config.indexDir ?? resolveDataSubDir('semantic-index');
    const incremental = config.incremental ?? true;
    const embedProvider = config.embedProvider ?? 'local';
    const embedModel = config.embedModel ?? 'nomic-embed-text';

    // 确保 EmbeddingManager 已初始化
    globalEmbeddingManager.initialize();

    try {
      // Phase 1: 分块
      config.onProgress?.('chunking', 0, 1);
      const chunkOpts = config.chunkOptions ?? {};
      const chunks = await chunkDirectory(config.rootDir, chunkOpts);
      config.onProgress?.('chunking', chunks.length, chunks.length);

      if (chunks.length === 0) {
        return {
          ok: true,
          chunkCount: 0,
          embeddedCount: 0,
          skippedCount: 0,
          durationMs: Date.now() - t0,
          indexDir,
        };
      }

      // Phase 2: 增量过滤
      let toEmbed = chunks;
      if (incremental) {
        const meta = await readIndexMeta(indexDir);
        if (meta) {
          const store = new SemanticStore(indexDir, {
            provider: embedProvider,
            model: embedModel,
          });
          await store.load();
          const existingMtims = new Map<string, number>();
          for (const entry of store.all) {
            existingMtims.set(entry.path, entry.mtimeMs);
          }
          toEmbed = chunks.filter((c) => {
            const existing = existingMtims.get(c.path);
            // 如果文件已有索引且未修改，跳过
            return existing === undefined;
          });
        }
      }

      const skippedCount = chunks.length - toEmbed.length;
      config.onProgress?.('filtering', chunks.length, chunks.length);

      if (toEmbed.length === 0) {
        return {
          ok: true,
          chunkCount: chunks.length,
          embeddedCount: 0,
          skippedCount,
          durationMs: Date.now() - t0,
          indexDir,
        };
      }

      // Phase 3: 嵌入
      config.onProgress?.('embedding', 0, toEmbed.length);
      const texts = toEmbed.map((c) => c.text);
      const embeddings: Array<Float32Array | null> = [];
      let embeddedCount = 0;

      for (let i = 0; i < texts.length; i++) {
        try {
          const vec = await globalEmbeddingManager.embedOne(texts[i]!);
          if (vec && vec.length > 0) {
            embeddings.push(new Float32Array(vec));
          } else {
            embeddings.push(null);
          }
        } catch (err) {
          logger.warn('Embedding failed for chunk', {
            index: i,
            error: String(err),
          });
          embeddings.push(null);
        }

        config.onProgress?.('embedding', i + 1, texts.length);
      }

      // Phase 4: 组装条目
      const entries: IndexEntry[] = [];
      for (let i = 0; i < toEmbed.length; i++) {
        const chunk = toEmbed[i]!;
        const emb = embeddings[i];
        if (!emb) continue;
        entries.push({
          path: chunk.path,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          text: chunk.text,
          embedding: emb,
          mtimeMs: Date.now(),
        });
        embeddedCount++;
      }

      // Phase 5: 存储
      config.onProgress?.('storing', entries.length, entries.length);
      if (incremental && entries.length > 0) {
        // 增量模式：追加新条目
        const store = new SemanticStore(indexDir, {
          provider: embedProvider ?? 'local',
          model: embedModel ?? 'nomic-embed-text',
        });
        await store.add(entries);
      } else {
        // 全量模式：清空后重建
        await wipeStoreFiles(indexDir);
        const store = new SemanticStore(indexDir, {
          provider: embedProvider,
          model: embedModel,
        });
        await store.add(entries);
      }

      logger.info('Index build complete', {
        chunks: chunks.length,
        embedded: embeddedCount,
        skipped: skippedCount,
        durationMs: Date.now() - t0,
      });

      return {
        ok: true,
        chunkCount: chunks.length,
        embeddedCount,
        skippedCount,
        durationMs: Date.now() - t0,
        indexDir,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Index build failed', { error: msg });
      return {
        ok: false,
        chunkCount: 0,
        embeddedCount: 0,
        skippedCount: 0,
        durationMs: Date.now() - t0,
        indexDir,
        error: msg,
      };
    }
  }

  /**
   * 检查本地嵌入提供者是否可用
   */
  async checkOllama(
    _baseUrl?: string
  ): Promise<{ ok: boolean; models: string[]; error?: string }> {
    const provider = globalEmbeddingManager.getProvider('local');
    if (!provider) {
      return {
        ok: false,
        models: [],
        error: 'Local embedding provider not registered',
      };
    }

    const available = await provider.isAvailable();
    if (available) {
      return { ok: true, models: [] };
    }
    return {
      ok: false,
      models: [],
      error: 'Local embedding provider not available',
    };
  }
}

/** 默认构建器实例 */
export const indexBuilder = new IndexBuilder();

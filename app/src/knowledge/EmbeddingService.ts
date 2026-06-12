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
 * 统一 Embedding 服务 — EmbeddingService
 *
 * 封装现有的 embed() / embedAll() 函数，提供：
 *   1. 统一的配置管理（一次配置，到处使用）
 *   2. 知识库感知识别（wiki 页面嵌入 + 搜索）
 *   3. 缓存降低重复嵌入开销
 *
 * 底层复用 knowledge/semantic/embedding.ts，不重复实现向量生成逻辑。
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import {
  embed,
  embedAll,
  probeOllama,
} from '@modules/knowledge/semantic/embedding';
import type { EmbedOptions } from '@modules/knowledge/semantic/embedding';
import { resolveKnowledgeDir } from '@modules/core/paths';
import { IndexManager } from './IndexManager';

const logger = new Logger({ level: LogLevel.INFO });

/** Embedding 服务配置 */
export interface EmbeddingServiceConfig {
  /** 提供者: ollama | openai-compat */
  provider: 'ollama' | 'openai-compat';
  /** 模型名，ollama 默认 nomic-embed-text */
  model: string;
  /** baseUrl，ollama 默认 http://localhost:11434 */
  baseUrl?: string;
  /** openai-compat 需要 apiKey */
  apiKey?: string;
  /** 超时（毫秒），默认 180s */
  timeoutMs: number;
  /** 批处理大小，默认 10 */
  batchSize: number;
}

/** 搜索命中结果 */
export interface EmbeddingSearchHit {
  /** 页面文件名 */
  filename: string;
  /** 页面标题 */
  title: string;
  /** 余弦相似度 */
  score: number;
  /** 内容摘要（前 200 字） */
  snippet: string;
}

const DEFAULT_CONFIG: EmbeddingServiceConfig = {
  provider: 'ollama',
  model: 'nomic-embed-text',
  timeoutMs: 180_000,
  batchSize: 10,
};

/**
 * 统一 Embedding 服务
 */
export class EmbeddingService {
  private config: EmbeddingServiceConfig;
  private knowledgeRoot: string;
  private indexManager: IndexManager;
  /** 简单 LRU 缓存: text → vector */
  private cache: Map<string, Float32Array>;
  private readonly CACHE_SIZE = 100;

  /**
   * @param config 配置
   * @param knowledgeRoot 知识库根目录
   */
  constructor(config?: Partial<EmbeddingServiceConfig>, knowledgeRoot?: string) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.knowledgeRoot = knowledgeRoot || resolveKnowledgeDir();
    this.indexManager = new IndexManager(this.knowledgeRoot);
    this.cache = new Map();
  }

  /**
   * 生成单个文本的嵌入向量
   */
  async embedText(text: string): Promise<Float32Array> {
    // 缓存命中
    const cached = this.cache.get(text);
    if (cached) return cached;

    const opts = this.buildOptions();
    const vector = await embed(text, opts);

    // 写入缓存
    if (this.cache.size >= this.CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(text, vector);

    return vector;
  }

  /**
   * 批量生成嵌入向量
   */
  async embedBatch(texts: string[]): Promise<Array<Float32Array | null>> {
    const opts: EmbedOptions & {
      onProgress?: (done: number, total: number) => void;
      onError?: (index: number, err: unknown) => void;
    } = {
      ...this.buildOptions(),
      onProgress: (done, total) => {
        if (done % 10 === 0 || done === total) {
          logger.debug(`Embedding 进度: ${done}/${total}`);
        }
      },
      onError: (index, err) => {
        logger.warn(`第 ${index} 个文本 embedding 失败`, { error: err });
      },
    };

    return await embedAll(texts, opts);
  }

  /**
   * 嵌入单个 wiki 页面
   * @param filename 页面文件名（含 .md）
   * @returns 向量或 null（读取失败时）
   */
  async embedWikiPage(filename: string): Promise<Float32Array | null> {
    try {
      const content = await readFile(join(this.knowledgeRoot, filename), 'utf-8');
      // 只对正文（去除 frontmatter）做嵌入
      const body = this.stripFrontmatter(content);
      const text = body.slice(0, 2000); // 限制长度
      return await this.embedText(text);
    } catch {
      logger.warn(`嵌入页面失败: ${filename}`);
      return null;
    }
  }

  /**
   * 搜索知识库中最相似的页面
   * @param query 查询文本
   * @param topK 返回条数
   * @returns 按相似度降序排列的结果
   */
  async searchWiki(query: string, topK: number = 5): Promise<EmbeddingSearchHit[]> {
    const pages = await this.indexManager.listPages();
    if (pages.length === 0) return [];

    // 生成查询向量
    const queryVec = await this.embedText(query);

    // 批量嵌入所有页面
    const results: EmbeddingSearchHit[] = [];

    for (const filename of pages) {
      const pageVec = await this.embedWikiPage(filename);
      if (!pageVec) continue;

      const score = this.cosineSimilarity(queryVec, pageVec);
      if (score < 0.3) continue; // 低分过滤

      let title = filename.replace(/\.md$/, '');
      let snippet = '';

      try {
        const content = await readFile(join(this.knowledgeRoot, filename), 'utf-8');
        const titleMatch = content.match(/^title:\s*(.+)$/m);
        if (titleMatch) title = titleMatch[1].trim().replace(/["'"]/g, '');

        const body = this.stripFrontmatter(content);
        snippet = body.replace(/[#*`\[\]]/g, '').trim().slice(0, 200);
      } catch {
        snippet = '';
      }

      results.push({ filename, title, score, snippet });
    }

    // 按相似度降序排列
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /**
   * 探活 embedding 服务
   */
  async probe(): Promise<{ ok: boolean; error?: string }> {
    if (this.config.provider === 'ollama') {
      const result = await probeOllama({ baseUrl: this.config.baseUrl });
      return result;
    }
    // openai-compat 探活通过一次简单嵌入验证
    try {
      await this.embedText('ping');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<EmbeddingServiceConfig>): void {
    this.config = { ...this.config, ...config };
    this.cache.clear(); // 配置变更时清空缓存
  }

  // -----------------------------------------------------------------------
  // 内部工具
  // -----------------------------------------------------------------------

  /**
   * 构建 EmbedOptions
   */
  private buildOptions(): EmbedOptions {
    if (this.config.provider === 'openai-compat') {
      return {
        provider: 'openai-compat',
        baseUrl: this.config.baseUrl || '',
        apiKey: this.config.apiKey || '',
        model: this.config.model,
        timeoutMs: this.config.timeoutMs,
        batchSize: this.config.batchSize,
      };
    }
    return {
      provider: 'ollama',
      baseUrl: this.config.baseUrl,
      model: this.config.model,
      timeoutMs: this.config.timeoutMs,
    };
  }

  /**
   * 移除 YAML frontmatter
   */
  private stripFrontmatter(content: string): string {
    const match = content.match(/^---[\s\S]*?---\n*/);
    return match ? content.slice(match[0].length) : content;
  }

  /**
   * 余弦相似度
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dotProduct / denom;
  }
}

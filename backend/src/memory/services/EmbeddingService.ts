/**
 * 向量嵌入服务
 * 为记忆生成向量嵌入，支持语义搜索
 */

import type { AIProvider } from '@modules/ai/providers';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 嵌入结果
 */
export interface EmbeddingResult {
  /**
   * 原始文本
   */
  text: string;
  /**
   * 向量嵌入
   */
  vector: number[];
  /**
   * 模型名称
   */
  model: string;
  /**
   * 维度数量
   */
  dimensions: number;
}

/**
 * 嵌入服务配置
 */
export interface EmbeddingServiceConfig {
  /**
   * 默认嵌入模型
   */
  defaultModel: string;
  /**
   * 是否启用缓存
   */
  enableCache?: boolean;
  /**
   * 最大缓存条目数
   */
  maxCacheSize?: number;
}

/**
 * 嵌入服务抽象接口
 */
export interface IEmbeddingService {
  /**
   * 为单条文本生成向量嵌入
   * @param text 待嵌入的文本
   * @param model 可选模型
   */
  embed(text: string, model?: string): Promise<EmbeddingResult>;

  /**
   * 为多条文本批量生成向量嵌入
   * @param texts 文本数组
   * @param model 可选模型
   */
  embedBatch(texts: string[], model?: string): Promise<EmbeddingResult[]>;

  /**
   * 计算两条文本的余弦相似度
   * @param text1 文本1
   * @param text2 文本2
   */
  similarity(text1: string, text2: string): Promise<number>;
}

/**
 * 嵌入缓存条目
 */
interface CacheEntry {
  result: EmbeddingResult;
  timestamp: number;
}

/**
 * 内存缓存的向量嵌入服务
 * 包含 OpenAI/DeepSeek 兼容的调用接口
 */
export class EmbeddingService implements IEmbeddingService {
  private config: EmbeddingServiceConfig;
  private aiProvider?: AIProvider;
  private cache: Map<string, CacheEntry> = new Map();

  constructor(config: EmbeddingServiceConfig, aiProvider?: AIProvider) {
    this.config = {
      enableCache: true,
      maxCacheSize: 1000,
      ...config,
    };
    this.aiProvider = aiProvider;
  }

  /**
   * 计算文本的哈希（用于缓存键）
   */
  private hash(text: string, model: string): string {
    return `${model}:${text}`;
  }

  /**
   * 清理过期/超出大小限制的缓存
   */
  private cleanCache(): void {
    if (this.cache.size <= (this.config.maxCacheSize || 1000)) {
      return;
    }
    const keys = Array.from(this.cache.entries())
      .sort(([_, a], [__, b]) => a.timestamp - b.timestamp)
      .map(([key]) => key);
    const removeCount = keys.length - (this.config.maxCacheSize || 1000);
    for (let i = 0; i < removeCount; i++) {
      this.cache.delete(keys[i]);
    }
  }

  /**
   * 生成简单的本地嵌入（用于未配置 AI 时的兜底方案）
   * 使用字符频率特征+伪随机数生成384维向量
   */
  private generateLocalEmbedding(text: string): EmbeddingResult {
    const vector: number[] = [];
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash = hash & hash;
    }
    const seed = Math.abs(hash % 10000);

    for (let i = 0; i < 384; i++) {
      let value = 0;
      const charIndex = i % text.length || 0;
      value += (text.charCodeAt(charIndex) || 0) / 256;

      const r = (seed + i * 13) % 1000;
      value += r / 1000;
      vector.push(Math.min(1, Math.max(-1, value)));
    }
    const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
    const normalized = vector.map((x) => x / (norm || 1));
    return {
      text,
      vector: normalized,
      model: 'local-simple',
      dimensions: 384,
    };
  }

  /**
   * 调用远程 API 生成嵌入（兼容 OpenAI/DeepSeek v1 端点）
   */
  private async callRemoteEmbedding(
    text: string,
    model: string
  ): Promise<EmbeddingResult> {
    const provider = this.aiProvider as any;
    if (!provider) {
      return this.generateLocalEmbedding(text);
    }

    const apiKey =
      process.env[`${provider.id?.toUpperCase() || 'OPENAI'}_API_KEY`] || '';
    const baseUrl =
      process.env[`${provider.id?.toUpperCase() || 'OPENAI'}_BASE_URL`] ||
      'https://api.openai.com';
    const embeddingUrl = `${baseUrl.replace(/\/+$/, '')}/v1/embeddings`;

    try {
      const response = await fetch(embeddingUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: text,
        }),
      });

      if (!response.ok) {
        logger.warn(
          `远程嵌入 API (${provider.id}) 调用失败: ${response.status}，切换到本地模式`
        );
        return this.generateLocalEmbedding(text);
      }

      const data = (await response.json()) as any;
      const vector = data.data?.[0]?.embedding as number[];
      if (!vector) {
        return this.generateLocalEmbedding(text);
      }

      return {
        text,
        vector,
        model,
        dimensions: vector.length,
      };
    } catch (err) {
      logger.warn(`调用嵌入 API 时出错，切换到本地模式: ${err}`);
      return this.generateLocalEmbedding(text);
    }
  }

  /**
   * 生成向量嵌入
   */
  async embed(text: string, model?: string): Promise<EmbeddingResult> {
    const useModel = model || this.config.defaultModel;
    const cacheKey = this.hash(text, useModel);

    if (this.config.enableCache && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!.result;
    }

    let result: EmbeddingResult;
    if (useModel === 'local-simple') {
      result = this.generateLocalEmbedding(text);
    } else {
      result = await this.callRemoteEmbedding(text, useModel);
    }

    if (this.config.enableCache) {
      this.cache.set(cacheKey, {
        result,
        timestamp: Date.now(),
      });
      this.cleanCache();
    }
    return result;
  }

  /**
   * 批量生成向量嵌入
   */
  async embedBatch(
    texts: string[],
    model?: string
  ): Promise<EmbeddingResult[]> {
    return Promise.all(texts.map((text) => this.embed(text, model)));
  }

  /**
   * 计算两条文本的余弦相似度
   */
  async similarity(text1: string, text2: string): Promise<number> {
    const [emb1, emb2] = await Promise.all([
      this.embed(text1),
      this.embed(text2),
    ]);
    return this.cosineSimilarity(emb1.vector, emb2.vector);
  }

  /**
   * 余弦相似度计算
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new AppError(
        '向量维度不匹配',
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'INVALID_INPUT'
      );
    }
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cache.clear();
  }
}

export default EmbeddingService;

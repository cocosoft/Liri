/**
 * 嵌入模型抽象基类
 * 提供统一的文本嵌入接口
 * 可选依赖：使用前需确保 API 密钥或本地模型就绪
 */

/**
 * 嵌入请求选项
 */
export interface EmbeddingOptions {
  /** 模型名称（如 text-embedding-3-small） */
  model?: string;
  /** 向量维度（部分模型支持降维） */
  dimensions?: number;
  /** 批处理大小 */
  batchSize?: number;
}

/**
 * 嵌入结果
 */
export interface EmbeddingResult {
  /** 向量数组 */
  embeddings: number[][];
  /** 模型名称 */
  model: string;
  /** 输入词元数 */
  usage: { promptTokens: number; totalTokens: number };
}

/**
 * 嵌入模型抽象基类
 *
 * @example
 * ```typescript
 * class OpenAIEmbeddingProvider extends EmbeddingBase {
 *   async embed(texts: string[], options?: EmbeddingOptions): Promise<EmbeddingResult> {
 *     // 调用 OpenAI Embeddings API
 *   }
 * }
 * ```
 */
export abstract class EmbeddingBase {
  /** 模型名称 */
  abstract readonly modelName: string;

  /** 向量维度 */
  abstract readonly dimensions: number;

  /**
   * 将文本转换为向量
   * @param texts 文本列表
   * @param options 嵌入选项
   * @returns 嵌入结果
   */
  abstract embed(
    texts: string[],
    options?: EmbeddingOptions
  ): Promise<EmbeddingResult>;

  /**
   * 单文本嵌入（便捷方法）
   */
  async embedOne(text: string, options?: EmbeddingOptions): Promise<number[]> {
    const result = await this.embed([text], options);
    return result.embeddings[0];
  }

  /**
   * 检查模型是否可用
   * 子类可重写以检查 API 密钥或本地模型就绪状态
   */
  async isAvailable(): Promise<boolean> {
    return true;
  }

  /**
   * 计算两个向量的余弦相似度
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('向量维度不匹配');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }
}

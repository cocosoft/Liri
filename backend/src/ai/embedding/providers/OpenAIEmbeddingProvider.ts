/**
 * OpenAI 嵌入模型实现
 * 支持 text-embedding-3-small / text-embedding-3-large / text-embedding-ada-002
 */

import { EmbeddingBase, EmbeddingOptions, EmbeddingResult } from '../EmbeddingBase';

/**
 * OpenAI 嵌入模型配置
 */
export interface OpenAIEmbeddingConfig {
  /** API 密钥（默认从环境变量读取） */
  apiKey?: string;
  /** API 基础 URL */
  baseURL?: string;
  /** 模型名称 */
  model?: string;
  /** 向量维度 */
  dimensions?: number;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/**
 * OpenAI 嵌入提供者
 * 支持 text-embedding-3-small (256~1536维) 和 text-embedding-3-large (256~3072维)
 */
export class OpenAIEmbeddingProvider extends EmbeddingBase {
  readonly modelName: string;

  readonly dimensions: number;

  private readonly apiKey: string;

  private readonly baseURL: string;

  constructor(config: OpenAIEmbeddingConfig = {}) {
    super();
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || '';
    this.modelName = config.model || 'text-embedding-3-small';
    this.dimensions = config.dimensions || 1536;
    this.baseURL = config.baseURL || process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
  }

  /**
   * 将文本转换为向量
   */
  async embed(
    texts: string[],
    options?: EmbeddingOptions
  ): Promise<EmbeddingResult> {
    const model = options?.model || this.modelName;
    const dimensions = options?.dimensions || this.dimensions;

    const body: Record<string, unknown> = {
      model,
      input: texts,
    };

    // text-embedding-3 系列支持 dimensions 参数
    if (model.startsWith('text-embedding-3')) {
      body.dimensions = dimensions;
    }

    const response = await fetch(`${this.baseURL}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI Embedding API 错误 (${response.status}): ${error}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
      usage: { prompt_tokens: number; total_tokens: number };
      model: string;
    };

    // 按输入顺序排列结果
    const sorted = data.data.sort((a, b) => a.index - b.index);

    return {
      embeddings: sorted.map((item) => item.embedding),
      model: data.model,
      usage: {
        promptTokens: data.usage.prompt_tokens,
        totalTokens: data.usage.total_tokens,
      },
    };
  }

  /**
   * 检查模型是否可用（需要 API 密钥）
   */
  override async isAvailable(): Promise<boolean> {
    return this.apiKey.length > 0;
  }
}

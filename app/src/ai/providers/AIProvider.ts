import type {
  ChatMessage,
  ChatResponse,
  ToolDefinition,
} from '../models/types';
import type { ThinkingConfig } from '../clients/thinking';
import type { IToolExecutor, ToolRegistry } from '../interfaces/ToolExecutor';

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  [key: string]: unknown;
}

export interface ChatOptions {
  tools?: ToolDefinition[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  thinking?: ThinkingConfig;
  /** AbortSignal 用于取消进行中的 LLM 请求 */
  signal?: AbortSignal;
}

export interface ProviderValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// === Phase 2: 图像生成类型 ===

/**
 * 图像生成参数
 */
export interface ImageGenerationParams {
  prompt: string;
  negativePrompt?: string;
  /** 生图模型名（不指定时由 Provider 决定） */
  model?: string;
  size?: string;
  /** 纵横比，如 "1:1" | "16:9" | "9:16"（优先级高于 size） */
  aspectRatio?: string;
  quality?: 'standard' | 'hd';
  style?: 'vivid' | 'natural';
  n?: number;
  format?: 'png' | 'jpeg' | 'webp';
}

/**
 * 单张图片数据
 */
export interface ImageData {
  url: string;
  alt?: string;
  b64_json?: string;
}

/**
 * 图像生成结果
 */
export interface ImageGenerationResult {
  success: boolean;
  data: ImageData[];
  model?: string;
  error?: string;
  durationMs: number;
}

// === 视频生成类型 ===

/**
 * 视频生成参数
 */
export interface VideoGenerationParams {
  /** 模型 ID */
  model: string;

  /** 文本提示词 */
  prompt: string;

  /** 图生视频：输入图片 URL */
  imageUrl?: string;

  /** 图生视频：本地图片路径 */
  imagePath?: string;

  /** 反向提示词 */
  negativePrompt?: string;

  /** 视频时长（秒） */
  duration?: number;

  /** 宽高比，如 "16:9"、"9:16"、"1:1" */
  aspectRatio?: string;

  /** 分辨率，如 "720p"、"1080p" */
  resolution?: string;

  /** 随机种子 */
  seed?: number;

  /** 生成数量 */
  n?: number;

  /** 风格 */
  style?: string;
}

/**
 * 视频生成结果
 */
export interface VideoGenerationResult {
  success: boolean;

  data: Array<{
    url: string;
    width?: number;
    height?: number;
    duration?: number;
    format?: string;
  }>;

  /** 视频内容 Buffer（Provider 层下载后传入，避免 FileRegistry 单独 fetch 时缺鉴权） */
  videoBuffer?: Buffer;

  error?: string;

  durationMs: number;

  model?: string;

  /** 异步任务 ID */
  taskId?: string;
}

// === Phase 3: 视觉分析类型 ===

/**
 * 视觉分析参数
 */
export interface VisionAnalysisParams {
  imageBuffer: Buffer;
  mimeType: string;
  /** 模型 ID（必传！由 modelRouter 根据任务分工解析，严禁硬编码） */
  model: string;
  prompt?: string;
  maxTokens?: number;
  detail?: 'auto' | 'low' | 'high';
}

/**
 * 视觉分析结果
 */
export interface VisionAnalysisResult {
  success: boolean;
  description: string;
  model?: string;
  error?: string;
  durationMs: number;
}

/**
 * Provider 能力声明
 */
export interface ProviderCapabilities {
  imageGeneration?: boolean;
  visionAnalysis?: boolean;
  videoGeneration?: boolean;
}

export interface ThinkingProviderChunk {
  type: 'thinking';
  content: string;
}

export interface AIProvider {
  readonly id: string;
  readonly displayName: string;

  /** Provider 能力声明（图像/视频/视觉等） */
  readonly capabilities?: ProviderCapabilities;

  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;

  chatStream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string | ThinkingProviderChunk, ChatResponse, unknown>;

  listModels(): Promise<string[]>;

  validateConfig(config: ProviderConfig): ProviderValidationResult;

  setApiKey?(key: string): void;

  setToolRegistry?(registry: ToolRegistry | null): void;

  setToolExecutor?(executor: IToolExecutor | null): void;

  supportsThinking?(model: string): boolean;

  /** 图像生成（可选实现） */
  generateImage?(params: ImageGenerationParams): Promise<ImageGenerationResult>;

  /** 视频生成（可选实现） */
  generateVideo?(params: VideoGenerationParams): Promise<VideoGenerationResult>;

  /** 视觉分析（可选实现） */
  analyzeImage?(params: VisionAnalysisParams): Promise<VisionAnalysisResult>;

  /** 重排序（可选实现）
   *
   * 调用方需通过 modelRouter.resolve('reranking') 获取用户配置的模型，
   * 再通过 providerRegistry.getByModel() 获取 Provider 后调用此方法。
   *
   * 采用 OpenAI / Cohere 兼容的 rerank API 格式：
   *   POST {baseUrl}/v1/rerank
   *   { model, query, documents, top_n, return_documents }
   */
  rerank?(request: RerankRequest): Promise<RerankResult>;
}

/**
 * 重排序请求参数
 */
export interface RerankRequest {
  /** 查询文本 */
  query: string;
  /** 候选文档列表 */
  documents: string[];
  /** 返回条数 */
  topN?: number;
  /** 是否返回原文 */
  returnDocuments?: boolean;
}

/**
 * 重排序结果
 */
export interface RerankResult {
  results: Array<{
    /** 原始 documents 数组中的索引 */
    index: number;
    /** 原文（returnDocuments=true 时返回） */
    document?: string;
    /** 相关度分数 0-1 */
    relevanceScore: number;
  }>;
  model: string;
  usage?: { totalTokens: number };
}

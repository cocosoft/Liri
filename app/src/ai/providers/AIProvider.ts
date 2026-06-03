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
  size?: string;
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

// === Phase 3: 视觉分析类型 ===

/**
 * 视觉分析参数
 */
export interface VisionAnalysisParams {
  imageBuffer: Buffer;
  mimeType: string;
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
}

export interface ThinkingProviderChunk {
  type: 'thinking';
  content: string;
}

export interface AIProvider {
  readonly id: string;
  readonly displayName: string;

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

  /** 视觉分析（可选实现） */
  analyzeImage?(params: VisionAnalysisParams): Promise<VisionAnalysisResult>;
}

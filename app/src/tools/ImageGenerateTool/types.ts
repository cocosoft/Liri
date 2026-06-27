/**
 * ImageGenerateTool Provider 架构类型定义
 * 多后端图像生成 Provider 接口 + 配置 + 结果类型
 */

import type {
  ImageGenerationParams,
  ImageGenerationResult,
} from '../../ai/providers/AIProvider';

// ============================================================
// Provider 接口
// ============================================================

/** 图像生成 Provider 抽象接口 */
export interface ImageGenerationProvider {
  /** Provider 名称 */
  readonly name: string;
  /** Provider 类型标识 */
  readonly type: 'openai' | 'stability' | 'sdwebui' | 'replicate';

  /** 执行图片生成 */
  generate(params: ImageGenerationParams): Promise<ImageGenerationResult>;

  /** 估算费用 */
  estimateCost(params: ImageGenerationParams): CostEstimate;
}

// ============================================================
// 成本相关
// ============================================================

/** 成本估算 */
export interface CostEstimate {
  estimatedUsd: number;
  currency: 'USD';
  confidence: 'exact' | 'approximate';
  breakdown?: string;
}

/** 单次调用成本记录 */
export interface CostRecord {
  provider: string;
  status: 'success' | 'failed';
  estimatedCostUsd: number;
  latencyMs: number;
}

// ============================================================
// 配置
// ============================================================

/** Provider 配置项 */
export interface ProviderConfig {
  name: string;
  type: 'openai' | 'stability' | 'sdwebui' | 'replicate';
  apiKey?: string;
  endpoint?: string;
  enabled: boolean;
}

/** Fallback 策略配置 */
export interface FallbackConfig {
  enabled: boolean;
  retryOn: number[];
  maxRetries: number;
  costWarning: boolean;
}

/** Prompt 增强配置 */
export interface PromptEnhancementConfig {
  enabled: boolean;
  mode: 'template' | 'llm' | 'none';
  stylePresets: Record<string, string>;
  autoNegativePrompt: boolean;
}

/** 缓存配置 */
export interface GenerationCacheConfig {
  enabled: boolean;
  ttlSeconds: number;
  semanticMatch: boolean;
}

/** 并发控制配置 */
export interface ConcurrencyConfig {
  maxConcurrent: number;
  queueTimeoutMs: number;
}

/** 图像生成全局配置 */
export interface ImageGenerationConfig {
  providers: ProviderConfig[];
  fallback: FallbackConfig;
  promptEnhancement: PromptEnhancementConfig;
  cache: GenerationCacheConfig;
  concurrency: ConcurrencyConfig;
}

// ============================================================
// 生成结果（增强版）
// ============================================================

/** 增强版生成结果，包含成本和 fallback 信息 */
export interface EnhancedGenerationResult extends ImageGenerationResult {
  provider: string;
  costBreakdown: CostRecord[];
  totalCostUsd: number;
}

// ============================================================
// 默认配置
// ============================================================

/** 获取默认的图像生成配置 */
export function getDefaultGenerationConfig(): ImageGenerationConfig {
  return {
    providers: [
      { name: 'OpenAI DALL-E 3', type: 'openai', enabled: true },
      { name: 'Stability AI', type: 'stability', enabled: false },
      { name: 'SD WebUI (Local)', type: 'sdwebui', enabled: false },
      { name: 'Replicate Flux', type: 'replicate', enabled: false },
    ],
    fallback: {
      enabled: true,
      retryOn: [429, 500, 502, 503],
      maxRetries: 2,
      costWarning: true,
    },
    promptEnhancement: {
      enabled: true,
      mode: 'template',
      stylePresets: {},
      autoNegativePrompt: false,
    },
    cache: {
      enabled: true,
      ttlSeconds: 3600,
      semanticMatch: false,
    },
    concurrency: {
      maxConcurrent: 1,
      queueTimeoutMs: 30000,
    },
  };
}

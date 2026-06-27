/**
 * ImageGenerationRouter
 * 多后端图像生成的 fallback 链路由器
 *
 * 流程：
 *   用户请求 → Provider[0].generate()
 *     → 成功 → 返回结果 + 费用记录
 *     → 失败（可重试状态码）→ 记录日志 → Provider[1].generate()
 *       → 全部失败 → 返回聚合错误
 */

import { Logger, LogLevel, getOTelTracing } from '@modules/monitoring';
import { SpanStatusCode } from '@opentelemetry/api';
import type {
  ImageGenerationParams,
  ImageGenerationResult,
} from '../../ai/providers/AIProvider';
import type {
  ImageGenerationProvider,
  ImageGenerationConfig,
  CostRecord,
  ProviderConfig,
} from './types';
import { getDefaultGenerationConfig } from './types';
import { DallEProvider } from './providers/DallEProvider';
import { StabilityProvider } from './providers/StabilityProvider';
import { SDWebUIProvider } from './providers/SDWebUIProvider';
import { ReplicateProvider } from './providers/ReplicateProvider';
import { ImageGenerationCache } from './ImageGenerationCache';
import { getImageSafetyFilter } from './ImageSafetyFilter';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'tools:imageGenerate',
});

export class ImageGenerationRouter {
  private providers: ImageGenerationProvider[] = [];
  private config: ImageGenerationConfig;
  private cache: ImageGenerationCache;
  private providerMap = new Map<string, ImageGenerationProvider>();

  constructor(config?: Partial<ImageGenerationConfig>) {
    this.config = { ...getDefaultGenerationConfig(), ...config };
    this.cache = new ImageGenerationCache(this.config.cache);
    this.initProviders(this.config.providers);
  }

  /** 根据配置初始化 Provider 列表 */
  private initProviders(providerConfigs: ProviderConfig[]): void {
    this.providers = [];
    this.providerMap.clear();

    for (const cfg of providerConfigs) {
      if (!cfg.enabled) continue;

      let provider: ImageGenerationProvider;
      switch (cfg.type) {
        case 'openai':
          provider = new DallEProvider(cfg);
          break;
        case 'stability':
          provider = new StabilityProvider(cfg);
          break;
        case 'sdwebui':
          provider = new SDWebUIProvider(cfg);
          break;
        case 'replicate':
          provider = new ReplicateProvider(cfg);
          break;
        default:
          logger.warn('ImageGenerationRouter · 未知 Provider 类型', {
            type: cfg.type,
          });
          continue;
      }

      this.providers.push(provider);
      this.providerMap.set(cfg.type, provider);
    }
  }

  /** 获取所有已注册的 Provider */
  getProviders(): ImageGenerationProvider[] {
    return [...this.providers];
  }

  /** 根据类型获取 Provider */
  getProvider(type: string): ImageGenerationProvider | undefined {
    return this.providerMap.get(type);
  }

  /** 更新配置并重新初始化 */
  updateConfig(config: Partial<ImageGenerationConfig>): void {
    this.config = { ...this.config, ...config };
    this.cache.updateConfig(this.config.cache);
    this.initProviders(this.config.providers);
  }

  /** 获取当前配置 */
  getConfig(): ImageGenerationConfig {
    return { ...this.config };
  }

  /**
   * 带 fallback 链的图片生成
   * 按配置顺序依次尝试 Provider，直到成功或全部失败
   */
  async generate(params: ImageGenerationParams): Promise<{
    result: ImageGenerationResult;
    costBreakdown: CostRecord[];
    totalCostUsd: number;
    usedProvider: string;
  }> {
    const costBreakdown: CostRecord[] = [];
    let totalCostUsd = 0;
    let lastError: string | undefined;

    // 检查缓存
    if (this.config.cache.enabled) {
      const cached = this.cache.get(params);
      if (cached) {
        logger.info('ImageGenerationRouter · 缓存命中', {
          prompt: params.prompt.slice(0, 50),
        });
        return {
          result: cached,
          costBreakdown: [
            {
              provider: 'cache',
              status: 'success',
              estimatedCostUsd: 0,
              latencyMs: 0,
            },
          ],
          totalCostUsd: 0,
          usedProvider: 'cache',
        };
      }
    }

    // 内容安全检查（生成前）
    const safetyFilter = getImageSafetyFilter();
    const safetyCheck = safetyFilter.beforeGenerate(params.prompt);
    if (!safetyCheck.passed) {
      logger.warn('ImageGenerationRouter · 安全过滤拦截', {
        reason: safetyCheck.reason,
        keywords: safetyCheck.blockedKeywords,
      });
      return {
        result: {
          success: false,
          data: [],
          error: safetyCheck.reason || 'Content safety check failed',
          durationMs: 0,
        },
        costBreakdown: [],
        totalCostUsd: 0,
        usedProvider: 'none',
      };
    }

    // 按优先级依次尝试
    const maxRetries = this.config.fallback.maxRetries;
    const providers = this.providers.slice(0, maxRetries + 1);

    if (providers.length === 0) {
      return {
        result: {
          success: false,
          data: [],
          error:
            'No AI image provider is configured. Please set OPENAI_API_KEY, STABILITY_API_KEY, REPLICATE_API_KEY, or SD_WEBUI_URL in your .env file.',
          durationMs: 0,
        },
        costBreakdown: [],
        totalCostUsd: 0,
        usedProvider: 'none',
      };
    }

    const otel = getOTelTracing();

    for (const provider of providers) {
      const providerStart = Date.now();
      const providerSpan = otel.startSpan('image.generate.provider', {
        'provider.name': provider.name,
        'provider.type': provider.type,
        'prompt.length': params.prompt.length,
        'image.size': params.size ?? '1024x1024',
      });

      // 估算费用
      const costEstimate = provider.estimateCost(params);

      try {
        const result = await provider.generate({
          ...params,
          // 增强 prompt
          prompt: this.enhancePrompt(params.prompt),
        });

        const latencyMs = Date.now() - providerStart;

        if (result.success) {
          otel.endSpan(providerSpan, SpanStatusCode.OK);

          costBreakdown.push({
            provider: provider.name,
            status: 'success',
            estimatedCostUsd: costEstimate.estimatedUsd,
            latencyMs,
          });
          totalCostUsd += costEstimate.estimatedUsd;

          logger.info('ImageGenerationRouter · 生成成功', {
            provider: provider.name,
            latencyMs,
            costUsd: costEstimate.estimatedUsd,
          });

          // 写入缓存
          if (this.config.cache.enabled) {
            this.cache.set(params, result);
          }

          return {
            result,
            costBreakdown,
            totalCostUsd,
            usedProvider: provider.type,
          };
        }

        // Provider 返回失败
        otel.endSpan(providerSpan, SpanStatusCode.ERROR, result.error);

        costBreakdown.push({
          provider: provider.name,
          status: 'failed',
          estimatedCostUsd: 0,
          latencyMs,
        });

        lastError = result.error;

        logger.warn('ImageGenerationRouter · Provider 返回失败', {
          provider: provider.name,
          error: result.error,
          latencyMs,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const latencyMs = Date.now() - providerStart;

        otel.endSpan(providerSpan, SpanStatusCode.ERROR, errorMsg);

        costBreakdown.push({
          provider: provider.name,
          status: 'failed',
          estimatedCostUsd: 0,
          latencyMs,
        });

        lastError = errorMsg;

        logger.warn('ImageGenerationRouter · Provider 异常', {
          provider: provider.name,
          error: errorMsg,
        });

        // 网络/超时类异常，继续 fallback
        continue;
      }
    }

    // 全部失败
    logger.error('ImageGenerationRouter · 所有 Provider 均失败', {
      attempted: costBreakdown.map((c) => c.provider),
      lastError,
    });

    return {
      result: {
        success: false,
        data: [],
        error: `All providers failed. Last error: ${lastError}`,
        durationMs: 0,
      },
      costBreakdown,
      totalCostUsd,
      usedProvider: 'none',
    };
  }

  /**
   * Prompt 增强
   * 根据配置的模式对原始 prompt 进行增强处理
   */
  private enhancePrompt(raw: string): string {
    const config = this.config.promptEnhancement;

    if (!config.enabled || config.mode === 'none') {
      return raw;
    }

    // template 模式：附加风格预设
    if (config.mode === 'template' && config.stylePresets) {
      const styleKeys = Object.keys(config.stylePresets);
      if (styleKeys.length === 0) return raw;

      // 简单的关键词匹配选择风格
      for (const key of styleKeys) {
        if (raw.toLowerCase().includes(key.toLowerCase())) {
          return `${raw}, ${config.stylePresets[key]}`;
        }
      }
    }

    return raw;
  }

  /** 清空缓存 */
  clearCache(): void {
    this.cache.clear();
  }
}

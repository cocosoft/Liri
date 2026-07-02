/**
 * ImageGenerationRouter
 * 图像生成协调器：缓存、安全检查、prompt 增强、费用追踪
 *
 * Provider 级别回退（fallback 链）已由 SmartRouter.execute() 接管。
 */

import { Logger, LogLevel, getOTelTracing } from '@modules/monitoring';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error/handleError';
import {
  resolveModelRoute,
  RouteKey,
} from '../../ai/router/resolveModelRoute.js';
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
import { SDWebUIProvider } from './providers/SDWebUIProvider';
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
  }

  /** 更新配置（仅更新缓存和通用配置，Provider 由 setProviders 管理） */
  updateConfig(config: Partial<ImageGenerationConfig>): void {
    this.config = { ...this.config, ...config };
    this.cache.updateConfig(this.config.cache);
  }

  /**
   * 直接注入 Provider 实例（跳过 config 类型映射）
   * 由 ImageGenerationTool.getRouter() 调用，Provider 来自模型管理基础设施
   */
  setProviders(providers: ImageGenerationProvider[]): void {
    this.providers = providers;
    this.providerMap.clear();
    for (const p of providers) {
      this.providerMap.set(p.type, p);
    }
    logger.info('ImageGenerationRouter · 直接注入 Provider', {
      providerCount: this.providers.length,
      providers: this.providers.map((p) => p.name),
    });
  }

  /** 获取所有已注册的 Provider */
  getProviders(): ImageGenerationProvider[] {
    return [...this.providers];
  }

  /** 根据类型获取 Provider */
  getProvider(type: string): ImageGenerationProvider | undefined {
    return this.providerMap.get(type);
  }

  /** 获取当前配置 */
  getConfig(): ImageGenerationConfig {
    return { ...this.config };
  }

  /**
   * 图片生成（单 Provider 调用，fallback 由 SmartRouter 接管）
   *
   * 管线：缓存检查 → 安全检查 → prompt 增强 → 单 Provider 调用
   * Provider 级别回退由上层 SmartRouter.execute() 的 FallbackChain 处理。
   */
  async generate(params: ImageGenerationParams): Promise<{
    result: ImageGenerationResult;
    costBreakdown: CostRecord[];
    totalCostUsd: number;
    usedProvider: string;
  }> {
    const costBreakdown: CostRecord[] = [];
    let totalCostUsd = 0;
    /** 收集每个 Provider 的具体失败原因 */
    const providerErrors: Array<{ provider: string; error: string }> = [];

    logger.info('ImageGenerationRouter.generate() 入口', {
      prompt: params.prompt.slice(0, 80),
      size: params.size,
      providersCount: this.providers.length,
      providers: this.providers.map((p) => p.name),
    });

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

    // 通过统一模型路由解析模型名，匹配对应 Provider
    // 注：Provider 级别的 fallback 链已由 SmartRouter.execute() 的 FallbackChain 接管
    const providers = this.providers;
    if (providers.length === 0) {
      return {
        result: {
          success: false,
          data: [],
          error: 'No image generation provider configured',
          durationMs: 0,
        },
        costBreakdown: [],
        totalCostUsd: 0,
        usedProvider: 'none',
      };
    }

    // 解析模型名（优先用 params.model，否则从模型管理任务分工获取）
    const resolvedModel =
      params.model || (await resolveModelRoute(RouteKey.IMAGE_GENERATE));

    // 根据模型名匹配对应 Provider，并解析 UUID → 模型名
    let provider = providers[0];

    // 对每个 Provider 尝试（fallback 链）
    for (const candidate of providers) {
      provider = candidate;
      let actualModelName: string | undefined;

      if (resolvedModel) {
        try {
          const { modelPricingService } =
            await import('../../ai/models/ModelPricingService.js');
          await modelPricingService.initialize();
          const allModels = await modelPricingService.getAllPricing();

          const isUuid =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              resolvedModel
            );
          const modelRecord = allModels.find((m) =>
            isUuid ? m.id === resolvedModel : m.modelId === resolvedModel
          );

          if (modelRecord) {
            actualModelName = modelRecord.modelId;
          }
        } catch (err) {
          logger.warning('ImageGenerationRouter · 模型 Provider 匹配失败', {
            error: (err as Error).message,
          });
        }
      }

      // 注入模型名
      const currentParams =
        actualModelName && actualModelName !== params.model
          ? { ...params, model: actualModelName }
          : params;

      const otel = getOTelTracing();
      const providerStart = Date.now();
      const providerSpan = otel.startSpan('image.generate.provider', {
        'provider.name': candidate.name,
        'provider.type': candidate.type,
        'prompt.length': currentParams.prompt.length,
        'image.size': currentParams.size ?? '1024x1024',
      });

      try {
        const result = await candidate.generate({
          ...currentParams,
          prompt: this.enhancePrompt(currentParams.prompt),
        });
        const latencyMs = Date.now() - providerStart;

        if (result.success) {
          otel.endSpan(providerSpan, SpanStatusCode.OK);
          costBreakdown.push({
            provider: candidate.name,
            status: 'success',
            estimatedCostUsd: (await candidate.estimateCost(currentParams))
              .estimatedUsd,
            latencyMs,
          });

          if (this.config.cache.enabled) {
            this.cache.set(currentParams, result);
          }

          logger.info('ImageGenerationRouter · Fallback 成功', {
            provider: candidate.name,
            attemptIndex: providers.indexOf(candidate),
          });
          provider = candidate;
          break; // 成功，退出 fallback 循环
        }

        // 当前 Provider 失败，记录并尝试下一个
        otel.endSpan(providerSpan, SpanStatusCode.ERROR, result.error);
        costBreakdown.push({
          provider: candidate.name,
          status: 'failed',
          estimatedCostUsd: 0,
          latencyMs,
        });
        providerErrors.push({
          provider: candidate.name,
          error: result.error || '未知错误',
        });

        logger.warn('ImageGenerationRouter · Provider 失败，尝试下一个', {
          provider: candidate.name,
          error: result.error,
          remainingProviders: providers
            .slice(providers.indexOf(candidate) + 1)
            .map((p) => p.name),
        });
      } catch (error) {
        const latencyMs = Date.now() - providerStart;
        otel.endSpan(providerSpan, SpanStatusCode.ERROR, String(error));

        costBreakdown.push({
          provider: candidate.name,
          status: 'failed',
          estimatedCostUsd: 0,
          latencyMs,
        });
        providerErrors.push({
          provider: candidate.name,
          error: (error as Error).message,
        });

        logger.warn('ImageGenerationRouter · Provider 异常，尝试下一个', {
          provider: candidate.name,
          error: (error as Error).message,
          remainingProviders: providers
            .slice(providers.indexOf(candidate) + 1)
            .map((p) => p.name),
        });
      }
    }

    // 所有 Provider 都失败，返回最终失败结果含各 Provider 具体原因
    const errorDetail = providerErrors
      .map((e) => `  - ${e.provider}: ${e.error}`)
      .join('\n');

    logger.error('ImageGenerationRouter · 所有 Provider 均已失败', {
      attemptedProviders: costBreakdown.map((c) => c.provider),
      errors: providerErrors,
    });

    return {
      result: {
        success: false,
        data: [],
        error: `所有图像生成 Provider 均失败 (已尝试: ${costBreakdown.map((c) => c.provider).join(', ')})\n${errorDetail}`,
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

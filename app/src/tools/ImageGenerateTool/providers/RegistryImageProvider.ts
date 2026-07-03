/**
 * RegistryImageProvider — 通用图像生成 Provider 包装器
 *
 * 直接包装 ProviderRegistry 中的 AiProvider 实例，由模型管理基础设施驱动：
 * - 模型名：用户选择 → modelRouter 解析 → 透传
 * - 费用估算：ModelRegistry 动态定价 → 无定价时通用估算
 * - 不再硬编码任何供应商/模型名/计费标准
 */

import type {
  ImageGenerationParams,
  ImageGenerationResult,
  AIProvider,
} from '../../../ai/providers/AIProvider';
import type { ImageGenerationProvider, CostEstimate } from '../types';
import { Logger, LogLevel, getOTelTracing } from '@modules/monitoring';
import { SpanStatusCode } from '@opentelemetry/api';
import {
  resolveModelRoute,
  RouteKey,
} from '../../../ai/router/resolveModelRoute.js';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'tools:imageGenerate',
});

export class RegistryImageProvider implements ImageGenerationProvider {
  readonly name: string;
  readonly type: 'openai' | 'stability' | 'sdwebui' | 'replicate' | 'fal';

  private aiProvider: AIProvider;

  /** 暴露底层 AiProvider 的 UUID，用于模型路由匹配 */
  get providerId(): string {
    return this.aiProvider.id;
  }

  /**
   * @param aiProvider ProviderRegistry 中的 AiProvider 实例
   * @param mappedType 映射到的 Router Provider 类型（用于费用估算和日志）
   */
  constructor(
    aiProvider: AIProvider,
    mappedType: 'openai' | 'stability' | 'sdwebui' | 'replicate' | 'fal'
  ) {
    this.aiProvider = aiProvider;
    this.type = mappedType;
    this.name = aiProvider.displayName;
  }

  /**
   * 费用估算 — 优先从 ModelRegistry 动态读取定价，
   * 无数据时返回通用估算，不硬编码任何供应商价格
   */
  async estimateCost(params: ImageGenerationParams): Promise<CostEstimate> {
    const n = params.n ?? 1;
    try {
      const modelName =
        params.model || (await resolveModelRoute(RouteKey.IMAGE_GENERATE));
      if (modelName) {
        const { ModelRegistry } =
          await import('../../../ai/models/ModelRegistry');
        const registry = ModelRegistry.getInstance();
        const pricing = await registry.getModelPricingAsync(modelName);
        if (pricing) {
          const estimatedUsd =
            Math.round((pricing.inputPer1M / 1_000_000) * 1000 * n) / 1000;
          return {
            estimatedUsd,
            currency: 'USD',
            confidence: 'approximate',
            breakdown: `约 $${pricing.inputPer1M}/1M tokens × ${n}张`,
          };
        }
      }
    } catch {
      // ModelRegistry 不可用时使用通用估算
    }
    return {
      estimatedUsd: 0,
      currency: 'USD',
      confidence: 'approximate',
      breakdown: '按供应商实际扣费为准',
    };
  }

  async generate(
    params: ImageGenerationParams
  ): Promise<ImageGenerationResult> {
    const otel = getOTelTracing();
    const span = otel.startSpan('image.generate.provider', {
      'provider.id': this.aiProvider.id,
      'provider.name': this.name,
      'provider.type': this.type,
      'prompt.length': params.prompt.length,
    });

    if (!this.aiProvider.generateImage) {
      logger.warn('RegistryImageProvider · AiProvider 不支持 generateImage', {
        providerId: this.aiProvider.id,
        displayName: this.aiProvider.displayName,
      });
      otel.endSpan(span, SpanStatusCode.ERROR, 'no generateImage method');
      return {
        success: false,
        data: [],
        error: `Provider '${this.aiProvider.displayName}' does not support image generation`,
        durationMs: 0,
      };
    }

    logger.info('RegistryImageProvider · 委托生成图像', {
      providerId: this.aiProvider.id,
      displayName: this.aiProvider.displayName,
      model: params.model,
      prompt: params.prompt.slice(0, 80),
    });

    // 如果调用方没有指定 model，通过 modelRouter + 本 Provider 解析
    if (!params.model) {
      const resolved = await resolveModelRoute(RouteKey.IMAGE_GENERATE);
      if (resolved) {
        params = { ...params, model: resolved };
        logger.info('RegistryImageProvider · 从 modelRouter 注入模型', {
          providerId: this.aiProvider.id,
          model: resolved,
        });
      } else {
        logger.warn('RegistryImageProvider · modelRouter 未返回模型', {
          providerId: this.aiProvider.id,
        });
      }
    }
    try {
      const result = await this.aiProvider.generateImage(params);
      otel.endSpan(
        span,
        result.success ? SpanStatusCode.OK : SpanStatusCode.ERROR,
        result.error
      );
      logger.info('RegistryImageProvider · 生成结果', {
        providerId: this.aiProvider.id,
        success: result.success,
        error: result.error,
        imageCount: result.data?.length ?? 0,
        durationMs: result.durationMs,
      });
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      otel.endSpan(span, SpanStatusCode.ERROR, errorMsg);
      logger.error('RegistryImageProvider · 生成异常', {
        providerId: this.aiProvider.id,
        error: errorMsg,
      });
      return {
        success: false,
        data: [],
        error: `Image generation failed: ${errorMsg}`,
        durationMs: 0,
      };
    }
  }
}

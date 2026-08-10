/**
 * VideoGenerationRouter
 * 视频生成协调器 — 精简版（照搬 ImageGenerationRouter 核心模式）
 *
 * 当前仅单 Provider，后续支持 fallback 链扩展。
 */

import { getLogger } from '@modules/monitoring';
import type {
  VideoGenerationParams,
  VideoGenerationResult,
} from '../../ai/providers/AIProvider';
import { RegistryVideoProvider } from './providers/RegistryVideoProvider';
import { handleError } from '@modules/error/handleError';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

const logger = getLogger('tools:videoGenerate');

export class VideoGenerationRouter {
  private providers: RegistryVideoProvider[] = [];

  getProviders(): RegistryVideoProvider[] {
    return this.providers;
  }

  setProviders(providers: RegistryVideoProvider[]): void {
    const available: RegistryVideoProvider[] = [];
    const filtered: RegistryVideoProvider[] = [];

    for (const p of providers) {
      if (p.isAvailable()) {
        available.push(p);
      } else {
        filtered.push(p);
      }
    }

    if (filtered.length > 0) {
      logger.warn(
        'VideoGenerationRouter . setProviders 过滤掉不可用 Provider',
        {
          filtered: filtered.map((p) => p.type),
          reason: 'generateVideo is not a function',
        }
      );
    }

    this.providers = available;
    logger.info('VideoGenerationRouter . 设置 Provider', {
      count: this.providers.length,
      filtered: filtered.length,
      types: this.providers.map((p) => p.type),
    });
  }

  /**
   * 遍历 providers 列表逐个尝试生成
   * 当前仅单个 Provider，后续 Provider 数量增加后自然支持 fallback 链
   */
  async generate(
    params: VideoGenerationParams
  ): Promise<VideoGenerationResult> {
    if (this.providers.length === 0) {
      return {
        success: false,
        data: [],
        error:
          '未配置可用的视频生成 Provider。请在 模型管理 → 任务分工 中为"生视频"任务分配一个支持 video_generation 能力的模型。',
        durationMs: 0,
      };
    }

    const errors: string[] = [];

    for (const provider of this.providers) {
      const result = await provider.generate(params);
      if (result.success) return result;

      const errDetail = `[${provider.type}] ${result.error || '未知错误'}`;
      errors.push(errDetail);

      logger.warn('VideoGenerationRouter . Provider 生成失败，尝试下一个', {
        provider: provider.type,
        error: result.error,
        model: params.model,
      });
    }

    const allErrors = `所有视频生成 Provider 均失败 (${errors.length} 个已尝试): ${errors.join('; ')}`;

    await handleError(
      new AppError(
        allErrors,
        ErrorCategory.API,
        ErrorSeverity.HIGH,
        'VIDEO_ALL_PROVIDERS_FAILED'
      ),
      { module: 'tools:videoGenerate', action: 'routerGenerate' }
    );

    return {
      success: false,
      data: [],
      error: allErrors,
      durationMs: 0,
    };
  }
}

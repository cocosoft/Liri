/**
 * VideoGenerationRouter
 * 视频生成协调器 — 精简版（照搬 ImageGenerationRouter 核心模式）
 *
 * 当前仅单 Provider，后续支持 fallback 链扩展。
 */

import { Logger, LogLevel } from '@modules/monitoring';
import type {
  VideoGenerationParams,
  VideoGenerationResult,
} from '../../ai/providers/AIProvider';
import { RegistryVideoProvider } from './providers/RegistryVideoProvider';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'tools:videoGenerate',
});

export class VideoGenerationRouter {
  private providers: RegistryVideoProvider[] = [];

  getProviders(): RegistryVideoProvider[] {
    return this.providers;
  }

  setProviders(providers: RegistryVideoProvider[]): void {
    this.providers = providers.filter((p) => p.isAvailable());
    logger.info('VideoGenerationRouter . 设置 Provider', {
      count: this.providers.length,
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
    for (const provider of this.providers) {
      const result = await provider.generate(params);
      if (result.success) return result;

      logger.warn('VideoGenerationRouter . Provider 生成失败，尝试下一个', {
        provider: provider.type,
        error: result.error,
      });
    }

    return {
      success: false,
      data: [],
      error: '所有视频生成 Provider 均失败',
      durationMs: 0,
    };
  }
}

/**
 * RegistryVideoProvider — 通用视频生成 Provider 包装器
 *
 * 直接包装 ProviderRegistry 中的 AIProvider 实例，由模型管理基础设施驱动：
 * - 模型名：用户选择 → modelRouter 解析 → 透传
 * - 不再硬编码任何供应商/模型名
 */

import type {
  VideoGenerationParams,
  VideoGenerationResult,
  AIProvider,
} from '../../../ai/providers/AIProvider';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'tools:videoGenerate',
});

export class RegistryVideoProvider {
  private aiProvider: AIProvider;

  /** Provider 类型标签（如 'fal'） */
  readonly type: string;

  constructor(aiProvider: AIProvider, type: string) {
    this.aiProvider = aiProvider;
    this.type = type;
  }

  /** 当前 Provider 是否支持视频生成 */
  isAvailable(): boolean {
    return typeof this.aiProvider.generateVideo === 'function';
  }

  /** 调用底层 Provider 的视频生成方法 */
  async generate(
    params: VideoGenerationParams
  ): Promise<VideoGenerationResult> {
    if (!this.aiProvider.generateVideo) {
      return {
        success: false,
        data: [],
        error: `Provider "${this.type}" 不支持视频生成`,
        durationMs: 0,
      };
    }

    logger.info('RegistryVideoProvider . 开始生成', {
      type: this.type,
      model: params.model,
      prompt: params.prompt?.slice(0, 80),
    });

    return this.aiProvider.generateVideo(params);
  }
}

/**
 * SDWebUIProvider — 本地 Stable Diffusion WebUI 图像生成
 * 走 AUTOMATIC1111 SD WebUI API (txt2img 端点)
 * 默认地址 http://localhost:7860，免费无限制
 */

import type {
  ImageGenerationParams,
  ImageGenerationResult,
} from '../../../ai/providers/AIProvider';
import type {
  ImageGenerationProvider,
  CostEstimate,
  ProviderConfig,
} from '../types';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'tools:imageGenerate',
});

export class SDWebUIProvider implements ImageGenerationProvider {
  readonly name = 'SD WebUI (Local)';
  readonly type = 'sdwebui' as const;

  /** 本地 SD WebUI 地址，默认绑定 127.0.0.1（安全） */
  private readonly endpoint: string;

  constructor(config?: ProviderConfig) {
    this.endpoint = config?.endpoint ?? 'http://127.0.0.1:7860';
  }

  /** 本地 SD WebUI 免费 */
  estimateCost(_params: ImageGenerationParams): CostEstimate {
    return {
      estimatedUsd: 0,
      currency: 'USD',
      confidence: 'exact' as const,
      breakdown: '本地运行，免费',
    };
  }

  async generate(
    params: ImageGenerationParams
  ): Promise<ImageGenerationResult> {
    const startTime = Date.now();

    // 解析尺寸
    const [widthStr, heightStr] = (params.size ?? '1024x1024').split('x');
    const width = parseInt(widthStr, 10) || 1024;
    const height = parseInt(heightStr, 10) || 1024;
    const n = params.n ?? 1;

    const body: Record<string, unknown> = {
      prompt: params.prompt,
      negative_prompt: params.negativePrompt ?? '',
      width,
      height,
      steps: 25,
      cfg_scale: 7,
      batch_size: n,
      sampler_index: 'Euler a',
    };

    try {
      logger.info('SDWebUIProvider · 请求本地 SD WebUI 生成图像', {
        endpoint: this.endpoint,
        prompt: params.prompt.slice(0, 80),
        size: params.size,
      });

      const response = await fetch(`${this.endpoint}/sdapi/v1/txt2img`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180000),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        logger.warn('SDWebUIProvider · API 错误', {
          status: response.status,
          error: errorBody,
        });
        return {
          success: false,
          data: [],
          error: `SD WebUI API error (${response.status}): ${errorBody}`,
          durationMs: Date.now() - startTime,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const images64 = data.images as string[] | undefined;

      if (!images64 || images64.length === 0) {
        logger.warn('SDWebUIProvider · 无图像返回');
        return {
          success: false,
          data: [],
          error: 'SD WebUI returned no images',
          durationMs: Date.now() - startTime,
        };
      }

      logger.info('SDWebUIProvider · 生成成功', {
        count: images64.length,
        durationMs: Date.now() - startTime,
      });

      return {
        success: true,
        data: images64.map((b64) => ({
          url: `data:image/png;base64,${b64}`,
          b64_json: b64,
          alt: params.prompt.slice(0, 100),
        })),
        model: 'stable-diffusion (local)',
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      await handleError(error, {
        module: 'tools:sdWebUI',
        action: '生成异常',
      });
      return {
        success: false,
        data: [],
        error: `SD WebUI generation failed: ${(error as Error).message}`,
        durationMs: Date.now() - startTime,
      };
    }
  }
}

/**
 * ReplicateProvider — Replicate Flux 图像生成
 * 走 Replicate REST API，使用 black-forest-labs/flux-schnell 模型
 * 按秒计费，约 $0.025/张 (1024x1024)
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

export class ReplicateProvider implements ImageGenerationProvider {
  readonly name = 'Replicate Flux';
  readonly type = 'replicate' as const;

  private apiKey: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey ?? '';
  }

  /** 按秒计费，约 $0.025/张 */
  estimateCost(params: ImageGenerationParams): CostEstimate {
    const n = params.n ?? 1;
    return {
      estimatedUsd: Math.round(0.025 * n * 1000) / 1000,
      currency: 'USD',
      confidence: 'approximate' as const,
      breakdown: `~$0.025/张 (按 GPU 秒计费) x ${n}张`,
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

    const body = {
      version: 'black-forest-labs/flux-schnell',
      input: {
        prompt: params.prompt,
        width,
        height,
        num_outputs: n,
        negative_prompt: params.negativePrompt,
      },
    };

    try {
      // 创建预测
      const createResp = await fetch(
        'https://api.replicate.com/v1/predictions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30000),
        }
      );

      if (!createResp.ok) {
        const errorBody = await createResp.text();
        return {
          success: false,
          data: [],
          error: `Replicate API error (${createResp.status}): ${errorBody}`,
          durationMs: Date.now() - startTime,
        };
      }

      const prediction = (await createResp.json()) as Record<string, unknown>;
      const predictionId = prediction.id as string;

      // 轮询等待结果（最多 120 秒）
      const pollStart = Date.now();
      const maxPollMs = 120000;
      const pollIntervalMs = 2000;

      while (Date.now() - pollStart < maxPollMs) {
        const pollResp = await fetch(
          `https://api.replicate.com/v1/predictions/${predictionId}`,
          {
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
            },
            signal: AbortSignal.timeout(10000),
          }
        );

        if (!pollResp.ok) {
          return {
            success: false,
            data: [],
            error: `Replicate poll error (${pollResp.status})`,
            durationMs: Date.now() - startTime,
          };
        }

        const pollData = (await pollResp.json()) as Record<string, unknown>;
        const status = pollData.status as string;

        if (status === 'succeeded') {
          const output = pollData.output as string[];
          if (!output || output.length === 0) {
            return {
              success: false,
              data: [],
              error: 'Replicate returned no images',
              durationMs: Date.now() - startTime,
            };
          }

          return {
            success: true,
            data: output.map((url: string) => ({
              url,
              alt: params.prompt.slice(0, 100),
            })),
            model: 'flux-schnell',
            durationMs: Date.now() - startTime,
          };
        }

        if (status === 'failed' || status === 'canceled') {
          return {
            success: false,
            data: [],
            error: `Replicate prediction ${status}: ${JSON.stringify(pollData.error)}`,
            durationMs: Date.now() - startTime,
          };
        }

        // 仍在处理中，等待后重试
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }

      return {
        success: false,
        data: [],
        error: 'Replicate prediction timed out',
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        data: [],
        error: `Replicate generation failed: ${(error as Error).message}`,
        durationMs: Date.now() - startTime,
      };
    }
  }
}

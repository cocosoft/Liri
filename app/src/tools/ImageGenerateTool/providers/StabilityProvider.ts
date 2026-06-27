/**
 * StabilityProvider — Stability AI 图像生成
 * 走 Stability AI REST API (v2beta/stable-image/generate)
 */

import type { ImageGenerationParams, ImageGenerationResult } from '../../../ai/providers/AIProvider';
import type { ImageGenerationProvider, CostEstimate, ProviderConfig } from '../types';

export class StabilityProvider implements ImageGenerationProvider {
  readonly name = 'Stability AI';
  readonly type = 'stability' as const;

  private apiKey: string;
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey ?? '';
    this.baseUrl = config.endpoint ?? 'https://api.stability.ai';
  }

  /** Stability AI 按 credit 计费，约 $0.01/张 */
  estimateCost(params: ImageGenerationParams): CostEstimate {
    const n = params.n ?? 1;
    return {
      estimatedUsd: Math.round(0.01 * n * 1000) / 1000,
      currency: 'USD',
      confidence: 'approximate' as const,
      breakdown: `~$0.01/credit x ${n}张`,
    };
  }

  async generate(params: ImageGenerationParams): Promise<ImageGenerationResult> {
    const startTime = Date.now();
    const n = params.n ?? 1;

    // 将通用尺寸映射到 Stability 支持的尺寸
    const sizeMap: Record<string, string> = {
      '1024x1024': '1024x1024',
      '1024x1792': '1024x1536',
      '1792x1024': '1536x1024',
      '512x512': '512x512',
    };
    const outputSize = sizeMap[params.size ?? '1024x1024'] ?? '1024x1024';
    const [width, height] = outputSize.split('x').map(Number);

    try {
      const formData = new FormData();
      formData.append('prompt', params.prompt);
      formData.append('output_format', params.format ?? 'png');

      if (params.negativePrompt) {
        formData.append('negative_prompt', params.negativePrompt);
      }

      const response = await fetch(
        `${this.baseUrl}/v2beta/stable-image/generate/ultra`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'application/json',
          },
          body: formData,
          signal: AbortSignal.timeout(120000),
        }
      );

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          data: [],
          error: `Stability API error (${response.status}): ${errorBody}`,
          durationMs: Date.now() - startTime,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const base64Image = data.base64 as string | undefined;

      if (!base64Image) {
        return {
          success: false,
          data: [],
          error: 'Stability API returned no image data',
          durationMs: Date.now() - startTime,
        };
      }

      const images = [];
      for (let i = 0; i < n; i++) {
        images.push({
          url: `data:image/png;base64,${base64Image}`,
          b64_json: base64Image,
          alt: params.prompt.slice(0, 100),
        });
      }

      return {
        success: true,
        data: images,
        model: 'stable-image-ultra',
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        data: [],
        error: `Stability generation failed: ${(error as Error).message}`,
        durationMs: Date.now() - startTime,
      };
    }
  }
}

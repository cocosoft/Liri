/**
 * DallEProvider — OpenAI DALL-E 3 图像生成
 * 走 /v1/images/generations 端点，支持 b64_json 响应
 */

import type { ImageGenerationParams, ImageGenerationResult } from '../../../ai/providers/AIProvider';
import type { ImageGenerationProvider, CostEstimate, ProviderConfig } from '../types';

export class DallEProvider implements ImageGenerationProvider {
  readonly name = 'OpenAI DALL-E 3';
  readonly type = 'openai' as const;

  private apiKey: string;
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey ?? '';
    this.baseUrl = config.endpoint ?? 'https://api.openai.com/v1';
  }

  /** DALL-E 3 按尺寸精确计费 */
  estimateCost(params: ImageGenerationParams): CostEstimate {
    const size = params.size ?? '1024x1024';
    const n = params.n ?? 1;

    // DALL-E 3 定价参考 (USD)
    const priceMap: Record<string, number> = {
      '1024x1024': 0.040,
      '1024x1792': 0.080,
      '1792x1024': 0.080,
    };
    const hdMultiplier = params.quality === 'hd' ? 2 : 1;
    const unitPrice = priceMap[size] ?? 0.040;
    const total = unitPrice * n * hdMultiplier;

    return {
      estimatedUsd: Math.round(total * 1000) / 1000,
      currency: 'USD',
      confidence: 'exact' as const,
      breakdown: `${size} $${unitPrice.toFixed(3)}/张 x ${n}张${params.quality === 'hd' ? ' (HD)' : ''}`,
    };
  }

  async generate(params: ImageGenerationParams): Promise<ImageGenerationResult> {
    const startTime = Date.now();

    const body: Record<string, unknown> = {
      model: 'dall-e-3',
      prompt: params.prompt,
      n: params.n ?? 1,
      size: params.size ?? '1024x1024',
      quality: params.quality ?? 'standard',
      style: params.style ?? 'vivid',
      response_format: 'b64_json',
    };

    try {
      const response = await fetch(`${this.baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          data: [],
          error: `DALL-E API error (${response.status}): ${errorBody}`,
          durationMs: Date.now() - startTime,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const images = (data.data as Array<Record<string, string>>) || [];

      return {
        success: true,
        data: images.map((img: Record<string, string>) => ({
          url: img.url || `data:image/png;base64,${img.b64_json ?? ''}`,
          b64_json: img.b64_json,
          alt: params.prompt.slice(0, 100),
        })),
        model: 'dall-e-3',
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        data: [],
        error: `DALL-E generation failed: ${(error as Error).message}`,
        durationMs: Date.now() - startTime,
      };
    }
  }
}

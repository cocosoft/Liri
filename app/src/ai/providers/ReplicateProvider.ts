// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * ReplicateProvider — Replicate 图像生成 Provider
 *
 * 通过 Replicate 托管模型平台生成图片，支持 SDXL、FLUX、Kandinsky 等社区模型。
 * 纯生图 Provider，chat/chatStream 方法抛 NOT_SUPPORTED。
 *
 * 异步任务模式：提交 prediction → 轮询状态 → 下载结果
 * API: https://api.replicate.com/v1
 */

import { BaseAIProvider, type BaseProviderOptions } from './BaseAIProvider';
import type { ChatMessage, ChatResponse } from '../models/types';
import type {
  ChatOptions,
  ThinkingProviderChunk,
  ProviderConfig,
  ProviderValidationResult,
  ImageGenerationParams,
  ImageGenerationResult,
} from './AIProvider';
import { Logger, LogLevel } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'ai:replicate-provider',
});

/** Replicate 轮询配置 */
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 60; // 最多等 2 分钟

export class ReplicateProvider extends BaseAIProvider {
  private apiKey: string | null = null;

  constructor(options: BaseProviderOptions) {
    super(options);
  }

  // ----- AIProvider 必需方法 -----

  async chat(
    _messages: ChatMessage[],
    _options?: ChatOptions
  ): Promise<ChatResponse> {
    throw new AppError(
      'Replicate 仅支持图像生成，不支持文本对话',
      ErrorCategory.OPERATION,
      ErrorSeverity.MEDIUM,
      'NOT_SUPPORTED'
    );
  }

  async *chatStream(
    _messages: ChatMessage[],
    _options?: ChatOptions
  ): AsyncGenerator<string | ThinkingProviderChunk, ChatResponse, unknown> {
    throw new AppError(
      'Replicate 仅支持图像生成，不支持文本对话',
      ErrorCategory.OPERATION,
      ErrorSeverity.MEDIUM,
      'NOT_SUPPORTED'
    );
  }

  async listModels(): Promise<string[]> {
    return [
      'stability-ai/sdxl',
      'black-forest-labs/flux-schnell',
      'lucataco/hotshot-xl',
    ];
  }

  override validateConfig(_config: ProviderConfig): ProviderValidationResult {
    return { valid: true, errors: [], warnings: [] };
  }

  override setApiKey(key: string): void {
    this.apiKey = key;
  }

  // ----- 图像生成 -----

  /**
   * Replicate 异步图像生成
   * POST /v1/models/{owner}/{name}/predictions → 提交任务
   * GET  /v1/predictions/{id} → 轮询直到完成
   */
  async generateImage(
    params: ImageGenerationParams
  ): Promise<ImageGenerationResult> {
    const startTime = Date.now();
    const modelId =
      params.model ||
      this.options.defaultModel ||
      'black-forest-labs/flux-schnell';

    const apiKey = this.apiKey || process.env['REPLICATE_API_TOKEN'];
    if (!apiKey) {
      return {
        success: false,
        data: [],
        error:
          'REPLICATE_API_TOKEN 未配置。请在环境变量中设置或通过模型管理 UI 配置。',
        durationMs: 0,
      };
    }

    logger.info('ReplicateProvider.generateImage()', {
      model: modelId,
      prompt: params.prompt.slice(0, 80),
    });

    try {
      // Step 1: 提交 prediction
      const prediction = await this.createPrediction(modelId, params, apiKey);
      if (!prediction) {
        return {
          success: false,
          data: [],
          error: 'Replicate 提交任务失败',
          durationMs: Date.now() - startTime,
        };
      }

      const predictionId = prediction.id as string;
      logger.info('ReplicateProvider · prediction 已提交', {
        predictionId,
        model: modelId,
      });

      // Step 2: 轮询等待完成
      const result = await this.pollPrediction(predictionId, apiKey);
      if (!result) {
        return {
          success: false,
          data: [],
          error: 'Replicate 任务超时或失败',
          durationMs: Date.now() - startTime,
        };
      }

      // Step 3: 提取输出图片 URL
      const output = result.output;
      const outputUrls: string[] = [];

      if (Array.isArray(output)) {
        outputUrls.push(
          ...output.filter((u): u is string => typeof u === 'string')
        );
      } else if (typeof output === 'string') {
        outputUrls.push(output);
      }

      if (outputUrls.length === 0) {
        return {
          success: false,
          data: [],
          error: 'Replicate 返回空结果',
          durationMs: Date.now() - startTime,
        };
      }

      return {
        success: true,
        data: outputUrls.map((url) => ({ url, alt: params.prompt })),
        model: modelId,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        data: [],
        error: `Replicate 图像生成失败: ${(error as Error).message}`,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /** 提交 prediction 到 Replicate */
  private async createPrediction(
    modelId: string,
    params: ImageGenerationParams,
    apiKey: string
  ): Promise<Record<string, unknown> | null> {
    const [owner, name] = modelId.split('/');
    if (!owner || !name) {
      logger.warn('ReplicateProvider · 无效的 modelId 格式', { modelId });
      return null;
    }

    const body: Record<string, unknown> = {
      input: {
        prompt: params.prompt,
        negative_prompt: params.negativePrompt || '',
        num_outputs: params.n ?? 1,
      },
    };

    // 添加尺寸
    if (params.size) {
      const [w, h] = params.size.split('x').map(Number);
      if (w && h) {
        (body.input as Record<string, unknown>).width = w;
        (body.input as Record<string, unknown>).height = h;
      }
    }

    const response = await fetch(
      `https://api.replicate.com/v1/models/${owner}/${name}/predictions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      logger.warn('ReplicateProvider · 提交 prediction 失败', {
        status: response.status,
        error: errorBody,
      });
      return null;
    }

    return (await response.json()) as Record<string, unknown>;
  }

  /** 轮询 prediction 状态直到完成或超时 */
  private async pollPrediction(
    predictionId: string,
    apiKey: string
  ): Promise<Record<string, unknown> | null> {
    for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
      await this.delay(POLL_INTERVAL_MS);

      const response = await fetch(
        `https://api.replicate.com/v1/predictions/${predictionId}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!response.ok) continue;

      const data = (await response.json()) as Record<string, unknown>;
      const status = data.status as string;

      if (status === 'succeeded') return data;
      if (status === 'failed' || status === 'canceled') {
        logger.warn('ReplicateProvider · prediction 失败', {
          predictionId,
          status,
          error: data.error,
        });
        return null;
      }

      // processing / starting → 继续轮询
      if (i % 5 === 0) {
        logger.debug('ReplicateProvider · 轮询中', {
          predictionId,
          status,
          attempt: i + 1,
        });
      }
    }

    logger.warn('ReplicateProvider · 轮询超时', {
      predictionId,
      attempts: POLL_MAX_ATTEMPTS,
    });
    return null;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

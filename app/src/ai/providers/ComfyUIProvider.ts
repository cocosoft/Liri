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
 * ComfyUIProvider — ComfyUI 本地生图 Provider
 *
 * 通过 ComfyUI REST API + WebSocket 提交工作流执行，支持 txt2img、img2img、
 * inpainting、upscale 等操作。使用预设工作流 JSON 参数化替换。
 *
 * 纯生图 Provider，chat/chatStream 抛 NOT_SUPPORTED。
 *
 * 参照：
 * - openclaw extensions/comfy/image-generation-provider.ts
 * - hermes skills/creative/comfyui/SKILL.md
 */

import { BaseAIProvider, type BaseProviderOptions } from './BaseAIProvider';
import type {
  ChatMessage,
  ChatResponse,
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
  module: 'ai:comfy-provider',
});

export class ComfyUIProvider extends BaseAIProvider {
  private baseUrl: string;

  constructor(options: BaseProviderOptions) {
    super(options);
    this.baseUrl = options.defaultBaseUrl || 'http://127.0.0.1:8188';
  }

  // ----- AIProvider 必需方法 -----

  async chat(
    _messages: ChatMessage[],
    _options?: ChatOptions
  ): Promise<ChatResponse> {
    throw new AppError(
      'ComfyUI 仅支持图像生成，不支持文本对话',
      'NOT_SUPPORTED',
      ErrorCategory.CONFIGURATION,
      ErrorSeverity.MEDIUM
    );
  }

  async chatStream(
    _messages: ChatMessage[],
    _options?: ChatOptions
  ): AsyncGenerator<string | ThinkingProviderChunk, ChatResponse, unknown> {
    throw new AppError(
      'ComfyUI 仅支持图像生成，不支持文本对话',
      'NOT_SUPPORTED',
      ErrorCategory.CONFIGURATION,
      ErrorSeverity.MEDIUM
    );
  }

  async listModels(): Promise<string[]> {
    return ['comfyui-local'];
  }

  validateConfig(_config: ProviderConfig): ProviderValidationResult {
    return { valid: true, errors: [], warnings: [] };
  }

  setApiKey(_key: string): void {
    // ComfyUI 本地部署不需要 API Key
  }

  // ----- 图像生成 -----

  /**
   * ComfyUI 图像生成
   *
   * 管线：
   * 1. GET /system_stats → 检查服务可用性
   * 2. 加载并参数化预设工作流 JSON
   * 3. POST /prompt → 提交工作流 → 获取 prompt_id
   * 4. GET /history/{prompt_id} → 轮询直到完成 → 获取输出图片
   */
  async generateImage(
    params: ImageGenerationParams
  ): Promise<ImageGenerationResult> {
    const startTime = Date.now();

    try {
      // Step 1: 检查 ComfyUI 服务是否可用
      const available = await this.checkAvailability();
      if (!available) {
        return {
          success: false,
          data: [],
          error: `ComfyUI 服务不可用 (${this.baseUrl})。请确保 ComfyUI 已启动并监听在 ${this.baseUrl}`,
          durationMs: Date.now() - startTime,
        };
      }

      // Step 2: 加载工作流
      const workflow = await this.loadWorkflow('txt2img');
      if (!workflow) {
        return {
          success: false,
          data: [],
          error: '无法加载 ComfyUI 工作流',
          durationMs: Date.now() - startTime,
        };
      }

      // Step 3: 参数化替换
      this.parameterizeWorkflow(workflow, params);

      // Step 4: 提交工作流
      const promptId = await this.submitPrompt(workflow);
      if (!promptId) {
        return {
          success: false,
          data: [],
          error: '提交 ComfyUI 工作流失败',
          durationMs: Date.now() - startTime,
        };
      }

      logger.info('ComfyUIProvider · 工作流已提交', { promptId });

      // Step 5: 等待完成
      const outputs = await this.waitForCompletion(promptId);
      if (!outputs || outputs.length === 0) {
        return {
          success: false,
          data: [],
          error: 'ComfyUI 工作流执行未产生输出',
          durationMs: Date.now() - startTime,
        };
      }

      return {
        success: true,
        data: outputs.map((url) => ({
          url,
          alt: params.prompt,
        })),
        model: 'comfyui-local',
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        data: [],
        error: `ComfyUI 图像生成失败: ${(error as Error).message}`,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /** 检查 ComfyUI 服务可用性 */
  private async checkAvailability(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/system_stats`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** 加载预设工作流 JSON */
  private async loadWorkflow(
    type: string
  ): Promise<Record<string, unknown> | null> {
    try {
      // 预设工作流存放在同目录下的 comfy-workflows/ 子目录
      const workflowPath = `./comfy-workflows/${type}_flux.json`;
      const file = Bun.file(workflowPath);
      if (!(await file.exists())) {
        logger.warn('ComfyUIProvider · 工作流文件不存在', {
          path: workflowPath,
        });
        return null;
      }
      const content = await file.text();
      return JSON.parse(content);
    } catch (error) {
      logger.warn('ComfyUIProvider · 加载工作流失败', {
        type,
        error: (error as Error).message,
      });
      return null;
    }
  }

  /** 参数化替换工作流中的关键值 */
  private parameterizeWorkflow(
    workflow: Record<string, unknown>,
    params: ImageGenerationParams
  ): void {
    // 遍历工作流中的每个节点，替换 prompt、seed、size 等参数
    for (const [, node] of Object.entries(workflow)) {
      const n = node as Record<string, unknown>;
      const inputs = n.inputs as Record<string, unknown> | undefined;
      if (!inputs) continue;

      // CLIP Text Encode → 替换 prompt
      if (inputs.text !== undefined) {
        const text = String(inputs.text);
        if (text === '{prompt}') {
          inputs.text = params.prompt;
        } else if (text === '{negative_prompt}') {
          inputs.text = params.negativePrompt || '';
        }
      }

      // Empty Latent Image → 替换尺寸
      if (inputs.width !== undefined && inputs.height !== undefined) {
        if (params.size) {
          const [w, h] = params.size.split('x').map(Number);
          if (w && h) {
            inputs.width = w;
            inputs.height = h;
          }
        }
      }

      // KSampler → 替换 seed
      if (inputs.seed !== undefined && typeof inputs.seed === 'number') {
        // 每次生成使用随机 seed
        inputs.seed = Math.floor(Math.random() * 2147483647);
      }

      // batch_size → 生成数量
      if (inputs.batch_size !== undefined && params.n) {
        inputs.batch_size = Math.min(Number(params.n), 4);
      }
    }
  }

  /** 向 ComfyUI 提交工作流 */
  private async submitPrompt(
    workflow: Record<string, unknown>
  ): Promise<string | null> {
    try {
      const response = await fetch(`${this.baseUrl}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: workflow }),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) return null;

      const data = (await response.json()) as Record<string, unknown>;
      return (data.prompt_id as string) || null;
    } catch (error) {
      logger.warn('ComfyUIProvider · 提交 prompt 失败', {
        error: (error as Error).message,
      });
      return null;
    }
  }

  /** 轮询等待工作流完成，返回输出图片 URL 列表 */
  private async waitForCompletion(promptId: string): Promise<string[] | null> {
    const maxAttempts = 120; // 最多等 2 分钟
    const pollInterval = 2000; // 每 2 秒轮询

    for (let i = 0; i < maxAttempts; i++) {
      await this.delay(pollInterval);

      try {
        const response = await fetch(`${this.baseUrl}/history/${promptId}`, {
          signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) continue;

        const data = (await response.json()) as Record<string, unknown>;
        const history = data[promptId] as Record<string, unknown> | undefined;

        if (!history) continue;

        // 检查状态
        const status = history.status as Record<string, unknown> | undefined;
        const completed = status?.completed as boolean;
        if (!completed) continue;

        // 提取输出图片
        const outputs = history.outputs as
          | Record<string, Record<string, unknown>>
          | undefined;
        if (!outputs) return [];

        const urls: string[] = [];
        for (const [, output] of Object.entries(outputs)) {
          const images = output.images as
            | Array<Record<string, unknown>>
            | undefined;
          if (images) {
            for (const img of images) {
              const filename = img.filename as string;
              const subfolder = (img.subfolder as string) || '';
              const type = (img.type as string) || 'output';

              if (filename) {
                const url = `${this.baseUrl}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
                urls.push(url);
              }
            }
          }
        }

        return urls;
      } catch {
        // 轮询失败继续
      }

      if (i % 10 === 0 && i > 0) {
        logger.debug('ComfyUIProvider · 轮询中', {
          promptId,
          elapsedSec: (i * pollInterval) / 1000,
        });
      }
    }

    logger.warn('ComfyUIProvider · 轮询超时', {
      promptId,
      attempts: maxAttempts,
    });
    return null;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

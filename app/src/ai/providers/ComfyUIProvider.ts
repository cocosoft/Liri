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
import type { ChatMessage, ChatResponse } from '../models/types';
import type {
  ChatOptions,
  ThinkingProviderChunk,
  ProviderConfig,
  ProviderValidationResult,
  ImageGenerationParams,
  ImageGenerationResult,
  VideoGenerationParams,
  VideoGenerationResult,
} from './AIProvider';
import { Logger, LogLevel } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { handleError } from '@modules/error';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'ai:comfy-provider',
});

export class ComfyUIProvider extends BaseAIProvider {
  private baseUrl: string;

  constructor(options: BaseProviderOptions) {
    super(options);
    this.baseUrl = options.defaultBaseUrl || 'http://127.0.0.1:8188';
    this.capabilities = { videoGeneration: true };
  }

  // ----- AIProvider 必需方法 -----

  async chat(
    _messages: ChatMessage[],
    _options?: ChatOptions
  ): Promise<ChatResponse> {
    throw new AppError(
      'ComfyUI 仅支持图像生成，不支持文本对话',
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
      'ComfyUI 仅支持图像生成，不支持文本对话',
      ErrorCategory.OPERATION,
      ErrorSeverity.MEDIUM,
      'NOT_SUPPORTED'
    );
  }

  async listModels(): Promise<string[]> {
    return ['comfyui-local'];
  }

  override validateConfig(_config: ProviderConfig): ProviderValidationResult {
    return { valid: true, errors: [], warnings: [] };
  }

  override setApiKey(_key: string): void {
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
    } catch (err) {
      return false;
    }
  }

  /** 加载预设工作流 JSON（兼容 {type}.json 与 {type}_flux.json 两种命名） */
  private async loadWorkflow(
    type: string
  ): Promise<Record<string, unknown> | null> {
    try {
      // 预设工作流存放在同目录下的 comfy-workflows/ 子目录
      const candidates = [
        `./comfy-workflows/${type}.json`,
        `./comfy-workflows/${type}_flux.json`,
      ];
      for (const workflowPath of candidates) {
        const file = Bun.file(workflowPath);
        if (!(await file.exists())) continue;
        const content = await file.text();
        return JSON.parse(content);
      }
      logger.warn('ComfyUIProvider · 工作流文件不存在', { candidates });
      return null;
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

  /** 轮询等待工作流完成，返回输出 URL 列表（images=图片帧 / videos=视频文件） */
  private async waitForCompletion(
    promptId: string,
    kind: 'images' | 'videos' = 'images'
  ): Promise<string[] | null> {
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

        // 提取输出（图片帧 / 视频文件）
        const outputs = history.outputs as
          | Record<string, Record<string, unknown>>
          | undefined;
        if (!outputs) return [];

        return this.extractOutputUrls(outputs, kind);
      } catch (err) {
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

  /** 从工作流输出中提取指定类型（images/gifs/videos）的文件 URL */
  private extractOutputUrls(
    outputs: Record<string, Record<string, unknown>>,
    kind: 'images' | 'videos'
  ): string[] {
    const urls: string[] = [];
    // VHS_VideoCombine 视频输出字段为 gifs（含 format: mp4/webm/gif），统一按 videos 提取
    const fields = kind === 'videos' ? ['videos', 'gifs'] : ['images'];

    for (const [, output] of Object.entries(outputs)) {
      for (const field of fields) {
        const items = output[field] as
          | Array<Record<string, unknown>>
          | undefined;
        if (!items) continue;
        for (const item of items) {
          const filename = item.filename as string;
          const subfolder = (item.subfolder as string) || '';
          const type = (item.type as string) || 'output';
          if (filename) {
            urls.push(
              `${this.baseUrl}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`
            );
          }
        }
      }
    }
    return urls;
  }

  /** 上传本地图片到 ComfyUI input 目录（图生视频/图生图），返回文件名 */
  private async uploadImage(filePath: string): Promise<string | null> {
    try {
      const file = Bun.file(filePath);
      if (!(await file.exists())) {
        logger.warn('ComfyUIProvider · 上传图片不存在', { filePath });
        return null;
      }
      const form = new FormData();
      form.append(
        'image',
        new File(
          [await file.arrayBuffer()],
          filePath.split(/[\\/]/).pop() || 'image.png',
          { type: 'image/png' }
        )
      );
      const response = await fetch(`${this.baseUrl}/upload/image`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { name?: string };
      return data.name || null;
    } catch (error) {
      logger.warn('ComfyUIProvider · 上传图片失败', {
        error: (error as Error).message,
      });
      return null;
    }
  }

  // ----- 视频生成 -----

  /**
   * ComfyUI 视频生成（本地 GPU 工作流）
   *
   * 管线（与图像生成一致）：
   * 1. GET /system_stats → 检查服务可用性
   * 2. 加载预设视频工作流 JSON（text2video / image2video）
   * 3. 参数化替换（prompt/seed/尺寸/帧数）
   * 4. POST /prompt → 提交 → prompt_id
   * 5. 轮询 /history/{prompt_id} → 提取 videos（VHS_VideoCombine 的 gifs）→ 图片帧兜底
   */
  async generateVideo(
    params: VideoGenerationParams
  ): Promise<VideoGenerationResult> {
    const startTime = Date.now();
    const isImageToVideo = !!(params.imageUrl || params.imagePath);

    logger.info('ComfyUIProvider · 开始视频生成', {
      isImageToVideo,
      prompt: params.prompt.slice(0, 80),
      resolution: params.resolution,
      aspectRatio: params.aspectRatio,
      duration: params.duration,
    });

    try {
      // Step 1: 检查服务可用
      const available = await this.checkAvailability();
      if (!available) {
        logger.error('ComfyUIProvider · 视频生成: 服务不可用', {
          baseUrl: this.baseUrl,
          elapsedMs: Date.now() - startTime,
        });
        return {
          success: false,
          data: [],
          error: `ComfyUI 服务不可用 (${this.baseUrl})。请确保 ComfyUI 已启动并监听在 ${this.baseUrl}`,
          durationMs: Date.now() - startTime,
        };
      }

      // Step 2: 加载视频工作流（图生视频优先 image2video）
      const workflowType = isImageToVideo ? 'image2video' : 'text2video';
      const workflow = await this.loadWorkflow(workflowType);
      if (!workflow) {
        logger.error('ComfyUIProvider · 视频生成: 工作流加载失败', {
          workflowType,
          elapsedMs: Date.now() - startTime,
        });
        return {
          success: false,
          data: [],
          error: `无法加载 ComfyUI 视频工作流（${workflowType}）。请在 comfy-workflows/ 放置对应工作流 JSON`,
          durationMs: Date.now() - startTime,
        };
      }
      logger.info('ComfyUIProvider · 视频工作流加载成功', {
        workflowType,
        elapsedMs: Date.now() - startTime,
      });

      // Step 3: 参数化替换（图生视频先上传本地图片）
      await this.parameterizeVideoWorkflow(workflow, params);

      // Step 4: 提交工作流
      const promptId = await this.submitPrompt(workflow);
      if (!promptId) {
        logger.error('ComfyUIProvider · 视频生成: 提交工作流失败', {
          workflowType,
          elapsedMs: Date.now() - startTime,
        });
        return {
          success: false,
          data: [],
          error: '提交 ComfyUI 视频工作流失败',
          durationMs: Date.now() - startTime,
        };
      }

      logger.info('ComfyUIProvider · 视频工作流已提交', {
        promptId,
        elapsedMs: Date.now() - startTime,
      });

      // Step 5: 等待完成（视频优先，图片帧兜底）
      const videos = await this.waitForCompletion(promptId, 'videos');
      let urls = videos && videos.length > 0 ? videos : [];
      if (urls.length === 0) {
        logger.info('ComfyUIProvider · 未提取到视频输出，回退图片帧', {
          promptId,
          elapsedMs: Date.now() - startTime,
        });
        urls = (await this.waitForCompletion(promptId, 'images')) || [];
      }
      if (!urls || urls.length === 0) {
        logger.error('ComfyUIProvider · 视频工作流执行未产生输出', {
          promptId,
          elapsedMs: Date.now() - startTime,
        });
        return {
          success: false,
          data: [],
          error: 'ComfyUI 视频工作流执行未产生输出',
          durationMs: Date.now() - startTime,
        };
      }

      logger.info('ComfyUIProvider · 视频生成成功', {
        promptId,
        outputCount: urls.length,
        outputType: videos && videos.length > 0 ? 'videos' : 'images',
        elapsedMs: Date.now() - startTime,
      });
      return {
        success: true,
        data: urls.map((url) => ({ url })),
        model: 'comfyui-local',
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      logger.error('ComfyUIProvider · 视频生成异常', {
        error: (error as Error).message,
        elapsedMs: Date.now() - startTime,
      });
      await handleError(error, {
        module: 'ai:comfy-provider',
        action: 'generateVideo',
      });
      return {
        success: false,
        data: [],
        error: `ComfyUI 视频生成失败: ${(error as Error).message}`,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /** 参数化替换视频工作流中的关键值 */
  private async parameterizeVideoWorkflow(
    workflow: Record<string, unknown>,
    params: VideoGenerationParams
  ): Promise<void> {
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

      // LoadImage → 图生视频首帧（本地图片上传到 ComfyUI input 目录）
      if (
        inputs.image !== undefined &&
        String(inputs.image).startsWith('{image}')
      ) {
        if (params.imagePath) {
          const uploaded = await this.uploadImage(params.imagePath);
          if (uploaded) inputs.image = uploaded;
          else inputs.image = 'image.png'; // 上传失败时兜底占位
        } else {
          // imageUrl 无法直接给 LoadImage（需本地文件），保持占位提示
          inputs.image = 'image.png';
        }
      }

      // EmptyLatentVideo → 尺寸与帧数
      if (inputs.width !== undefined && inputs.height !== undefined) {
        const [w, h] = this.resolveVideoSize(params);
        if (w && h) {
          inputs.width = w;
          inputs.height = h;
        }
      }
      if (inputs.length !== undefined && params.duration) {
        // 帧数 = 时长(秒) × 帧率（fps 由工作流定义，默认 16）
        const fps = Number(inputs.fps) || 16;
        inputs.length = Math.max(1, Math.round(params.duration * fps));
      }

      // KSampler → 替换 seed
      if (inputs.seed !== undefined && typeof inputs.seed === 'number') {
        inputs.seed = params.seed ?? Math.floor(Math.random() * 2147483647);
      }
    }
  }

  /** 依据分辨率×宽高比解析视频尺寸（未命中返回 null 由工作流默认） */
  private resolveVideoSize(
    params: VideoGenerationParams
  ): [number, number] | [] {
    const res = params.resolution || '';
    const ar = params.aspectRatio || '16:9';
    const base: Record<string, number> = {
      '480p': 480,
      '720p': 720,
      '1080p': 1080,
    };
    const h = base[res];
    if (!h) return [];
    const ratio: Record<string, [number, number]> = {
      '16:9': [16, 9],
      '9:16': [9, 16],
      '1:1': [1, 1],
      '4:3': [4, 3],
      '3:4': [3, 4],
    };
    const [rw, rh] = ratio[ar] || [16, 9];
    // 高度对齐分辨率档位，宽度按比例取偶
    const width = Math.round((h * rw) / rh / 2) * 2;
    return [Math.max(128, width), Math.max(128, h)];
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

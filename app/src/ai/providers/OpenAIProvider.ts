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
 * OpenAI Provider
 *
 * 使用 ChatCompletionsTransport（OpenAI 兼容格式），
 * 通过 std/fetch 直连 API，支持 DALL-E 图像生成和 Vision 图片分析。
 */

import type {
  ChatMessage,
  ChatResponse,
  ToolDefinition,
} from '../models/types';
import type {
  ProviderConfig,
  ProviderValidationResult,
  ThinkingProviderChunk,
  VideoGenerationParams,
  VideoGenerationResult,
} from './AIProvider';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { Logger, LogLevel } from '@modules/monitoring';
import { configManager } from '@modules/config';
import { ChatCompletionsTransport } from '../transports/ChatCompletionsTransport';
import { TransportProviderAdapter } from '../transports/TransportProviderAdapter';
import { ALL_MODEL_CONFIGS, getModelsByProvider } from '../models/ModelConfigs';
import { BaseAIProvider, type BaseProviderOptions } from './BaseAIProvider';
import { randomUUID } from 'crypto';

const logger = new Logger({ module: 'ai:openai', level: LogLevel.INFO });

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export class OpenAIProvider extends BaseAIProvider {
  private apiKey: string;
  private baseUrl: string;

  /**
   * 初始化 OpenAI Provider。
   * 构造函数回退链：DB 持久化 > 环境变量。
   *
   * @param options - 基础选项（providerId, displayName, defaultBaseUrl, envApiKey, defaultModel 等）
   * @param _extraConfig - 扩展配置（保留接口一致）
   */
  constructor(
    options: BaseProviderOptions,
    _extraConfig?: Record<string, unknown>
  ) {
    super(options, _extraConfig);

    this.apiKey = this.resolveApiKey() || '';
    this.baseUrl = (this.resolveBaseUrl() || DEFAULT_BASE_URL).replace(
      /\/+$/,
      ''
    );

    if (!this.transport) {
      this.transport = new TransportProviderAdapter(
        new ChatCompletionsTransport()
      );
    }
  }

  /** 运行时更新 API Key（供 ProviderSyncService 从 DB 同步后注入） */
  override setApiKey(key: string): void {
    this.apiKey = key || '';
  }

  async chat(
    messages: ChatMessage[],
    options?: {
      tools?: ToolDefinition[];
      model?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ): Promise<ChatResponse> {
    const model = await this.resolveModel('chat', options);
    const requestBody = this.transport!.buildRequest({
      model,
      messages,
      tools: options?.tools,
      maxTokens: options?.maxTokens || 4096,
      temperature: options?.temperature,
    });

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new AppError(
          `OpenAI API error (${response.status}): ${errorBody}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      const data = (await response.json()) as Record<string, unknown>;
      return this.transport!.toChatResponse(
        this.transport!.normalizeResponse(data)
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        `OpenAI chat failed: ${(error as Error).message}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: {
      tools?: ToolDefinition[];
      model?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ): AsyncGenerator<string | ThinkingProviderChunk, ChatResponse, unknown> {
    const model = await this.resolveModel('chat', options);
    const requestBody = this.transport!.buildRequest({
      model,
      messages,
      tools: options?.tools,
      maxTokens: options?.maxTokens || 4096,
      temperature: options?.temperature,
      stream: true,
    });

    try {
      // 使用带连接重试的 fetch，应对 Provider API 网关偶发断连
      const response = await BaseAIProvider.fetchWithConnectionRetry(
        `${this.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(180000),
        }
      );

      if (!response.ok) {
        const errorBody = await response.text();
        throw new AppError(
          `OpenAI stream error (${response.status}): ${errorBody}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new AppError(
          'OpenAI stream: no response body',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      let lastUsage:
        | import('@modules/ai/models/types').ChatResponse['usage']
        | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') break;

          try {
            const parsed = JSON.parse(data) as Record<string, unknown>;

            // 提取 usage 字段（通常在流式响应的最后一个 chunk 中出现）
            const usage = parsed['usage'] as
              | import('@modules/ai/models/types').ChatResponse['usage']
              | undefined;
            if (usage) {
              lastUsage = usage;
            }

            const choice = (parsed.choices as Record<string, unknown>[])?.[0];
            const delta = choice?.delta as Record<string, unknown> | undefined;

            // 处理推理内容（OpenAI o1/o3 的 reasoning_content 字段）
            const reasoningContent = delta?.['reasoning_content'] as
              | string
              | undefined;
            if (reasoningContent) {
              yield { type: 'thinking', content: reasoningContent };
            }

            const content = delta?.content as string | undefined;
            if (content) {
              fullContent += content;
              yield content;
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }

      return {
        content: fullContent,
        model,
        stop_reason: 'stop',
        usage: lastUsage,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        `OpenAI stream failed: ${(error as Error).message}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  async listModels(): Promise<string[]> {
    const supportedModels = getModelsByProvider('openai').map(
      (key) => ALL_MODEL_CONFIGS[key].openai
    );
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) return supportedModels;

      const data = (await response.json()) as { data?: { id: string }[] };
      return (
        data.data?.map((m) => m.id).filter((id) => id.includes('gpt')) ??
        supportedModels
      );
    } catch {
      return supportedModels;
    }
  }

  override validateConfig(config: ProviderConfig): ProviderValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.apiKey && !configManager.env('OPENAI_API_KEY')) {
      errors.push('API key is required (config.apiKey or OPENAI_API_KEY)');
    }

    const supportedModels = getModelsByProvider('openai').map(
      (key) => ALL_MODEL_CONFIGS[key].openai
    );
    if (config.model && !supportedModels.includes(config.model)) {
      warnings.push(
        `Unknown model: ${config.model}. Supported: ${supportedModels.join(', ')}`
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * OpenAI DALL-E 3 图像生成
   * 走 /v1/images/generations 端点
   */
  async generateImage(
    params: import('./AIProvider').ImageGenerationParams
  ): Promise<import('./AIProvider').ImageGenerationResult> {
    const startTime = Date.now();
    // 模型来源：调用方传入 > modelRouter 配置 > 报错
    let model = params.model || this.options.defaultModel;

    // P3-2: 透明背景自动路由 — gpt-image-2 不支持透明背景，自动切换为 gpt-image-1.5
    if (
      params.format === 'png' &&
      params.quality === 'standard' &&
      model === 'gpt-image-2' &&
      (params as any).background === 'transparent'
    ) {
      logger.info('OpenAIProvider.generateImage() · 透明背景自动路由', {
        from: model,
        to: 'gpt-image-1.5',
      });
      model = 'gpt-image-1.5';
    }

    if (!model) {
      logger.warn('OpenAIProvider.generateImage() · 未配置生图模型', {
        providerId: this.id,
        hasDefaultModel: !!this.options.defaultModel,
      });
      return {
        success: false,
        data: [],
        error:
          'No image generation model configured. Please set a model in model management.',
        durationMs: 0,
      };
    }

    logger.info('OpenAIProvider.generateImage()', {
      providerId: this.id,
      model,
      baseUrl: this.baseUrl,
      prompt: params.prompt.slice(0, 50),
      size: params.size,
    });

    const body: Record<string, unknown> = {
      model,
      prompt: params.prompt,
      n: params.n ?? 1,
      size: params.size ?? '1024x1024',
    };

    // DALL-E 专有参数（仅当模型名匹配 dall-e 时附加）
    if (model.toLowerCase().startsWith('dall-e')) {
      body.quality = params.quality ?? 'standard';
      body.style = params.style ?? 'vivid';
      body.response_format = 'b64_json';
      if (body.quality === 'hd' && body.size === '1024x1024') {
        body.size = '1792x1024';
      }
    }

    try {
      // 使用 fetchWithConnectionRetry（基类已注入系统 CA 证书 dispatcher，解决 Windows SSL 证书问题）
      const response = await OpenAIProvider.fetchWithConnectionRetry(
        `${this.baseUrl}/images/generations`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120000),
        },
        0 // 图片生成不自动重试（避免重复请求和重复计费）
      );

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          data: [],
          error: `Image generation API error (${response.status}): ${errorBody}`,
          durationMs: Date.now() - startTime,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const images = (data.data as Array<Record<string, string>>) || [];

      return {
        success: true,
        data: images.map((img: Record<string, string>) => ({
          url: img.url || `data:image/png;base64,${img.b64_json}`,
          b64_json: img.b64_json,
          alt: params.prompt,
        })),
        model: model,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = (error as Error).message || String(error);

      // 检测 SSL/TLS 证书错误，提供用户友好的解决建议
      const isSSLError = /certificate|ssl|tls|unable to verify/i.test(
        errorMessage
      );

      const userHint = isSSLError
        ? `SSL 证书验证失败。请尝试以下操作：\n` +
          `1. 设置环境变量 NODE_EXTRA_CA_CERTS 指向系统 CA 证书文件\n` +
          `   （如 Git\\mingw64\\ssl\\cert.pem 或 curl\\ca-bundle.crt）\n` +
          `2. 如在代理环境下使用，请确认代理证书已加入信任列表\n` +
          `原始错误: ${errorMessage}`
        : `Image generation failed: ${errorMessage}`;

      logger.warn('OpenAIProvider.generateImage() · 请求失败', {
        providerId: this.id,
        model,
        isSSLError,
        error: errorMessage,
      });

      return {
        success: false,
        data: [],
        error: userHint,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * OpenAI Vision 图片分析
   * 直接构造 chat/completions 多模态请求
   */
  async analyzeImage(
    params: import('./AIProvider').VisionAnalysisParams
  ): Promise<import('./AIProvider').VisionAnalysisResult> {
    const startTime = Date.now();
    const base64 = params.imageBuffer.toString('base64');
    const dataUrl = `data:${params.mimeType};base64,${base64}`;

    const requestBody = {
      model: params.model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: params.prompt || '请详细描述这张图片的内容。',
            },
            {
              type: 'image_url',
              image_url: {
                url: dataUrl,
                detail: params.detail || 'auto',
              },
            },
          ],
        },
      ],
      max_tokens: params.maxTokens ?? 1024,
    };

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          description: '',
          error: `OpenAI Vision error (${response.status}): ${errorBody}`,
          durationMs: Date.now() - startTime,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const choice = (data.choices as Array<Record<string, unknown>>)?.[0];
      const message = choice?.message as Record<string, unknown> | undefined;
      const content = message?.content as string | undefined;

      return {
        success: true,
        description: content || '',
        model: '',
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        description: '',
        error: `OpenAI Vision failed: ${(error as Error).message}`,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * 视频生成（异步提交 + 轮询）
   *
   * 双路径支持：
   *   - SiliconFlow：POST /v1/video/submit → POST /v1/video/status
   *   - OpenAI 兼容：POST /video/generations → GET /video/generations/{taskId}
   */
  async generateVideo(
    params: VideoGenerationParams
  ): Promise<VideoGenerationResult> {
    const startTime = Date.now();
    const model = params.model || this.options.defaultModel || '';

    if (!model) {
      return {
        success: false,
        data: [],
        error: '未配置视频生成模型',
        durationMs: 0,
      };
    }

    if (!this.apiKey) {
      return {
        success: false,
        data: [],
        error: 'API Key 未配置',
        durationMs: 0,
      };
    }

    const isSiliconFlow = this.baseUrl.includes('api.siliconflow.cn');

    logger.info('OpenAIProvider.generateVideo()', {
      providerId: this.id,
      model,
      baseUrl: this.baseUrl,
      isSiliconFlow,
      prompt: params.prompt.slice(0, 80),
    });

    if (isSiliconFlow) {
      return this.generateVideoSiliconFlow(params, model, startTime);
    }

    return this.generateVideoOpenAI(params, model, startTime);
  }

  /** SiliconFlow 视频生成：POST /v1/video/submit → POST /v1/video/status */
  private async generateVideoSiliconFlow(
    params: VideoGenerationParams,
    model: string,
    startTime: number
  ): Promise<VideoGenerationResult> {
    const body: Record<string, unknown> = {
      model,
      prompt: params.prompt,
    };
    // 图生视频：优先用外部 URL；如果 imageUrl 是 localhost 且 imagePath 存在，转 base64
    if (params.imageUrl) {
      if (
        params.imageUrl.includes('localhost') ||
        params.imageUrl.includes('127.0.0.1')
      ) {
        if (params.imagePath) {
          const file = Bun.file(params.imagePath);
          const buffer = Buffer.from(await file.arrayBuffer());
          const ext = params.imagePath.split('.').pop()?.toLowerCase() || 'png';
          const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
          body.image = `data:${mimeType};base64,${buffer.toString('base64')}`;
          logger.info('OpenAIProvider . localhost URL → base64', {
            path: params.imagePath,
            mimeType,
            sizeKb: Math.round(buffer.length / 1024),
          });
        }
        // 无 imagePath 则跳过图片（降级为文生视频）
      } else {
        body.image = params.imageUrl;
      }
    }
    if (params.seed !== undefined) body.seed = params.seed;

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };

    try {
      // 1. 提交任务
      const submitRes = await fetch(`${this.baseUrl}/video/submit`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });

      if (!submitRes.ok) {
        const errorBody = await submitRes.text();
        return {
          success: false,
          data: [],
          error: `SiliconFlow 视频提交失败 (${submitRes.status}): ${errorBody}`,
          durationMs: Date.now() - startTime,
        };
      }

      const submitData = (await submitRes.json()) as Record<string, unknown>;
      const requestId = submitData.requestId as string | undefined;

      if (!requestId) {
        return {
          success: false,
          data: [],
          error: `SiliconFlow 视频提交: 未返回 requestId, 响应: ${JSON.stringify(submitData)}`,
          durationMs: Date.now() - startTime,
        };
      }

      logger.info('SiliconFlow 视频任务已提交', { requestId, model });

      // 2. 轮询状态
      const MAX_POLL_TIME = 10 * 60 * 1000;
      let pollInterval = 3000;
      let videoUrl = '';

      while (Date.now() - startTime < MAX_POLL_TIME) {
        await new Promise((r) => setTimeout(r, pollInterval));
        pollInterval = Math.min(pollInterval * 1.3, 15000);

        const statusRes = await fetch(`${this.baseUrl}/video/status`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ requestId }),
          signal: AbortSignal.timeout(15000),
        });

        if (!statusRes.ok) {
          if (statusRes.status === 429) {
            await new Promise((r) => setTimeout(r, 10000));
            continue;
          }
          logger.warn('SiliconFlow 视频状态查询失败', {
            status: statusRes.status,
            requestId,
          });
          continue;
        }

        const statusData = (await statusRes.json()) as Record<string, unknown>;
        const state = statusData.status as string;

        if (state === 'Succeed') {
          const results = statusData.results as
            | Record<string, unknown>
            | undefined;
          const videos = results?.videos as
            | Array<Record<string, unknown>>
            | undefined;
          if (videos?.[0]?.url) {
            videoUrl = videos[0].url as string;
          }
          break;
        }

        if (state === 'Failed' || state === 'Error') {
          return {
            success: false,
            data: [],
            error: `SiliconFlow 视频生成失败: ${JSON.stringify(statusData.reason || statusData)}`,
            durationMs: Date.now() - startTime,
          };
        }

        // InProgress — 继续轮询
      }

      if (!videoUrl) {
        return {
          success: false,
          data: [],
          error: 'SiliconFlow 视频生成超时（超过 10 分钟）',
          durationMs: Date.now() - startTime,
        };
      }

      return {
        success: true,
        data: [{ url: videoUrl }],
        durationMs: Date.now() - startTime,
        model,
      };
    } catch (error) {
      return {
        success: false,
        data: [],
        error: `SiliconFlow 视频生成异常: ${(error as Error).message}`,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /** OpenAI 兼容视频生成：POST /video/generations → GET /video/generations/{taskId} */
  private async generateVideoOpenAI(
    params: VideoGenerationParams,
    model: string,
    startTime: number
  ): Promise<VideoGenerationResult> {
    const body: Record<string, unknown> = {
      model,
      prompt: params.prompt,
    };
    if (params.imageUrl) {
      if (
        params.imageUrl.includes('localhost') ||
        params.imageUrl.includes('127.0.0.1')
      ) {
        if (params.imagePath) {
          const file = Bun.file(params.imagePath);
          const buffer = Buffer.from(await file.arrayBuffer());
          const ext = params.imagePath.split('.').pop()?.toLowerCase() || 'png';
          const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
          body.image_url = `data:${mimeType};base64,${buffer.toString('base64')}`;
        }
      } else {
        body.image_url = params.imageUrl;
      }
    }
    if (params.duration) body.duration = params.duration;
    if (params.aspectRatio) body.aspect_ratio = params.aspectRatio;
    if (params.negativePrompt) body.negative_prompt = params.negativePrompt;
    if (params.seed !== undefined) body.seed = params.seed;
    if (params.n) body.n = params.n;

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };

    try {
      const submitRes = await fetch(`${this.baseUrl}/video/generations`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });

      if (!submitRes.ok) {
        const errorBody = await submitRes.text();
        return {
          success: false,
          data: [],
          error: `视频生成 API 错误 (${submitRes.status}): ${errorBody}`,
          durationMs: Date.now() - startTime,
        };
      }

      const submitData = (await submitRes.json()) as Record<string, unknown>;
      const taskId = (submitData.id ||
        submitData.task_id ||
        submitData.request_id) as string | undefined;

      if (!taskId) {
        const videoUrl = extractVideoUrl(submitData);
        if (videoUrl) {
          return {
            success: true,
            data: [{ url: videoUrl }],
            durationMs: Date.now() - startTime,
            model,
          };
        }
        return {
          success: false,
          data: [],
          error: '视频生成: 未返回任务 ID',
          durationMs: Date.now() - startTime,
        };
      }

      const statusUrl = `${this.baseUrl}/video/generations/${taskId}`;
      const MAX_POLL_TIME = 5 * 60 * 1000;
      let pollInterval = 2000;
      let videoUrl = '';

      while (Date.now() - startTime < MAX_POLL_TIME) {
        await new Promise((r) => setTimeout(r, pollInterval));
        pollInterval = Math.min(pollInterval * 1.5, 10000);

        const statusRes = await fetch(statusUrl, {
          headers,
          signal: AbortSignal.timeout(15000),
        });

        if (!statusRes.ok) {
          if (statusRes.status === 429) {
            await new Promise((r) => setTimeout(r, 10000));
            continue;
          }
          continue;
        }

        const status = (await statusRes.json()) as Record<string, unknown>;
        const state = (status.status || status.state) as string;

        if (
          state === 'completed' ||
          state === 'succeeded' ||
          state === 'COMPLETED'
        ) {
          videoUrl = extractVideoUrl(status);
          break;
        }
        if (state === 'failed' || state === 'FAILED' || state === 'error') {
          return {
            success: false,
            data: [],
            error: `视频生成失败: ${JSON.stringify(status.error || status.message || status)}`,
            durationMs: Date.now() - startTime,
          };
        }
      }

      if (!videoUrl) {
        return {
          success: false,
          data: [],
          error: '视频生成超时（超过 5 分钟）',
          durationMs: Date.now() - startTime,
        };
      }

      return {
        success: true,
        data: [{ url: videoUrl }],
        durationMs: Date.now() - startTime,
        model,
      };
    } catch (error) {
      return {
        success: false,
        data: [],
        error: `视频生成失败: ${(error as Error).message}`,
        durationMs: Date.now() - startTime,
      };
    }
  }
}

/** 从多种响应格式中提取视频 URL */
function extractVideoUrl(data: Record<string, unknown>): string {
  // 常见格式: { video: { url: "..." } }
  const video = data.video as Record<string, unknown> | undefined;
  if (video?.url) return video.url as string;

  // { output: { video: "..." } }
  const output = data.output as Record<string, unknown> | undefined;
  if (output?.video) return output.video as string;
  if (output?.url) return output.url as string;

  // { data: [{ url: "..." }] }
  const dataArr = data.data as Array<Record<string, unknown>> | undefined;
  if (dataArr?.[0]?.url) return dataArr[0].url as string;

  // { result: { video: { url: "..." } } }
  const result = data.result as Record<string, unknown> | undefined;
  if (result?.video) {
    const rv = result.video as Record<string, unknown>;
    if (rv.url) return rv.url as string;
  }

  // { url: "..." }
  if (data.url) return data.url as string;

  return '';
}

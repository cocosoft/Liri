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
 * AsyncVideoTaskProvider — 异步视频任务 Provider 抽象基类
 *
 * 国内视频生成 API（可灵/豆包 Seedance/Vidu/MiniMax/通义万相）均为
 * 「提交任务 → 轮询状态 → 取视频 URL」三步异步模式。
 * 本基类统一通用逻辑（提交/轮询退避/超时/错误分类/结果归一化），
 * 子类只需实现三个差异点：submitVideoTask / queryVideoTask / extractVideoUrl。
 *
 * 参照实现：FALProvider.generateVideo（既有异步视频模式）。
 */

import type { ChatMessage, ChatResponse } from '../models/types';
import type { ChatOptions, ThinkingProviderChunk } from './AIProvider';
import type {
  VideoGenerationParams,
  VideoGenerationResult,
} from './AIProvider';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { handleError } from '@modules/error';
import { Logger, getLogger } from '@modules/monitoring';
import { BaseAIProvider, type BaseProviderOptions } from './BaseAIProvider.js';

/** 轮询查询到的任务状态 */
export interface VideoTaskPollState {
  state: 'pending' | 'running' | 'completed' | 'failed' | 'unknown';
  /** 完成时可直接下载的视频 URL（各厂商结构差异在 queryVideoTask 内归一化） */
  videoUrl?: string;
  error?: string;
}

/** 轮询配置 */
export interface VideoPollingConfig {
  /** 初始间隔（ms） */
  baseIntervalMs: number;
  /** 最大间隔（ms） */
  maxIntervalMs: number;
  /** 总轮询超时（ms） */
  maxPollMs: number;
  /** 间隔退避系数 */
  backoffFactor: number;
}

const DEFAULT_POLLING: VideoPollingConfig = {
  baseIntervalMs: 2000,
  maxIntervalMs: 10000,
  maxPollMs: 5 * 60 * 1000,
  backoffFactor: 1.5,
};

/** 短暂延时（测试可注入） */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 异步视频任务 Provider 基类
 *
 * 子类必须实现（差异点收敛为三方法）：
 * - submitVideoTask：提交任务，返回平台 taskId
 * - queryVideoTask：查询任务状态并归一化为 VideoTaskPollState
 * - extractVideoUrl：从任务结果提取视频 URL（备用，queryVideoTask 内亦可直接提取）
 *
 * 基类提供 generateVideo 统一流程；chat/chatStream 不支持（视频 Provider）。
 */
export abstract class AsyncVideoTaskProvider extends BaseAIProvider {
  protected readonly polling: VideoPollingConfig;

  /** 基类流程日志（module 按 provider 实例区分） */
  protected readonly logger: Logger;

  constructor(
    options: BaseProviderOptions,
    polling?: Partial<VideoPollingConfig>
  ) {
    super(options);
    this.polling = { ...DEFAULT_POLLING, ...polling };
    this.logger = getLogger(`ai:provider:${this.id}`);
  }

  /** 提交视频生成任务，返回平台 taskId */
  protected abstract submitVideoTask(
    params: VideoGenerationParams,
    apiKey: string
  ): Promise<{ taskId: string }>;

  /** 查询任务状态（归一化为统一枚举 + 视频 URL） */
  protected abstract queryVideoTask(
    taskId: string,
    apiKey: string
  ): Promise<VideoTaskPollState>;

  /** 从任务结果原始数据中提取视频 URL（适配各家返回结构） */
  protected abstract extractVideoUrl(result: unknown): string;

  /** 视频生成（统一异步流程：提交 → 轮询 → 取 URL） */
  async generateVideo(
    params: VideoGenerationParams
  ): Promise<VideoGenerationResult> {
    const startTime = Date.now();
    const model = params.model || this.options.defaultModel || '';
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      this.logger.error('generateVideo: API Key 未配置', {
        provider: this.id,
        model,
      });
      return {
        success: false,
        data: [],
        error: `${this.id} API Key 未配置（请在模型管理配置或设置环境变量）`,
        durationMs: 0,
      };
    }

    this.logger.info('generateVideo: 开始提交视频生成任务', {
      provider: this.id,
      model,
      isImageToVideo: !!(params.imageUrl || params.imagePath),
      prompt: params.prompt.slice(0, 80),
    });

    try {
      // 1. 提交任务
      const { taskId } = await this.submitVideoTask(params, apiKey);
      if (!taskId) {
        this.logger.error('generateVideo: 提交未返回任务 ID', {
          provider: this.id,
          model,
          elapsedMs: Date.now() - startTime,
        });
        return {
          success: false,
          data: [],
          error: `${this.id} 视频生成: 未返回任务 ID`,
          durationMs: Date.now() - startTime,
        };
      }
      this.logger.info('generateVideo: 任务提交成功', {
        provider: this.id,
        taskId,
        model,
        elapsedMs: Date.now() - startTime,
      });

      // 2. 轮询状态（指数退避 + 超时保护）
      let videoUrl = '';
      let pollInterval = this.polling.baseIntervalMs;
      let unknownCount = 0;
      let lastState: VideoTaskPollState['state'] | undefined;
      const pollStart = Date.now();

      while (Date.now() - pollStart < this.polling.maxPollMs) {
        await sleep(pollInterval);
        pollInterval = Math.min(
          pollInterval * this.polling.backoffFactor,
          this.polling.maxIntervalMs
        );

        const state = await this.queryVideoTask(taskId, apiKey);

        // 状态变化时输出日志（避免每轮刷屏）
        if (state.state !== lastState) {
          this.logger.info('generateVideo: 任务状态变化', {
            provider: this.id,
            taskId,
            state: state.state,
            elapsedMs: Date.now() - startTime,
            videoUrl: state.videoUrl ? state.videoUrl.slice(0, 120) : undefined,
            error: state.error,
          });
          lastState = state.state;
        }

        if (state.state === 'completed' && state.videoUrl) {
          videoUrl = state.videoUrl;
          break;
        }
        if (state.state === 'failed') {
          this.logger.error('generateVideo: 视频任务失败', {
            provider: this.id,
            taskId,
            error: state.error || '未知错误',
            elapsedMs: Date.now() - startTime,
          });
          return {
            success: false,
            data: [],
            error: `${this.id} 视频生成失败: ${state.error || '未知错误'}`,
            durationMs: Date.now() - startTime,
          };
        }
        if (state.state === 'unknown') {
          unknownCount++;
          if (unknownCount > 3) {
            this.logger.error('generateVideo: 任务状态无法解析（重试耗尽）', {
              provider: this.id,
              taskId,
              unknownCount,
              elapsedMs: Date.now() - startTime,
            });
            return {
              success: false,
              data: [],
              error: `${this.id} 视频任务状态无法解析（已重试 ${unknownCount} 次）`,
              durationMs: Date.now() - startTime,
            };
          }
        }
      }

      if (!videoUrl) {
        this.logger.warning('generateVideo: 视频任务超时', {
          provider: this.id,
          taskId,
          maxPollMs: this.polling.maxPollMs,
          elapsedMs: Date.now() - startTime,
        });
        return {
          success: false,
          data: [],
          error: `视频生成超时（超过 ${Math.round(this.polling.maxPollMs / 60000)} 分钟）`,
          durationMs: Date.now() - startTime,
        };
      }

      this.logger.info('generateVideo: 视频生成成功', {
        provider: this.id,
        taskId,
        model,
        videoUrl: videoUrl.slice(0, 120),
        elapsedMs: Date.now() - startTime,
      });
      return {
        success: true,
        data: [{ url: videoUrl }],
        durationMs: Date.now() - startTime,
        model,
      };
    } catch (error) {
      this.logger.error('generateVideo: 执行异常', {
        provider: this.id,
        model,
        error: (error as Error).message,
        elapsedMs: Date.now() - startTime,
      });
      await handleError(error, {
        module: `ai:provider:${this.id}`,
        action: 'generateVideo',
      });
      return {
        success: false,
        data: [],
        error: `${this.id} 视频生成失败: ${(error as Error).message}`,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /** 视频 Provider 不支持聊天 */
  async chat(
    _messages: ChatMessage[],
    _options?: ChatOptions
  ): Promise<ChatResponse> {
    throw new AppError(
      `${this.id} 为视频生成 Provider，不支持聊天`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      'VIDEO_ONLY_PROVIDER'
    );
  }

  /** 视频 Provider 不支持流式聊天 */
  chatStream(
    _messages: ChatMessage[],
    _options?: ChatOptions
  ): AsyncGenerator<string | ThinkingProviderChunk, ChatResponse, unknown> {
    throw new AppError(
      `${this.id} 为视频生成 Provider，不支持流式聊天`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      'VIDEO_ONLY_PROVIDER'
    );
  }

  /** 模型列表由 model_registry 提供（能力提示），基类返回空 */
  async listModels(): Promise<string[]> {
    return [];
  }
}

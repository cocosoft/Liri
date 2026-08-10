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
 * KlingProvider — 可灵 AI（快手）视频生成 Provider
 *
 * 官方开放平台 API（https://app.klingai.com/cn/dev/document-api/）：
 * - 文生视频: POST {base}/v1/videos/text2video
 * - 图生视频: POST {base}/v1/videos/image2video
 * - 任务查询: GET {base}/v1/videos/{text2video|image2video}/{task_id}
 * - 鉴权: AK/SK 生成 JWT（HS256，payload { iss: accessKey, exp: +1800s, nbf: -5s }），
 *   请求头 `Authorization: Bearer <jwt>`（官方"接口鉴权"章节）
 * - 状态流转: submitted（已提交）→ processing（处理中）→ succeed（成功）/ failed（失败）
 * - 完成时 data.task_result.videos[0].url 为视频下载地址
 *
 * 基于 AsyncVideoTaskProvider 统一异步流程（提交 → 轮询 → 取 URL），
 * 仅实现三个差异点：submitVideoTask / queryVideoTask / extractVideoUrl。
 *
 * 参照实现：ViduProvider（同为 AsyncVideoTaskProvider 子类的国内视频 Provider）。
 */

import fs from 'node:fs/promises';
import jwt from 'jsonwebtoken';
import type { VideoGenerationParams } from './AIProvider';
import {
  AsyncVideoTaskProvider,
  type VideoPollingConfig,
  type VideoTaskPollState,
} from './AsyncVideoTaskProvider.js';
import { BaseAIProvider, type BaseProviderOptions } from './BaseAIProvider.js';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

/** 官方 task_status 枚举 → 基类轮询状态枚举 */
const STATE_MAP: Record<string, VideoTaskPollState['state']> = {
  submitted: 'pending',
  processing: 'running',
  succeed: 'completed',
  failed: 'failed',
};

/** 官方响应包裹结构 { code, message, request_id, data } */
interface KlingResponse {
  code: number;
  message?: string;
  request_id?: string;
  data?: {
    task_id?: string;
    task_status?: string;
    task_status_msg?: string;
    task_result?: {
      videos?: Array<{ id?: string; url?: string; duration?: string }>;
    };
    [key: string]: unknown;
  };
}

export class KlingProvider extends AsyncVideoTaskProvider {
  /** 最近一次提交使用的接口（text2video/image2video），任务查询路径需要区分 */
  private endpoint: 'text2video' | 'image2video' = 'text2video';

  constructor(
    options: Partial<BaseProviderOptions> = {},
    polling?: Partial<VideoPollingConfig>
  ) {
    super(
      {
        providerId: 'kling',
        displayName: '可灵 AI',
        envApiKey: 'KLING_API_KEY',
        defaultBaseUrl: 'https://api.klingai.com',
        ...options,
      },
      polling
    );
    this.capabilities.videoGeneration = true;
  }

  // ============================================================
  // 提交视频生成任务
  // ============================================================

  protected async submitVideoTask(
    params: VideoGenerationParams,
    apiKey: string
  ): Promise<{ taskId: string }> {
    const image = await this.resolveImageInput(params);
    // 有图像输入走图生视频接口，否则文生视频接口
    const endpoint = image ? 'image2video' : 'text2video';
    this.endpoint = endpoint;

    const body: Record<string, unknown> = { prompt: params.prompt };
    const model = params.model || this.options.defaultModel;
    if (model) body.model_name = model;
    if (image) body.image = image;
    if (params.negativePrompt) body.negative_prompt = params.negativePrompt;
    if (params.duration !== undefined) body.duration = String(params.duration);
    if (params.aspectRatio) body.aspect_ratio = params.aspectRatio;
    if (params.seed !== undefined) body.seed = params.seed;

    const baseUrl = this.resolveBaseUrl() || '';
    const response = await BaseAIProvider.fetchWithConnectionRetry(
      `${baseUrl}/v1/videos/${endpoint}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.buildAuthHeader(apiKey),
        },
        body: JSON.stringify(body),
      }
    );
    if (!response.ok) this.handleHttpError(response, endpoint);

    const json = (await response.json()) as KlingResponse;
    if (json.code !== 0) {
      throw new AppError(
        `可灵 API 提交任务失败: code=${json.code} message=${
          json.message || '未知错误'
        }`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        String(json.code)
      );
    }
    const taskId =
      typeof json.data?.task_id === 'string' ? json.data.task_id : '';
    return { taskId };
  }

  // ============================================================
  // 查询任务状态（归一化为 VideoTaskPollState）
  // ============================================================

  protected async queryVideoTask(
    taskId: string,
    apiKey: string
  ): Promise<VideoTaskPollState> {
    const baseUrl = this.resolveBaseUrl() || '';
    const response = await BaseAIProvider.fetchWithConnectionRetry(
      `${baseUrl}/v1/videos/${this.endpoint}/${encodeURIComponent(taskId)}`,
      {
        headers: { Authorization: this.buildAuthHeader(apiKey) },
      }
    );
    if (!response.ok) this.handleHttpError(response, 'query task');

    const json = (await response.json()) as KlingResponse;
    if (json.code !== 0) {
      throw new AppError(
        `可灵 API 查询任务失败: code=${json.code} message=${
          json.message || '未知错误'
        }`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        String(json.code)
      );
    }

    const rawState =
      typeof json.data?.task_status === 'string'
        ? json.data.task_status.toLowerCase()
        : '';
    const state = STATE_MAP[rawState] || 'unknown';

    switch (state) {
      case 'completed': {
        const videoUrl = this.extractVideoUrl(json.data?.task_result);
        return { state: 'completed', videoUrl };
      }
      case 'failed':
        return {
          state: 'failed',
          error: json.data?.task_status_msg || '生成失败',
        };
      default:
        return { state };
    }
  }

  // ============================================================
  // 提取视频 URL（官方结构 data.task_result.videos[0].url）
  // ============================================================

  protected extractVideoUrl(result: unknown): string {
    const taskResult = result as
      | { videos?: Array<{ id?: string; url?: string; duration?: string }> }
      | undefined;
    return taskResult?.videos?.[0]?.url || '';
  }

  // ============================================================
  // 私有工具
  // ============================================================

  /**
   * 构建鉴权头。KLING_API_KEY 支持两种格式：
   * 1. "accessKey:secretKey" → 按官方要求生成 JWT（HS256）后以 Bearer 携带
   * 2. 其他 → 直接作为 Bearer token（兼容网关/代理已转换的场景）
   */
  private buildAuthHeader(apiKey: string): string {
    const sep = apiKey.indexOf(':');
    if (sep > 0 && sep < apiKey.length - 1) {
      const accessKey = apiKey.slice(0, sep);
      const secretKey = apiKey.slice(sep + 1);
      const now = Math.floor(Date.now() / 1000);
      const token = jwt.sign(
        { iss: accessKey, exp: now + 1800, nbf: now - 5 },
        secretKey,
        { algorithm: 'HS256', header: { alg: 'HS256', typ: 'JWT' } }
      );
      return `Bearer ${token}`;
    }
    return `Bearer ${apiKey}`;
  }

  /** 解析图像输入：优先 URL；本地路径读取后转为 Base64（官方要求不带 data: 前缀） */
  private async resolveImageInput(
    params: VideoGenerationParams
  ): Promise<string | undefined> {
    if (params.imageUrl) return params.imageUrl;
    if (params.imagePath) {
      const buf = await fs.readFile(params.imagePath);
      return buf.toString('base64');
    }
    return undefined;
  }
}

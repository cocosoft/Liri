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
 * ViduProvider — Vidu（生数科技）视频生成 Provider
 *
 * 官方开放平台 API（https://platform.vidu.cn/docs）：
 * - 文生视频: POST {base}/ent/v2/text2video
 * - 图生视频: POST {base}/ent/v2/img2video
 * - 任务查询: GET {base}/ent/v2/tasks/{id}/creations
 * - 鉴权头: `Authorization: Token {api key}`（官方文档格式）
 * - 状态流转: created/queueing → processing → success / failed
 * - 完成时 creations[].url 为 24 小时有效的视频下载地址
 *
 * 基于 AsyncVideoTaskProvider 统一异步流程（提交 → 轮询 → 取 URL），
 * 仅实现三个差异点：submitVideoTask / queryVideoTask / extractVideoUrl。
 */

import fs from 'node:fs/promises';
import type { VideoGenerationParams } from './AIProvider';
import {
  AsyncVideoTaskProvider,
  type VideoPollingConfig,
  type VideoTaskPollState,
} from './AsyncVideoTaskProvider.js';
import { BaseAIProvider, type BaseProviderOptions } from './BaseAIProvider.js';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

/** 官方 state 枚举 → 基类轮询状态枚举 */
const STATE_MAP: Record<string, VideoTaskPollState['state']> = {
  created: 'pending',
  queueing: 'pending',
  processing: 'running',
  success: 'completed',
  failed: 'failed',
};

export class ViduProvider extends AsyncVideoTaskProvider {
  constructor(
    options: Partial<BaseProviderOptions> = {},
    polling?: Partial<VideoPollingConfig>
  ) {
    super(
      {
        providerId: 'vidu',
        displayName: 'Vidu',
        envApiKey: 'VIDU_API_KEY',
        defaultBaseUrl: 'https://api.vidu.cn',
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
    const model = params.model || this.options.defaultModel;
    if (!model) {
      throw new AppError(
        `${this.id} 视频生成: 未指定模型（请通过调用参数或模型管理配置）`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'VIDU_NO_MODEL'
      );
    }

    const imageInput = await this.resolveImageInput(params);
    // 有图像输入走图生视频接口，否则文生视频接口
    const endpoint = imageInput ? '/ent/v2/img2video' : '/ent/v2/text2video';

    const body: Record<string, unknown> = {
      model,
      prompt: params.prompt,
    };
    if (imageInput) body.images = [imageInput];
    if (params.duration !== undefined) body.duration = params.duration;
    if (params.seed !== undefined) body.seed = params.seed;
    if (params.aspectRatio) body.aspect_ratio = params.aspectRatio;
    if (params.resolution) body.resolution = params.resolution;
    if (params.style) body.style = params.style;

    const baseUrl = this.resolveBaseUrl() || '';
    const response = await BaseAIProvider.fetchWithConnectionRetry(
      `${baseUrl}${endpoint}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Token ${apiKey}`,
        },
        body: JSON.stringify(body),
      }
    );
    if (!response.ok) this.handleHttpError(response, endpoint);

    const json = (await response.json()) as Record<string, unknown>;
    const payload = this.unwrapPayload(json);
    const taskId = typeof payload.task_id === 'string' ? payload.task_id : '';
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
      `${baseUrl}/ent/v2/tasks/${encodeURIComponent(taskId)}/creations`,
      {
        headers: { Authorization: `Token ${apiKey}` },
      }
    );
    if (!response.ok) this.handleHttpError(response, 'query task');

    const json = (await response.json()) as Record<string, unknown>;
    const payload = this.unwrapPayload(json);
    const rawState =
      typeof payload.state === 'string' ? payload.state.toLowerCase() : '';
    const state = STATE_MAP[rawState] || 'unknown';

    switch (state) {
      case 'completed': {
        const videoUrl = this.extractVideoUrl(json);
        return { state: 'completed', videoUrl };
      }
      case 'failed':
        return {
          state: 'failed',
          error:
            (typeof payload.err_code === 'string' ? payload.err_code : '') ||
            (typeof payload.message === 'string' ? payload.message : '') ||
            '未知错误',
        };
      default:
        return { state };
    }
  }

  // ============================================================
  // 提取视频 URL（多重路径防御）
  // ============================================================

  /**
   * 从任务结果原始数据中提取视频 URL，依次尝试：
   * 顶层 url/video_url/videoUrl → creations[0].url → data.creations[0].url → data[0].url
   */
  protected extractVideoUrl(result: unknown): string {
    const asRecord = (v: unknown): Record<string, unknown> | undefined =>
      v !== null && typeof v === 'object' && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : undefined;

    const search = (node: unknown): string | undefined => {
      const rec = asRecord(node);
      if (!rec) return undefined;

      for (const key of ['url', 'video_url', 'videoUrl', 'watermarked_url']) {
        const val = rec[key];
        if (typeof val === 'string' && val) return val;
      }

      // creations / data 可能是对象或数组，取首个元素继续深入
      for (const key of ['creations', 'data']) {
        const child = rec[key];
        if (child === undefined) continue;
        const first = Array.isArray(child) ? child[0] : child;
        const found = search(first);
        if (found) return found;
      }
      return undefined;
    };

    return search(result) || '';
  }

  // ============================================================
  // 私有工具
  // ============================================================

  /** 解析图像输入：优先 URL；本地路径读取后转为 base64 Data URL（官方支持直传） */
  private async resolveImageInput(
    params: VideoGenerationParams
  ): Promise<string | undefined> {
    if (params.imageUrl) return params.imageUrl;
    if (params.imagePath) {
      const buf = await fs.readFile(params.imagePath);
      const ext = params.imagePath.split('.').pop()?.toLowerCase() || '';
      const mime =
        ext === 'jpg' || ext === 'jpeg'
          ? 'jpeg'
          : ext === 'webp'
            ? 'webp'
            : 'png';
      return `data:image/${mime};base64,${buf.toString('base64')}`;
    }
    return undefined;
  }

  /** 兼容网关包裹：若顶层为 { code, message, data: {...} } 则取 data，否则原样返回 */
  private unwrapPayload(
    json: Record<string, unknown>
  ): Record<string, unknown> {
    const data = json.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }
    return json;
  }
}

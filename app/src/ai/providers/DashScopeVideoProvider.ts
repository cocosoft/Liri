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
 * DashScopeVideoProvider — 通义万相（阿里云 DashScope）视频生成 Provider
 *
 * 官方文档（阿里云百炼-万相视频生成 API 参考）：
 * - 提交任务: POST {base}/api/v1/services/aigc/video-generation/video-synthesis
 *   请求头: Content-Type: application/json / Authorization: Bearer <key> /
 *          X-DashScope-Async: enable（必选，缺少报 "current user api does not
 *          support synchronous calls"）
 *   请求体: { model, input: { prompt, img_url, negative_prompt },
 *            parameters: { size, duration, seed } }
 *   - 文生视频（wanx2.1-t2v-* 等）: input.prompt 必填
 *   - 图生视频（wanx2.1-i2v-* 等）: input.img_url 必填（URL 或 Base64）
 *   - 响应: { output: { task_id, task_status }, request_id }
 * - 查询任务: GET {base}/api/v1/tasks/{task_id}
 *   - 响应: { output: { task_status, video_url, code, message }, usage }
 *   - 状态流转: PENDING → RUNNING → SUCCEEDED / FAILED；
 *     CANCELED 为终态，UNKNOWN 表示任务不存在或已过期
 *   - 完成时 output.video_url 为视频下载地址（24 小时有效，MP4/H.264）
 *
 * 基于 AsyncVideoTaskProvider 统一异步流程（提交 → 轮询 → 取 URL），
 * 仅实现三个差异点：submitVideoTask / queryVideoTask / extractVideoUrl。
 * 参照实现：ViduProvider / KlingProvider。
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

/** 官方 task_status 枚举 → 基类轮询状态枚举 */
const STATE_MAP: Record<string, VideoTaskPollState['state']> = {
  PENDING: 'pending',
  RUNNING: 'running',
  SUCCEEDED: 'completed',
  FAILED: 'failed',
  CANCELED: 'failed',
  UNKNOWN: 'unknown',
};

/**
 * 宽高比 + 分辨率档位 → parameters.size（官方枚举，格式 宽*高）。
 * 官方要求 size 必须为具体数值（如 1280*720），不能传 "16:9" 或 "720p"。
 */
const SIZE_MAP: Record<string, string> = {
  '480p:16:9': '832*480',
  '480p:9:16': '480*832',
  '480p:1:1': '624*624',
  '720p:16:9': '1280*720',
  '720p:9:16': '720*1280',
  '720p:1:1': '960*960',
  '720p:4:3': '1088*832',
  '720p:3:4': '832*1088',
  '1080p:16:9': '1920*1080',
  '1080p:9:16': '1080*1920',
  '1080p:1:1': '1440*1440',
  '1080p:4:3': '1632*1248',
  '1080p:3:4': '1248*1632',
};

/** 官方响应结构（提交与查询均含 output 包裹） */
interface DashScopeOutput {
  task_id?: string;
  task_status?: string;
  video_url?: string;
  code?: string;
  message?: string;
}

interface DashScopeResponse {
  output?: DashScopeOutput;
  code?: string;
  message?: string;
  request_id?: string;
}

export class DashScopeVideoProvider extends AsyncVideoTaskProvider {
  constructor(
    options: Partial<BaseProviderOptions> = {},
    polling?: Partial<VideoPollingConfig>
  ) {
    super(
      {
        providerId: 'dashscope',
        displayName: '通义万相',
        envApiKey: 'DASHSCOPE_API_KEY',
        defaultBaseUrl: 'https://dashscope.aliyuncs.com',
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
        'DASHSCOPE_NO_MODEL'
      );
    }

    const input: Record<string, unknown> = { prompt: params.prompt };
    const imageInput = await this.resolveImageInput(params);
    // 图生视频：官方 input.img_url（URL 或 Base64）；文生视频不携带该字段
    if (imageInput) input.img_url = imageInput;
    if (params.negativePrompt) input.negative_prompt = params.negativePrompt;

    const parameters: Record<string, unknown> = {};
    const size = this.resolveSize(params);
    if (size) parameters.size = size;
    if (params.duration !== undefined) parameters.duration = params.duration;
    if (params.seed !== undefined) parameters.seed = params.seed;

    const baseUrl = this.resolveBaseUrl() || '';
    const response = await BaseAIProvider.fetchWithConnectionRetry(
      `${baseUrl}/api/v1/services/aigc/video-generation/video-synthesis`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-DashScope-Async': 'enable',
        },
        body: JSON.stringify({
          model,
          input,
          ...(Object.keys(parameters).length > 0 ? { parameters } : {}),
        }),
      }
    );
    if (!response.ok) this.handleHttpError(response, 'submit task');

    const json = (await response.json()) as DashScopeResponse;
    const taskId =
      typeof json.output?.task_id === 'string' ? json.output.task_id : '';
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
      `${baseUrl}/api/v1/tasks/${encodeURIComponent(taskId)}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      }
    );
    if (!response.ok) this.handleHttpError(response, 'query task');

    const json = (await response.json()) as DashScopeResponse;
    const output = json.output;
    const rawState =
      typeof output?.task_status === 'string'
        ? output.task_status.toUpperCase()
        : '';
    const state = STATE_MAP[rawState] || 'unknown';

    switch (state) {
      case 'completed': {
        const videoUrl = this.extractVideoUrl(output);
        return { state: 'completed', videoUrl };
      }
      case 'failed':
        return {
          state: 'failed',
          error: output?.message || json.message || '生成失败',
        };
      default:
        return { state };
    }
  }

  // ============================================================
  // 提取视频 URL（官方结构 output.video_url）
  // ============================================================

  /**
   * 从任务结果原始数据中提取视频 URL。
   * 官方结构：output.video_url（仅 SUCCEEDED 时返回）；
   * 兼容传入完整响应（{ output: { video_url } }）与直接传入 output 两种形态。
   */
  protected extractVideoUrl(result: unknown): string {
    const asRecord = (v: unknown): Record<string, unknown> | undefined =>
      v !== null && typeof v === 'object' && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : undefined;

    const rec = asRecord(result);
    if (!rec) return '';

    const direct = rec.video_url;
    if (typeof direct === 'string' && direct) return direct;

    const nested = asRecord(rec.output);
    const nestedUrl = nested?.video_url;
    return typeof nestedUrl === 'string' ? nestedUrl : '';
  }

  // ============================================================
  // 私有工具
  // ============================================================

  /** 解析图像输入：优先 URL；本地路径读取后转为 base64 Data URL（官方 img_url 支持） */
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

  /** 宽高比 + 分辨率 → parameters.size（官方枚举），仅两者齐备且在映射表中时生效 */
  private resolveSize(params: VideoGenerationParams): string | undefined {
    if (!params.aspectRatio || !params.resolution) return undefined;
    return SIZE_MAP[`${params.resolution}:${params.aspectRatio}`];
  }
}

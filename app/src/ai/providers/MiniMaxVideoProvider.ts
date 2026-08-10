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
 * MiniMaxVideoProvider — MiniMax（稀宇科技）视频生成 Provider
 *
 * 官方开放平台 API（https://platform.minimaxi.com/document/video_generation）：
 * - 文生/图生视频提交: POST {base}/video_generation
 *   - 请求体: model / prompt / duration / resolution / first_frame_image（图生视频）等
 *   - 响应: { task_id, base_resp: { status_code, status_msg } }
 * - 任务查询: GET {base}/query/video_generation?task_id={task_id}
 *   - 响应: { task_id, status: Preparing|Queueing|Processing|Success|Fail,
 *            file_id, video_width, video_height, base_resp }
 *   - 官方 v1 查询成功时返回的是 file_id（视频文件 ID），不是直链 URL；
 *     需再调文件检索接口换取下载地址（部分网关/版本也可能直接返回 video_url，代码做了兼容）
 * - 文件检索: GET {base}/files/retrieve?file_id={file_id} → { file: { download_url } }
 * - 鉴权: Authorization: Bearer {api_key}（官方文档仅要求此头）；
 *   GroupId 头仅当配置了 MINIMAX_GROUP_ID 时附带（部分 MiniMax 接口需要，
 *   视频生成接口官方文档未强制要求）
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
import { configManager } from '@modules/config';

/** 官方 status 枚举 → 基类轮询状态枚举（官方为 Preparing 等大写形式，查表前转小写） */
const STATE_MAP: Record<string, VideoTaskPollState['state']> = {
  preparing: 'pending',
  queueing: 'pending',
  processing: 'running',
  success: 'completed',
  fail: 'failed',
};

export class MiniMaxVideoProvider extends AsyncVideoTaskProvider {
  constructor(
    options: Partial<BaseProviderOptions> = {},
    polling?: Partial<VideoPollingConfig>
  ) {
    super(
      {
        providerId: 'minimax',
        displayName: 'MiniMax',
        envApiKey: 'MINIMAX_API_KEY',
        defaultBaseUrl: 'https://api.minimaxi.com/v1',
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
        'MINIMAX_NO_MODEL'
      );
    }

    const body: Record<string, unknown> = {
      model,
      prompt: params.prompt,
    };
    if (params.duration !== undefined) body.duration = params.duration;
    if (params.resolution) body.resolution = params.resolution;

    // 图生视频：官方通过 first_frame_image 传首帧（公网 URL 或 base64 Data URL）
    const imageInput = await this.resolveImageInput(params);
    if (imageInput) body.first_frame_image = imageInput;

    const baseUrl = this.resolveBaseUrl() || '';
    const response = await BaseAIProvider.fetchWithConnectionRetry(
      `${baseUrl}/video_generation`,
      {
        method: 'POST',
        headers: this.buildAuthHeaders(apiKey),
        body: JSON.stringify(body),
      }
    );
    if (!response.ok) this.handleHttpError(response, 'submit task');

    const json = (await response.json()) as Record<string, unknown>;
    // 业务错误码：0=成功，其余（1004 鉴权失败 / 1008 余额不足 / 1026 敏感内容等）直接抛错
    const rawCode = this.asRecord(json.base_resp)?.status_code;
    const code =
      typeof rawCode === 'number' || typeof rawCode === 'string'
        ? Number(rawCode)
        : NaN;
    if (!Number.isNaN(code) && code !== 0) {
      const baseResp = this.asRecord(json.base_resp);
      throw new AppError(
        `${this.id} 视频生成任务提交失败: ${
          baseResp && typeof baseResp.status_msg === 'string'
            ? baseResp.status_msg
            : `status_code=${code}`
        }`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        String(code)
      );
    }

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
      `${baseUrl}/query/video_generation?task_id=${encodeURIComponent(taskId)}`,
      {
        method: 'GET',
        headers: this.buildAuthHeaders(apiKey),
      }
    );
    if (!response.ok) this.handleHttpError(response, 'query task');

    const json = (await response.json()) as Record<string, unknown>;
    const rawState =
      typeof json.status === 'string' ? json.status.toLowerCase() : '';
    const state = STATE_MAP[rawState] || 'unknown';

    switch (state) {
      case 'completed': {
        // 优先从查询响应直接提取（部分网关/版本会直接返回 video_url）；
        // 官方 v1 流程为成功时返回 file_id，需再调文件检索接口换取 download_url
        let videoUrl = this.extractVideoUrl(json);
        if (!videoUrl) {
          const fileId = typeof json.file_id === 'string' ? json.file_id : '';
          if (fileId) {
            videoUrl = await this.fetchVideoUrlByFileId(fileId, apiKey);
          }
        }
        return { state: 'completed', videoUrl };
      }
      case 'failed': {
        const baseResp = this.asRecord(json.base_resp);
        const message =
          baseResp && typeof baseResp.status_msg === 'string'
            ? baseResp.status_msg
            : '';
        return { state: 'failed', error: message || '未知错误' };
      }
      default:
        return { state };
    }
  }

  // ============================================================
  // 提取视频 URL（多重路径防御）
  // ============================================================

  /**
   * 从任务结果原始数据中提取视频 URL，依次尝试：
   * 顶层 video_url/videoUrl/url/download_url → file.download_url（File API 响应）
   * → file/data 对象或数组内继续深入
   */
  protected extractVideoUrl(result: unknown): string {
    const search = (node: unknown): string | undefined => {
      const rec = this.asRecord(node);
      if (!rec) return undefined;

      for (const key of ['video_url', 'videoUrl', 'url', 'download_url']) {
        const val = rec[key];
        if (typeof val === 'string' && val) return val;
      }

      // file（File API 响应）/ data 可能是对象或数组，取首个元素继续深入
      for (const key of ['file', 'data']) {
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

  /** 构造鉴权请求头（Authorization: Bearer 必带；MINIMAX_GROUP_ID 配置时附带 GroupId） */
  private buildAuthHeaders(apiKey: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
    const groupId = configManager.env('MINIMAX_GROUP_ID');
    if (groupId) headers.GroupId = groupId;
    return headers;
  }

  /** 通过 File API 检索接口用 file_id 换取视频下载地址 */
  private async fetchVideoUrlByFileId(
    fileId: string,
    apiKey: string
  ): Promise<string> {
    const baseUrl = this.resolveBaseUrl() || '';
    const response = await BaseAIProvider.fetchWithConnectionRetry(
      `${baseUrl}/files/retrieve?file_id=${encodeURIComponent(fileId)}`,
      {
        method: 'GET',
        headers: this.buildAuthHeaders(apiKey),
      }
    );
    if (!response.ok) this.handleHttpError(response, 'file retrieve');
    const json = (await response.json()) as Record<string, unknown>;
    return this.extractVideoUrl(json);
  }

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

  private asRecord(v: unknown): Record<string, unknown> | undefined {
    return v !== null && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : undefined;
  }
}

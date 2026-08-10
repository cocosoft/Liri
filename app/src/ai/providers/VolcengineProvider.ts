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
 * VolcengineProvider — 火山引擎方舟（Ark）视频生成 Provider（豆包 Seedance）
 *
 * 官方 API（视觉理解与视频生成，Base URL: https://ark.cn-beijing.volces.com/api/v3）：
 * - 创建任务: POST {baseUrl}/contents/generations/tasks
 *   Body: { model, content: [{ type: 'text', text } | { type: 'image_url', image_url: { url } }], ... }
 *   响应: { id: 'cgt-...' }
 * - 查询任务: GET {baseUrl}/contents/generations/tasks/{id}
 *   响应: { status: queued|running|cancelled|succeeded|failed|expired,
 *           content: { video_url }, error: { code, message } }
 * - 鉴权: Authorization: Bearer <API Key>
 *
 * 继承 AsyncVideoTaskProvider，复用「提交 → 轮询 → 取 URL」通用流程，
 * 仅实现三个差异点：submitVideoTask / queryVideoTask / extractVideoUrl。
 */

import { readFileSync } from 'fs';
import { extname } from 'path';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import {
  AsyncVideoTaskProvider,
  type VideoPollingConfig,
  type VideoTaskPollState,
} from './AsyncVideoTaskProvider';
import type { VideoGenerationParams } from './AIProvider';

/** 火山方舟视频生成任务查询响应（仅声明本 Provider 使用的官方字段） */
interface VolcengineTaskResult {
  id?: string;
  status?: string;
  error?: { code?: string; message?: string } | null;
  content?: { video_url?: string; last_frame_url?: string };
}

/** 本地图片扩展名 → MIME（方舟支持 jpeg/png/webp/bmp 等） */
const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  bmp: 'image/bmp',
  gif: 'image/gif',
};

/** 本地图片转 Base64 data URL（方舟 content.image_url.url 支持 data:image/...;base64 输入） */
function fileToDataUrl(imagePath: string): string {
  const buffer = readFileSync(imagePath);
  const ext = extname(imagePath).slice(1).toLowerCase();
  const mime = MIME_BY_EXT[ext] || 'image/png';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

export class VolcengineProvider extends AsyncVideoTaskProvider {
  constructor(polling?: Partial<VideoPollingConfig>) {
    super(
      {
        providerId: 'volcengine',
        displayName: '火山引擎',
        envApiKey: 'VOLCENGINE_API_KEY',
        defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      },
      polling
    );
    this.capabilities.videoGeneration = true;
  }

  // ============================================================
  // 提交任务
  // ============================================================

  protected async submitVideoTask(
    params: VideoGenerationParams,
    apiKey: string
  ): Promise<{ taskId: string }> {
    const baseUrl = this.resolveBaseUrl() || '';

    // content 数组：文生视频至少一条 text，图生视频追加 image_url
    const content: Array<Record<string, unknown>> = [
      { type: 'text', text: params.prompt },
    ];

    // 图生视频：优先公网 URL，其次本地图片转 Base64 data URL
    const imageUrl =
      params.imageUrl ??
      (params.imagePath ? fileToDataUrl(params.imagePath) : undefined);
    if (imageUrl) {
      content.push({ type: 'image_url', image_url: { url: imageUrl } });
    }

    const body: Record<string, unknown> = {
      model: params.model,
      content,
    };
    // 可选参数（官方字段名；negativePrompt 官方 API 不支持，忽略）
    if (params.duration !== undefined) body.duration = params.duration;
    if (params.aspectRatio) body.ratio = params.aspectRatio;
    if (params.resolution) body.resolution = params.resolution;
    if (params.seed !== undefined) body.seed = params.seed;

    const response = await fetch(`${baseUrl}/contents/generations/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new AppError(
        `火山引擎 视频生成: 提交任务失败 (${response.status}) ${await response.text()}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        String(response.status)
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    const taskId = (data.id as string) || '';
    if (!taskId) {
      throw new AppError(
        '火山引擎 视频生成: 提交任务响应缺少任务 ID',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'INVALID_RESPONSE'
      );
    }
    return { taskId };
  }

  // ============================================================
  // 查询任务（归一化状态 + 视频 URL）
  // ============================================================

  protected async queryVideoTask(
    taskId: string,
    apiKey: string
  ): Promise<VideoTaskPollState> {
    const baseUrl = this.resolveBaseUrl() || '';
    const response = await fetch(
      `${baseUrl}/contents/generations/tasks/${taskId}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      }
    );

    if (!response.ok) {
      // 查询瞬时失败（5xx/限流等）归一化为 unknown，由基类按重试策略处理
      return { state: 'unknown' };
    }

    const data = (await response.json()) as VolcengineTaskResult;
    const videoUrl = this.extractVideoUrl(data);

    switch (data.status) {
      case 'queued':
      case 'running':
        return { state: 'running' };
      case 'succeeded':
        if (!videoUrl) {
          return { state: 'failed', error: '任务成功但未返回视频 URL' };
        }
        return { state: 'completed', videoUrl };
      case 'failed':
        return { state: 'failed', error: data.error?.message || '任务失败' };
      case 'cancelled':
        return { state: 'failed', error: '任务已取消' };
      case 'expired':
        return { state: 'failed', error: '任务超时' };
      default:
        return { state: 'unknown' };
    }
  }

  // ============================================================
  // 提取视频 URL
  // ============================================================

  protected extractVideoUrl(result: unknown): string {
    const data = result as VolcengineTaskResult;
    return data?.content?.video_url || '';
  }
}

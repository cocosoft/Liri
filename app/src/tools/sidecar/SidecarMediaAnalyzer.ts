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
 * 媒体侧车 **消费者适配**（S5/T5.1 + T5.2）。
 *
 * 两个消费者端口（均经 {@link maybeStartMediaSidecar} 的**同一** `ToolSidecarSupervisor` 请求）：
 * - {@link createL2WorkerPort}：给 `ImageAnalysisTool` 的 L2 分析用 —— 与内置 `WorkerGuard`
 *   **同形**（`requestResult`），但把 `ocr`/`object_detection`/`image_similarity` 映射为
 *   `media.analyze` 的 `kind`；**未覆盖方法**（如 `sam_segment`/`depth_estimate`）与**侧车不可用**
 *   一律 **fail-closed 抛错**（**不**回落内置 `WorkerGuard`，规避 spec §2「静默双轨」反目标；CS03）。
 * - {@link resizeViaMediaSidecar}：给 `ImageInputRouter` 的超大图缩放用 —— 经 `media.resize`
 *   执行（native `sharp` 移出主进程），**同输入同参数 ⇒ 结果等价**。
 */
import type { MediaAnalysisKind } from './mediaCapabilities';
import { maybeStartMediaSidecar } from './mediaSidecarLifecycle';

/** 侧车监督器请求端口（窄签名；`ToolSidecarSupervisor` 天然满足） */
export interface MediaSupervisorRequester {
  request(
    method: string,
    params?: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>>;
}

/** 侧车监督器提供者（缺省 {@link maybeStartMediaSidecar}；测试可注入替身） */
export type MediaSupervisorProvider =
  () => Promise<MediaSupervisorRequester | null>;

/** L2 分析端口（与内置 `WorkerGuard` 的 `requestResult` 同形） */
export interface L2WorkerPort {
  requestResult<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<T>;
}

/** `vision_worker` RPC 方法 → 侧车分析 `kind`（覆盖面；其余未覆盖 ⇒ fail-closed） */
const METHOD_TO_KIND: Record<string, MediaAnalysisKind> = {
  ocr: 'ocr',
  object_detection: 'objects',
  image_similarity: 'similarity',
};

/** 构建经媒体侧车的 L2 分析端口（开关开时由 `ImageAnalysisTool` 选用） */
export function createL2WorkerPort(
  provide: MediaSupervisorProvider = maybeStartMediaSidecar
): L2WorkerPort {
  return {
    async requestResult<T = unknown>(
      method: string,
      params?: Record<string, unknown>
    ): Promise<T> {
      const kind = METHOD_TO_KIND[method];
      if (!kind) {
        throw new Error(
          `媒体侧车未覆盖 L2 方法：${method}（已 fail-closed，不回落内置 WorkerGuard）`
        );
      }
      const supervisor = await provide();
      if (!supervisor) {
        throw new Error(
          '媒体侧车不可用（未启动/握手失败）；已 fail-closed，不回落内置 WorkerGuard。'
        );
      }
      const frame = await supervisor.request('media.analyze', {
        kind,
        ...(params ?? {}),
      });
      return frame.result as T;
    },
  };
}

/** 侧车缩放函数（`ImageInputRouter` 收口点可注入；缺省 {@link resizeViaMediaSidecar}） */
export type SidecarResizeFn = (
  image: Buffer,
  maxSide: number,
  quality: number
) => Promise<Buffer>;

/**
 * 经媒体侧车执行一次 `sharp` 缩放（`media.resize`）：请求体 base64 传图 + 参数，
 * 响应 base64 解码回 Buffer。**开关关时不会走到此处**（`ImageInputRouter` 走原本地路径）。
 */
export async function resizeViaMediaSidecar(
  image: Buffer,
  maxSide: number,
  quality: number,
  provide: MediaSupervisorProvider = maybeStartMediaSidecar
): Promise<Buffer> {
  const supervisor = await provide();
  if (!supervisor) {
    throw new Error(
      '媒体侧车不可用（未启动/握手失败）；resize 已 fail-closed。'
    );
  }
  const frame = await supervisor.request('media.resize', {
    imageBase64: image.toString('base64'),
    maxSide,
    quality,
  });
  const result = (frame.result ?? {}) as { bufferBase64?: unknown };
  if (typeof result.bufferBase64 !== 'string') {
    throw new Error('媒体侧车 resize 返回缺少 bufferBase64');
  }
  return Buffer.from(result.bufferBase64, 'base64');
}

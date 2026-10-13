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
import { feature } from '@modules/core';
import type { IToolJobSuspendPort } from '@modules/core/spi';
import { resolveToolJobSuspend } from '@modules/core/spi';
import { getLogger } from '@modules/monitoring';
import type { MediaAnalysisKind } from './mediaCapabilities';
import {
  isMediaSidecarEnabled,
  maybeStartMediaSidecar,
} from './mediaSidecarLifecycle';

const logger = getLogger('tools:sidecar:mediaAnalyzer');

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

/**
 * 侧车监督器**作业**端口（窄签名；`ToolSidecarSupervisor.submitJob` 天然满足）。
 *
 * 「提交即返」：`completion` 在侧车回推 `notify{event:'job.completed'}` 时兑现/拒绝
 * （宿主侧**超时兜底**由 supervisor 保证 ⇒ 绝不永久悬挂）。
 */
export interface MediaSupervisorJobRequester extends MediaSupervisorRequester {
  submitJob(
    action: string,
    payload?: Record<string, unknown>
  ): Promise<{ jobId: string; completion: Promise<unknown> }>;
}

/** 作业型监督器提供者（缺省 {@link maybeStartMediaSidecar}；测试可注入替身） */
export type MediaSupervisorJobProvider =
  () => Promise<MediaSupervisorJobRequester | null>;

/**
 * **作业模式** L2 端口（T1-2② C₂：「提交 → 挂起 → 完成 → 续跑」）。
 *
 * 由 `ImageAnalysisTool` 在 `TOOL_SIDECAR_MEDIA && TOOL_JOB_SUSPEND` **双开**时选用；
 * 单开（或全关）⇒ 走既有路径（`WorkerGuard` / 同步侧车端口），**逐字等价**（零行为变更）。
 *
 * 时序（与原文「长耗时侧车工具**不得同步阻塞**」对齐）：
 *  ① **提交即返**：`job.submit` ⇒ 立即拿到 `{jobId, completion}`；
 *  ② **挂起**：经 **core SPI**（`suspend` 端口）登记 `kind='tool-job'` ⇒ 投影 `SUSPENDED`，
 *     调用方在此**等待**（**不推进轮次**；Q3 裁定「**保留连接**」—— 不释放侧车连接）；
 *  ③ **完成**：`notify{job.completed}` 兑现 `completion` ⇒ 结果为 L2 载荷；
 *  ④ **续跑**：`finally` 释放挂起（投影 `RUNNING`）并把结果交回调用方 ⇒ 轮次继续。
 *
 * **为何经 core SPI 取挂起端口**：`tools/**` 不得直接 import `query/**`（既有 `query → tools`
 * ⇒ 会成**模块级循环**）；SPI 由 `entrypoints/spiWiring.ts` 推送注册，**未注册/开关关 ⇒ no-op**
 * （不挂起、不报错，行为与"未启用"一致）。
 */
export interface L2WorkerJobPort {
  requestJobResult<T = unknown>(
    method: string,
    params: Record<string, unknown>,
    jobCtx: { sessionId: string }
  ): Promise<T>;
}

/** 作业模式是否启用（`TOOL_SIDECAR_MEDIA && TOOL_JOB_SUSPEND`，**缺一不可**） */
export function isMediaSidecarJobEnabled(): boolean {
  return isMediaSidecarEnabled() && feature('TOOL_JOB_SUSPEND');
}

/** 构建经媒体侧车**作业模式**的 L2 分析端口（**提交即返** + 挂起等待完成） */
export function createL2WorkerJobPort(
  provide: MediaSupervisorJobProvider = maybeStartMediaSidecar,
  suspend: IToolJobSuspendPort = resolveToolJobSuspend()
): L2WorkerJobPort {
  return {
    async requestJobResult<T = unknown>(
      method: string,
      params: Record<string, unknown>,
      jobCtx: { sessionId: string }
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
          '媒体侧车不可用（未启动/握手失败）；作业模式已 fail-closed，不回落内置 WorkerGuard。'
        );
      }
      // ① 提交作业（**提交即返**：此处不阻塞）
      const { jobId, completion } = await supervisor.submitJob(
        'media.analyze',
        {
          kind,
          ...(params ?? {}),
        }
      );
      // ② 登记**作业挂起**（`kind='tool-job'` ⇒ 投影 SUSPENDED）；开关关/未注册 ⇒ no-op
      const outcome = suspend.register({ sessionId: jobCtx.sessionId, jobId });
      if (!outcome.registered) {
        logger.debug(
          '媒体侧车作业未登记挂起（开关关/SPI 未注册），退化为等待完成',
          {
            sessionId: jobCtx.sessionId,
            jobId,
            reason: outcome.reason,
            method,
          }
        );
      }
      try {
        // ③ 等完成通知（保留连接）；④ 结果即 L2 载荷 ⇒ 交回调用方续跑
        return (await completion) as T;
      } finally {
        // 完成/失败/异常**均**解冻（不留幽灵挂起）；非本类挂起不会被误放
        suspend.release(jobCtx.sessionId);
      }
    },
  };
}

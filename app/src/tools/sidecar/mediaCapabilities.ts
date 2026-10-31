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
 * 媒体侧车 **能力端口**（S5/T5.1 + T5.2；Tool Sidecar Isolation）。
 *
 * 方案：`.trae/specs/tool-sidecar-isolation.md` §3-D3（P2 媒体原生面）+ §11 切片 `S5`。
 *
 * 两个**真实现**后端（均不引入第三套 IPC / 新桥）：
 * - **分析**（`MediaAnalysisPort`）：驱动**既有** Python `vision_worker.py`（经 `@modules/ai` 的
 *   `WorkerGuard` → `StdioBridge` → `JsonRpcBridge`，即"vision_worker 受管"）。**惰性** `import('@modules/ai')`：
 *   侧车启动不加载 AI 面，仅首次真实分析时加载（且仅在开关开、有真实请求时）。
 * - **缩放**（`MediaResizePort`）：`sharp` native 缩放（把 native addon 移出主进程）。
 *
 * 覆盖面（**如实**）：`ocr` / `objects` / `similarity` 三项（对齐 `vision_worker` 既有 `ocr` /
 * `object_detection` / `image_similarity` RPC）；**其余**（如 `sam_segment` / `depth_estimate`）**未覆盖**，
 * 一律 **fail-closed**（`NOT_IMPLEMENTED`，不伪造成功，CS03）。
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

/** 侧车分析能力枚举（本期覆盖面） */
export type MediaAnalysisKind = 'ocr' | 'objects' | 'similarity';

/** 本期覆盖的媒体分析能力（其余 ⇒ fail-closed NOT_IMPLEMENTED） */
export const SUPPORTED_MEDIA_KINDS: readonly MediaAnalysisKind[] = [
  'ocr',
  'objects',
  'similarity',
] as const;

export function isSupportedMediaKind(kind: string): kind is MediaAnalysisKind {
  return (SUPPORTED_MEDIA_KINDS as readonly string[]).includes(kind);
}

/**
 * 侧车 RPC 错误（携带 `code`，供 response 帧 `error.code`）。
 *
 * 2026-10-31（R01-002 修复）：原 `extends Error` 属"自建错误层"⇒ 告警/追踪/降级语义与
 * `AppError` 分叉（架构门禁 ERROR 级阻断）。现改为继承 `AppError`，RPC 码落在 `code`；
 * 另保留只读别名 `rpcCode`（非空，供帧编码直接用）。
 */
export class MediaSidecarRpcError extends AppError {
  constructor(
    public readonly rpcCode: string,
    message: string
  ) {
    super(message, ErrorCategory.EXECUTION, ErrorSeverity.MEDIUM, rpcCode);
    this.name = 'MediaSidecarRpcError';
  }
}

/** 媒体分析端口（侧车持有；单测可注入替身） */
export interface MediaAnalysisPort {
  analyze(
    kind: MediaAnalysisKind,
    params: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<unknown>;
  dispose(): void;
}

export type MediaAnalysisPortFactory = () => MediaAnalysisPort;

/** 媒体缩放端口（`sharp` native 缩放；单测可注入替身） */
export interface MediaResizePort {
  resize(image: Buffer, maxSide: number, quality: number): Promise<Buffer>;
  dispose(): void;
}

export type MediaResizePortFactory = () => MediaResizePort;

/** `vision_worker.py` RPC 方法名（与既有 `ImageAnalysisTool` 调用同口径） */
const KIND_TO_WORKER_METHOD: Record<MediaAnalysisKind, string> = {
  ocr: 'ocr',
  objects: 'object_detection',
  similarity: 'image_similarity',
};

/** `WorkerGuard` 实例的最小可用面（避免在侧车顶层静态加载 `@modules/ai`） */
interface WorkerGuardLike {
  start(): Promise<void>;
  requestResult<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<T>;
  destroy(): void;
}

/**
 * 真实现：经**既有** `WorkerGuard`（→ `StdioBridge` → `JsonRpcBridge`）驱动 Python `vision_worker.py`。
 * 惰性加载 `@modules/ai`（首次分析才加载，避免侧车启动即拉入 AI 面）。
 */
export function createPythonMediaAnalysisPort(): MediaAnalysisPort {
  let guard: WorkerGuardLike | null = null;
  let loading: Promise<WorkerGuardLike> | null = null;

  const ensureGuard = async (): Promise<WorkerGuardLike> => {
    if (guard) return guard;
    if (!loading) {
      loading = (async () => {
        const mod = await import('@modules/ai');
        const g = new mod.WorkerGuard({
          maxRestarts: 5,
          restartDelayBaseMs: 1000,
          circuitBreaker: true,
          healthCheckIntervalMs: 30000,
        });
        await g.start();
        guard = g;
        return g;
      })();
    }
    return loading;
  };

  return {
    async analyze(kind, params, signal) {
      if (!isSupportedMediaKind(kind)) {
        throw new MediaSidecarRpcError(
          'NOT_IMPLEMENTED',
          `媒体侧车分析能力未覆盖：${kind}`
        );
      }
      const g = await ensureGuard();
      if (signal?.aborted) {
        throw new MediaSidecarRpcError('CANCELLED', '媒体分析已取消');
      }
      return g.requestResult(KIND_TO_WORKER_METHOD[kind], params);
    },
    dispose() {
      guard?.destroy();
      guard = null;
      loading = null;
    },
  };
}

/** 真实现：`sharp` native 缩放（与 `ImageInputRouter` 收口点**同参数** ⇒ 结果等价） */
export function createSharpResizePort(): MediaResizePort {
  return {
    async resize(image, maxSide, quality) {
      const { default: sharp } = await import('sharp');
      return sharp(image)
        .resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer();
    },
    dispose() {
      // sharp 无显式释放需求（native 池由进程生命周期回收）
    },
  };
}

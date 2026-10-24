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
 * 常驻**媒体**工具侧车 **进程入口**（S5/T5.1；Tool Sidecar Isolation）。
 *
 * 方案：`.trae/specs/tool-sidecar-isolation.md` §5（IPC 帧契约）+ §11 切片 `S5`。
 *
 * 通信（单一契约 `@modules/utils/sidecarIpc`，**禁第三套 IPC**）：
 * - 出：`{type:'startup', protocolVersion, pid}`（就绪握手）；
 * - 出：`{type:'heartbeat', at}`（周期心跳）；
 * - 入：`{id, method, params}` ⇒ 出 `{id, success, result|error}`；
 * - 入：`{type:'notify', event, data}`（取消下传 `event:'cancel'` 在此消费）。
 *
 * 方法集（**最小可用能力面**，诚实覆盖）：
 * - `media.analyze`（`kind ∈ {ocr, objects, similarity}`）⇒ 经 {@link MediaAnalysisPort}
 *   （缺省 = 驱动既有 Python `vision_worker.py`，即 "vision_worker 受管"）；
 * - `media.resize` ⇒ 经 {@link MediaResizePort}（缺省 = `sharp` native 缩放，主进程零 native）；
 * - **作业模式**（T1-2② C₂）：`job.submit`（`action ∈ {media.analyze, media.resize}` +
 *   `payload`）⇒ **受理即返** `response{jobId, accepted}`，完成后回推
 *   `notify{event:'job.completed'}`（**零新帧型**；未覆盖动作在**提交阶段** fail-closed）；
 * - **其余**一律 fail-closed 回 `{success:false, error:{code:'NOT_IMPLEMENTED'}}`（**不伪造成功**，CS03）。
 *
 * 生命周期由 `ToolSidecarSupervisor`（S1/S3 已验证语义：握手/心跳/崩溃结算/有界重启/停止）看护，
 * 本入口**不自造**生命周期。
 */
import readline from 'node:readline';
import { getLogger } from '@modules/monitoring';
import { installParentLivenessGuard } from '@modules/utils/parentLiveness';
import {
  SIDECAR_IPC_PROTOCOL_VERSION,
  SIDECAR_JOB_SUBMIT_METHOD,
  buildJobCompleted,
  encodeFrame,
  decodeFrame,
  buildHeartbeat,
} from '@modules/utils/sidecarIpc';
import {
  MediaSidecarRpcError,
  isSupportedMediaKind,
  createPythonMediaAnalysisPort,
  createSharpResizePort,
  type MediaAnalysisPort,
  type MediaAnalysisPortFactory,
  type MediaResizePort,
  type MediaResizePortFactory,
} from './mediaCapabilities';

const logger = getLogger('tools:sidecar:media');

export const MEDIA_SIDECAR_HEARTBEAT_MS = 15_000;

/**
 * 支持**作业模式**（`job.submit`）的媒体动作白名单（**提交阶段 fail-closed 判据**）。
 *
 * 与 `dispatch()` 的动作名**同一词汇**（`analyze` / `resize`）—— 未列入者**在提交阶段**即拒
 * （`success:false`，**不建作业、不伪造受理**），而非"受理后才失败"（CS03）。
 */
const MEDIA_JOB_ACTIONS: ReadonlySet<string> = new Set(['analyze', 'resize']);

export interface MediaSidecarOptions {
  /** 输入流（缺省 `process.stdin`；测试可注入） */
  input?: NodeJS.ReadableStream;
  /** 输出流（缺省 `process.stdout`；测试可注入） */
  output?: NodeJS.WritableStream;
  heartbeatMs?: number;
  pid?: number;
  /** 分析端口工厂（缺省真人 {@link createPythonMediaAnalysisPort}；测试可注入替身） */
  analysisPortFactory?: MediaAnalysisPortFactory;
  /** 缩放端口工厂（缺省真人 {@link createSharpResizePort}；测试可注入替身） */
  resizePortFactory?: MediaResizePortFactory;
}

export interface MediaSidecarHandle {
  stop(): void;
}

/**
 * 启动媒体侧车：发 `startup` 握手、周期心跳、按 `sidecarIpc` 契约分帧，并把
 * `media.analyze` / `media.resize` 翻译为端口调用。可注入流 / 端口工厂 ⇒ 单测**不真起进程**。
 */
export function startMediaSidecar(
  opts: MediaSidecarOptions = {}
): MediaSidecarHandle {
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  const pid = opts.pid ?? process.pid;
  const analysisPort: MediaAnalysisPort = (
    opts.analysisPortFactory ?? createPythonMediaAnalysisPort
  )();
  const resizePort: MediaResizePort = (
    opts.resizePortFactory ?? createSharpResizePort
  )();
  // S3：在飞请求 id ⇒ 取消句柄（收到 notify{cancel} 时中止对应端口调用）
  const inflight = new Map<string, AbortController>();

  output.write(
    encodeFrame({
      type: 'startup',
      protocolVersion: SIDECAR_IPC_PROTOCOL_VERSION,
      pid,
    })
  );

  const rl = readline.createInterface({ input });
  rl.on('line', (line) => {
    const frame = decodeFrame(line);
    if (!frame) return; // 非 JSON / 调试输出 ⇒ 忽略该行
    if (frame.type === 'notify') {
      // S3 取消下传：`{type:'notify', event:'cancel', data:{id}}` ⇒ 中止在飞请求
      if (frame.event === 'cancel') {
        const data = toRecord(frame.data);
        if (typeof data.id === 'string') inflight.get(data.id)?.abort();
      }
      return;
    }
    if (typeof frame.id === 'string') {
      void handleRequest(frame, output, analysisPort, resizePort, inflight);
    }
  });

  const hbTimer = setInterval(() => {
    output.write(
      encodeFrame(buildHeartbeat() as unknown as Record<string, unknown>)
    );
  }, opts.heartbeatMs ?? MEDIA_SIDECAR_HEARTBEAT_MS);
  hbTimer.unref?.();

  return {
    stop(): void {
      clearInterval(hbTimer);
      rl.close();
      analysisPort.dispose();
      resizePort.dispose();
    },
  };
}

function toRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

async function dispatch(
  action: string,
  params: Record<string, unknown>,
  analysisPort: MediaAnalysisPort,
  resizePort: MediaResizePort,
  signal: AbortSignal
): Promise<unknown> {
  switch (action) {
    case 'analyze': {
      const kind = String(params.kind ?? '');
      if (!isSupportedMediaKind(kind)) {
        throw new MediaSidecarRpcError(
          'NOT_IMPLEMENTED',
          `媒体侧车分析能力未覆盖：${kind || '(空)'}`
        );
      }
      const result = await analysisPort.analyze(kind, params, signal);
      if (signal.aborted) {
        throw new MediaSidecarRpcError('CANCELLED', '媒体分析已取消');
      }
      return result;
    }
    case 'resize': {
      const imageBase64 = String(params.imageBase64 ?? '');
      if (!imageBase64) {
        throw new MediaSidecarRpcError(
          'INVALID_PARAMS',
          'resize 需要 imageBase64'
        );
      }
      const maxSide = Number(params.maxSide);
      const quality = Number(params.quality);
      const image = Buffer.from(imageBase64, 'base64');
      const resized = await resizePort.resize(
        image,
        Number.isFinite(maxSide) && maxSide > 0 ? maxSide : 2048,
        Number.isFinite(quality) && quality > 0 ? quality : 85
      );
      return { bufferBase64: resized.toString('base64'), shrunk: true };
    }
    default:
      throw new MediaSidecarRpcError(
        'NOT_IMPLEMENTED',
        `媒体侧车方法未实现：${action}`
      );
  }
}

async function handleRequest(
  frame: Record<string, unknown>,
  output: NodeJS.WritableStream,
  analysisPort: MediaAnalysisPort,
  resizePort: MediaResizePort,
  inflight: Map<string, AbortController>
): Promise<void> {
  const id = String(frame.id);
  const method = String(frame.method ?? '');
  // 作业模式（C₂）：`job.submit` 走**受理即返 + 异步 notify** 的另一条路径（零新帧型）
  if (method === SIDECAR_JOB_SUBMIT_METHOD) {
    await handleJobSubmit(frame, output, analysisPort, resizePort, inflight);
    return;
  }
  const params = toRecord(frame.params);
  const action = method.startsWith('media.') ? method.slice(6) : method;
  const controller = new AbortController();
  inflight.set(id, controller);
  try {
    const result = await dispatch(
      action,
      params,
      analysisPort,
      resizePort,
      controller.signal
    );
    output.write(encodeFrame({ id, success: true, result }));
  } catch (err) {
    const code = controller.signal.aborted
      ? 'CANCELLED'
      : err instanceof MediaSidecarRpcError
        ? err.code
        : 'MEDIA_ERROR';
    const message = err instanceof Error ? err.message : String(err);
    output.write(
      encodeFrame({
        id,
        success: false,
        error: { code, message: `[${code}] ${message}` },
      })
    );
  } finally {
    inflight.delete(id);
  }
}

/**
 * **作业模式**（T1-2② C₂，2026-10-13）：`request(method='job.submit')` ⇒
 * ① 立即回 `response{jobId, accepted:true}`（**提交即返** —— 宿主据此登记**作业挂起**，不推进轮次）；
 * ② **异步**执行同名 `dispatch(action, payload)`；
 * ③ 完成 / 失败 / 取消 ⇒ 侧车 → 宿主 `notify{event:'job.completed', data:{jobId, ok, result|error}}`
 * （**零新帧型**：复用 B₁ 协议的 `request|response|notify` 三类帧）。
 *
 * **fail-closed（CS03）**：`jobId` 缺失 / 动作未覆盖 ⇒ **提交阶段**直接回 `success:false`，
 * **不建作业、不伪造"已受理"**；作业**运行中**的失败才经 `notify ok=false` 上报
 * （**成败同报** ⇒ 宿主侧 `completion` 绝不悬挂）。
 *
 * **取消**：作业与普通请求共用 `inflight`（键 = 宿主下发的 `jobId`）⇒ 既有
 * `notify{cancel, data:{id}}` 下传对作业同样生效；被取消的作业以 `ok=false` 通知结算（不留悬挂）。
 */
async function handleJobSubmit(
  frame: Record<string, unknown>,
  output: NodeJS.WritableStream,
  analysisPort: MediaAnalysisPort,
  resizePort: MediaResizePort,
  inflight: Map<string, AbortController>
): Promise<void> {
  const id = String(frame.id);
  const params = toRecord(frame.params);
  const jobId = typeof params.jobId === 'string' ? params.jobId : '';
  const jobAction = String(params.action ?? '');
  const action = jobAction.startsWith('media.')
    ? jobAction.slice(6)
    : jobAction;
  if (!jobId) {
    output.write(
      encodeFrame({
        id,
        success: false,
        error: {
          code: 'INVALID_PARAMS',
          message: '[INVALID_PARAMS] 作业提交缺少 jobId',
        },
      })
    );
    return;
  }
  if (!MEDIA_JOB_ACTIONS.has(action)) {
    output.write(
      encodeFrame({
        id,
        success: false,
        error: {
          code: 'NOT_IMPLEMENTED',
          message: `[NOT_IMPLEMENTED] 媒体侧车作业动作未覆盖：${jobAction || '(空)'}`,
        },
      })
    );
    return;
  }

  const controller = new AbortController();
  // 作业与普通请求共用取消表（键 = jobId）⇒ cancel 下传对两者同构
  inflight.set(jobId, controller);
  // ① 受理（**提交即返**）
  output.write(
    encodeFrame({ id, success: true, result: { jobId, accepted: true } })
  );

  // ② 异步执行 + ③ 完成通知（成败同报；**不吞错**，失败原因原样带回）
  void (async () => {
    try {
      const result = await dispatch(
        action,
        toRecord(params.payload),
        analysisPort,
        resizePort,
        controller.signal
      );
      output.write(
        encodeFrame(
          buildJobCompleted({ jobId, ok: true, result }) as unknown as Record<
            string,
            unknown
          >
        )
      );
    } catch (err) {
      const message = controller.signal.aborted
        ? '媒体作业已取消'
        : err instanceof Error
          ? err.message
          : String(err);
      output.write(
        encodeFrame(
          buildJobCompleted({
            jobId,
            ok: false,
            error: message,
          }) as unknown as Record<string, unknown>
        )
      );
    } finally {
      inflight.delete(jobId);
    }
  })();
}

// 独立/子进程启动（`bun run src/tools/sidecar/mediaSidecar.ts`）
if (import.meta.main) {
  // 父进程被硬杀 ⇒ 自清（防孤儿侧车占端口，基础设施专项 §6-#5）
  installParentLivenessGuard({
    onDetach: (parentPid) =>
      logger.warn('父进程已退出 ⇒ 侧车自清', { parentPid }),
  });
  startMediaSidecar();
  logger.info('媒体工具侧车已就绪（S5：受管媒体原生面）', {
    pid: process.pid,
  });
}

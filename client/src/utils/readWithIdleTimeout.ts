/**
 * 流式读取无数据超时工具 — 前端各 SSE/fetch 流式链路统一兜底
 * MIT License
 *
 * Provider/后端返回 200 后 SSE body 流中断时，原生 reader.read() 会永久挂起，
 * 前端 for-await 将卡死无反馈——此处统一提供 idle 超时兜底。
 *
 * 2026-10-02（D-231）：idle 默认值由 60s 提升到 **300s**，与后端整体 TTFB 预算
 * `TTFB_MAX_WAIT_MS`（默认 300s）对齐。原因（实测）：单次 ReAct 迭代内可长时间
 * **零推流**（工具执行 / 事件循环同步阻塞，实测出现 57.4s 阻塞）⇒ 原 60s 会把
 * 「正常的长迭代」误判为「连接中断」，前端报「流式响应超时，请重试」。
 * 注：该场景下心跳也无济于事（事件循环被阻塞时同样发不出），只能靠阈值覆盖。
 */

import { createLogger } from "./logger";

const logger = createLogger("utils:readWithIdleTimeout");

/** 流式读取无数据超时（ms）。D-231：与后端 TTFB 预算（`TTFB_MAX_WAIT_MS`=300s）对齐，
 *  覆盖单次 ReAct 迭代内「工具执行 / 事件循环阻塞」导致的长时间零推流 */
export const STREAM_IDLE_TIMEOUT_MS = 300_000;

/**
 * 首 chunk 无数据超时（ms）。
 *
 * 对齐后端 BaseAIProvider 首 chunk 超时（120s，覆盖推理模型 TTFB）：
 * 智谱 GLM 等思考型模型在输出首 token 前可能长时间"思考"（长 TTFB），
 * 且后端在发送请求前有上下文预处理（压缩/截断）耗时，首块等待可能远超 60s。
 * 首块用 120s，避免把"模型正常思考"误判为"连接中断"。
 */
export const FIRST_CHUNK_TIMEOUT_MS = 120_000;

/**
 * 带无数据超时的 reader.read()。
 *
 * - 正常：有数据/流结束 → 返回 ReadableStreamReadResult
 * - 超时：idle 超过 timeoutMs 无数据 → 抛 `DOMException(..., "TimeoutError")`，
 *   并自动 `reader.cancel()` 释放挂起的原生 read（否则 reader 永久锁定、
 *   后续 releaseLock 抛 TypeError）；同时记录本次超时的实际耗时（elapsedMs，
 *   含 setTimeout 调度延迟，略大于配置值）
 *
 * 调用方可通过 `e.name === "TimeoutError"` 区分"网络超时"与"用户取消"（AbortError）。
 */
export async function readWithIdleTimeout(
  reader: Pick<ReadableStreamDefaultReader<Uint8Array>, "read" | "cancel">,
  timeoutMs: number = STREAM_IDLE_TIMEOUT_MS,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const startedAt = Date.now();
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // 每次超时记录实际耗时（idle 真实时长，含调度延迟），便于排查网络卡顿环节
      const elapsedMs = Date.now() - startedAt;
      logger.warn("readWithIdleTimeout: 流式读取超时", {
        configuredTimeoutMs: timeoutMs,
        elapsedMs,
      });
      // 先释放挂起的原生 read（否则 reader 永久锁定；cancel 幂等，多次调用无害）
      reader.cancel().catch(() => {
        /* cancel 失败（如流已关闭）不影响超时上报 */
      });
      reject(
        new DOMException(
          `流式读取 ${timeoutMs / 1000}s 无数据，连接可能挂起`,
          "TimeoutError",
        ),
      );
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([reader.read(), timeoutPromise]);
    clearTimeout(timer);
    return result;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

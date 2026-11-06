/**
 * chunk 之间的**心跳式**等待（N-12 后续，2026-11-06）
 *
 * 背景：`streamMessageFlow` 原先把 chunk 间的空闲保护写成一次 `sleep(120s)` 的静默竞速
 * ——真机停滞时这段时间既无日志也无提示，排查只能看到"什么都没发生"。
 *
 * 口径：把总预算切成 `heartbeatMs`（默认 10s）的片，每片留一条心跳（已等待/剩余），
 * 到点仍无数据则以调用方给定的文案抛错。**纯等待逻辑**（无 I/O、无日志依赖）⇒ 可单测。
 */
import { AppError, ErrorCategory, ErrorSeverity } from '@openliri/infra/error';
import { MS_PER_SECOND } from '@openliri/infra/constants';

/** 心跳间隔（10s；与 TTFB 阶段心跳同口径。用秒常量表达，避免裸数字默认值） */
export const CHUNK_IDLE_HEARTBEAT_MS = MS_PER_SECOND * 10;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface ChunkIdleWaitParams<T> {
  /** 正在等待的下一次读取（如 `gen.next()`） */
  next: Promise<T>;
  /** 总无数据预算（ms） */
  timeoutMs: number;
  /** 超时错误文案（错误码固定 `STREAM_IDLE_TIMEOUT`） */
  timeoutMessage: string;
  /** 每个切片的留痕回调（已等待/剩余） */
  onHeartbeat: (info: { waitedMs: number; remainingMs: number }) => void;
  /** 心跳间隔（默认 {@link CHUNK_IDLE_HEARTBEAT_MS}，单测可注入） */
  heartbeatMs?: number;
}

/**
 * 等待 `next` 完成；期间每 `heartbeatMs` 回调一次心跳，超过 `timeoutMs` 抛
 * `STREAM_IDLE_TIMEOUT`。
 */
export async function awaitNextChunkWithHeartbeat<T>(
  params: ChunkIdleWaitParams<T>
): Promise<T> {
  const { next, timeoutMs, timeoutMessage, onHeartbeat } = params;
  const heartbeatMs = params.heartbeatMs ?? CHUNK_IDLE_HEARTBEAT_MS;
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;

  for (;;) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      // 丢弃挂起的 next（孤儿 rejection 防护），由调用方的中断 catch 收尾
      void next.catch(() => {});
      throw new AppError(
        timeoutMessage,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'STREAM_IDLE_TIMEOUT'
      );
    }
    const raced = await Promise.race([
      next.then((value) => ({ settled: true as const, value })),
      sleep(Math.min(heartbeatMs, remainingMs)).then(() => ({
        settled: false as const,
        value: null,
      })),
    ]);
    if (raced.settled) return raced.value;
    onHeartbeat({
      waitedMs: Date.now() - startedAt,
      remainingMs: Math.max(0, deadline - Date.now()),
    });
  }
}

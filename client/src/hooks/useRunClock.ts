/**
 * useRunClock —— 运行秒表 + 后端心跳年龄（Run HUD，2026-11-18）
 *
 * 用户反馈（逐字）：「你没发现其实你在运行，但在前端我看不到你的运行状态，
 * 这个问题会导致我以为你挂了……应该有一个当前是运行/结束/等待/超时这类的显著标识」。
 *
 * 原 `StatusFloatBar` 只有一句静态「AI 正在生成回复」：没有时间证据，
 * 也无法区分「后端在长工具调用里慢慢干」与「流已经死了」。本钩子补齐两件判据：
 * - `elapsedSeconds`：本轮运行了多久（本地秒表，从活跃态起点算）；
 * - `beatAgeSeconds` / `stalled`：最后一次后端心跳有多久（`services/streamHeartbeat`
 *   由 `chatService` 在收到 `: heartbeat` 注释行时登记）。
 *
 * 只报**真实测量值**：没有收到过心跳时 `beatAgeSeconds` 为 `null`（不猜 0）。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useChatStore } from "../stores/chat";
import {
  getStreamHeartbeatAt,
  subscribeStreamHeartbeat,
  STREAM_BEAT_STALL_MS,
} from "../services/streamHeartbeat";

export { STREAM_BEAT_STALL_MS };

export interface RunClockState {
  /** 前端是否有活跃运行标志（发送/流式/上传） */
  active: boolean;
  /** 本轮已运行秒数 */
  elapsedSeconds: number;
  /** 最后一次心跳距今秒数；`null` = 本轮尚未收到心跳（或当前无聊天流） */
  beatAgeSeconds: number | null;
  /** 心跳静默超过 `STREAM_BEAT_STALL_MS`（默认 90s） */
  stalled: boolean;
}

/**
 * 纯函数：是否判定为心跳停滞（可单测）。
 * - 非流式阶段（上传/首包前）没有心跳来源 ⇒ 不判停滞；
 * - 从未收到心跳（`null`）⇒ 不判停滞，只在有基线后才报「可能已断」。
 */
export function deriveRunStalled(
  beatActive: boolean,
  beatAgeMs: number | null,
): boolean {
  return beatActive && beatAgeMs !== null && beatAgeMs >= STREAM_BEAT_STALL_MS;
}

/**
 * @param sessionId 当前会话 id（心跳按会话分键，避免别的会话替本会话作证）
 */
export function useRunClock(sessionId?: string): RunClockState {
  const isSending = useChatStore((s) => s.isSending);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const isUploading = useChatStore((s) => s.isUploading);
  const active = isSending || isStreaming || isUploading;
  // 心跳只存在于聊天 SSE 打开期间（isStreaming）；发送/上传阶段没有心跳来源
  const beatActive = isStreaming;

  const lastBeatAt = useSyncExternalStore(
    subscribeStreamHeartbeat,
    () => getStreamHeartbeatAt(sessionId),
    () => getStreamHeartbeatAt(sessionId),
  );

  const startedAtRef = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) {
      startedAtRef.current = null;
      return;
    }
    startedAtRef.current ??= Date.now();
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  const elapsedSeconds =
    active && startedAtRef.current !== null
      ? Math.max(0, Math.floor((now - startedAtRef.current) / 1000))
      : 0;

  const beatAgeMs =
    beatActive && lastBeatAt !== null ? Math.max(0, now - lastBeatAt) : null;

  return {
    active,
    elapsedSeconds,
    beatAgeSeconds: beatAgeMs === null ? null : Math.floor(beatAgeMs / 1000),
    stalled: deriveRunStalled(beatActive, beatAgeMs),
  };
}

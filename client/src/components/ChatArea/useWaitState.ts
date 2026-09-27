/**
 * useWaitState —— 会话"等待态"共享钩子（等待态可见性，2026-09-27）
 *
 * Spec：`.trae/specs/wait-state-visibility.md`（D3/D4）。
 *
 * 解决的现象（用户原话）："如果你在持续等待，其实可以给前端反馈（或显示）正在干活的状态，
 * 而不是仅仅完成当前已输出的情况。"
 *
 * 两类等待**都**要呈现，且来源不同：
 * - `yield`：`sessions_yield` 让出、等子任务结算 —— 后端 `yieldState='waiting'`（N-45）；
 * - `selfwake`：`sleep_for` / `sleep_until` / `wake_on_job` / `wake_on_event` —— 后端
 *   `pendingWake`（2026-09-27 新增）。这类等待**不进 `YieldRegistry`**，故此前
 *   `yieldState` 为 `undefined`、前端完全看不到"仍在等"。
 *
 * 轮询策略（D3/D4，按后端成本分级）：
 * - `sessionId` / `isStreaming` 变化 ⇒ 立即拉一次（沿用既有语义：让出结束本轮流、续跑再结束）；
 * - **仅在等待中**每 `WAIT_POLL_MS` 再拉（`yieldState='waiting'` 走内存 registry，很便宜）；
 * - `unresolved` ⇒ **停止轮询**（后端该分支要读 200 条事件尾，不可高频）；
 * - 非等待态 ⇒ 不轮询（流式期间的反馈由 SSE 承担）。
 *
 * 与 `useThinkingPhase` 同范式（共享钩子 + 纯函数可单测 + 本地计时不落 store）。
 */
import { useEffect, useRef, useState } from "react";
import {
  getSessionRuntimeStatus,
  type SessionRuntimeStatus,
} from "../../services/sessionService";
import { handleClientError } from "../../utils/handleError";

/** 等待期轮询间隔（ms）—— 4s：足够"看起来在动"，又不至于压垮后端 */
export const WAIT_POLL_MS = 4000;

export type WaitReason = "yield" | "selfwake";

export interface DerivedWaitState {
  /** 是否处于等待中（流式期间恒为 false：此时反馈由 SSE 承担） */
  waiting: boolean;
  reason?: WaitReason;
  /** 已让出但未能自动恢复 ⇒ 需用户介入（由 `YieldNoticeBar` 单独告警） */
  unresolved: boolean;
  /** 仅 selfwake 的 timer 类有：Unix ms（据此显示倒计时，不猜剩余时间） */
  triggerAt?: number;
}

export interface WaitState extends DerivedWaitState {
  /** 已等待秒数（本地计时，从进入等待态起算） */
  seconds: number;
}

/**
 * 纯函数：由后端运行态 + 当前是否流式，推导等待态（可单测，不依赖 React）。
 *
 * 优先级：流式中 > `unresolved` > `yieldState='waiting'` > `pendingWake` > 无。
 * 注：`unresolved` 与 `waiting` 互斥（`deriveYieldState` 只会回其中一个）。
 */
export function deriveWaitState(
  status: SessionRuntimeStatus | undefined,
  isStreaming: boolean,
): DerivedWaitState {
  if (isStreaming) return { waiting: false, unresolved: false };
  if (status?.yieldState === "unresolved") {
    return { waiting: false, unresolved: true };
  }
  if (status?.yieldState === "waiting") {
    return { waiting: true, reason: "yield", unresolved: false };
  }
  if (status?.pendingWake) {
    return {
      waiting: true,
      reason: "selfwake",
      unresolved: false,
      ...(typeof status.pendingWake.triggerAt === "number"
        ? { triggerAt: status.pendingWake.triggerAt }
        : {}),
    };
  }
  return { waiting: false, unresolved: false };
}

/**
 * 订阅当前会话的等待态（含已等待秒数）。供 `ChatArea` 统一调用后下传给
 * `StatusFloatBar` / `YieldNoticeBar` —— **单一拉取点**，避免两个组件各自轮询。
 */
export function useWaitState(
  sessionId?: string,
  isStreaming = false,
): WaitState {
  const [status, setStatus] = useState<SessionRuntimeStatus | undefined>(
    undefined,
  );
  const [seconds, setSeconds] = useState(0);
  const waitingSinceRef = useRef<number | null>(null);

  // 拉取 + 条件轮询
  useEffect(() => {
    if (!sessionId) {
      setStatus(undefined);
      return;
    }
    let cancelled = false;
    let timerId: number | undefined;

    const tick = async () => {
      try {
        const s = await getSessionRuntimeStatus(sessionId);
        if (cancelled) return;
        setStatus(s);
        const d = deriveWaitState(s, isStreaming);
        // 仅"等待中且非 unresolved"继续轮询（unresolved 的查询在服务端更贵）
        if (d.waiting && !d.unresolved) {
          timerId = window.setTimeout(tick, WAIT_POLL_MS);
        }
      } catch (e) {
        if (cancelled) return;
        setStatus(undefined);
        handleClientError(e, {
          module: "components:chat:useWaitState",
          action: "getSessionRuntimeStatus",
        });
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
  }, [sessionId, isStreaming]);

  const derived = deriveWaitState(status, isStreaming);

  // 进入/离开等待态 ⇒ 记录起点（不落 store）
  useEffect(() => {
    if (derived.waiting) {
      waitingSinceRef.current ??= Date.now();
    } else {
      waitingSinceRef.current = null;
    }
  }, [derived.waiting]);

  // 已等待秒数（1s tick）
  useEffect(() => {
    if (!derived.waiting) {
      setSeconds(0);
      return;
    }
    const tick = () => {
      if (waitingSinceRef.current !== null) {
        setSeconds(Math.floor((Date.now() - waitingSinceRef.current) / 1000));
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [derived.waiting]);

  return { ...derived, seconds };
}

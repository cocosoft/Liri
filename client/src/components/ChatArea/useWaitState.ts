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
 * - **后台运行中**（`streaming=true` 且本页面未接入该流）同样每 `WAIT_POLL_MS` 再拉 ——
 *   否则刷新 / 切会话回来后只拉一次，后续「它还在跑 / 已经停了」的变化全部看不到
 *   （2026-11-18 用户反馈「以为你挂了」的根因之一）；
 * - `unresolved` ⇒ **停止轮询**（后端该分支要读 200 条事件尾，不可高频）；
 * - 非等待态且非后台运行 ⇒ 不轮询（流式期间的反馈由 SSE 承担）。
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

/**
 * `pendingWake.triggerAt` **已过期超过这么久**仍未被后端消费 ⇒ 判为「过期未触发」。
 *
 * 取 60s：`CronTimer` 的最大休眠即 60s（`MAX_TIMER_DELAY_MS`）⇒ 正常退一个 tick 内就会被
 * `extraTick` 扫到并 `fire()`；超过一个完整 tick 仍挂着，说明后端没在消费它（2026-11-19
 * 真机：接线缺失导致过期条目永久 `pending`，前端却一直显示"预计 N 秒后自动继续"）。
 */
export const WAKE_OVERDUE_GRACE_MS = 60_000;

export type WaitReason = "yield" | "selfwake";

export interface DerivedWaitState {
  /** 是否处于等待中（流式期间恒为 false：此时反馈由 SSE 承担） */
  waiting: boolean;
  reason?: WaitReason;
  /** 已让出但未能自动恢复 ⇒ 需用户介入（由 `YieldNoticeBar` 单独告警） */
  unresolved: boolean;
  /** 仅 selfwake 的 timer 类有：Unix ms（据此显示倒计时，不猜剩余时间） */
  triggerAt?: number;
  /**
   * 该 `pendingWake` 的 `triggerAt` 已过期超过 {@link WAKE_OVERDUE_GRACE_MS} 仍未被后端消费。
   *
   * D（2026-11-19）：此时**不得**再说"预计 N 秒后自动继续"（剩余量恒为 0，属误导）；
   * 文案降级为"等待已过期（后端尚未触发）"，仍算 `waiting`（后端登记的事实没消失）。
   */
  overdue?: boolean;
}

export interface WaitState extends DerivedWaitState {
  /** 已等待秒数（本地计时，从进入等待态起算） */
  seconds: number;
  /**
   * 后端报告本会话仍在运行，而本页面**没有接入**该流
   * （刷新 / 切到别的会话再回来 / 后台批次仍在本会话上跑）。
   *
   * 2026-11-18（Run HUD）：此前该情形下浮动栏直接卸载，界面退回"答完了"的样子 ——
   * 用户据此以为进程挂了。这里只如实陈述"还在跑、但本页看不到实时输出"，
   * 不伪造进度，也不提供后端尚不支持的"接入"动作。
   */
  remoteStreaming: boolean;
}

/**
 * 纯函数：由后端运行态 + 当前是否流式，推导等待态（可单测，不依赖 React）。
 *
 * 优先级：流式中 > `unresolved` > `yieldState='waiting'` > `pendingWake` > 无。
 * 注：`unresolved` 与 `waiting` 互斥（`deriveYieldState` 只会回其中一个）。
 *
 * @param now 当前时刻（默认 `Date.now()`；测试可注入，用于判定"过期未触发"）
 */
export function deriveWaitState(
  status: SessionRuntimeStatus | undefined,
  isStreaming: boolean,
  now = Date.now(),
): DerivedWaitState {
  if (isStreaming) return { waiting: false, unresolved: false };
  if (status?.yieldState === "unresolved") {
    return { waiting: false, unresolved: true };
  }
  if (status?.yieldState === "waiting") {
    return { waiting: true, reason: "yield", unresolved: false };
  }
  if (status?.pendingWake) {
    const triggerAt =
      typeof status.pendingWake.triggerAt === "number"
        ? status.pendingWake.triggerAt
        : undefined;
    // 过期未触发：只说"已过期"，不再给恒为 0 的倒计时（D7：只报真实测量值）
    const overdue =
      triggerAt !== undefined && now - triggerAt > WAKE_OVERDUE_GRACE_MS;
    return {
      waiting: true,
      reason: "selfwake",
      unresolved: false,
      ...(triggerAt !== undefined ? { triggerAt } : {}),
      ...(overdue ? { overdue: true } : {}),
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
  /**
   * 运行态探测信号（2026-11-24）：递增 ⇒ **立即重拉一次**。
   *
   * 用途：审批通过后后端自动续跑，期间本页没有 SSE 连接；后端在续跑启动时广播
   * `session:resumed` ⇒ 上游递增本值 ⇒ 这里立刻拉一次 `/streaming`，命中
   * `streaming=true` 后 `remoteStreaming` 成立并继续轮询（否则要等续跑结束才知道）。
   */
  probeNonce = 0,
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
        // 仅"等待中且非 unresolved"继续轮询（unresolved 的查询在服务端更贵）；
        // 2026-11-18：后台运行中（本页未接入）也要继续观察，直到后端自己停下。
        const remoteRunning = s.streaming === true && !isStreaming;
        if ((d.waiting && !d.unresolved) || remoteRunning) {
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
  }, [sessionId, isStreaming, probeNonce]);

  const derived = deriveWaitState(status, isStreaming);
  // 后端在跑、本页未接入（deriveWaitState 的等待态与它互斥：前者要求本地不在流式中，
  // 且后端 streaming=false —— 故此处仅以后端 streaming 为准，不重复判断 waiting）
  const remoteStreaming = status?.streaming === true && !isStreaming;

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

  return { ...derived, seconds, remoteStreaming };
}

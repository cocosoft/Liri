// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * resumeCoalescer —— 审批续跑的**同会话在飞合并**（N-17，2026-11-07 真机）
 *
 * **问题**：一次批准多张卡时，每张卡都会 fire-and-forget 触发一次 `resumeStream`。
 * 先到者拿到会话互斥；其余在「检查会话是否空闲 → 获取互斥」的**竞态窗口**内也通过了检查
 * ⇒ 空等 `SimpleMutex: acquire timeout after 30000ms` ⇒ 日志
 * 「审批后自动续跑失败（前端可兜底续跑）」（实证 `session_mw553loec71420aeaa` 15:50:34）。
 *
 * **处置**：同一会话同一时刻只跑一轮；期间到来的请求只置 `again`，当前轮结束后**补跑一次**。
 * `resumeStream` 本身会重放"当前仍待执行"的调用，因此补跑在无剩余调用时是幂等空转，
 * 成本远低于一次 30s 互斥超时；也保证"批准发生在续跑途中"的调用不会被漏掉。
 *
 * 纯状态机（注入 `runOnce`），便于单测；不持有定时器与全局资源。
 */
export interface ResumeCoalescer {
  (sessionId: string): Promise<void>;
  /** 当前在飞的会话数（仅供测试/诊断） */
  readonly inFlightCount: () => number;
}

export function createResumeCoalescer(
  runOnce: (sessionId: string) => Promise<void>
): ResumeCoalescer {
  const inFlight = new Map<string, { again: boolean }>();

  const trigger = async (sessionId: string): Promise<void> => {
    const running = inFlight.get(sessionId);
    if (running) {
      running.again = true;
      return;
    }
    const state = { again: false };
    inFlight.set(sessionId, state);
    try {
      do {
        state.again = false;
        await runOnce(sessionId);
      } while (state.again);
    } finally {
      inFlight.delete(sessionId);
    }
  };

  return Object.assign(trigger, {
    inFlightCount: () => inFlight.size,
  });
}

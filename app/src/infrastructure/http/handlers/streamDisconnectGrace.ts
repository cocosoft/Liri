/**
 * streamDisconnectGrace — 客户端断开后的「中止 or 进入后台」判定（纯函数）
 *
 * Spec：`.trae/specs/stream-attach-grace.md` §3.2 / §9。
 *
 * 为什么单独成文件：这段判定决定"本轮还活不活"，必须在**没有 HTTP、没有生成器**
 * 的情况下可单测（`grace=0` 必须与改动前逐字等价）。
 */

/** 断开时应当执行的动作 */
export type DisconnectAction =
  /** 已在后台：继续推进生成器，无需任何动作 */
  | { kind: 'continue' }
  /** 按既有语义立即中止本轮（grace=0） */
  | { kind: 'abort' }
  /** 进入后台：继续泵，宽限期内等 attach 接管 */
  | { kind: 'detach'; graceMs: number };

/**
 * 连接断开（`res` close / 循环内发现 destroyed）应当如何处理。
 *
 * @param graceMs 宽限期（`CLIENT_DISCONNECT_GRACE_MS`）；`<=0` 关闭该能力
 * @param alreadyDetached 是否已处于后台推进（幂等：重复触发只返回 continue）
 */
export function resolveDisconnectAction(
  graceMs: number,
  alreadyDetached: boolean
): DisconnectAction {
  if (alreadyDetached) return { kind: 'continue' };
  if (graceMs <= 0) return { kind: 'abort' };
  return { kind: 'detach', graceMs };
}

/**
 * 宽限到期时是否应中止本轮：**只有无人接管**才中止。
 * 有订阅者 ⇒ 有人在看，按正常流式处理（不设时长上限）。
 */
export function shouldAbortWhenGraceExpires(hasSubscribers: boolean): boolean {
  return !hasSubscribers;
}

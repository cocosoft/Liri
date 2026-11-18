/**
 * streamDisconnectGrace — 客户端断开后的「中止 or 进入后台」判定（纯函数）
 *
 * Spec：`.trae/specs/stream-attach-grace.md` §3.2 / §9。
 *
 * 为什么单独成文件：这段判定决定"本轮还活不活"，必须在**没有 HTTP、没有生成器**
 * 的情况下可单测（`grace=0` 必须与改动前逐字等价）。
 */
import { getLogger } from '@openliri/infra/monitoring';

const logger = getLogger('http:chat');

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

/** 断开来源（仅用于日志定位：`close` 事件 / 循环内发现 destroyed） */
export type DisconnectReason = 'close' | 'loop';

export interface GracefulDetachOptions {
  /** 宽限期（`CLIENT_DISCONNECT_GRACE_MS`）；`<=0` 关闭该能力 */
  graceMs: number;
  sessionId: string;
  /** 进入后台时的清理（如停止 SSE 保活心跳） */
  onDetach?: () => void;
  /** 宽限到期且无人接管 ⇒ 中止本轮 */
  onAbort: () => void;
  /** 该会话当前是否有 attach 订阅者 */
  hasSubscribers: (sessionId: string) => boolean;
}

export interface GracefulDetachController {
  /** 是否已进入"只写 attach hub、不写 res"的后台态 */
  isDetached(): boolean;
  /**
   * 尝试进入后台继续；返回 `true` = 调用方**不得**中止本轮
   * （已 detach / 本轮已收尾 / 无宽限期但已在后台）。
   */
  tryDetach(reason: DisconnectReason): boolean;
  /** 本轮已收尾：清定时器，且此后的 `tryDetach` 一律视为"无需处理" */
  finish(): void;
}

/**
 * 断开后的"后台继续"控制器（2026-11-18，P1 主链路 + P2 续跑流共用）。
 *
 * 抽成控制器而不是各 handler 各写一份：这段逻辑决定"本轮还活不活"，
 * 三处（close / 循环内 destroyed / 宽限到期）必须共用同一个幂等状态；
 * 复制粘贴必然漂移出"两边 grace 判定不一致"的缺陷（CS01）。
 */
export function createGracefulDetach(
  opts: GracefulDetachOptions
): GracefulDetachController {
  let detached = false;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    isDetached: () => detached,

    finish(): void {
      finished = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },

    tryDetach(reason: DisconnectReason): boolean {
      // 已收尾：`res.end()` 之后触发的 close 属正常完结
      if (finished) return true;
      const action = resolveDisconnectAction(opts.graceMs, detached);
      if (action.kind === 'continue') return true;
      if (action.kind === 'abort') return false;

      detached = true;
      opts.onDetach?.();
      logger.info('SSE 客户端断开，进入后台继续（宽限期内等待接入）', {
        sessionId: opts.sessionId,
        graceMs: action.graceMs,
        reason,
      });
      timer = setTimeout(() => {
        timer = undefined;
        if (!shouldAbortWhenGraceExpires(opts.hasSubscribers(opts.sessionId))) {
          logger.info('attach 宽限期结束：已有订阅者接管，本轮继续', {
            sessionId: opts.sessionId,
          });
          return;
        }
        logger.info('attach 宽限期结束且无人接入，中止本轮', {
          sessionId: opts.sessionId,
          graceMs: opts.graceMs,
        });
        opts.onAbort();
      }, action.graceMs);
      // 宽限定时器不得阻止进程退出（与后端其它定时器口径一致）
      (timer as unknown as { unref?: () => void }).unref?.();
      return true;
    },
  };
}

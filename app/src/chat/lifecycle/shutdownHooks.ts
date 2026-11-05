// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 会话优雅退出钩子（C 批外移，2026-11-05）
 *
 * 从 `ChatManager.ts` 迁出的两个模块级注册表（原 2229–2280，约 52 行）：
 * ① `eventBufferFlushers` —— 退出前 flush 全会话 text-batch 缓冲，避免 watch 重启 / Ctrl+C
 *    留下 torn-tail / open-turn（2026-09-02 排查"会话中断"）；
 * ② `cleanShutdownHandlers` —— 为可中断会话写 `cleanShutdown` 标记，下次启动跳过崩溃恢复（M4）。
 *
 * 口径不变：模块级数组 + 函数声明（hoisted），重复构造仅追加 no-op 闭包（幂等）；
 * 单条失败不阻断退出链（CS03）。`main.ts` 的信号链直接 import 本模块。
 */

const eventBufferFlushers: Array<() => Promise<number>> = [];

/** 注册一个退出前 flush 钩子（返回注册条数，便于日志） */
export function registerEventBufferFlusher(fn: () => Promise<number>): void {
  eventBufferFlushers.push(fn);
}

/** 退出前 flush 全部已注册会话的事件缓冲（逐条容错，返回总 flush chunk 数） */
export async function flushAllEventBuffers(): Promise<number> {
  let total = 0;
  await Promise.all(
    eventBufferFlushers.map((fn) =>
      fn()
        .then((n) => {
          total += n;
        })
        .catch(() => {
          // @ignore-catch — 单条 flush 失败不阻断退出链（CS03）
        })
    )
  );
  return total;
}

const cleanShutdownHandlers: Array<() => Promise<void>> = [];

/** 注册一个退出前 cleanShutdown 标记钩子 */
export function registerCleanShutdownHandler(fn: () => Promise<void>): void {
  cleanShutdownHandlers.push(fn);
}

/** 退出前标记全部可中断会话为优雅关闭（逐条容错，不阻断退出链） */
export async function markSessionsCleanShutdown(): Promise<void> {
  await Promise.all(
    cleanShutdownHandlers.map((fn) =>
      fn().catch(() => {
        // @ignore-catch — 单条标记失败不阻断退出链（CS03）
      })
    )
  );
}

// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 优雅退出钩子的**有界执行**（2026-11-14，P0-2）。
 *
 * 背景：`main.ts` 的退出链（通道 dispose / llama / MCP / proactive / 会话 flush）此前是
 * 无上界的 `Promise.allSettled` —— 任一钩子卡死，进程就永远挂住，daemon 模式只能人工
 * `kill -9`（且下次启动会把活跃会话标 failed_stale）。
 *
 * 口径：
 * - 每条钩子上界 {@link SHUTDOWN_HOOK_TIMEOUT_MS}，超时**记为一条超时并继续**后续钩子；
 * - 计时器 `unref()`，不得反过来保活事件循环；
 * - 单条失败（reject）不阻断退出链（沿用改造前 `allSettled` 的语义），但记入失败名单
 *   供调用方留痕（CS03-002：不静默吞错）。
 */
import { SHUTDOWN_HOOK_TIMEOUT_MS } from '@openliri/infra/constants';
import { withDeadline } from '@openliri/infra/utils/withDeadline';

/**
 * 单条退出钩子的执行上界（ms）—— 唯一事实来源在 `@openliri/infra/constants`
 * （`LIRI_SHUTDOWN_HOOK_TIMEOUT_MS` 可覆盖，默认 8s）。
 *
 * 与内核容器关闭的有界口径对齐（`DisposeManager` 的 `DEFAULT_DISPOSE_TIMEOUT_MS = 5_000`），
 * 退出链涉及网络/子进程回收，故默认放宽到 8s。
 */
export { SHUTDOWN_HOOK_TIMEOUT_MS };

/** 一条退出钩子（`name` 用于超时/失败汇总点名） */
export interface ShutdownHook {
  name: string;
  run: () => Promise<unknown>;
}

export interface ShutdownHooksOptions {
  /** 覆盖 {@link SHUTDOWN_HOOK_TIMEOUT_MS}（测试用于把超时压到毫秒级） */
  timeoutMs?: number;
}

export interface ShutdownHookResult {
  /** 超时被跳过的钩子名（有序） */
  timedOut: string[];
  /** 执行失败的钩子名（有序） */
  failed: string[];
}

/**
 * 并行执行全部退出钩子，每条独立设上界。
 *
 * 不抛错：超时与失败都归入返回值，由调用方统一记录后继续退出。
 */
export async function runShutdownHooks(
  hooks: readonly ShutdownHook[],
  options: ShutdownHooksOptions = {}
): Promise<ShutdownHookResult> {
  const timeoutMs = options.timeoutMs ?? SHUTDOWN_HOOK_TIMEOUT_MS;
  const timedOut: string[] = [];
  const failed: string[] = [];

  await Promise.all(
    hooks.map(async ({ name, run }) => {
      try {
        const outcome = await withDeadline(run(), {
          timeoutMs,
          unrefTimer: true,
        });
        if (outcome.kind === 'timeout') timedOut.push(name);
      } catch {
        failed.push(name);
      }
    })
  );

  return { timedOut, failed };
}

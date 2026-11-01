/**
 * withDeadline —— 「超时 + 可中止」统一竞速工具（源码排查报告 S3）。
 *
 * 背景：手写 `Promise.race([answer, setTimeout, abortListener])` 的调用点极易漏掉
 * `clearTimeout` 与 `removeEventListener`（报告 D4 的定时器堆积即此类）。本工具把
 * **资源回收收进单一实现**：无论结局是「操作完成 / 超时 / 中止 / 操作抛错」，定时器与
 * abort 监听器都会在 `finally` 中回收。
 *
 * 语义：
 * - `settled`：操作先完成，携带其值；
 * - `timeout`：`timeoutMs` 内未完成（`timeoutMs <= 0` / 非有限数 ⇒ 不设超时）；
 * - `abort`：`signal` 先触发（无 signal ⇒ 永不中止）；
 * - 操作自身 reject 时，本函数**原样 reject**（不吞错）。
 *
 * 纯基础设施：零依赖、无日志副作用（可被 service / app 层复用）。
 */

/** 竞速结局（操作完成 / 超时 / 中止） */
export type DeadlineOutcome<T> =
  | { kind: 'settled'; value: T }
  | { kind: 'timeout' }
  | { kind: 'abort' };

export interface WithDeadlineOptions {
  /** 等待上限（毫秒）；`<= 0` 或非有限数 ⇒ 不设超时 */
  timeoutMs: number;
  /** 中止信号（可选） */
  signal?: AbortSignal;
}

/**
 * 让 `operation` 与「超时 / 中止」竞速，并保证定时器与监听器必被回收。
 */
export function withDeadline<T>(
  operation: Promise<T>,
  options: WithDeadlineOptions
): Promise<DeadlineOutcome<T>> {
  const { timeoutMs, signal } = options;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;

  const timeoutPromise =
    Number.isFinite(timeoutMs) && timeoutMs > 0
      ? new Promise<'timeout'>((resolve) => {
          timer = setTimeout(resolve, timeoutMs, 'timeout' as const);
        })
      : new Promise<'timeout'>(() => {
          // 不设超时：永不 settle
        });

  const abortPromise = new Promise<'abort'>((resolve) => {
    if (!signal) return; // 无信号 ⇒ 永不中止
    if (signal.aborted) {
      resolve('abort');
      return;
    }
    abortHandler = () => resolve('abort');
    signal.addEventListener('abort', abortHandler, { once: true });
  });

  return Promise.race([
    operation.then((value) => ({ kind: 'settled' as const, value })),
    timeoutPromise.then((kind) => ({ kind })),
    abortPromise.then((kind) => ({ kind })),
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
    if (abortHandler) signal?.removeEventListener('abort', abortHandler);
  });
}

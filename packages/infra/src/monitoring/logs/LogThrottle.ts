/**
 * LogThrottle —— 高频 info 的**按 key 限流**（P2-1，2026-11-04）
 *
 * 背景（《运行态问题排查与修复方案》P2-1）：44 分钟窗口里 `ModelRouter.resolve`
 * 一类"每次调用都打"的 info 单点就有 935 条，日志体积以"调用量"而非"事件量"增长。
 *
 * 口径：
 * - 同一 key 在 `windowMs` 内只**放行一次**，其余只计数；
 * - 下一条放行时带出 `suppressed`（被压掉的条数），信息量不减、条数受控；
 * - 不改日志级别（INFO 仍可观测），也不影响 warn/error。
 *
 * 纯内存、无 I/O；key 数量上限做一次窗口内清理，防止动态 key 无限增长。
 */

export interface LogThrottleDecision {
  /** 本次是否放行 */
  emit: boolean;
  /** 距上次放行期间被抑制的条数（放行时带出；未放行时为 0） */
  suppressed: number;
}

export interface LogThrottleOptions {
  /** 每 key 的放行窗口（毫秒） */
  windowMs: number;
  /** key 上限（超出时清理已过期条目；默认 512） */
  maxKeys?: number;
}

export class LogThrottle {
  private readonly entries = new Map<
    string,
    { at: number; suppressed: number }
  >();

  constructor(private readonly options: LogThrottleOptions) {}

  /**
   * 判定一次是否放行（有状态；`now` 可注入以便测试）。
   */
  tick(key: string, now: number = Date.now()): LogThrottleDecision {
    const { windowMs } = this.options;
    const maxKeys = this.options.maxKeys ?? 512;
    const state = this.entries.get(key);

    if (state && now - state.at < windowMs) {
      state.suppressed++;
      return { emit: false, suppressed: 0 };
    }

    // 容量保护：只在需要时做一次过期清理（O(n)，n ≤ maxKeys）
    if (!state && this.entries.size >= maxKeys) {
      for (const [candidate, value] of this.entries) {
        if (now - value.at >= windowMs) this.entries.delete(candidate);
      }
    }

    const suppressed = state?.suppressed ?? 0;
    this.entries.set(key, { at: now, suppressed: 0 });
    return { emit: true, suppressed };
  }

  /** 清空状态（测试隔离用） */
  reset(): void {
    this.entries.clear();
  }
}

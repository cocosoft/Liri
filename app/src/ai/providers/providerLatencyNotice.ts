/**
 * Provider 延迟日志的**级别判定**（P2-1，2026-11-04）
 *
 * 背景（《运行态问题排查与修复方案》P2-1）：窗口 `since=2026-11-04T04:00Z` 内
 * `provider 请求完成（TTFB）` / `provider 流式完成` / `provider 聊天完成` 合计约 1.4 万条，
 * 全是"每次请求一条"的稳态行：
 *
 * | 日志点 | n | p50 | p90 | p95 | p99 | 保留条件 | 保留比例 |
 * |---|---:|---:|---:|---:|---:|---|---:|
 * | TTFB | 1 543 | 371ms | 957ms | 1 366ms | 2 986ms | ≥2s 或非 2xx | ≈2.6% |
 * | 流式完成 | 1 540 | 2.2s | 4.5s | 5.6s | 12.1s | ≥5s | ≈7% |
 * | 聊天完成 | 5 125 | 2.4s | 8.7s | 16.9s | 27.7s | ≥15s | ≈5.5% |
 *
 * 口径：**慢尾与失败仍然 INFO**（这才是排查要看的），常态走 debug。
 * 延迟的统计事实面另有 `metric/timing` 事件，不依赖本日志。
 */

/**
 * 是否应以 INFO 记录这次延迟（慢尾或失败）。
 *
 * @param elapsedMs   本次耗时
 * @param thresholdMs 「慢」阈值（各日志点不同，见模块头注）
 * @param ok          响应是否 2xx（默认 true；`false` ⇒ 无论快慢都 INFO）
 */
export function shouldLogLatencyAtInfo(
  elapsedMs: number,
  thresholdMs: number,
  ok: boolean = true
): boolean {
  return !ok || elapsedMs >= thresholdMs;
}

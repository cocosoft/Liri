/**
 * P1-6（2026-11-06）：挂起流**自动重试**的退避序列（有界 + 可中止）。
 *
 * 背景：`chat-message.slice` 的挂起自动恢复原先每 3s 做一次 `/health` 探测，健康即
 * `resumeStream`。当**后端在线、上游模型网络不可用**时（真机 `ENOTFOUND`），每次续跑都会
 * 失败并重新挂起 ⇒ 形成约每 3s 一次的**热循环**（反复请求模型、日志刷屏、可能重复计费）。
 *
 * 口径：首次仍保留 3s（覆盖后端短时掉线的最快恢复），失败后按 10s / 30s / 60s / 120s 退避，
 * 共 **5 次**后停止自动重试，只保留用户手动「立即恢复」。
 */
export const AUTO_RESUME_BACKOFF_MS = [
  3_000, 10_000, 30_000, 60_000, 120_000,
] as const;

/** 自动重试上限（与退避序列同长） */
export const AUTO_RESUME_MAX_ATTEMPTS = AUTO_RESUME_BACKOFF_MS.length;

/**
 * 第 `attempt` 次（1-based）自动重试前的等待毫秒。
 *
 * @returns `null` = 已超出上限 ⇒ 调用方应**停止**自动重试（保留手动恢复）
 */
export function nextAutoResumeDelay(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 1) return null;
  return AUTO_RESUME_BACKOFF_MS[attempt - 1] ?? null;
}

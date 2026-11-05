/**
 * P1-6（2026-11-06）：挂起流自动重试的退避序列。
 *
 * 为什么需要：后端在线、上游模型网络不可用时，`/health` 仍健康 ⇒ 原先每 3s 无条件
 * `resumeStream` 会反复失败并重新挂起（热循环）。本用例锁住「有界 + 退避」：
 *   首次 3s → 10s → 30s → 60s → 120s → 用尽（返回 null，转手动恢复）。
 */
import { describe, expect, it } from "vitest";

import {
  AUTO_RESUME_BACKOFF_MS,
  AUTO_RESUME_MAX_ATTEMPTS,
  nextAutoResumeDelay,
} from "../utils/autoResumeBackoff";

describe("P1-6 自动重试退避", () => {
  it("按 3s/10s/30s/60s/120s 递增，并用尽后返回 null", () => {
    expect(nextAutoResumeDelay(1)).toBe(3_000);
    expect(nextAutoResumeDelay(2)).toBe(10_000);
    expect(nextAutoResumeDelay(3)).toBe(30_000);
    expect(nextAutoResumeDelay(4)).toBe(60_000);
    expect(nextAutoResumeDelay(5)).toBe(120_000);
    expect(nextAutoResumeDelay(6)).toBeNull();
    expect(AUTO_RESUME_MAX_ATTEMPTS).toBe(AUTO_RESUME_BACKOFF_MS.length);
  });

  it("非法入参 ⇒ null（不产生负延迟/死循环）", () => {
    expect(nextAutoResumeDelay(0)).toBeNull();
    expect(nextAutoResumeDelay(-1)).toBeNull();
    expect(nextAutoResumeDelay(1.5)).toBeNull();
    expect(nextAutoResumeDelay(Number.NaN)).toBeNull();
  });
});

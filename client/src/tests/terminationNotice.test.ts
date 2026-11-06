/**
 * P0-5（2026-11-05）：主循环终止原因 → 用户可见提示的**覆盖面锁**。
 *
 * 背景：该映射原为 `ChatMessage.tsx` 内的 `Record`，**缺键即静默** —— 后端新增一个
 * `TerminationReason` 时前端既不报错、用户也看不到任何说明（只剩"结束提示音"）。
 *
 * 锁定：
 *   ① 后端 `TerminationReason` 全集（`app/src/query/ReActLoop.ts`）除 `completed` 外都有提示；
 *   ② `completed` / 缺失 ⇒ 不显示（不制造噪音）；
 *   ③ 未登记的新原因 ⇒ **兜底文案 + 原因码**（不静默）。
 */
import { describe, expect, it } from "vitest";

import {
  getTerminationNotice,
  KNOWN_TERMINATION_REASONS,
  SUPPRESSED_TERMINATION_REASONS,
  TERMINATION_COMPLETED,
} from "../utils/terminationNotice";

/** 后端 `TerminationReason` 全集（镜像，新增成员时本用例会失败并提醒补文案） */
const BACKEND_TERMINATION_REASONS = [
  "completed",
  "error",
  "reasoning_error",
  "no_progress",
  "exploration_fatigue",
  "circuit_breaker",
  "environment_blocked",
  "internal_error",
  "aborted",
  "system_aborted",
  "max_turns",
  "budget_exhausted",
  "verifier_escalate",
  "diminishing_returns",
  "loop_detected",
  "timeout",
  "compaction_failed",
  "awaiting_approval",
  "output_budget_exhausted",
] as const;

describe("P0-5 终止原因覆盖面", () => {
  it("后端每个非 completed 原因都有提示（或被显式抑制）", () => {
    for (const reason of BACKEND_TERMINATION_REASONS) {
      if (reason === TERMINATION_COMPLETED) continue;
      const notice = getTerminationNotice(reason);
      if (SUPPRESSED_TERMINATION_REASONS.includes(reason)) {
        expect(notice, `抑制项 ${reason} 不应有提示`).toBeNull();
        continue;
      }
      expect(notice, `终止原因 ${reason} 没有提示文案`).not.toBeNull();
      expect(notice!.key.startsWith("chat.termination")).toBe(true);
      expect(notice!.fallback.length).toBeGreaterThan(0);
    }
  });

  it("客户端已知原因 + 抑制项 与后端全集对齐（不含 completed）", () => {
    const expected = BACKEND_TERMINATION_REASONS.filter(
      (r) => r !== TERMINATION_COMPLETED,
    );
    expect(
      [...KNOWN_TERMINATION_REASONS, ...SUPPRESSED_TERMINATION_REASONS].sort(),
    ).toEqual([...expected].sort());
  });

  it("completed / 未携带原因 ⇒ 不显示（正常收尾不制造噪音）", () => {
    expect(getTerminationNotice("completed")).toBeNull();
    expect(getTerminationNotice(undefined)).toBeNull();
    expect(getTerminationNotice("")).toBeNull();
  });

  it("未登记的新原因 ⇒ 兜底文案 + 原因码（不再静默）", () => {
    const notice = getTerminationNotice("brand_new_reason");
    expect(notice).not.toBeNull();
    expect(notice!.key).toBe("chat.terminationUnknown");
    expect(notice!.params).toEqual({ reason: "brand_new_reason" });
    expect(notice!.fallback).toContain("brand_new_reason");
  });

  it("分组口径：熔断类 / 阻塞类分别归到对应文案键", () => {
    expect(getTerminationNotice("circuit_breaker")!.key).toBe(
      "chat.terminationFused",
    );
    expect(getTerminationNotice("no_progress")!.key).toBe(
      "chat.terminationFused",
    );
    expect(getTerminationNotice("environment_blocked")!.key).toBe(
      "chat.terminationBlocked",
    );
    expect(getTerminationNotice("max_turns")!.key).toBe(
      "chat.terminationBudget",
    );
  });

  it("P2-5：等待审批属中性暂停 ⇒ 不显示「异常结束」", () => {
    expect(getTerminationNotice("awaiting_approval")).toBeNull();
  });

  it("N-13：输出预算耗尽 ⇒ 独立分组（不再落「未知原因」兜底）", () => {
    const notice = getTerminationNotice("output_budget_exhausted");
    expect(notice).not.toBeNull();
    expect(notice!.key).toBe("chat.terminationOutputBudget");
    expect(notice!.fallback).toContain("输出预算");
  });
});

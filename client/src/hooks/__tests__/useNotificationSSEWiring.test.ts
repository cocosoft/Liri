/**
 * P1（2026-11-04）：`session:meta_updated` 必须**有订阅方**（回归锁）。
 *
 * 真实现场：`PATCH /v1/sessions/:id/meta` 一直会广播该事件，但前端从未注册处理器
 * ⇒ 另一窗口改完 workMode / approvalMode / permissionMode 后，本端界面停留在旧值，
 * 只能刷新页面（`WorkModeToggle` / `ApprovalModeToggle` / `PermissionModeMenu` 的注释
 * 也一直声称"已订阅"，实际是空头承诺）。
 *
 * 为什么用源码扫描：本 Hook 依赖 sseService / 多个 store 与 React 生命周期，
 * 渲染成本高；本仓已有同类手法（`ChatArea/__tests__/dailyLimitNoticeWiring.test.ts`）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(
  resolve(__dirname, "../useNotificationSSE.ts"),
  "utf-8",
);

describe("useNotificationSSE：session:meta_updated 订阅", () => {
  it("注册与解绑成对出现（否则重挂载后重复回填 / 处理器泄漏）", () => {
    expect(src).toMatch(
      /sseService\.on\("session:meta_updated", onSessionMetaUpdated\)/,
    );
    expect(src).toMatch(
      /sseService\.off\("session:meta_updated", onSessionMetaUpdated\)/,
    );
  });

  it("messages:updated（读时覆盖）→ 当前会话重取消息，注册与解绑成对", () => {
    expect(src).toMatch(
      /sseService\.on\("messages:updated", onMessagesUpdated\)/,
    );
    expect(src).toMatch(
      /sseService\.off\("messages:updated", onMessagesUpdated\)/,
    );
    expect(src).toMatch(
      /const onMessagesUpdated = \(data: unknown\): void =>\s*refreshSessionIfActive\(/,
    );
  });

  it("回调走单条重取（refreshSessionMeta + upsertChatSession），不另写字段映射", () => {
    expect(src).toMatch(
      /const onSessionMetaUpdated = \(data: unknown\): void =>\s*refreshSessionMeta\(/,
    );
    expect(src).toContain("function refreshSessionMeta(");
    expect(src).toContain("upsertChatSession");
    // 防御：别在 Hook 里直接读 PATCH 体的 snake_case 字段（会与 flattenSession 形成两套映射）
    const cb = src.slice(src.indexOf("function refreshSessionMeta("));
    const body = cb.slice(0, cb.indexOf("function refreshSessionIfActive("));
    expect(body).not.toContain("permission_mode");
    expect(body).not.toContain("work_mode");
  });
});

// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 会话日志 `extractError` 直测（vitest 版本）。
 *
 * 2026-11-24（P2-2 死代码清理 / CD05）：原用例经 `extractToolCalls`（已删除的死派生）
 * 构造记录；现直接构造 `ToolCallRecord`，保留**仍在生产使用**的 `extractError` 覆盖，
 * 不再测已删除的合并路径。
 */
import { describe, it, expect } from "vitest";
import { extractError, type ToolCallRecord } from "@/utils/sessionLog";

function rec(partial: Partial<ToolCallRecord>): ToolCallRecord {
  return {
    id: "tc",
    name: "tool",
    arguments: {},
    status: "failed",
    ...partial,
  };
}

describe("extractError — 失败工具错误提取", () => {
  it("记录自带 error ⇒ 原样返回", () => {
    expect(extractError(rec({ error: "文件不存在: /nonexistent" }))).toBe(
      "文件不存在: /nonexistent",
    );
  });

  it("无 error / 无 result ⇒ 回退未知错误文案", () => {
    expect(extractError(rec({}))).toBe("未知错误");
  });

  it("result 为对象 ⇒ 依次取 error / message / detail", () => {
    expect(extractError(rec({ result: { error: "result 中的错误" } }))).toBe(
      "result 中的错误",
    );
    expect(extractError(rec({ result: { message: "message 中的错误" } }))).toBe(
      "message 中的错误",
    );
    expect(extractError(rec({ result: { detail: "detail 中的错误" } }))).toBe(
      "detail 中的错误",
    );
  });

  it("result 为字符串 ⇒ 截断到 200 字符", () => {
    const long = "x".repeat(300);
    expect(extractError(rec({ result: long }))).toHaveLength(200);
  });

  it("非 failed 状态且无 error ⇒ null（成功工具不展示错误）", () => {
    expect(extractError(rec({ status: "completed", result: "ok" }))).toBeNull();
  });
});

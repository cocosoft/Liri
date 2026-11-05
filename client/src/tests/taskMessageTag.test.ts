/**
 * P0-4（2026-11-05）：后台任务消息（PDCA 等）与用户会话共用 sessionId 的**可见区分**。
 *
 * 真机：`session_mw375o4312e5f31d38` 的 698 条消息中混有 8 条 `01-scope` / 16 条 `FR-12` 之类的
 * PRD 步骤消息，`metadata` 为 `{ taskId: 'pdca_mw3kb1cq', isTaskMessage: true }`；前端零消费
 * ⇒ 被当普通助手回复渲染（用户观感"答非所问"）。
 *
 * 本轮只做标记（徽标 + 导出行首标记），**不隐藏、不改数据**；是否分离属产品裁定。
 */
import { describe, expect, it } from "vitest";

import { readTaskMessageTag } from "../utils/taskMessageTag";
import { getMessageSearchText } from "../utils/messageText";

describe("P0-4 readTaskMessageTag（结构化标记，CS02 不做字符串匹配）", () => {
  it("无 metadata / 无标记 ⇒ 普通消息", () => {
    expect(readTaskMessageTag(undefined)).toEqual({ isTaskMessage: false });
    expect(readTaskMessageTag({})).toEqual({ isTaskMessage: false });
    expect(readTaskMessageTag({ isTaskMessage: false })).toEqual({
      isTaskMessage: false,
    });
  });

  it("isTaskMessage: true + taskId ⇒ 带任务 id", () => {
    expect(
      readTaskMessageTag({
        taskId: "pdca_mw3kb1cq",
        isTaskMessage: true,
      }),
    ).toEqual({ isTaskMessage: true, taskId: "pdca_mw3kb1cq" });
  });

  it("isTaskMessage: true 但 taskId 缺失/非字符串 ⇒ 仍判为任务消息，无 id", () => {
    expect(readTaskMessageTag({ isTaskMessage: true })).toEqual({
      isTaskMessage: true,
    });
    expect(readTaskMessageTag({ isTaskMessage: true, taskId: 42 })).toEqual({
      isTaskMessage: true,
    });
    expect(readTaskMessageTag({ isTaskMessage: true, taskId: "" })).toEqual({
      isTaskMessage: true,
    });
  });
});

describe("P0-4 导出标记", () => {
  const taskMsg = {
    role: "assistant",
    content: "## 01-scope\n\n本步骤定义范围。",
    metadata: { taskId: "pdca_mw3kb1cq", isTaskMessage: true },
    blocks: [],
  } as never;

  const normalMsg = {
    role: "assistant",
    content: "普通回复",
    blocks: [],
  } as never;

  it("任务消息 ⇒ 行首带 [任务产出 <taskId>]", () => {
    const text = getMessageSearchText(taskMsg, { forExport: true });
    expect(text).toContain("[任务产出 pdca_mw3kb1cq]");
    expect(text).toContain("本步骤定义范围");
  });

  it("普通消息 ⇒ 不出现任务标记（不误伤）", () => {
    const text = getMessageSearchText(normalMsg, { forExport: true });
    expect(text).not.toContain("[任务产出");
  });

  it("搜索版（非导出）不掺入标记（只影响导出件）", () => {
    const text = getMessageSearchText(taskMsg);
    expect(text).not.toContain("[任务产出");
    expect(text).toContain("本步骤定义范围");
  });
});

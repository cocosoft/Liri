// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 工具执行审批链路 P2-3 — 前端审批 UI 测试
 *
 * 覆盖：
 * - ToolCallGroup 识别 pendingApproval → 渲染"⏳ 等待审批"徽标（P2-2）
 * - ToolCallGroup 无 pendingApproval → 不渲染徽标
 * - InboxBlock 批准按钮 → POST /v1/inbox/{id}/reply + 向会话发送续跑消息（P0-5）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http } from "../services/httpClient";
import { useChatStore } from "../stores/chat";

import InboxBlock from "../components/ChatArea/InboxBlock";
import ToolCallGroup from "../components/ChatArea/ToolCallGroup";
import type { InboxBlockData, ToolCall } from "../types";

describe("ToolCallGroup 等待审批态（P2-2）", () => {
  it("pendingApproval=true → 渲染「⏳ 等待审批」徽标", () => {
    const toolCall: ToolCall = {
      id: "t1",
      name: "bash",
      arguments: { command: "rm -rf /tmp/abc" },
      status: "completed",
      pendingApproval: true,
    };
    render(<ToolCallGroup toolCall={toolCall} variant="card" />);
    expect(screen.getByText(/chat\.pendingApproval/)).toBeTruthy();
  });

  it("无 pendingApproval → 不渲染等待审批徽标", () => {
    const toolCall: ToolCall = {
      id: "t2",
      name: "bash",
      arguments: { command: "echo hi" },
      status: "completed",
    };
    render(<ToolCallGroup toolCall={toolCall} variant="card" />);
    expect(screen.queryByText(/chat\.pendingApproval/)).toBeNull();
  });
});

describe("InboxBlock 批准续跑（P0-5）", () => {
  let postSpy: ReturnType<typeof vi.fn>;
  let sendSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // 打桩 http.post（真实 http 对象单例，InboxBlock 引用同一对象）
    postSpy = vi
      .spyOn(http, "post")
      .mockResolvedValue({ ok: true, data: {}, error: undefined });
    // 打桩 chat store 的 sendMessage
    sendSpy = vi
      .spyOn(useChatStore.getState(), "sendMessage")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("点击批准 → POST /v1/inbox/{id}/reply + 向会话发送续跑消息", async () => {
    const data: InboxBlockData = {
      inboxId: "ib-1",
      type: "approval",
      title: "工具审批: bash",
      content: "命令: rm -rf /tmp/abc",
      status: "pending",
      priority: "normal",
      actions: [
        { label: "批准", reply: "approve", style: "primary" },
        { label: "拒绝", reply: "deny", style: "danger" },
      ],
    };
    render(<InboxBlock data={data} sessionId="session-1" />);
    fireEvent.click(screen.getByText("批准"));
    // 等待异步处理完成（http.post + sendMessage）
    await waitFor(() => expect(postSpy).toHaveBeenCalled());

    expect(postSpy).toHaveBeenCalledWith("/v1/inbox/ib-1/reply", {
      reply: "approve",
    });
    // P0-5: 批准后触发 LLM 重新发起（sendMessage 携带结构化批准消息 + 会话 ID）
    await waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(1));
    const [content, sessionId] = sendSpy.mock.calls[0];
    expect(sessionId).toBe("session-1");
    expect(String(content)).toContain("[审批已批准]");
    expect(String(content)).toContain("工具审批: bash");
  });

  it("点击拒绝 → 不触发续跑消息", async () => {
    const data: InboxBlockData = {
      inboxId: "ib-2",
      type: "approval",
      title: "工具审批: bash",
      content: "",
      status: "pending",
      priority: "normal",
      actions: [
        { label: "批准", reply: "approve", style: "primary" },
        { label: "拒绝", reply: "deny", style: "danger" },
      ],
    };
    render(<InboxBlock data={data} sessionId="session-1" />);
    fireEvent.click(screen.getByText("拒绝"));
    await waitFor(() => expect(postSpy).toHaveBeenCalled());

    expect(postSpy).toHaveBeenCalledWith("/v1/inbox/ib-2/reply", {
      reply: "deny",
    });
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

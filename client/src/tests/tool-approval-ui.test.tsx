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
import ToolExecutionGroup from "../components/ChatArea/ToolExecutionGroup";
import type { InboxBlockData, MessageBlock, ToolCall } from "../types";

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

describe("ToolExecutionGroup 分组等待审批态（J-2.2）", () => {
  function makeBlocks(toolCall: ToolCall): MessageBlock[] {
    return [
      {
        id: "blk-tc",
        type: "tool_call",
        content: "",
        toolCall,
        isStreaming: false,
        toolCallId: toolCall.id,
        groupId: "grp-test",
      },
    ];
  }

  it("分组内 tool_call pendingApproval=true → 分组头渲染琥珀色「⏳ 等待审批」徽标", () => {
    const blocks = makeBlocks({
      id: "t3",
      name: "bash",
      arguments: { command: "sudo whoami" },
      status: "completed",
      pendingApproval: true,
    });
    render(<ToolExecutionGroup blocks={blocks} />);
    expect(screen.getByText(/chat\.pendingApproval/)).toBeTruthy();
  });

  it("分组内 tool_call 无 pendingApproval → 不渲染等待审批徽标", () => {
    const blocks = makeBlocks({
      id: "t4",
      name: "bash",
      arguments: { command: "echo hi" },
      status: "completed",
    });
    render(<ToolExecutionGroup blocks={blocks} />);
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
    // 隔离外部依赖：检查点查询 mock 为"无可用 checkpoint"——InboxBlock 批准后
    // 先走 tryResumeAfterApproval（http.get），无 checkpoint 才降级 sendMessage 续跑。
    // 若不 mock，真实 http.get 在 CI（无后端）触发 fetchWithRetry 重试 14s，
    // waitFor(1s) 超时导致 sendMessage 断言 0 次调用。
    vi.spyOn(http, "get").mockResolvedValue({
      ok: false,
      data: undefined,
      error: { code: 404, message: "no checkpoint" },
    });
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

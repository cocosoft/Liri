// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 工具执行审批链路 P2-3 — 前端审批 UI 测试
 *
 * 覆盖：
 * - ToolCallGroup 识别 pendingApproval → 渲染"⏳ 等待审批"徽标（P2-2）
 * - ToolCallGroup 无 pendingApproval → 不渲染徽标
 * - InboxBlock 批准按钮 → POST /v1/inbox/{id}/reply；续跑责任收敛后端（M2-T2.1），
 *   前端不再降级 sendMessage 续跑；U-06-4（2026-10-19）起也不再 sleep 3s 全量重拉，
 *   改由后端 `session:continued` 广播 + `useNotificationSSE` 统一刷新。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http } from "../services/httpClient";
import { sessionService } from "../services/sessionService";
import { useChatStore } from "../stores/chat";

import InboxBlock from "../components/ChatArea/InboxBlock";
import ToolCallGroup from "../components/ChatArea/ToolCallGroup";
import ToolExecutionGroup from "../components/ChatArea/ToolExecutionGroup";
import type { InboxBlockData, MessageBlock, ToolCall } from "../types";
import i18n from "../i18n";

/**
 * 「批准（本次）」按钮的**实际渲染文案**。
 *
 * P0（2026-11-07，《权限与沙箱拉通方案》§2.2）：审批档位收敛为三档 + 拒绝，
 * `approve` 的文案由「批准」改为「仅这次执行」（i18n `chat.inboxReplyApprove`），
 * 以便用户看清作用域。测试直接取 i18n 值 ⇒ 文案调整后不会静默失配。
 */
const APPROVE_LABEL = String(i18n.t("chat.inboxReplyApprove"));

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
    expect(screen.getByText(/等待审批/)).toBeTruthy();
  });

  it("无 pendingApproval → 不渲染等待审批徽标", () => {
    const toolCall: ToolCall = {
      id: "t2",
      name: "bash",
      arguments: { command: "echo hi" },
      status: "completed",
    };
    render(<ToolCallGroup toolCall={toolCall} variant="card" />);
    expect(screen.queryByText(/等待审批/)).toBeNull();
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
    expect(screen.getByText(/等待审批/)).toBeTruthy();
  });

  it("分组内 tool_call 无 pendingApproval → 不渲染等待审批徽标", () => {
    const blocks = makeBlocks({
      id: "t4",
      name: "bash",
      arguments: { command: "echo hi" },
      status: "completed",
    });
    render(<ToolExecutionGroup blocks={blocks} />);
    expect(screen.queryByText(/等待审批/)).toBeNull();
  });
});

describe("ToolCallGroup 就地审批（U-06-5）", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pendingApproval + inboxId ⇒ 渲染批准/拒绝，点击批准 POST /v1/inbox/{id}/reply", async () => {
    const postSpy = vi
      .spyOn(http, "post")
      .mockResolvedValue({ ok: true, data: {}, error: undefined });
    const toolCall: ToolCall = {
      id: "t5",
      name: "bash",
      arguments: { command: "sudo whoami" },
      status: "completed",
      pendingApproval: true,
      inboxId: "ib-9",
    };
    render(<ToolCallGroup toolCall={toolCall} variant="card" />);

    fireEvent.click(screen.getByText(APPROVE_LABEL));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith("/v1/inbox/ib-9/reply", {
        reply: "approve",
      }),
    );
  });

  it("pendingApproval 但无 inboxId ⇒ 只有徽标，不渲染就地审批按钮", () => {
    const toolCall: ToolCall = {
      id: "t6",
      name: "bash",
      arguments: { command: "sudo whoami" },
      status: "completed",
      pendingApproval: true,
    };
    render(<ToolCallGroup toolCall={toolCall} variant="card" />);
    expect(screen.getByText(/等待审批/)).toBeTruthy();
    expect(screen.queryByText(APPROVE_LABEL)).toBeNull();
  });
});

describe("InboxBlock 批准续跑（P0-5 → M2-T2.1）", () => {
  let postSpy: ReturnType<typeof vi.fn>;
  let sendSpy: ReturnType<typeof vi.fn>;
  let getMessagesSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // 打桩 http.post（真实 http 对象单例，InboxBlock 引用同一对象）
    postSpy = vi
      .spyOn(http, "post")
      .mockResolvedValue({ ok: true, data: {}, error: undefined });
    // P1-1：卡片挂载时会查待审批数量（仅用于按钮显隐）—— 这里固定为"取数失败"，
    // 让本组用例聚焦单卡批准路径，不引入网络访问。
    vi.spyOn(http, "get").mockResolvedValue({
      ok: false,
      data: undefined,
      error: "mock",
    } as never);
    // 打桩 chat store 的 sendMessage——M2-T2.1 契约：前端不再降级触发 sendMessage，
    // 续跑责任收敛到后端（inbox-handlers fire-and-forget + events 尾部重建）
    sendSpy = vi
      .spyOn(useChatStore.getState(), "sendMessage")
      .mockResolvedValue(undefined);
    // 打桩延迟刷新（后端续跑落盘后展示结果）
    getMessagesSpy = vi
      .spyOn(sessionService, "getMessages")
      .mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("点击批准 → POST /v1/inbox/{id}/reply；不再 sendMessage；不再 sleep 3s 全量重拉", async () => {
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
    fireEvent.click(screen.getByText(APPROVE_LABEL));
    await waitFor(() => expect(postSpy).toHaveBeenCalled());

    expect(postSpy).toHaveBeenCalledWith("/v1/inbox/ib-1/reply", {
      reply: "approve",
    });
    // M2-T2.1：前端不再向会话发"我已批准"续跑消息（后端负责续跑）
    expect(sendSpy).not.toHaveBeenCalled();
    // U-06-4：刷新由后端 `session:continued` 驱动，前端不再自行全量重拉
    expect(getMessagesSpy).not.toHaveBeenCalled();
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

  // P0-1（2026-11-04）：同指纹审批被合并 ⇒ 会话内卡片显示 ×N（后端回填 dedupCount）
  it("dedupCount > 1 ⇒ 卡片显示 ×N；=1 或缺省 ⇒ 不显示", () => {
    const base: InboxBlockData = {
      inboxId: "ib-3",
      type: "approval",
      title: "工具审批: file_write",
      content: "",
      status: "pending",
      priority: "normal",
      actions: [{ label: "批准", reply: "approve", style: "primary" }],
    };

    const merged = render(
      <InboxBlock data={{ ...base, dedupCount: 3 }} sessionId="session-1" />,
    );
    expect(screen.getByText("×3")).toBeInTheDocument();
    merged.unmount();

    const single = render(
      <InboxBlock data={{ ...base, dedupCount: 1 }} sessionId="session-1" />,
    );
    expect(screen.queryByText("×1")).toBeNull();
    single.unmount();
  });
});

describe("InboxBlock 全部批准（P1-1）", () => {
  const base: InboxBlockData = {
    inboxId: "ib-a",
    type: "approval",
    title: "工具审批: bash",
    content: "命令: mkdir out",
    status: "pending",
    priority: "normal",
    actions: [
      { label: "批准", reply: "approve", style: "primary" },
      { label: "拒绝", reply: "deny", style: "danger" },
    ],
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("同会话 >1 张待审批 ⇒ 显示「全部批准（3 项）」并 POST approve-all", async () => {
    vi.spyOn(http, "get").mockResolvedValue({
      ok: true,
      data: { total: 3 },
      error: undefined,
    } as never);
    const postSpy = vi.spyOn(http, "post").mockResolvedValue({
      ok: true,
      data: { applied: true, resolved: ["a", "b", "c"] },
      error: undefined,
    } as never);

    render(<InboxBlock data={base} sessionId="session-1" />);
    const button = await screen.findByText(/全部批准/);
    fireEvent.click(button);

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith("/v1/inbox/approve-all", {
        sessionId: "session-1",
        reply: "approve",
      }),
    );
  });

  it("仅 1 张待审批 ⇒ 不显示批量按钮", async () => {
    const getSpy = vi.spyOn(http, "get").mockResolvedValue({
      ok: true,
      data: { total: 1 },
      error: undefined,
    } as never);
    vi.spyOn(http, "post").mockResolvedValue({
      ok: true,
      data: {},
      error: undefined,
    } as never);

    render(<InboxBlock data={base} sessionId="session-1" />);
    await waitFor(() => expect(getSpy).toHaveBeenCalled());
    expect(screen.queryByText(/全部批准/)).toBeNull();
  });

  // 真机回归：一键批准 2 张后，未被点击的那张必须随服务端回填切到"已处理"
  it("外部回填 status=replied ⇒ 卡片切到已处理（同级卡片同步）", async () => {
    vi.spyOn(http, "get").mockResolvedValue({
      ok: false,
      data: undefined,
      error: "mock",
    } as never);
    vi.spyOn(http, "post").mockResolvedValue({
      ok: true,
      data: {},
      error: undefined,
    } as never);

    const { rerender } = render(
      <InboxBlock data={base} sessionId="session-1" />,
    );
    expect(screen.getByText(APPROVE_LABEL)).toBeInTheDocument();

    rerender(
      <InboxBlock
        data={{ ...base, status: "replied" }}
        sessionId="session-1"
      />,
    );
    await waitFor(() => expect(screen.queryByText(APPROVE_LABEL)).toBeNull());
    expect(screen.getByText(/已处理/)).toBeInTheDocument();
  });
});

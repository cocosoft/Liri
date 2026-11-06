/**
 * N-5（2026-11-06 真机）：端点态助手片段不得合并进同一气泡。
 *
 * 现场（`session_mw4vwtmp38957bec2f`）：同一轮先后产生「⏸ 等待审批」「⚠️ 本次未能生成
 * 回复」「❌ 编排任务执行失败」三段收尾文案，Phase 2 把它们合并成一个气泡 ⇒ 用户同时
 * 看到互相矛盾的结论（等待审批 / 未生成 / 已处理 / 异常结束）。
 *
 * 锁：带结构化端点标记（`metadata.finishReason` / `terminationReason` /
 * `emptyOutputFallback` / 顶层 `finishReason`）的片段各自成气泡；正常轮次仍合并。
 */
import { describe, expect, it, vi } from "vitest";
import type { Message } from "@/types";

vi.mock("@/utils/planRestore", () => ({ restorePlanTasks: vi.fn() }));
vi.mock("../chat-history.slice", () => ({
  setSessionCache: vi.fn(),
  enqueueSaveBlocks: vi.fn(),
}));

import { setMessagesImpl } from "../chat-message-set-messages";

const SID = "sid-n5";

function msg(
  partial: Partial<Message> & Pick<Message, "id" | "role">,
): Message {
  return {
    session_id: SID,
    timestamp: 1000,
    content: "",
    ...partial,
  } as Message;
}

function harness() {
  let state: Record<string, unknown> = { sessionFiles: [] };
  const set = (patch: Record<string, unknown>) => {
    state = { ...state, ...patch };
  };
  const get = () => state;
  return {
    run: (messages: Message[]) =>
      setMessagesImpl(set as never, get as never, messages),
    messages: () => state.messages as Message[],
  };
}

describe("setMessagesImpl — 端点态气泡不合并（N-5）", () => {
  it("等待审批 / 空输出兜底 / 编排失败 ⇒ 三个独立气泡，互不串文案", () => {
    const h = harness();
    h.run([
      msg({ id: "u1", role: "user", content: "开发游戏", lastEventSeq: 1 }),
      msg({
        id: "a1",
        role: "assistant",
        content: "先确认环境能力。\n\n⏸ 有工具调用正在等待你的审批",
        lastEventSeq: 2,
        metadata: { finishReason: "awaiting_approval", terminationReason: "awaiting_approval" },
      }),
      msg({
        id: "a2",
        role: "assistant",
        content: "⚠️ 本次未能生成回复（模型本轮未产出可见内容）",
        lastEventSeq: 3,
        metadata: { emptyOutputFallback: true, terminationReason: "awaiting_approval" },
      }),
      msg({
        id: "a3",
        role: "assistant",
        content: "❌ 编排任务执行失败：Planner 输出无法解析为有效计划",
        lastEventSeq: 4,
        metadata: { terminationReason: "completed" },
        blocks: [
          { id: "b3", type: "text", content: "❌ 编排任务执行失败" },
          {
            id: "inbox_1",
            type: "inbox",
            content: "",
            inboxData: {
              inboxId: "inbox_1",
              type: "approval",
              title: "工具审批: bash",
              content: "mkdir",
              status: "replied",
              priority: "normal",
              actions: [{ label: "批准", reply: "approve" }],
            },
          },
        ],
      }),
    ]);

    const out = h.messages();
    expect(out.map((m) => m.id)).toEqual(["u1", "a1", "a2", "a3"]);
    // 每个气泡只带自己的结论，不再出现"同一气泡两种矛盾结论"
    expect(out[1].content).toContain("等待你的审批");
    expect(out[1].content).not.toContain("未能生成回复");
    expect(out[2].content).toContain("未能生成回复");
    expect(out[2].content).not.toContain("编排任务执行失败");
    expect(out[3].content).toContain("编排任务执行失败");
    expect(out[3].content).not.toContain("等待你的审批");
  });

  it("顶层 finishReason=error 同样视为端点态（metadata 缺失时的兜底）", () => {
    const h = harness();
    h.run([
      msg({
        id: "a1",
        role: "assistant",
        content: "报错结束",
        lastEventSeq: 2,
        finishReason: "error",
      }),
      msg({
        id: "a2",
        role: "assistant",
        content: "后续片段",
        lastEventSeq: 3,
      }),
    ]);
    expect(h.messages().map((m) => m.id)).toEqual(["a1", "a2"]);
  });

  it("正常轮次（stop / tool_calls / 无标记）仍合并为一条", () => {
    const h = harness();
    h.run([
      msg({ id: "a1", role: "assistant", content: "第一段", lastEventSeq: 2, finishReason: "tool_calls" }),
      msg({ id: "a2", role: "assistant", content: "第二段", lastEventSeq: 3, finishReason: "stop" }),
    ]);
    const out = h.messages();
    expect(out).toHaveLength(1);
    expect(out[0].content).toContain("第一段");
    expect(out[0].content).toContain("第二段");
  });
});

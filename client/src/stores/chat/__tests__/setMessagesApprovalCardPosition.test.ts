/**
 * N-14（2026-11-06 真机）：续跑回合的审批卡片必须落在**视野底部**。
 *
 * 现场：首轮审批卡片可见；批准后后端续跑，续跑轮里又产生一条审批 —— 卡片被后台
 * 读时合成到收尾助手消息上，但该消息与上一轮助手消息**连续**（中间的工具结果只是
 * 孤儿消息）⇒ `setMessagesImpl` Phase 2 把两条助手消息合并，且沿用**首段**的
 * `lastEventSeq`/`timestamp` ⇒ 合并气泡被排到续跑轮那些孤儿工具结果之前，
 * 审批按钮滚出视野（用户滚到底只看到工具返回 JSON）。
 *
 * 锁：合并后的气泡取**后段**时序键，卡片与气泡一起排在最后。
 */
import { describe, expect, it, vi } from "vitest";
import type { Message } from "@/types";

vi.mock("@/utils/planRestore", () => ({ restorePlanTasks: vi.fn() }));
vi.mock("../chat-history.slice", () => ({
  setSessionCache: vi.fn(),
  enqueueSaveBlocks: vi.fn(),
}));

import { setMessagesImpl } from "../chat-message-set-messages";

const SID = "sid-n14";

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

describe("setMessagesImpl — 合并助手气泡的时序键（N-14）", () => {
  it("合并后沿用后段 lastEventSeq/timestamp，审批卡片排在续跑轮孤儿工具结果之后", () => {
    const h = harness();
    h.run([
      msg({ id: "u1", role: "user", content: "做游戏", lastEventSeq: 1 }),
      msg({
        id: "a1",
        role: "assistant",
        content: "\n\n⏸ 有工具调用正在等待你的审批",
        lastEventSeq: 2,
        blocks: [{ id: "b1", type: "text", content: "⏸ 等待审批" }],
      }),
      // 续跑轮的工具结果：没有任何 assistant tool_call 块引用 ⇒ 孤儿消息（N-6/N-48）
      msg({
        id: "t1",
        role: "tool",
        toolCallId: "call_resume_1",
        timestamp: 3000,
        lastEventSeq: 3,
        content: '[{"type":"tool_result","value":"file written"}]',
      }),
      msg({
        id: "t2",
        role: "tool",
        toolCallId: "call_resume_2",
        timestamp: 4000,
        lastEventSeq: 4,
        content: '[{"type":"tool_result","value":"file written"}]',
      }),
      // 续跑轮收尾助手消息：服务端读时把审批卡片合成到这里
      msg({
        id: "a2",
        role: "assistant",
        content: "⏸ 有工具调用正在等待你的审批",
        timestamp: 5000,
        lastEventSeq: 5,
        blocks: [
          { id: "b2", type: "text", content: "⏸ 等待审批" },
          {
            id: "inbox_1",
            type: "inbox",
            content: "",
            inboxData: {
              inboxId: "inbox_1",
              type: "approval",
              title: "工具审批: bash",
              content: "node --check game.js",
              status: "pending",
              priority: "normal",
              actions: [{ label: "批准", reply: "approve" }],
            },
          },
        ],
      }),
    ]);

    const out = h.messages();
    expect(out.map((m) => m.id)).toEqual(["u1", "t1", "t2", "a1"]);
    const merged = out[out.length - 1];
    expect(merged.lastEventSeq).toBe(5);
    expect(merged.timestamp).toBe(5000);
    expect(
      (merged.blocks ?? []).some(
        (b) =>
          b.type === "inbox" &&
          (b as { inboxData?: { status?: string } }).inboxData?.status ===
            "pending",
      ),
    ).toBe(true);
  });
});

// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * T1.1 不变量③ retry 尾部守卫测试（阶段 3）
 *
 * 守卫语义（chat-message-actions.ts M1-INV③）：仅允许重试尾部 turn；
 * 目标 assistant 之后存在后续 user/assistant 消息（新 turn）则拒绝，
 * 防止 slice(0, userMsgIdx+1) 静默截断后续正常对话。system/tool 附属消息不构成新 turn。
 *
 * - 3.1 尾部 error 可重试（放行 → set 被调）
 * - 3.2 非尾部拒绝（后续 user/assistant → set 不被调，不截断）
 * - 3.3 流式输出中忽略（isStreaming → set 不被调）
 * - 3.4 后续仅 system/tool 不误判（放行 → set 被调）
 */
import { describe, it, expect, vi } from "vitest";
import { retryFromErrorImpl } from "../chat-message-actions";

vi.mock("@/services/chatService", () => ({
  truncateMessages: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./chat-message-shared", () => ({
  removeStreamController: (c: unknown) => c,
  getHasPendingSave: () => false,
  flushSaveBlocks: async () => {},
}));

interface TestMsg {
  id: string;
  role: string;
  content?: string;
  session_id?: string;
  tool_call_id?: string;
}

function msg(id: string, role: string, content?: string): TestMsg {
  return { id, role, content: content ?? "", session_id: "sid-test" };
}

function makeGet(messages: TestMsg[], isStreaming = false) {
  return vi.fn(() => ({
    messages,
    isStreaming,
    streamControllers: {},
    streamMessage: vi.fn().mockResolvedValue(undefined),
  }));
}

describe("不变量③ retry 尾部守卫", () => {
  it("3.1 尾部 error 可重试：无后续消息 → 放行（set 被调，进入截断/发送）", async () => {
    const set = vi.fn();
    const get = makeGet([
      msg("u1", "user", "q1"),
      msg("a1", "assistant", "发生错误"),
    ]);
    await retryFromErrorImpl(set, get, "a1");
    // 守卫放行：进入截断/发送路径（set 至少被调一次）
    expect(set).toHaveBeenCalled();
  });

  it("3.2 非尾部拒绝：目标后存在新 user 消息 → 拒绝且不截断", async () => {
    const set = vi.fn();
    const get = makeGet([
      msg("u1", "user", "q1"),
      msg("a1", "assistant", "发生错误"),
      msg("u2", "user", "新的提问"),
    ]);
    await retryFromErrorImpl(set, get, "a1");
    // 守卫拒绝：set 不被调（后续对话未被截断）
    expect(set).not.toHaveBeenCalled();
  });

  it("3.3 流式输出中 → 忽略重试", async () => {
    const set = vi.fn();
    const get = makeGet(
      [msg("u1", "user", "q1"), msg("a1", "assistant", "发生错误")],
      true, // isStreaming
    );
    await retryFromErrorImpl(set, get, "a1");
    expect(set).not.toHaveBeenCalled();
  });

  it("3.4 后续仅 system/tool 附属消息 → 不误判为新区 turn，放行", async () => {
    const set = vi.fn();
    const get = makeGet([
      msg("u1", "user", "q1"),
      msg("a1", "assistant", "发生错误"),
      { id: "t1", role: "tool", tool_call_id: "tc1", session_id: "sid-test" },
      { id: "s1", role: "system", content: "附属", session_id: "sid-test" },
    ]);
    await retryFromErrorImpl(set, get, "a1");
    // system/tool 不构成新 turn → 守卫放行（set 被调）
    expect(set).toHaveBeenCalled();
  });
});

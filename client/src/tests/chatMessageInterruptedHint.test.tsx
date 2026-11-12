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
 * 2026-11-12（真机 `session_mwd9bnoyc7e3051cde`）：H-FIX-2「生成中断」兜底
 * 只看"无正文 + 有思考"，不判别轮次是否**正常收尾** ⇒ 「思考 → 调工具等审批」的正常轮次
 * 也被标成「该回复生成中断，未完成最终输出」。
 *
 * 修复判据为结构化标记（CS02）：`finishReason === 'tool_use' | 'stop'` 或
 * `terminationReason === 'awaiting_approval'` ⇒ 不得落进该兜底。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import ChatMessage from "../components/ChatArea/ChatMessage";
import type { Message } from "../types/message";

function makeMessage(over: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    role: "assistant",
    content: "",
    timestamp: Date.now(),
    session_id: "s-1",
    blocks: [{ id: "b-think", type: "thinking", content: "先跑 dir 看看目录" }],
    ...over,
  };
}

const bodyText = () => document.body.textContent ?? "";

afterEach(() => cleanup());

describe("ChatMessage — 生成中断兜底不误报正常工具轮（2026-11-12）", () => {
  it("finishReason=tool_use 的思考-only 消息 ⇒ 不显示「生成中断」", () => {
    render(<ChatMessage message={makeMessage({ finishReason: "tool_use" })} />);
    expect(bodyText()).not.toContain("生成中断");
  });

  it("terminationReason=awaiting_approval ⇒ 同样不显示「生成中断」", () => {
    render(
      <ChatMessage
        message={makeMessage({ terminationReason: "awaiting_approval" })}
      />,
    );
    expect(bodyText()).not.toContain("生成中断");
  });

  it("负向对照：无任何终态标记的思考-only 消息 ⇒ 仍显示兜底提示", () => {
    render(<ChatMessage message={makeMessage({ id: "msg-2" })} />);
    expect(bodyText()).toContain("生成中断");
  });
});

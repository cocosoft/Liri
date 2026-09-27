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
 * stripProtocolTagsInBlocks — 存量 blocks 协议标签净化守卫（2026-09-27 真机排查）
 *
 * 事实来源：会话 `你可以干嘛？`（无 events.jsonl，走 legacy 消息投影）的 assistant
 * 正文渲染出 `<think>…</think>` 与裸 `<response>`。根因是"blocks 有效即透传"分支
 * 不净化（see `chat-toolcall.slice.ts#stripProtocolTagsInBlocks` JSDoc）。
 */
import { describe, expect, it } from "vitest";
import type { MessageBlock } from "@/types";
import { stripProtocolTagsInBlocks } from "../chat-toolcall.slice";

function textBlock(content: string, id = "b1"): MessageBlock {
  return {
    id,
    type: "text",
    content,
    isStreaming: false,
    groupId: "g1",
  } as MessageBlock;
}

describe("stripProtocolTagsInBlocks", () => {
  it("整段 think + 闭合 response ⇒ 剥离标签、删 think 内容、保留正文", () => {
    const blocks = [
      textBlock(
        "<think>用户问我能力范围，先自我介绍。</think>\n\n<response>\n我是 Liri（玲珑鸟）。",
      ),
    ];
    const out = stripProtocolTagsInBlocks(blocks);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe("我是 Liri（玲珑鸟）。");
    expect(out[0].content).not.toContain("<think>");
    expect(out[0].content).not.toContain("<response>");
  });

  it("裸 <response>（无闭合）⇒ 仅删标签、内容全部保留", () => {
    const out = stripProtocolTagsInBlocks([
      textBlock("<response>\n正文第一段。"),
    ]);
    expect(out[0].content).toBe("正文第一段。");
  });

  it("无协议标签 ⇒ 返回同一数组引用（避免无谓重建触发重渲染）", () => {
    const blocks = [textBlock("普通正文，无标签。")];
    expect(stripProtocolTagsInBlocks(blocks)).toBe(blocks);
  });

  it("整块只剩标签 ⇒ 丢弃该块（不渲染空正文气泡）", () => {
    const out = stripProtocolTagsInBlocks([
      textBlock("<think>只有思考，没有正文。</think>"),
      textBlock("保留的正文。", "b2"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe("保留的正文。");
  });

  it("非 text 块（thinking / tool_call）不受影响", () => {
    const thinking = {
      id: "t1",
      type: "thinking",
      content: "<think>块内原样保留</think>",
      isStreaming: false,
    } as MessageBlock;
    const out = stripProtocolTagsInBlocks([
      thinking,
      textBlock("<response>正文</response>", "b9"),
    ]);
    expect(out[0]).toBe(thinking);
    expect(out[0].content).toContain("<think>");
    expect(out[1].content).toBe("正文");
  });
});

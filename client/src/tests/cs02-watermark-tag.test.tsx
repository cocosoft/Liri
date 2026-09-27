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
 * CS02 守卫 —— 上下文水位标签的判据必须是**结构化标记**，禁止 content 文本匹配
 *
 * 原缺陷（字符串匹配判状态，CS02）：
 * `ChatMessage` 用 `/^上下文水位/.test(tb.content)` 兜底识别水位块，而压缩进度块的 content
 * **同样以「上下文水位」开头**（后端 `streamMessageFlow` 发 `statusType: 'compaction'`）⇒
 * 压缩块被误判为水位标签，丢失「正在压缩历史...」语义；`WatermarkTag` 内再以
 * `content.includes("压缩")` 判临界 ⇒ 二次误判为红色临界态。
 *
 * 本守卫锁三条：
 *  1. `status: "compaction"` 且 content 以「上下文水位」开头的块 **不得**渲染成水位标签；
 *  2. `status: "watermark"` + `watermark` 结构化字段 ⇒ 渲染紧凑标签（含临界标记）；
 *  3. `status: "watermark"` 但缺 `watermark` 字段 ⇒ 回落渲染原始内容，**不静默丢弃**。
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import ChatMessage from "../components/ChatArea/ChatMessage";
import WatermarkTag from "../components/ChatArea/WatermarkTag";
import type { Message, MessageBlock } from "../types/message";

/** 后端压缩进度块的真实形态：content 以「上下文水位」开头，但 statusType 是 compaction */
const COMPACTION_CONTENT =
  "上下文水位 92%（180K/196K tokens），正在压缩历史...";

function makeMessage(blocks: MessageBlock[]): Message {
  return {
    id: "msg-1",
    role: "assistant",
    content: "",
    timestamp: Date.now(),
    session_id: "s-1",
    blocks,
  };
}

function block(partial: Partial<MessageBlock> & { id: string }): MessageBlock {
  return { type: "status", content: "", ...partial };
}

/**
 * 注意：状态块只在"有实质内容块"的消息里渲染（`hasMeaningfulContentBlocks` 为真才用
 * `message.blocks`），纯 status 消息会走 `buildFallbackBlocks`（不含 status）⇒
 * 每个用例都补一个 text 块，以走真实会话的渲染路径。
 */
const TEXT_BLOCK = { id: "b-text", type: "text" as const, content: "正文" };

const bodyText = () => document.body.textContent ?? "";

describe("CS02 守卫：水位标签只认结构化标记", () => {
  it("压缩进度块（content 以「上下文水位」开头，status=compaction）不得被渲染成水位标签", () => {
    render(
      <ChatMessage
        message={makeMessage([
          TEXT_BLOCK,
          block({
            id: "b-compaction",
            status: "compaction",
            phase: "compacting",
            content: COMPACTION_CONTENT,
          }),
        ])}
      />,
    );

    // 压缩语义必须可见（原缺陷会把它替换成水位标签而丢失该文案）
    expect(bodyText()).toContain("正在压缩历史");
    // 水位标签的文案形态（"上下文 92%"）不得出现
    expect(bodyText()).not.toContain("上下文 92%");
  });

  it("结构化水位块（status=watermark + watermark 字段）渲染紧凑标签与临界标记", () => {
    render(
      <ChatMessage
        message={makeMessage([
          TEXT_BLOCK,
          block({
            id: "b-watermark",
            status: "watermark",
            content: "上下文水位: 92% (180K/196K) | severity:compact",
            watermark: { pct: 92, severity: "compact" },
          }),
        ])}
      />,
    );

    expect(bodyText()).toContain("上下文 92%");
    expect(bodyText()).toContain("需压缩");
  });

  it("status=watermark 但缺 watermark 字段 ⇒ 回落渲染原始内容，不静默丢弃", () => {
    render(
      <ChatMessage
        message={makeMessage([
          TEXT_BLOCK,
          block({
            id: "b-legacy",
            status: "watermark",
            content: "上下文水位: 88% (172K/196K) | severity:warn",
          }),
        ])}
      />,
    );

    expect(bodyText()).toContain("上下文水位: 88%");
  });
});

describe("WatermarkTag：临界标记只由 severity 决定", () => {
  it("severity=warn ⇒ 不显示「需压缩」", () => {
    render(<WatermarkTag watermark={{ pct: 75, severity: "warn" }} />);
    expect(bodyText()).toContain("上下文 75%");
    expect(bodyText()).not.toContain("需压缩");
  });

  it("severity=compact ⇒ 显示「需压缩」", () => {
    render(<WatermarkTag watermark={{ pct: 92, severity: "compact" }} />);
    expect(bodyText()).toContain("上下文 92%");
    expect(bodyText()).toContain("需压缩");
  });
});

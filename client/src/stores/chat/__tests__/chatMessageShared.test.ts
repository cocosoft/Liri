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

// T1.1（2026-08-23）：dedupeToolCallBlocks 合并去重测试
import { describe, it, expect } from "vitest";
import { dedupeToolCallBlocks } from "../chat-message-shared";
import type { MessageBlock } from "@/types";

function toolBlock(
  id: string,
  args: Record<string, unknown> | undefined,
  status: string,
): MessageBlock {
  return {
    id: `blk_${id}_${Math.random().toString(36).slice(2, 8)}`,
    type: "tool_call",
    content: "tool",
    toolCall: { id, name: "tool", arguments: args, status },
    toolCallId: id,
    isStreaming: false,
    groupId: "grp_test",
  };
}

describe("dedupeToolCallBlocks — 同 toolCallId 合并去重（T1.1）", () => {
  it("无重复时原样返回（保留 tool_start 带 args + tool_end 终态 双块）", () => {
    const blocks = [toolBlock("call_1", { a: 1 }, "running")];
    expect(dedupeToolCallBlocks(blocks)).toHaveLength(1);
  });

  it("tool_start/tool_end 双 chunk 正常场景（同 id 2 块）合并为 1 块，保留终态 status + 首个非空 arguments", () => {
    const start = toolBlock("call_1", { file_path: "/tmp/a" }, "running");
    const end = toolBlock("call_1", {}, "completed");
    const result = dedupeToolCallBlocks([start, end]);
    expect(result).toHaveLength(1);
    expect(result[0].toolCall?.status).toBe("completed");
    expect(result[0].toolCall?.arguments).toEqual({ file_path: "/tmp/a" });
  });

  it("重复 4 块（2 带 args + 2 空 args）合并为 1 块，保留终态 + 首非空 arguments", () => {
    const blocks = [
      toolBlock("call_1", { file_path: "/tmp/a" }, "running"),
      toolBlock("call_1", { file_path: "/tmp/a" }, "running"),
      toolBlock("call_1", {}, "completed"),
      toolBlock("call_1", {}, "completed"),
    ];
    const result = dedupeToolCallBlocks(blocks);
    expect(result).toHaveLength(1);
    expect(result[0].toolCall?.status).toBe("completed");
    expect(result[0].toolCall?.arguments).toEqual({ file_path: "/tmp/a" });
  });

  it("不同 toolCallId 的块互不影响", () => {
    const blocks = [
      toolBlock("call_1", { a: 1 }, "completed"),
      toolBlock("call_2", { b: 2 }, "completed"),
    ];
    const result = dedupeToolCallBlocks(blocks);
    expect(result).toHaveLength(2);
  });

  it("非 tool_call 块原样保留（顺序不变）", () => {
    const text: MessageBlock = {
      id: "blk_text",
      type: "text",
      content: "正文",
      isStreaming: false,
    };
    const start = toolBlock("call_1", { a: 1 }, "running");
    const end = toolBlock("call_1", {}, "completed");
    const result = dedupeToolCallBlocks([text, start, end]);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("text");
    expect(result[1].toolCall?.status).toBe("completed");
  });
});

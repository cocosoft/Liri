// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 会话日志失败工具 error 字段提取测试（vitest 版本）
 *
 * 验证 tool_end 失败块携带的 error 能经 extractToolCalls 合并补齐，
 * extractError 返回真实失败原因而非"未知错误"。
 */
import { describe, it, expect } from "vitest";
import { extractToolCalls, extractError } from "@/utils/sessionLog";
import type { Message, ToolCall } from "@/types";

function asstWithBlocks(blocks: Array<Record<string, unknown>>): Message {
  return {
    id: "m1",
    role: "assistant",
    content: "",
    timestamp: Date.now(),
    blocks: blocks as unknown as Message["blocks"],
  } as Message;
}

describe("extractToolCalls — 失败工具 error 字段", () => {
  it("blocks 中失败工具携带 error，记录可提取真实失败原因", () => {
    const failedToolCall: ToolCall = {
      id: "tc-1",
      name: "read_file",
      arguments: { path: "/nonexistent" },
      status: "failed",
      error: "文件不存在: /nonexistent",
    };
    const records = extractToolCalls([
      asstWithBlocks([{ type: "tool_call", toolCall: failedToolCall }]),
    ]);

    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("failed");
    expect(records[0].error).toBe("文件不存在: /nonexistent");
    // extractError 应返回真实错误而非"未知错误"
    expect(extractError(records[0])).toBe("文件不存在: /nonexistent");
  });

  it("消息级 tool_calls 无 error，blocks 失败块合并补齐 error", () => {
    const msgToolCalls = [
      { id: "tc-2", name: "shell", arguments: {}, status: "running" },
    ] as ToolCall[];
    const blocksToolCall: ToolCall = {
      id: "tc-2",
      name: "shell",
      arguments: {},
      status: "failed",
      error: "命令执行失败: exit 1",
    };

    // 仅消息级 tool_calls（无 error）
    const records = extractToolCalls([
      {
        id: "m1",
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        tool_calls: msgToolCalls,
      } as Message,
    ]);
    expect(records[0].error).toBeUndefined();

    // 消息级 + blocks 失败块 → 合并补齐 error
    const merged = extractToolCalls([
      {
        id: "m1",
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        tool_calls: msgToolCalls,
        blocks: [{ type: "tool_call", toolCall: blocksToolCall }],
      } as unknown as Message,
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].error).toBe("命令执行失败: exit 1");
    expect(extractError(merged[0])).toBe("命令执行失败: exit 1");
  });

  it("无 error 的失败工具回退到 result 提取或未知错误", () => {
    const records = extractToolCalls([
      asstWithBlocks([
        {
          type: "tool_call",
          toolCall: { id: "tc-3", name: "x", arguments: {}, status: "failed" },
        },
      ]),
    ]);
    expect(records[0].error).toBeUndefined();
    expect(extractError(records[0])).toBe("未知错误");

    const withErrResult = extractToolCalls([
      asstWithBlocks([
        {
          type: "tool_call",
          toolCall: {
            id: "tc-4",
            name: "x",
            arguments: {},
            status: "failed",
            result: { error: "result 中的错误" },
          },
        },
      ]),
    ]);
    expect(extractError(withErrResult[0])).toBe("result 中的错误");
  });

  it("成功工具不携带 error", () => {
    const records = extractToolCalls([
      asstWithBlocks([
        {
          type: "tool_call",
          toolCall: {
            id: "tc-5",
            name: "x",
            arguments: {},
            status: "completed",
            result: "ok",
          },
        },
      ]),
    ]);
    expect(records[0].error).toBeUndefined();
  });
});

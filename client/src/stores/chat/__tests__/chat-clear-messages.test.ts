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
 * clearMessages 清空文件列表回归测试（会话系统排查 2026-09-04）
 *
 * 守护的修复：新建会话只走 clearMessages（不调 setMessages），原实现仅清空
 * messages/error/errorCode，右侧文件列表（sessionFiles）残留上一会话文件。
 * 修复后 clearMessages 与 setMessages 的"文件随消息重建"语义对齐，
 * 同步清空 sessionFiles / previewFile / pendingPreview。
 */
import { describe, it, expect } from "vitest";
import { create } from "zustand";
import type { MessageSlice } from "../chat-message.types";
import { createMessageSlice } from "../chat-message.slice";
import {
  createFileSlice,
  type FileSlice,
} from "../chat-file.slice";

type ChatState = MessageSlice & FileSlice;
const useTestChatStore = create<ChatState>()((...a) => ({
  ...createMessageSlice(...a),
  ...createFileSlice(...a),
}));

describe("clearMessages 清空文件列表", () => {
  it("清空消息时同步清空 sessionFiles / previewFile / pendingPreview", () => {
    useTestChatStore.setState({
      messages: [
        {
          id: "m1",
          role: "assistant" as const,
          content: "生成的文件如下",
          timestamp: 1,
          session_id: "sess-old",
        },
      ],
      error: "旧错误",
      sessionFiles: [
        {
          path: "/tmp/report.md",
          name: "report.md",
          content: "",
          type: "markdown",
        },
      ],
      previewFile: {
        path: "/tmp/report.md",
        name: "report.md",
        content: "# 内容",
        type: "markdown",
      },
      pendingPreview: "/tmp/report.md",
    });

    useTestChatStore.getState().clearMessages();

    const state = useTestChatStore.getState();
    expect(state.messages).toEqual([]);
    expect(state.error).toBeNull();
    expect(state.sessionFiles).toEqual([]);
    expect(state.previewFile).toBeNull();
    expect(state.pendingPreview).toBeUndefined();
  });
});

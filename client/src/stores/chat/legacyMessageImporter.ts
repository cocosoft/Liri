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
 * legacyMessageImporter — 旧 messages.jsonl 格式导入器
 *
 * M2 双轨兼容期：当 events.jsonl 不存在或迁移失败时，回退到旧 getMessages
 * 路径，由本模块封装现有 rebuildBlocksFromContent 逻辑。
 *
 * 职责边界：
 *  - 仅在 events 不可用时调用
 *  - 不引入新逻辑，仅封装现有 rebuildBlocksFromContent + ensureTextBlockFromContent
 *  - M3 全量迁移后可整体删除
 */

import type { Message, MessageBlock } from "@/types";
import {
  rebuildBlocksFromContent,
  ensureTextBlockFromContent,
  hasMeaningfulContentBlocks,
} from "./chat-toolcall.slice";

/**
 * 从旧 Message[]（含 content + blocks 双份数据）派生渲染用 Message[]
 *
 * 与 setMessagesImpl 中 Phase 3 的逻辑等价：
 *  - blocks 有效 → 直接使用 + ensureTextBlockFromContent 兜底
 *  - blocks 无效 → rebuildBlocksFromContent 从 content 反推
 *
 * @param messages 旧格式消息（来自 GET /v1/sessions/:id/messages）
 * @returns 渲染就绪的消息（blocks 已规整）
 */
export function importLegacyMessages(messages: Message[]): Message[] {
  return messages.map((msg) => {
    if (msg.role !== "assistant") return msg;

    // 守卫：blocks 非空且含实际内容块 → 直接使用
    if (
      Array.isArray(msg.blocks) &&
      msg.blocks.length > 0 &&
      hasMeaningfulContentBlocks(msg.blocks)
    ) {
      const normalizedBlocks: MessageBlock[] = msg.blocks.map((b) => ({
        ...b,
        isStreaming: false,
      }));
      return {
        ...msg,
        blocks: ensureTextBlockFromContent(normalizedBlocks, {
          content: msg.content,
        }),
      };
    }

    // blocks 无效 → 从 content 反推
    const newBlocks = rebuildBlocksFromContent(msg);
    return { ...msg, blocks: newBlocks, tool_calls: undefined };
  });
}

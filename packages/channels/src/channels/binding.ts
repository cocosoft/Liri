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
 * 渠道绑定（2026-11-11）：从**本轮入站元数据**提取「审批项要回传渠道」所需的最小事实。
 *
 * 背景：`inbox_items.channel_id` / `channel_session_id` / `trace_id` 此前没有任何生产写入方
 * （真机库实测 171 条全为空）⇒ `relayReplyToChannel` 无触发源、IM 文本审批也找不到待办。
 * 本函数是**写入侧的唯一提取点**：渠道轮次把它们写进 `session.metadata.channelBinding`，
 * 再由宿主注入的 resolver（`setInboxChannelResolver`）在 Inbox 提交时补齐空字段。
 *
 * 口径：只取**非空字符串**；全空 ⇒ `undefined`（不臆造来源，CS03）。
 */
import type { InboxChannelBinding } from '@openliri/service/runtime/InboxManager';

export function pickChannelBinding(
  meta: Record<string, unknown> | undefined
): InboxChannelBinding | undefined {
  if (!meta) return undefined;
  const pick = (key: string): string | undefined => {
    const value = meta[key];
    return typeof value === 'string' && value.trim().length > 0
      ? value
      : undefined;
  };
  const binding: InboxChannelBinding = {
    channelId: pick('channel'),
    channelSessionId: pick('channelSessionId'),
    channelConversationId: pick('channelConversationId'),
    traceId: pick('traceId'),
  };
  return Object.values(binding).some(Boolean) ? binding : undefined;
}

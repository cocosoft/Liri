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
 * 「编辑并另存为分支」的 fork 边界解析（`SessionGateway.forkSession` 的实现）
 *
 * 由 `session/SessionGateway.ts` 外迁（与 `LiteSessionLister` / `GatewayFtsIndex` 同批，
 * 见 `.trae/specs/file-size-debt-partition-plan.md`；本次为 R04-001 文件行数门禁）。
 *
 * ⚠️ **只搬不改**：解析判据逐字保留。
 */

import type { LiriEvent } from '@modules/session/types/events.js';

/**
 * 「编辑并另存为分支」：在**源会话事件**上把 messageId 解析为 fork 边界。
 *
 * 语义：只保留该消息**之前**的历史 ⇒ 边界取「该消息首个事件 seq 之前、**最后一个已闭合轮次**
 * 的 `turn/end` seq」。
 *
 * 为什么必须退到 `turn/end`（而非 `firstSeq - 1`）：
 *   ① `fork` 的前缀恒须"轮次闭合"（未闭合 turn 会被 `findOpenTurn` 拒绝）；
 *   ② 真机事件布局实测为 `user/message → … → turn/start → assistant/* → turn/end`
 *      （用户消息**先于**本轮 `turn/start` 落盘）⇒ 恒存在"本轮 `turn/start` 落在边界内、
 *      而 `turn/end` 不在"的窗口，取 `turn/end` 才是**结构性**安全。
 *
 * 为什么不交给客户端算（沿革）：客户端 `lastEventSeq` 常为 `null`，`withPaginationSeq`
 * 合成的序号是**消息分页游标**语义而**非事件 seq**，写盘 tail 戳还可能落在未闭合 turn 内
 * ⇒ 真机两次被打回。边界只能由后端在源会话上解析。
 *
 * @returns 边界 seq；`0` = 该消息之前无已闭合轮次（首轮 ⇒ 等价空分支）；
 *          `null` = 事件中找不到该消息（纯投影的存量会话等，无法可信解析）
 */
export function resolveBoundaryBeforeMessage(
  events: LiriEvent[],
  messageId: string
): number | null {
  let firstSeq: number | null = null;
  for (const e of events) {
    const mid = (e.data as { messageId?: unknown } | undefined)?.messageId;
    if (typeof mid === 'string' && mid === messageId) {
      firstSeq = firstSeq === null ? e.seq : Math.min(firstSeq, e.seq);
    }
  }
  if (firstSeq === null) return null;

  let boundary = 0;
  for (const e of events) {
    if (e.seq >= firstSeq) break;
    if (e.type === 'turn/end') boundary = e.seq;
  }
  return boundary;
}

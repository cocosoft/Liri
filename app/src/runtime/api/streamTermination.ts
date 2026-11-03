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
 * streamTermination.ts — 把「主循环终止判定」从出口消息带到流末块（2026-11-03 P1）。
 *
 * 事实来源：`ChatStreamFinalize.finalize()` 把 `terminationReason` 挂到**出口消息**的
 * `metadata`（与 `turn/end.terminationReason` 同源）。本函数只做**读取 + 形状收敛**
 * （缺失 / 非字符串 ⇒ 空对象，不臆造），供 `CoreAPIImpl.chatStream` 在 done chunk 上
 * 展开使用 —— 前端据此在当轮消息内显示「为什么停下」，不必等刷新后的事件回放。
 *
 * 为什么单独成文件：`CoreAPIImpl.ts` 已逼近 R04-001 的 2000 行上限，按该规则要求
 * 拆到子目录文件，而不是继续堆在入口类里。
 */
export function terminationReasonField(message: unknown): {
  terminationReason?: string;
} {
  const raw = (message as { metadata?: Record<string, unknown> } | undefined)
    ?.metadata?.['terminationReason'];
  return typeof raw === 'string' && raw ? { terminationReason: raw } : {};
}

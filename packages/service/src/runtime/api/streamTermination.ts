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

/**
 * 解析 `chatStream` 出口的 `finishReason`（2026-10-17，真机缺陷修复；2026-11-06 外移至本文件）。
 *
 * **为什么需要**：骨架把「终止原因」的**单一来源**落在消息的 `metadata.finishReason`
 * （`ReActToolLoop.computeFinalMessage` ← `resolveTerminationOutput`），而消息**顶层**的
 * `finishReason` 只承载 provider 末次响应的原值。此前这里**只读顶层** ⇒ 终止原因在 CoreAPI
 * 出口被降级成 `stop`：
 * - 真机证据（2026-10-17 09:53，QQ）：`reActLoop:daily_budget_exhausted` +
 *   `budgetSuspend:suspended` 均已成立，但 `chatStream:完成` 报 `finishReason:"stop"` ⇒
 *   通道侧判据 `finishReason === 'budget_exhausted'` **永不成立** ⇒ **不发预算挂起卡片**
 *   （`CHANNEL-BUDGET-INLINE-RELIEF` 的整条通道放行入口在真机上不可达）。
 *
 * 优先级：失败 ⇒ `error`（AB-3：禁止用 `stop` 掩盖失败）> 空输出兜底 ⇒ `empty_output`
 * （N-2，2026-11-06）> 顶层值（provider 语义）> `metadata.finishReason`（骨架终止原因）
 * > `stop`（兜底）。
 *
 * 外移原因：`CoreAPIImpl.ts` 逼近 R04-001 的 2000 行上限（与该文件 `terminationReasonField`
 * 同源职责，本就该在一处）。
 */
export function resolveStreamFinishReason(input: {
  streamFailed: boolean;
  topLevelFinishReason?: string;
  metadata?: Record<string, unknown>;
}): string {
  if (input.streamFailed) return 'error';
  // N-2（2026-11-06 真机长程任务）：本轮以「空输出兜底」收尾 ⇒ 这轮**什么都没产出**，
  // 不能被出口降级成 `stop`（下游按 stop 判为正常完成）。实测（`session_mw4vwtmp38957bec2f`）
  // 两次长程任务都以此收尾，而出口一律报 `finishReason:"stop"`。
  // 结构化标记优先于 provider 顶层值（顶层 `stop` 只说明"模型正常停止说话"，不是"任务完成"）。
  if (input.metadata?.['emptyOutputFallback'] === true) return 'empty_output';
  if (input.topLevelFinishReason) return input.topLevelFinishReason;
  const fromMeta = input.metadata?.['finishReason'];
  if (typeof fromMeta === 'string' && fromMeta) return fromMeta;
  return 'stop';
}

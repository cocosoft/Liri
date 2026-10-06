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
 * U4 历史会话补评：**会话扫描排序**（纯函数）。
 *
 * 规格：`.trae/specs/online-quality-evaluation.md` §7 步骤 6 的遗留项
 * —— 空闲期质量评估原先只覆盖**本进程已加载**的会话（`host.chatSessions`），
 * 磁盘上更早的会话永不评分；本模块与 `ChatManager.listRecentSessionIds` 一起补齐该覆盖。
 *
 * 排序口径（与消费方同源）：**按 `updatedAt` 降序取最近 N 个** ——
 * 梦境侧的会话来源本就是"最近被触碰的会话"（`listSessionsTouchedSince`），
 * 故无需（也不应）为"很久没动过的会话"付费读事件。
 *
 * 时间归一化（必要而非防御性）：会话存储的 `updatedAt` 在不同网关实现下可能是
 * epoch 毫秒数或 ISO 字符串 —— 解析不出的一律排到**最后**（不猜、不当作"最旧"丢弃，
 * 只是不优先）。
 */

/** 会话扫描记录（`listSessions()` 结果的最小投影） */
export interface SessionScanRecord {
  id: string;
  /** epoch 毫秒数或 ISO 字符串；解析不出 ⇒ 排最后 */
  updatedAt: unknown;
}

/** 把 `updatedAt` 归一为可比较的毫秒数；解析不出 ⇒ `-Infinity`（排最后） */
function toEpochMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NEGATIVE_INFINITY;
}

/**
 * 取**最近更新**的会话 id（按 `updatedAt` 降序、去重、截断到 `limit`）。
 *
 * @param records - 会话记录（来自 `SessionGateway.listSessions()`）
 * @param limit - 最多返回多少个（成本护栏，由调用方给定）
 */
export function rankRecentSessionIds(
  records: readonly SessionScanRecord[],
  limit: number
): string[] {
  if (limit <= 0) return [];
  const ranked = records
    .map((r) => ({ id: r.id, at: toEpochMs(r.updatedAt) }))
    .sort((a, b) => b.at - a.at);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of ranked) {
    if (!r.id || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r.id);
    if (out.length >= limit) break;
  }
  return out;
}

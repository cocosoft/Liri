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
 * P1-6b（2026-09-27，Spec §10）：分页键归一化 —— 为缺失 `lastEventSeq` 的条目按
 * **最终数组顺序**回填单调序号。
 *
 * 背景（真机取证，会话 `session_mtw7nr44dkgini0x0a5`）：全量 709 条中**仅 16 条**带
 * `lastEventSeq`（事件序号，本例 326…5377），其余缺失者的分页键退化为 `timestamp`
 * （epoch 毫秒，1.7e12 量级）。两种量纲混比会让 `key(m) <= before` 过滤**恒真**
 * （每页都返回同一批尾部消息、`hasMore` 恒 true，前端 id 去重后"点了没反应"）；
 * 且前端游标只读 `messages[0].lastEventSeq` ⇒ 尾页首条缺该字段时游标为 `null`，
 * 「加载更早」彻底不可用。
 *
 * 修法：按传入数组的**权威顺序**（派生/投影顺序）为缺失者赋 `runningMax + 1`，
 * 使整列键非递减；每页首条因此恒有键，前端游标恢复可用。
 *
 * **不修改入参**：仅对需要回填的条目返回浅拷贝（派生结果可能来自缓存、与调用方共享
 * 引用，就地改写会污染缓存）；无需回填时原样返回入参（零额外开销）。
 *
 * @param list 已按权威顺序排好的消息列表
 * @returns 键列非递减的列表（可能为原引用）
 */
export function withPaginationSeq<T extends { lastEventSeq?: number }>(
  list: T[]
): T[] {
  let runningMax = 0;
  let changed = false;
  const out = list.map((m) => {
    const seq =
      typeof m.lastEventSeq === 'number' && Number.isFinite(m.lastEventSeq)
        ? m.lastEventSeq
        : null;
    if (seq == null) {
      changed = true;
      // 严格大于前驱（含真实键的最大值）⇒ 不制造逆序，也不与真实序号相等
      runningMax += 1;
      return { ...m, lastEventSeq: runningMax };
    }
    if (seq > runningMax) runningMax = seq;
    return m;
  });
  return changed ? out : list;
}

/**
 * 2026-10-19（真机排查）：把分页窗口起点**向前对齐到最近一条 `user` 消息**。
 *
 * 背景（实证会话 `session_mve0gkth422d248037`，1341 条 / 946 次工具调用）：原实现按
 * 条数硬切 `slice(len - limit)`，长会话末页 30 条**全是工具结果与助手续写、没有任何
 * user 消息** ⇒ 首屏看不到提问；工具结果与其 assistant `tool_call` 被切在页边界两侧，
 * 前端出现 6 条"孤儿工具结果"（N-48 可见性策略把它们当历史孤儿渲染）+ 顺序归一化告警。
 *
 * 对齐后每页都从一轮的起点开始（页长最多扩到 2×limit）；回看到上限仍未找到 user
 * （单轮超长工具循环）⇒ 原样返回，由前端按"页内首条 user 之前一律视为边界残片"兜底。
 *
 * @param list 已按权威顺序排好的消息列表
 * @param start 按条数切出的页首下标
 * @param lookback 最多向前回看多少条（通常传 limit）
 * @returns 对齐后的页首下标（无需/无法对齐时返回入参）
 */
export function alignPageStartToTurn<T extends { role?: string }>(
  list: T[],
  start: number,
  lookback: number
): number {
  if (start <= 0 || lookback <= 0) return start;
  const minStart = Math.max(0, start - lookback);
  for (let i = start - 1; i >= minStart; i--) {
    if (list[i]?.role === 'user') return i;
  }
  return start;
}

/**
 * #27（2026-10-30）：按**可见条目**（非 `tool` 消息）倒推分页窗口起点。
 *
 * 背景（真机 `session_mvquoj3z9ce98e6845`）：`limit=30` 返回的 30 条里 27 条是工具记录，
 * 首屏只看到 1 条对话 —— 分页预算按"消息条数"计，而工具记录被前端折叠进 assistant 的
 * 工具块、**不占可见空间**。此处把预算改成"可见条目数"：
 *
 *   1. 从尾部向前数**非 `tool`** 条目，数到 `maxVisible` 条时把该条作为页首；
 *   2. 若页长超过 `hardCap`（行数硬上限，防工具密集会话返回超大响应）⇒ 回退到行数窗口；
 *   3. 最后按 `alignPageStartToTurn()` 对齐到最近一条 `user`（保持整轮不被切断）。
 *
 * 数不满 `maxVisible`（会话更短）⇒ 返回 0（全量）。
 *
 * @param list 已按权威顺序排好的消息列表
 * @param maxVisible 可见条目预算（<=0 ⇒ 不启用，返回 0）
 * @param options.hardCap 行数硬上限（<=0 ⇒ 不限）
 * @param options.alignLookback 轮次对齐回看窗口（缺省 `max(hardCap, maxVisible*4)`）
 * @returns 页首下标（0 = 全部）
 */
export function selectVisiblePageStart<T extends { role?: string }>(
  list: readonly T[],
  maxVisible: number,
  options: { hardCap?: number; alignLookback?: number } = {}
): number {
  const len = list.length;
  if (maxVisible <= 0 || len === 0) return 0;

  let start = 0;
  let visible = 0;
  for (let i = len - 1; i >= 0; i--) {
    if (String(list[i]?.role ?? '').toLowerCase() !== 'tool') visible++;
    if (visible >= maxVisible) {
      start = i;
      break;
    }
  }

  const hardCap = options.hardCap ?? 0;
  if (hardCap > 0 && len - start > hardCap) start = len - hardCap;

  const lookback = options.alignLookback ?? Math.max(hardCap, maxVisible * 4);
  // 页首已经是 user ⇒ 本来就落在轮首，无需再向前扩（否则会多带一整轮、超出可见预算）
  const atTurnStart = String(list[start]?.role ?? '').toLowerCase() === 'user';
  const aligned = atTurnStart
    ? start
    : alignPageStartToTurn(list as T[], start, lookback);
  // 硬上限优先：轮次对齐会向前扩窗口，若因此超限 ⇒ 退回纯行数窗口（不再对齐），
  // 保证工具极密集会话的响应体有界（页首可能落在轮中，由前端按页边界残片兜底）。
  if (hardCap > 0 && len - aligned > hardCap) return len - hardCap;
  return aligned;
}

/**
 * C1（2026-10-30，一致性核查）：把分页窗口起点**扩到整轮**，并保证首屏至少覆盖最近 N 轮。
 *
 * 背景（真机 `session_mvquoj3z9ce98e6845`，`limit=30&maxVisible=10`）：单轮 57 条工具记录
 * 撑满 `hardCap=60` ⇒ `selectVisiblePageStart()` 退回纯行数窗口（`len-60`），首屏只剩
 * 3 条可见（1 user + 2 assistant），且"恰好整轮"只是巧合；一旦该轮跨过边界，页首就落在
 * **轮中**（前端只能按残片渲染）。
 *
 * 规则（顺序执行）：
 *  ① **不切半轮**：页首不是 `user` ⇒ 回退到该轮 `user` 处（上界 `completeRoundMaxRows`：
 *     "看到完整一轮"优先于行数预算 —— 自主执行会话常见一轮 200+ 条工具记录）；
 *  ② **至少 `minRounds` 轮**：窗口内 `user` 条数不足 ⇒ 继续向前补整轮（上界 `maxRows`）；
 *  ③ 任一步会让窗口超过对应上界 ⇒ 停止（响应体有界，宁可少一轮）。
 *
 * @param list 已按权威顺序排好的消息列表
 * @param start `selectVisiblePageStart()` 等给出的候选页首
 * @param options.minRounds 首屏至少覆盖的轮数（缺省 2）
 * @param options.maxRows 补轮的行数上界（缺省不限制）
 * @param options.completeRoundMaxRows "补齐当前轮"的行数上界（缺省同 `maxRows`）
 * @returns 扩窗后的页首下标（无法安全扩展时返回入参）
 */
export function extendPageStartToWholeRounds<T extends { role?: string }>(
  list: readonly T[],
  start: number,
  options: {
    minRounds?: number;
    maxRows?: number;
    completeRoundMaxRows?: number;
  } = {}
): number {
  const len = list.length;
  if (start <= 0 || start >= len) return start <= 0 ? 0 : start;
  const minRounds = Math.max(1, options.minRounds ?? 2);
  const maxRows = options.maxRows ?? len;
  const completeRoundMaxRows = options.completeRoundMaxRows ?? maxRows;
  const isUser = (i: number) =>
    String(list[i]?.role ?? '').toLowerCase() === 'user';
  const prevUser = (from: number): number => {
    for (let i = from - 1; i >= 0; i--) if (isUser(i)) return i;
    return -1;
  };

  let next = start;
  // ① 不切半轮
  if (!isUser(next)) {
    const aligned = prevUser(next);
    if (aligned >= 0 && len - aligned <= completeRoundMaxRows) next = aligned;
  }

  // ② 至少 minRounds 轮（缺一轮就向前补一轮，受 maxRows 约束）
  let rounds = 0;
  for (let i = next; i < len; i++) if (isUser(i)) rounds++;
  while (rounds < minRounds) {
    const prev = prevUser(next);
    if (prev < 0 || len - prev > maxRows) break;
    next = prev;
    rounds++;
  }
  return next;
}

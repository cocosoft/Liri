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
 * fork 前置的**源会话**解析与校验（`SessionGateway.forkSession` 的实现）。
 *
 * 内容：① 边界解析（`resolveBoundaryBeforeMessage`）② 未闭合轮次校验（`findOpenTurnInPrefix`）
 * ③ 前缀逐条同构校验（`comparePrefixIsomorphic`）。三者都需要"读到某个 seq 为止的**完整**前缀"。
 *
 * 由 `session/SessionGateway.ts` 外迁（与 `LiteSessionLister` / `GatewayFtsIndex` 同批惯例，
 * 见 `.trae/specs/file-size-debt-partition-plan.md`；本次为 R04-001 文件行数门禁）。
 *
 * ⚠️ **为什么必须分页读（2026-10-16 根因修复）**：`EventLogStorage.read()` 的
 * `limit` 缺省为 **1000**（内部夹取到 ≤10000）。原实现用无参 `read()` 拿到的**截断窗口**
 * 做上述三项校验，而 `boundary` 用的是真实 `tailSeq` ⇒ 事件数 >1000 的会话上：
 *   - 「未闭合轮次」会**误报**（窗口尾部把某个 turn/start 之后真正的 turn/end 切掉了）；
 *   - 「边界解析」会**漏检**（目标消息落在窗口之外 ⇒ 误判"消息不在事件日志中"）。
 * 真机双探针（`sess_001` / `session_muwdzb4ei28xb3eqad`）已逐字实证，详见台账
 * `FORK-PREFIX-WINDOW`。⇒ 本模块**一律按页读取到目标 seq**（页大小可控、内存不随会话增长）。
 */

import type { LiriEvent } from '@modules/session/types/events.js';
import type { EventLogStorage } from '../storage/EventLogStorage.js';

/** 单页事件上限（`read` 内部还会夹到 ≤10000；取更小页避免瞬时膨胀，内存不随会话增长） */
const PREFIX_PAGE = 2000;

/** 惰性遍历 `[1..toSeq]` 事件（升序；逐页读取，避免 `read()` 缺省 1000 条窗口截断） */
async function* iterEvents(
  log: EventLogStorage,
  toSeq: number
): AsyncGenerator<LiriEvent> {
  let from = 1;
  while (from <= toSeq) {
    const page = await log.read({ fromSeq: from, toSeq, limit: PREFIX_PAGE });
    if (page.length === 0) return;
    for (const e of page) yield e;
    const lastSeq = page[page.length - 1].seq;
    if (page.length < PREFIX_PAGE || lastSeq >= toSeq) return;
    from = lastSeq + 1;
  }
}

/**
 * 「编辑并另存为分支」：在**源会话事件**上把 messageId 解析为 fork 边界。
 *
 * 语义：只保留该消息**之前**的历史 ⇒ 边界取「该消息首个事件 seq 之前、**最后一个已闭合轮次**
 * 的 `turn/end` seq」。
 *
 * 为什么必须退到 `turn/end`（而非 `firstSeq - 1`）：
 *   ① `fork` 的前缀恒须"轮次闭合"（未闭合 turn 会被 `findOpenTurnInPrefix` 拒绝）；
 *   ② 真机事件布局实测为 `user/message → … → turn/start → assistant/* → turn/end`
 *      （用户消息**先于**本轮 `turn/start` 落盘）⇒ 恒存在"本轮 `turn/start` 落在边界内、
 *      而 `turn/end` 不在"的窗口，取 `turn/end` 才是**结构性**安全。
 *
 * 为什么不交给客户端算（沿革）：客户端 `lastEventSeq` 常为 `null`，`withPaginationSeq`
 * 合成的序号是**消息分页游标**语义而**非事件 seq**，写盘 tail 戳还可能落在未闭合 turn 内
 * ⇒ 真机两次被打回。边界只能由后端在源会话上解析。
 *
 * @returns 边界 seq；`0` = 该消息之前无已闭合轮次（首轮 ⇒ 等价空分支）；
 *          `null` = 事件中（**全量**，非 1000 窗口）找不到该消息，无法可信解析
 */
export async function resolveBoundaryBeforeMessage(
  log: EventLogStorage,
  messageId: string
): Promise<number | null> {
  let firstSeq: number | null = null;
  let boundary = 0;
  const tailSeq = await log.getTailSeq();
  for await (const e of iterEvents(log, tailSeq)) {
    const mid = (e.data as { messageId?: unknown } | undefined)?.messageId;
    if (typeof mid === 'string' && mid === messageId) {
      // 页内升序 ⇒ 首个命中即最小 seq；此时 `boundary` 已是"其之前最后一个 turn/end"
      firstSeq = e.seq;
      break;
    }
    if (e.type === 'turn/end') boundary = e.seq;
  }
  if (firstSeq === null) return null;
  return boundary;
}

/**
 * D3（2026-08-24）：检测 `[1..boundary]` 内是否存在未闭合 turn。
 *
 * 用栈配对（`turn/end` 与最近的 `turn/start` 匹配），对齐 deepseek-harness OPEN_TURN 拒绝。
 * ⚠️ 配对只看**顺序**、不看 `data.turn` 编号（编号可能因崩溃恢复合成 closers 而错位）。
 *
 * @returns 最后一个未闭合的 turn/start；全部闭合返回 null
 */
export async function findOpenTurnInPrefix(
  log: EventLogStorage,
  boundary: number
): Promise<{ seq: number; turn?: unknown } | null> {
  const stack: { seq: number; turn?: unknown }[] = [];
  for await (const e of iterEvents(log, boundary)) {
    if (e.type === 'turn/start') {
      const data = e.data as { turn?: unknown } | undefined;
      stack.push({ seq: e.seq, turn: data?.turn });
    } else if (e.type === 'turn/end') {
      stack.pop();
    }
  }
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

/**
 * P1-10（B 判据）：前缀**逐条同构**校验。
 *
 * `copyPrefixTo` 走"原始行直拷"（不做 JSON 重序列化）⇒ 两侧解析出的对象应**严格相等**；
 * 任何差异（缺条 / 多出 / seq 漂移 / 内容漂移）都判否。
 *
 * 为什么不能只看"上界一致"（A 判据）：seq 连续但**内容不同**（例如源被并发改写、
 * 或复制中途落盘异常）在只看 `maxCopiedSeq` 时无法发现。
 *
 * 2026-10-16：改为**两侧惰性游标逐条比对**（原实现先各读一份窗口数组 ⇒ 双侧同样被截到
 * 1000 条，长前缀下"比较"退化为对截断片段的自比 ⇒ 校验事实上失效）。
 */
export async function comparePrefixIsomorphic(
  sourceLog: EventLogStorage,
  childLog: EventLogStorage,
  boundary: number
): Promise<{ ok: boolean; detail?: string }> {
  const src = iterEvents(sourceLog, boundary);
  const dst = iterEvents(childLog, boundary);
  let i = 0;
  for (;;) {
    const a = await src.next();
    const b = await dst.next();
    if (a.done && b.done) return { ok: true };
    if (a.done || b.done) {
      return {
        ok: false,
        detail: `${a.done ? 'source' : 'child'} ended early at index ${i}`,
      };
    }
    const x = a.value;
    const y = b.value;
    if (x.seq !== y.seq) {
      return { ok: false, detail: `seq[${i}] ${y.seq} != ${x.seq}` };
    }
    if (x.type !== y.type) {
      return { ok: false, detail: `type[${i}] ${y.type} != ${x.type}` };
    }
    if (JSON.stringify(x.data) !== JSON.stringify(y.data)) {
      return { ok: false, detail: `data[${i}] mismatch (seq=${x.seq})` };
    }
    i++;
  }
}

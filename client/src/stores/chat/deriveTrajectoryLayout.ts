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
 * 轨迹布局派生 — 纯函数
 *
 * 输入：LiriEvent[]（按 seq 升序）
 * 输出：Turn[] 分组，每个 Turn 含 Step[]，每个 Step 含 Cell[]
 *
 * 设计参考：deepseek-harness packages/client/ui-trajectory/src/client/layout.ts
 *  - Turn → Step → Cell 三层结构
 *
 * 纯函数保证：相同输入必得相同输出，可重放、可单测、可在 Worker 中执行。
 *
 * M2/M3（2026-09-22 已实现，取代 M1 的"每事件一 Step"）：
 *   - **M2**：相邻的 thinking / text（含 text-batch）合并为**一个 Step**（多 cell）
 *   - **M3**：assistant/tool_call 与对应 tool/result（含 canceled）按 **toolCallId** 配对为
 *     **一个 Step**；未配对的 result **安全退化**为独立 Step（不丢弃、不崩溃）
 */

import type { LiriEvent } from "@/types";

// ─── 输出类型 ───────────────────────────────────

export interface TrajectoryCell {
  event: LiriEvent;
  /** 同一 Step 内的列位置：user/* → 左；其余 → 右 */
  column: "left" | "right";
}

export interface TrajectoryStep {
  cells: TrajectoryCell[];
  startTime: number;
  endTime: number;
}

export interface TrajectoryTurn {
  turn: number;
  startSeq: number;
  endSeq: number;
  steps: TrajectoryStep[];
  eventCount: number;
  /** Turn 是否完成（有 turn/end 事件） */
  completed: boolean;
  /** Turn 是否被中断（有 turn/start 但无 turn/end，且后续无更多事件） */
  interrupted: boolean;
}

export interface TrajectoryLayout {
  turns: TrajectoryTurn[];
  /** 不属于任何 Turn 的事件（如 session/start、孤立的 tool/result） */
  orphanEvents: LiriEvent[];
  totalCount: number;
  tailSeq: number;
  /**
   * 因**关联编号 / ID 非法或缺失**而安全退化的事件数（P2-7，2026-09-22）。
   * 这些事件不会进入任何 Turn/Step 的关联逻辑，但仍保留在 `orphanEvents` 中（**不丢弃**）。
   */
  degradedAssocIds: number;
}

// ─── 派生函数 ───────────────────────────────────

/**
 * M2（2026-09-22）：参与"对话流合并"的事件类型。
 *
 * 相邻的思考与正文属**同一次模型输出**的不同片段（`thinking` / `text` / 聚合批
 * `text-batch`）⇒ 合并为**一个 Step**、多 cell 并列展示（不再"每事件一 Step"）。
 *
 * 刻意**不含** `assistant/tool_call` —— 它与 `tool/result` 由 M3 按 `toolCallId` 配对。
 */
const DIALOGUE_TEXT_TYPES: ReadonlySet<string> = new Set([
  "assistant/thinking",
  "assistant/text",
  "assistant/text-batch",
]);

/**
 * 关联编号 / ID 的**统一读取**（P2-7，2026-09-22）
 *
 * 规则：**类型非法或缺失 ⇒ 返回 `undefined`**（安全退化），由调用方据此**跳过关联逻辑**，
 * 而不是把 `undefined` 当作有效 key 合入（那会污染分组、折叠与配对）。
 * 对标 deepseek-harness 的做法：*忽略该记录，而非合入 `undefined` / 崩溃*。
 *
 * 说明：派生器是**纯函数**（相同输入必得相同输出、可重放、可单测）⇒ 这里**不写日志**；
 * 可观测性改由返回值 `degradedAssocIds` 计数承载（见 `deriveTrajectoryLayout`）。
 */
export function readTurnNo(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** 关联字符串 ID（如 `toolCallId`）的统一读取：空串视为缺失 */
export function readAssocId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * 派生轨迹布局
 *
 * 算法：
 *  1. 遍历 events，遇到 turn/start 开启新 Turn
 *  2. 遇到 turn/end 关闭当前 Turn
 *  3. 同一 Turn 内的事件归入 steps —— **M2 合并相邻 thinking/text**、
 *     **M3 按 toolCallId 配对 tool_call/result**（一个 Step 可含多个 cell）
 *  4. 不在任何 Turn 内的事件归入 orphanEvents
 *
 * **复杂度（P3-3，2026-09-22）**：
 *  - 时间 `O(E)` —— 单遍扫描；`toolCallSteps` 用 `Map` ⇒ 配对查找 **O(1)**（非逐 step 搜索）；
 *  - 空间 `O(T + S + C)`，且 `T + S + C = O(E)`（turn / step / cell 均为事件的成组映射）。
 *  **刻意不声称 `O(1)`**：输出规模本身与事件数同阶。
 *
 * 边界处理：
 *  - turn/end 无对应 turn/start：归入 orphanEvents
 *  - turn/start 后无 turn/end（流式中断）：turn.completed=false，interrupted=true
 *  - 嵌套 turn/start（异常）：原 Turn 关闭并归入，新 Turn 开启
 */
export function deriveTrajectoryLayout(events: LiriEvent[]): TrajectoryLayout {
  const turns: TrajectoryTurn[] = [];
  const orphanEvents: LiriEvent[] = [];
  let currentTurn: TrajectoryTurn | null = null;
  /**
   * 因**关联编号 / ID 非法或缺失**而安全退化的事件数（P2-7）。
   * 派生器为纯函数 ⇒ 不以日志暴露，改为计数（消费方可据此提示"有 N 条记录无法归类"）。
   */
  let degradedAssocIds = 0;

  /**
   * M3（2026-09-22）：`toolCallId` → 承载该 `assistant/tool_call` 的 Step。
   *
   * 用 Map 而**非**"仅相邻合并"：并发工具调用的 `tool/result` 可能在 seq 上不相邻
   * （晚于其他工具的事件到达）⇒ 只有按 id 配对才能正确归位。
   * 每个 Turn 边界清空（见 `turn/start` / `turn/end`），避免跨 turn 误配。
   */
  const toolCallSteps = new Map<string, TrajectoryStep>();

  /** 向既有 Step 追加一个 cell（统一维护计数与结束 seq） */
  const appendCell = (
    turn: TrajectoryTurn,
    step: TrajectoryStep,
    event: LiriEvent,
  ) => {
    step.cells.push({
      event,
      column: event.type.startsWith("user/") ? "left" : "right",
    });
    step.endTime = event.time;
    turn.eventCount++;
    turn.endSeq = event.seq;
  };

  const pushStep = (event: LiriEvent) => {
    const turn = currentTurn;
    if (!turn) {
      orphanEvents.push(event);
      return;
    }

    // ── M3：`tool/result` / `tool/canceled` 按 toolCallId 追加到其 `tool_call` 的 Step ──
    // 未配对（孤立 result）时**不**在此 return，落到下方普通分支 —— 安全退化（P2-7 精神）
    if (event.type === "tool/result" || event.type === "tool/canceled") {
      // P2-7：统一走 `readAssocId`（空串 / 非字符串均视为缺失 ⇒ 安全退化）
      const id = readAssocId(
        (event.data as { toolCallId?: unknown }).toolCallId,
      );
      const paired = id !== undefined ? toolCallSteps.get(id) : undefined;
      if (paired) {
        appendCell(turn, paired, event);
        return;
      }
    }

    // ── M2：相邻的 thinking / text 合并入同一 Step ──
    const lastStep = turn.steps[turn.steps.length - 1];
    const lastType = lastStep?.cells[lastStep.cells.length - 1]?.event.type;
    if (
      lastStep &&
      lastType !== undefined &&
      DIALOGUE_TEXT_TYPES.has(event.type) &&
      DIALOGUE_TEXT_TYPES.has(lastType)
    ) {
      appendCell(turn, lastStep, event);
      return;
    }

    // ── 新建 Step ──
    const step: TrajectoryStep = {
      cells: [
        {
          event,
          column: event.type.startsWith("user/") ? "left" : "right",
        },
      ],
      startTime: event.time,
      endTime: event.time,
    };
    turn.steps.push(step);
    turn.eventCount++;
    turn.endSeq = event.seq;

    // M3：登记 tool_call，供其 result 归位
    if (event.type === "assistant/tool_call") {
      // P2-7：统一校验（缺失 ⇒ 不登记；其 `result` 后续走"孤立 ⇒ 独立 Step"的安全退化）
      const id = readAssocId(
        (event.data as { toolCallId?: unknown }).toolCallId,
      );
      if (id !== undefined && !toolCallSteps.has(id)) {
        toolCallSteps.set(id, step);
      }
    }
  };

  for (const event of events) {
    switch (event.type) {
      case "turn/start": {
        // 嵌套 turn/start：原 Turn 视为中断并关闭
        if (currentTurn) {
          currentTurn.completed = false;
          currentTurn.interrupted = true;
          currentTurn = null;
        }
        // M3：新 Turn 清空配对映射（避免跨 turn 误配）
        toolCallSteps.clear();
        // P2-7（2026-09-22）：关联编号**统一安全退化** —— 非法/缺失 ⇒ 该事件归入
        // `orphanEvents`，**不开启非法 Turn**（否则会产出 `turn` 为 `undefined` 的 Turn，
        // 污染分组、折叠与日志 Tab 的统计）。
        const turnNo = readTurnNo((event.data as { turn?: unknown }).turn);
        if (turnNo === undefined) {
          orphanEvents.push(event);
          degradedAssocIds++;
          break;
        }
        currentTurn = {
          turn: turnNo,
          startSeq: event.seq,
          endSeq: event.seq,
          steps: [],
          eventCount: 0,
          completed: false,
          interrupted: false,
        };
        turns.push(currentTurn);
        break;
      }
      case "turn/end": {
        // P2-7：`turn/end` 的编号同样统一校验（非法/缺失 ⇒ 安全退化，不计入任何 Turn）。
        // 注：**编号与当前 Turn 不匹配**的处理不在本项范围（原实现即不校验匹配，属既有容错）。
        const endTurnNo = readTurnNo((event.data as { turn?: unknown }).turn);
        if (endTurnNo === undefined) {
          orphanEvents.push(event);
          degradedAssocIds++;
          break;
        }
        if (!currentTurn) {
          orphanEvents.push(event);
          break;
        }
        currentTurn.endSeq = event.seq;
        currentTurn.completed = true;
        currentTurn = null;
        toolCallSteps.clear(); // M3：Turn 结束清空配对映射
        break;
      }
      default:
        pushStep(event);
        break;
    }
  }

  // 遍历结束后，仍开启的 Turn 视为中断
  if (currentTurn && !currentTurn.completed) {
    currentTurn.interrupted = true;
  }

  return {
    turns,
    orphanEvents,
    degradedAssocIds,
    totalCount: events.length,
    tailSeq: events.length > 0 ? events[events.length - 1].seq : 0,
  };
}

// ─── 拍平行（P1 虚拟滚动：2026-08-25，Turn 头作为独立行参与虚拟化） ───────

export type TrajectoryFlatRow =
  | { kind: "turn-header"; turn: TrajectoryTurn; key: string }
  | { kind: "event"; event: LiriEvent; turn?: TrajectoryTurn; key: string };

/**
 * 将 TrajectoryLayout 拍平为虚拟滚动行列表：
 *  每个 Turn 先输出 turn-header 行，再输出其 steps 中**全部 cell** 的事件行；最后 orphanEvents 各一行。
 *
 * M2/M3（2026-09-22）：一个 Step 现可含**多个 cell**（对话流合并 / 工具配对）⇒ 必须全部展开；
 * 原先"只取 `cells[0]`"会让合并后增补的事件在列表中**消失**。
 *
 * **复杂度（P3-3）**：`O(R)`（`R` = 展开后行数，`R = O(E)`）；单遍、无排序。
 */
export function flattenLayout(layout: TrajectoryLayout): TrajectoryFlatRow[] {
  const rows: TrajectoryFlatRow[] = [];
  for (const turn of layout.turns) {
    rows.push({ kind: "turn-header", turn, key: `turn-${turn.startSeq}` });
    for (const step of turn.steps) {
      for (const cell of step.cells) {
        rows.push({
          kind: "event",
          event: cell.event,
          turn,
          key: `ev-${turn.startSeq}-${cell.event.seq}`,
        });
      }
    }
  }
  for (const event of layout.orphanEvents) {
    rows.push({
      kind: "event",
      event,
      key: `orphan-${event.seq}-${event.type}`,
    });
  }
  return rows;
}

/**
 * 按"已折叠 turn 集合"过滤拍平行（P1-6，2026-09-22）。
 *
 * 语义（与 `LogTab` 既有实现同构，那边是 `if (collapsedTurns.has(turn.turn)) continue;`）：
 * - **turn 头行始终保留** —— 它就是折叠入口，且承载统计/区间信息；
 * - 被折叠 turn 的**事件行**跳过；
 * - **孤立事件行**（`turn` 为 undefined，不属于任何 turn）**始终保留**（无 turn 可折叠）。
 *
 * 纯函数 ⇒ 可单测，且让"折叠行为"在两处（日志 Tab / 轨迹 Tab）口径一致。
 *
 * **复杂度（P3-3）**：`O(R)` 单遍过滤；折叠集合为空时**提前返回同一引用**（零开销）。
 */
export function filterCollapsedTurns(
  rows: TrajectoryFlatRow[],
  collapsedTurns: ReadonlySet<number>,
): TrajectoryFlatRow[] {
  if (collapsedTurns.size === 0) return rows;
  return rows.filter(
    (row) =>
      row.kind === "turn-header" ||
      !(row.turn !== undefined && collapsedTurns.has(row.turn.turn)),
  );
}

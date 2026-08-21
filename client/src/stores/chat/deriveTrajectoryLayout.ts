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
 * M1-8：M1 阶段仅做基础分组（每事件一个 Step）；后续 M2/M3 优化为
 *   - thinking + text 合并为一个 Step
 *   - assistant/tool_call + tool/result 配对一个 Step
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
}

// ─── 派生函数 ───────────────────────────────────

/**
 * 派生轨迹布局
 *
 * 算法：
 *  1. 遍历 events，遇到 turn/start 开启新 Turn
 *  2. 遇到 turn/end 关闭当前 Turn
 *  3. 同一 Turn 内的事件归入当前 Turn 的 steps（每事件一 Step，M1 简化版）
 *  4. 不在任何 Turn 内的事件归入 orphanEvents
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

  const pushStep = (event: LiriEvent) => {
    if (!currentTurn) {
      orphanEvents.push(event);
      return;
    }
    currentTurn.steps.push({
      cells: [
        {
          event,
          column: event.type.startsWith("user/") ? "left" : "right",
        },
      ],
      startTime: event.time,
      endTime: event.time,
    });
    currentTurn.eventCount++;
    currentTurn.endSeq = event.seq;
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
        const data = event.data as { turn: number };
        currentTurn = {
          turn: data.turn,
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
        if (!currentTurn) {
          orphanEvents.push(event);
          break;
        }
        currentTurn.endSeq = event.seq;
        currentTurn.completed = true;
        currentTurn = null;
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
    totalCount: events.length,
    tailSeq: events.length > 0 ? events[events.length - 1].seq : 0,
  };
}

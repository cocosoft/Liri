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
 * U4 在线质量评估：**从事件派生每轮打分信号**（纯函数，无 IO）。
 *
 * 规格：`.trae/specs/online-quality-evaluation.md` §3 D1/D4。
 *
 * 为什么从事件派生（而不是取内存遥测 `AgentTelemetry.TurnMetrics`）：
 * 事件日志是**唯一可重建的事实源**（§1.6）；内存遥测重启即失、也无法回填历史轮。
 * 派生口径尽量只依赖**已落事件**：
 * - `turn/start` → 开一轮（`data.turn`）
 * - `turn/start … turn/end` 之间：数 `assistant/tool_call`、累加 `metric/timing` 的
 *   `duration` / `inputTokens` / `outputTokens`
 * - `turn/end` → 收一轮并定 `status`（`finishReason` 的结构化映射，**禁按文案判断**）
 *
 * ⚠️ **v1 边界（如实，勿默认其存在）**：**验证器结论不进本派生** ——
 * 本仓**未持久化**每轮的 `VerifierAgent` verdict（既有 `validation/injected` 仅承载
 * mermaid 结构校验回喂），故 `signals.verdict` 在派生结果里**恒为 `undefined`**
 * （打分里取"中性"，不加不减）。verdict 只在**LLM 复核**产出后写入事件的 `review` 字段。
 */

import type { LiriEvent } from '@modules/session/types/events';
import type { TurnQualitySignals, TurnStatus } from './types.js';

/** 派生所得的单轮信号（含该轮**结束 seq** —— 供水位使用） */
export interface DerivedTurn {
  turnNumber: number;
  signals: TurnQualitySignals;
  /** 该轮 `turn/end` 事件的 seq（无 `turn/end` 的未收轮不产出） */
  endSeq: number;
}

/** 未收轮（有 `turn/start` 无 `turn/end`）的累积态 */
interface OpenTurn {
  turnNumber: number;
  toolCalls: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
}

/** 把 `turn/end.finishReason` 映射为**结构化** `TurnStatus`（`undefined` = 正常收尾） */
function resolveStatus(
  finishReason: string | undefined,
  hasError: boolean
): TurnStatus {
  if (hasError || finishReason === 'error') return 'error';
  if (finishReason === 'canceled') return 'aborted';
  return 'completed';
}

/**
 * 从**一段按 seq 升序的事件**里派生每轮信号。
 *
 * 只产出**已收轮**（见到 `turn/end`）；未收轮（进行中）**不产出** ——
 * 与 `scoreTurn` 对 `running` 返回 `null` 的取向一致（未终态不评）。
 */
export function deriveTurnSignals(events: LiriEvent[]): DerivedTurn[] {
  const out: DerivedTurn[] = [];
  let open: OpenTurn | null = null;

  for (const ev of events) {
    switch (ev.type) {
      case 'turn/start': {
        const turn = (ev.data as { turn?: number }).turn;
        open = {
          turnNumber: typeof turn === 'number' ? turn : 0,
          toolCalls: 0,
          durationMs: 0,
          inputTokens: 0,
          outputTokens: 0,
        };
        break;
      }
      case 'assistant/tool_call': {
        if (open) open.toolCalls += 1;
        break;
      }
      case 'metric/timing': {
        if (!open) break;
        const d = ev.data as {
          duration?: number;
          inputTokens?: number;
          outputTokens?: number;
        };
        if (typeof d.duration === 'number') open.durationMs += d.duration;
        if (typeof d.inputTokens === 'number')
          open.inputTokens += d.inputTokens;
        if (typeof d.outputTokens === 'number')
          open.outputTokens += d.outputTokens;
        break;
      }
      case 'turn/end': {
        if (!open) break;
        const d = ev.data as { finishReason?: string; error?: string };
        const status = resolveStatus(d.finishReason, Boolean(d.error));
        out.push({
          turnNumber: open.turnNumber,
          endSeq: ev.seq,
          signals: {
            status,
            toolCalls: open.toolCalls,
            durationMs: open.durationMs > 0 ? open.durationMs : undefined,
            inputTokens: open.inputTokens,
            outputTokens: open.outputTokens,
          },
        });
        open = null;
        break;
      }
      default:
        break;
    }
  }

  return out;
}

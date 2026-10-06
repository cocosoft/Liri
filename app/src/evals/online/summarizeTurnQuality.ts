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
 * U4 在线质量评估：**会话级摘要**（纯函数；消费点 D6 的取数口径）。
 *
 * 规格：`.trae/specs/online-quality-evaluation.md` §3 **D6**。
 *
 * 为什么做摘要而不是把原始事件给消费方：消费方（梦境）要的是"**这个会话里哪几轮值得看**"，
 * 重放整个事件流既昂贵又把 chat 的存储契约泄漏成下游依赖（见 `core/spi/SessionQualityService.ts` 头注）。
 *
 * 口径（都不引入新阈值）：
 * - **低价值** = `score < SUSPICIOUS_SCORE_THRESHOLD`（与可疑轮同一阈值，不另立第二套判据）
 * - **高价值** = `score ≥ HIGH_VALUE_SCORE_THRESHOLD`（`weights.ts` 单一常量表）
 * - `avgScore` 为算术平均；`total === 0` 时返回 `0`（调用方应看 `total` 再决定用不用）
 */

import type { LiriEvent } from '@modules/session/types/events';
import {
  HIGH_VALUE_SCORE_THRESHOLD,
  SUSPICIOUS_SCORE_THRESHOLD,
} from './weights.js';

/** 单会话在线质量摘要（与 core SPI 的 DTO 同形 —— 由装配层做一次映射） */
export interface TurnQualitySummary {
  total: number;
  avgScore: number;
  highValueTurns: number[];
  lowValueTurns: number[];
}

/** 空摘要（无数据时的规范值；**不伪造**分数） */
export const EMPTY_TURN_QUALITY_SUMMARY: TurnQualitySummary = {
  total: 0,
  avgScore: 0,
  highValueTurns: [],
  lowValueTurns: [],
};

/**
 * 从 `turn/quality` 事件汇总单会话摘要（纯函数）。
 *
 * 非 `turn/quality` 事件一律忽略；`score` / `turnNumber` 非数值的畸形事件**跳过**
 * （不猜、不补 0 —— 畸形项不计入 `total`，避免把脏数据算成"低分轮"）。
 */
export function summarizeTurnQuality(events: LiriEvent[]): TurnQualitySummary {
  const sorted = [...events]
    .filter((e) => e.type === 'turn/quality')
    .sort((a, b) => a.seq - b.seq);

  let sum = 0;
  let total = 0;
  const highValueTurns: number[] = [];
  const lowValueTurns: number[] = [];

  for (const ev of sorted) {
    const data = ev.data as { score?: unknown; turnNumber?: unknown };
    if (typeof data.score !== 'number' || !Number.isFinite(data.score))
      continue;
    if (typeof data.turnNumber !== 'number') continue;
    total += 1;
    sum += data.score;
    if (data.score >= HIGH_VALUE_SCORE_THRESHOLD) {
      highValueTurns.push(data.turnNumber);
    } else if (data.score < SUSPICIOUS_SCORE_THRESHOLD) {
      lowValueTurns.push(data.turnNumber);
    }
  }

  if (total === 0) return { ...EMPTY_TURN_QUALITY_SUMMARY };

  return {
    total,
    avgScore: sum / total,
    highValueTurns,
    lowValueTurns,
  };
}

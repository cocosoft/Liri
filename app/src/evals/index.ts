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
 * `evals` 模块**出口**（R03-002「模块出口单一」）。
 *
 * 背景（2026-10-06，U4）：本目录此前**无入口桶**、也没有模块外消费者
 * （评测走 `evals/cli.ts` 独立入口）。U4 在线质量评估需要被 `chat/orchestrator`
 * 在**空闲期**动态引用 ⇒ 必须有**规范出口**，禁止跨模块引子目录
 * （`./online/xxx` 会触 R03-002）。
 *
 * 边界：本出口**只暴露在线评估（U4）的稳定面**；离线评测族（runner / scoring /
 * sandbox 等）仍由 `evals/cli.ts` 与同目录直接引用，不在此转出 ——
 * 避免把整个评测框架变成模块公共 API（CS03：不做投机性扩展面）。
 */

// ─── 在线质量评估（U4，`.trae/specs/online-quality-evaluation.md`） ───
export { runTurnQualityPass } from './online/turnQualityEvaluator.js';
export type {
  TurnQualityEvaluatorPorts,
  TurnQualityPassOptions,
  TurnQualityPassResult,
} from './online/turnQualityEvaluator.js';
export { deriveTurnSignals } from './online/deriveTurnSignals.js';
export type { DerivedTurn } from './online/deriveTurnSignals.js';
export {
  isSuspicious,
  nextLowScoreStreak,
  scoreTurn,
} from './online/turnQuality.js';
export type {
  ReviewVerdictType,
  SuspiciousInput,
  SuspiciousReason,
  SuspiciousVerdict,
  TurnQualityReview,
  TurnQualitySignals,
  TurnScore,
  TurnScoreComponents,
  TurnStatus,
} from './online/types.js';
export {
  EMPTY_TURN_QUALITY_SUMMARY,
  summarizeTurnQuality,
} from './online/summarizeTurnQuality.js';
export type { TurnQualitySummary } from './online/summarizeTurnQuality.js';
export {
  EVALUATOR_VERSION,
  HIGH_VALUE_SCORE_THRESHOLD,
  MAX_REVIEWS_PER_IDLE,
  SUSPICIOUS_SCORE_THRESHOLD,
} from './online/weights.js';

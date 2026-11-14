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
 * 线上低分轮 → 评测语料（M3，2026-11-15）
 *
 * 规格：`.trae/specs/learning-feedback-loop.md` §3-S4 / §5-M3。
 *
 * 链路：
 *   `~/.pyapp/data/learning-candidates/approved-cases.jsonl`（人工批准产出的**种子**）
 *     ──（手工执行 `gen:learning-eval-cases`，可预览/可选落盘）
 *   `learning-cases.json`（本目录，入库；入库前须人工脱敏）
 *     ──（本文件在**导入时**读取）
 *   `TaskPool`（`tasks/index.ts`）⇒ `evals --gate` 的回归卡口。
 *
 * 三条纪律：
 * - **期望必须人工填**：`expectation` 为空 ⇒ 不进语料（不编造判据，CS04/CS06）；
 * - **判据只做逐字比对**：L1「回答包含期望片段」（空白归一后比对），不做语义相似度/LLM 判分
 *   （与 `smoke.ts` 的 `LIRI_EVAL_OK` 同口径；语义类判据需另立 L3 spec）；
 * - **不自动登记基线**：新增任务由 `checkGate` 以「基线中未登记该任务」**阻断**，
 *   登记 `baseline.json`（minPass1 / requirePassK）是人的第二道门（见 spec §5-M3）。
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EvalTask } from '@modules/evals/types.js';

/**
 * 种子记录（**只取本模块需要的字段**）。
 *
 * 结构与 app 侧 `LearningApprovedCase` 对齐，但**不 import app 类型**（evals 不得依赖上层）。
 */
export interface LearningCaseRecord {
  /** 种子 id（候选 id 的确定性哈希） */
  id: string;
  sessionId: string;
  turnNumber: number;
  category: string;
  score: number;
  /** 该轮用户输入（= 评测提示词；为空 ⇒ 不成题） */
  input: string | null;
  /** 人工填写的期望片段（为空 ⇒ 不成题） */
  expectation: string | null;
  /** 撤销时间（有值 ⇒ 不进语料） */
  revokedAt?: number;
}

/** 未进入语料的种子及原因（如实上报，不静默吞掉） */
export interface LearningCaseSkip {
  id: string;
  reason: 'revoked' | 'no-expectation' | 'no-input';
}

/** 评测任务 id 前缀（与既有 `file-create` / `control-judge-sanity` 等区分） */
export const LEARNING_CASE_TASK_PREFIX = 'learning-case-';

/** 语料文件名（由 `gen:learning-eval-cases` 生成） */
export const LEARNING_CASES_FILE = 'learning-cases.json';

/** 种子 id → 评测任务 id */
export function learningCaseTaskId(caseId: string): string {
  return `${LEARNING_CASE_TASK_PREFIX}${caseId}`;
}

/**
 * 文本归一（断言的**唯一**等价变形）：连续空白压成一个空格、去首尾。
 *
 * 只做"不承载语义"的变形（同 `types.ts` 的 `EquivalentVariantKind` 口径）。
 */
export function normalizeCaseText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 选择结果 */
export interface LearningCaseSelection {
  /** 可成题的种子（按 id 升序 ⇒ 输出确定性） */
  eligible: LearningCaseRecord[];
  /** 被跳过的种子（按 id 升序） */
  skipped: LearningCaseSkip[];
}

/**
 * 过滤种子（纯函数）：撤销 / 无期望 / 无输入 三类跳过，其余按 id 升序。
 *
 * 幂等且确定：同一输入永远得到同一输出（落盘文件可 diff）。
 */
export function selectLearningCaseRecords(
  records: readonly LearningCaseRecord[]
): LearningCaseSelection {
  const eligible: LearningCaseRecord[] = [];
  const skipped: LearningCaseSkip[] = [];
  for (const record of records) {
    const expectation = (record.expectation ?? '').trim();
    const input = (record.input ?? '').trim();
    if (record.revokedAt !== undefined) {
      skipped.push({ id: record.id, reason: 'revoked' });
    } else if (!expectation) {
      skipped.push({ id: record.id, reason: 'no-expectation' });
    } else if (!input) {
      skipped.push({ id: record.id, reason: 'no-input' });
    } else {
      eligible.push(record);
    }
  }
  const byId = (a: { id: string }, b: { id: string }) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  eligible.sort(byId);
  skipped.sort(byId);
  return { eligible, skipped };
}

/** 单条种子 → 评测任务（L1：回答须包含期望片段） */
export function toLearningCaseTask(record: LearningCaseRecord): EvalTask {
  const prompt = (record.input ?? '').trim();
  const expected = normalizeCaseText(record.expectation ?? '');
  return {
    id: learningCaseTaskId(record.id),
    name: `线上低分轮回归：${record.category}（第 ${record.turnNumber} 轮，score ${record.score.toFixed(2)}）`,
    level: 'L1',
    assertionPolarity: 'positive',
    prompt: () => prompt,
    async assert({ finalText }) {
      if (!normalizeCaseText(finalText).includes(expected)) {
        return {
          pass: false,
          reason: `回答未包含期望片段：${expected.slice(0, 120)}`,
        };
      }
      return { pass: true };
    },
  };
}

/** 种子集合 → 题集 + 跳过清单（纯函数） */
export function buildLearningCaseTasks(
  records: readonly LearningCaseRecord[]
): { tasks: EvalTask[]; skipped: LearningCaseSkip[] } {
  const { eligible, skipped } = selectLearningCaseRecords(records);
  return { tasks: eligible.map(toLearningCaseTask), skipped };
}

/** 语料文件绝对路径（与本文件同目录） */
export function learningCasesFilePath(): string {
  return resolve(import.meta.dir, LEARNING_CASES_FILE);
}

/**
 * 读取语料文件。
 *
 * 文件不存在 ⇒ 空数组（尚未物料化，属正常态）；**解析失败 ⇒ 抛出**（fail-closed：
 * 静默返回空会让 `--gate` 在"题集缺失"的情况下判绿，与 AR-3 的教训同源）。
 */
export function loadLearningCaseRecords(
  file: string = learningCasesFilePath()
): LearningCaseRecord[] {
  if (!existsSync(file)) return [];
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf-8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`学习语料文件格式非法（应为数组）：${file}`);
  }
  return parsed as LearningCaseRecord[];
}

/** 本模块贡献的题集（导入时读取；当前无种子 ⇒ 空数组 ⇒ 对既有跑批零影响） */
export const learningCaseTasks: EvalTask[] = buildLearningCaseTasks(
  loadLearningCaseRecords()
).tasks;

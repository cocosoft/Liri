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
 * 评测报告生成（D2 骨架）
 *
 * 产出两份：JSON（给门禁比对基线）+ Markdown（给人看）。
 * 指标口径：`pass^1` = 符合预期率；`pass^k` = k 次全部符合预期（可用性门槛）。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EvalRunSummary } from './types.js';

/** 生成 Markdown 报告正文 */
function toMarkdown(summary: EvalRunSummary): string {
  const lines: string[] = [];
  lines.push('# Agent 能力评测报告（D2 骨架）');
  lines.push('');
  lines.push(`> 模型：\`${summary.model}\` ｜ 每任务次数 k=${summary.k}`);
  lines.push(`> 起止：${summary.startedAt} → ${summary.finishedAt}`);
  lines.push('');
  lines.push(
    `**汇总**：pass^k 全通过任务占比 **${(summary.passKRate * 100).toFixed(0)}%**（${summary.tasks.filter((t) => t.passK).length}/${summary.tasks.length}）；pass^1 均值 **${(summary.pass1Mean * 100).toFixed(1)}%**；判分器自检 **${summary.judgeSanityOk ? '通过' : '未通过'}**`
  );
  lines.push('');
  lines.push('| 任务 | 层级 | 期望 | 断言通过 | pass^1 | pass^k | 说明 |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const t of summary.tasks) {
    const lastFail = t.attempts.find((a) => !a.asExpected);
    lines.push(
      `| ${t.task.id} | ${t.task.level} | ${t.task.expect ?? 'pass'} | ` +
        `${t.assertPassCount}/${t.attempts.length} | ${(t.pass1 * 100).toFixed(0)}% | ` +
        `${t.passK ? '✅' : '❌'} | ${lastFail?.assertion.reason ?? ''} |`
    );
  }
  lines.push('');
  lines.push('## 逐次明细');
  for (const t of summary.tasks) {
    lines.push('');
    lines.push(`### ${t.task.id}（${t.task.name}）`);
    for (const a of t.attempts) {
      lines.push(
        `- #${a.index}: ${a.asExpected ? '符合预期' : '不符合预期'} ｜ ${a.durationMs}ms` +
          `${a.promptTokens !== undefined ? ` ｜ tokens ${a.promptTokens}+${a.completionTokens ?? 0}` : ''}` +
          `${a.assertion.reason ? ` ｜ ${a.assertion.reason}` : ''}`
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

/** 写出报告，返回文件路径 */
export function writeReport(
  summary: EvalRunSummary,
  outDir: string
): { jsonPath: string; mdPath: string } {
  mkdirSync(outDir, { recursive: true });
  const stamp = summary.startedAt.replace(/[:.]/g, '-');
  const jsonPath = join(outDir, `eval-${stamp}.json`);
  const mdPath = join(outDir, `eval-${stamp}.md`);

  const serializable = {
    ...summary,
    tasks: summary.tasks.map((t) => ({
      id: t.task.id,
      name: t.task.name,
      level: t.task.level,
      expect: t.task.expect ?? 'pass',
      pass1: t.pass1,
      passK: t.passK,
      assertPassCount: t.assertPassCount,
      attempts: t.attempts,
    })),
  };
  writeFileSync(jsonPath, JSON.stringify(serializable, null, 2), 'utf-8');
  writeFileSync(mdPath, toMarkdown(summary), 'utf-8');
  return { jsonPath, mdPath };
}

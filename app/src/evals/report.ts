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
    `**汇总**：pass^k 全通过任务占比 **${(summary.passKRate * 100).toFixed(0)}%**（${summary.tasks.filter((t) => t.passK).length}/${summary.tasks.length}）；pass^1 均值 **${(summary.pass1Mean * 100).toFixed(1)}%**；判分器自检 **${summary.judgeSanityOk ? '通过' : '未通过'}**` +
      // A2（2026-10-06）：resolved 率 —— **仅** F2P/P2P 任务参与分母；无该类任务则**不出该段**
      (summary.resolvedRate === undefined
        ? ''
        : `；**resolved 率 ${(summary.resolvedRate * 100).toFixed(0)}%**（k 次全 resolved 的 F2P/P2P 任务占比）`)
  );
  if (summary.security) {
    const sec = summary.security;
    // A4（2026-09-26）：分母为**已完成** attempt；为 0 时显式标注 n/a，不给"0% 的假安全感"
    const asrText =
      sec.attackCompleted === 0
        ? 'n/a（无已完成 attempt，ASR 不可信）'
        : `${(sec.asr * 100).toFixed(0)}%`;
    lines.push(
      `**安全（D9）**：成对 ${sec.pairs} ｜ **ASR ${asrText}**（注入得手比例，越低越好；A4 分母 = **已完成** ${sec.attackCompleted} 次，未完成 ${sec.attackIncomplete} 次**不进分母**）｜ **benign utility ${(sec.benignPassRate * 100).toFixed(0)}%**（正常任务完成率，越高越好；其降幅即**误伤**）`
    );
  }
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

  // A2（2026-10-06）：F2P/P2P 明细 —— **仅当题集中存在声明了双清单的任务**时出现
  // （无该类任务 ⇒ 报告与改造前**逐字一致**）。
  const withLists = summary.tasks.filter((t) => t.f2pP2P);
  if (withLists.length > 0) {
    lines.push('');
    lines.push('## F2P / P2P（SWE-bench 语义；仅声明了双清单的 S1 类任务）');
    lines.push('');
    lines.push(
      '| 任务 | F2P 用例 | P2P 用例 | resolved | breaking | no-op | 未归类 |'
    );
    lines.push('|---|---|---|---|---|---|---|');
    for (const t of withLists) {
      const s = t.f2pP2P!;
      // "未归类" = 既非 resolved/breaking 也非 no-op 的 attempt（F2P 部分过、或该 attempt 无逐用例结果）
      const unclassified = s.attempts - s.resolved - s.breaking - s.noOp;
      lines.push(
        `| ${t.task.id} | ${s.f2pTotal} | ${s.p2pTotal} | ${s.resolved}/${s.attempts} | ${s.breaking} | ${s.noOp} | ${unclassified} |`
      );
    }
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
          `${a.toolCalls?.length ? ` ｜ 工具: ${a.toolCalls.join(' → ')}` : ''}` +
          // A2（2026-09-26）：行为指标（**仅观测**，不作为通过/失败判据）
          `${a.behavior ? ` ｜ 行为: 自验证${a.behavior.selfVerificationCount}/探索${a.behavior.explorationCount}/草稿比${a.behavior.draftingRatio}` : ''}` +
          // S2（2026-09-26）：过程断言摘要（**仅观测**）。即使 0 违规也打印规则数 ⇒ 可区分"无违规"与"未计算"。
          `${
            a.processFindings?.length
              ? ` ｜ 过程: ${a.processFindings.length}规则/${a.processFindings.filter((f) => !f.pass).length}违规${
                  a.processFindings.some((f) => !f.pass)
                    ? `(${a.processFindings
                        .filter((f) => !f.pass)
                        .map((f) => `${f.rule}✗`)
                        .join('')})`
                    : ''
                }`
              : ''
          }` +
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

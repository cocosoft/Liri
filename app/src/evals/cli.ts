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
 * Agent 能力评测 CLI（D2 骨架）
 *
 * 用法（在 app/ 下）：
 *   bun run eval -- --model=<模型名>            # 全部任务，k=1
 *   bun run eval -- --model=<模型名> --k=4      # 每任务跑 4 次，采集 pass^k
 *   bun run eval -- --model=<模型名> --task=file-create
 *   bun run eval -- --model=<模型名> --keep     # 保留沙箱目录（默认评测结束即删；沙箱内含凭据副本）
 *   bun run eval -- --model=<模型名> --gate     # R12-001 门禁：与基线比对，有回归则退出码 1
 *   bun run eval -- --model=<模型名> --baseline=<file.json>   # 指定基线（按模型分档时用）
 *
 * 约束：模型名**必须显式传入**（按 model-usage 规则，代码中不得硬编码模型名或默认值）。
 * 退出码：0 = 全部任务符合预期、判分器自检通过、且门禁无回归；1 = 有任务不符合预期/自检失败/门禁回归；2 = 环境准备失败。
 */

import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { configManager } from '@modules/config';
import { resolveDbPath, resolvePyappHome } from '@modules/core/paths';
import { createSandbox } from './sandbox.js';
import { runTask } from './runner.js';
import { writeReport } from './report.js';
import { allTasks } from './tasks/index.js';
import { checkGate, summarizeRun } from './scoring.js';
import type { Baseline } from './scoring.js';
import type { EvalTaskResult } from './types.js';

/** CLI 输出（项目禁 console；与 WizardEngine/ProgressBar 一致走 stdout） */
const out = (line = ''): void => void process.stdout.write(`${line}\n`);
const err = (line: string): void => void process.stderr.write(`${line}\n`);

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

const k = Math.max(1, parseInt(argValue('k') ?? '1', 10) || 1);
// 模型名**必须显式传入**：按 model-usage 规则，代码中不得硬编码模型名/默认值
const model = argValue('model');
const taskFilter = argValue('task')
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const repoRoot = (
  configManager.env('LIRI_PROJECT_DIR')?.trim() ||
  resolve(import.meta.dir, '../../..')
).replace(/\\/g, '/');
const outDir = argValue('out') ?? resolve(repoRoot, 'dev_docs', 'evals');

if (!model) {
  err(
    '缺少 --model=<模型名>：评测必须显式指定模型（不硬编码默认值）。可用模型见 `GET /v1/models`。'
  );
  process.exit(2);
}

const tasks = taskFilter
  ? allTasks.filter((t) => taskFilter.includes(t.id))
  : allTasks;

if (tasks.length === 0) {
  err(`未匹配到任何任务：--task=${taskFilter?.join(',')}`);
  process.exit(2);
}

out('Agent 能力评测（D2 骨架）');
out(`  模型=${model} ｜ k=${k} ｜ 任务=${tasks.map((t) => t.id).join(', ')}`);
out(`  仓库根=${repoRoot}`);

let sandbox;
try {
  sandbox = await createSandbox({
    repoRoot,
    realDbPath: resolveDbPath(),
    realHome: resolvePyappHome(),
  });
} catch (e) {
  err(`沙箱准备失败：${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
out(`  沙箱=${sandbox.root}（隔离 HOME/数据目录，DB 为真实库快照）`);
out(`  后端=${sandbox.baseUrl}`);
if (!sandbox.hasCredentials) {
  out(
    '  ⚠️ 未找到 <LIRI_HOME>/credentials.json —— 模型密钥缺失，调用很可能返回 401'
  );
}

const startedAt = new Date().toISOString();
const results: EvalTaskResult[] = [];

try {
  for (const task of tasks) {
    out(`\n[任务] ${task.id} — ${task.name}`);
    results.push(await runTask(task, sandbox, { k, model }));
  }
} finally {
  await sandbox.stop();
}

const summary = summarizeRun({
  startedAt,
  finishedAt: new Date().toISOString(),
  model,
  k,
  tasks: results,
  // 用 --task= 只跑子集时，子集里没有控制任务属正常，不应判为"判分器自检失败"
  expectControls: !taskFilter,
});

const { jsonPath, mdPath } = writeReport(summary, outDir);

out('\n================ 汇总 ================');
out(
  `pass^k 全通过：${results.filter((r) => r.passK).length}/${results.length}` +
    ` ｜ pass^1 均值：${(summary.pass1Mean * 100).toFixed(1)}%` +
    ` ｜ 判分器自检：${summary.judgeSanityOk ? '通过' : '未通过'}`
);
for (const r of results) {
  out(
    `  ${r.task.id}: 断言通过 ${r.assertPassCount}/${r.attempts.length}` +
      ` ｜ pass^1 ${(r.pass1 * 100).toFixed(0)}% ｜ pass^k ${r.passK ? '✅' : '❌'}`
  );
}
if (summary.security) {
  const sec = summary.security;
  out(
    `安全（D9）：成对 ${sec.pairs} ｜ ASR ${(sec.asr * 100).toFixed(0)}%` +
      ` ｜ benign utility ${(sec.benignPassRate * 100).toFixed(0)}%`
  );
}
out(`\n报告：${mdPath}\n      ${jsonPath}`);

// R12-001 门禁：--gate 或 --baseline=<path> 时与基线比对（默认基线 = 本目录 baseline.json）
const baselinePath = argValue('baseline');
const gateEnabled = process.argv.includes('--gate') || Boolean(baselinePath);
const gateFailures: string[] = [];
if (gateEnabled) {
  const baselineFile =
    baselinePath ?? resolve(import.meta.dir, 'baseline.json');
  out(`\n[门禁 R12-001] 基线=${baselineFile}`);
  try {
    const baseline = JSON.parse(
      readFileSync(baselineFile, 'utf-8')
    ) as Baseline;
    gateFailures.push(...checkGate(summary, baseline));
  } catch (e) {
    gateFailures.push(
      `基线不可读/不可解析：${e instanceof Error ? e.message : String(e)}`
    );
  }
  if (gateFailures.length === 0) {
    out('  ✅ 无回归');
  } else {
    for (const failure of gateFailures) err(`  ❌ ${failure}`);
  }
}

// 沙箱含真实凭据副本 → 默认删除；需要排查时用 --keep
if (process.argv.includes('--keep')) {
  out(`沙箱保留（--keep）：${sandbox.root}`);
} else {
  try {
    rmSync(sandbox.root, { recursive: true, force: true });
    out('沙箱已删除（含凭据副本；需要保留请加 --keep）');
  } catch (e) {
    out(
      `沙箱删除失败（可手动清理）：${sandbox.root} —— ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

const failed = results.filter((r) => !r.passK);
process.exit(
  failed.length === 0 && summary.judgeSanityOk && gateFailures.length === 0
    ? 0
    : 1
);

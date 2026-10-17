/**
 * 阶段 C（2026-10-17）：**交接单生成器**（SB07）。
 *
 * 上位方案：`dev_docs/20261014/会话token预算与交接整改方案-20261014.md` §5 阶段 C
 * 规则依据：`.trae/rules/session-budget.md` SB06/SB07
 *
 * 输入：`.trae/architecture/hardcode-progress.json`（**机器可读续跑状态**，唯一事实源）
 * 输出：stdout ≤30 行；`--out <path>` 可落盘
 * 运行：`bun run scripts/gen-handoff.ts [--out .trae/architecture/handoff.md]`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const PROGRESS = join(ROOT, '.trae/architecture/hardcode-progress.json');

interface Progress {
  nextKey?: string;
  doneKeys?: string[];
  lastCommit?: string;
  baselineKeys?: Record<string, number>;
  nextAction?: string;
  decisions?: string[];
}

function load(): Progress {
  return JSON.parse(readFileSync(PROGRESS, 'utf-8')) as Progress;
}

export function renderHandoff(p: Progress): string[] {
  const lines: string[] = [];
  lines.push('## 续跑交接单（脚本生成 · SB07）');
  lines.push('');
  lines.push(`- 下一键：${p.nextKey ?? '（未设置）'}`);
  lines.push(`- 最近提交：${p.lastCommit ?? '（未设置）'}`);
  const done = p.doneKeys ?? [];
  lines.push(
    `- 最近完成键（${done.length}）：${done.length > 0 ? done.join(' / ') : '（无）'}`
  );
  const baseline = p.baselineKeys ?? {};
  const keys = Object.keys(baseline);
  if (keys.length > 0) {
    lines.push(
      `- 基线存量：${keys.map((k) => `${k}=${baseline[k]}`).join(' · ')}`
    );
  }
  lines.push('');
  lines.push(`**下一步**：${p.nextAction ?? '（未设置 nextAction）'}`);
  const decisions = p.decisions ?? [];
  if (decisions.length > 0) {
    lines.push('');
    lines.push('裁定/说明：');
    for (const d of decisions.slice(-3)) lines.push(`- ${d}`);
  }
  // SB07：≤30 行
  return lines.slice(0, 30);
}

function main(): void {
  const outIdx = process.argv.indexOf('--out');
  const out = outIdx >= 0 ? process.argv[outIdx + 1] : undefined;
  const text = renderHandoff(load()).join('\n') + '\n';
  if (out) {
    writeFileSync(resolve(ROOT, out), text, 'utf-8');
    console.log(`[gen-handoff] 已写入 ${out}`);
    process.exitCode = 0;
    return;
  }
  process.stdout.write(text);
  process.exitCode = 0;
}

if (import.meta.main) main();

#!/usr/bin/env bun
/**
 * R10 —— **状态复杂度审计**（非 CI 门禁，仅「评估可行性与阈值」用）
 *
 * 背景：外部第九轮 §3.2 建议把"行数门禁"升级为"**状态复杂度门禁**"（6 指标：圈复杂度 /
 * 依赖出度 / 状态变量数 / 跨模块共享可变状态 / 异步调用深度 / 分支覆盖率）。
 * 本仓裁定：**先评估可行性与阈值，勿全量开启**（计划 §2 R10）。
 *
 * 本脚本只做**一件事**：为"可行性评估"提供**真实数据**，而非凭感觉定阈值 —— 复用仓内
 * 既有 ESLint（`complexity` / `max-depth` / `max-params` / `max-lines-per-function` 均为
 * ESLint 内置规则，**零新依赖**），把阈值压到 1 迫使 ESLint 逐函数**报出真实数值**，
 * 再解析数值聚合出分布（分位 + Top 榜单）。分支覆盖率从既有 `bun test --coverage` 产出的
 * `coverage/lcov.info`（BRF/BRH）读取。
 *
 * **非门禁**：始终退出 0（审计报告，不阻断）。是否升级为门禁由评估结论决定。
 *
 * 用法（app 目录下）：
 *   bun run scripts/state-complexity-audit.ts
 *   bun test --coverage --coverage-reporter=lcov   # 若需分支覆盖率数据
 */
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { ESLint } from 'eslint';

const APP_DIR = resolve(import.meta.dir, '..');
const SRC_GLOB = 'src/**/*.ts';
const TOP_N = 15;

/** 探针：把 ESLint 规则消息里的真实数值抽出来（阈值压到 1 ⇒ 每个函数都上报其值） */
interface Probe {
  ruleId: string;
  label: string;
  unit: string;
  re: RegExp;
  /** 候选阈值：打印"≥阈值"的函数数，供定阈值用（可选） */
  thresholds?: number[];
}

const PROBES: Probe[] = [
  {
    ruleId: 'complexity',
    label: '圈复杂度',
    unit: '',
    re: /complexity of (\d+)/,
    thresholds: [15, 20, 30, 40, 50, 60, 80, 100],
  },
  {
    ruleId: 'max-depth',
    label: '嵌套深度',
    unit: ' 层',
    re: /nested too deeply \((\d+)\)/,
  },
  {
    ruleId: 'max-params',
    label: '参数个数',
    unit: '',
    re: /too many parameters \((\d+)\)/,
  },
  {
    ruleId: 'max-lines-per-function',
    label: '函数行数',
    unit: ' 行',
    re: /too many lines \((\d+)\)/,
  },
];

interface Sample {
  file: string;
  line: number;
  value: number;
}

const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

const rel = (abs: string): string => relative(APP_DIR, abs).replace(/\\/g, '/');

/** 从既有 lcov 读分支覆盖率（BRF/BRH）；无文件或无分支记录 ⇒ null（如实留白） */
function branchCoverage(): { found: number; hit: number } | null {
  const p = resolve(APP_DIR, 'coverage', 'lcov.info');
  if (!existsSync(p)) return null;
  let found = 0;
  let hit = 0;
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    if (line.startsWith('BRF:')) found += parseInt(line.slice(4), 10) || 0;
    else if (line.startsWith('BRH:')) hit += parseInt(line.slice(4), 10) || 0;
  }
  return found > 0 ? { found, hit } : null;
}

async function main(): Promise<void> {
  console.log('=== R10 状态复杂度审计（非 CI 门禁，仅评估用）===');

  // 复用仓内 ESLint：overrideConfig 把 4 个内置规则阈值压到 1（逐函数报真实值），
  // 同时关掉与本次无关的规则（prettier/console/未用变量等）以降噪提速。
  const eslint = new ESLint({
    cwd: APP_DIR,
    overrideConfig: [
      {
        files: ['**/*.ts'],
        rules: {
          'prettier/prettier': 'off',
          'no-console': 'off',
          'no-debugger': 'off',
          '@typescript-eslint/no-unused-vars': 'off',
          '@typescript-eslint/no-explicit-any': 'off',
          'module-registry/no-direct-module-import': 'off',
          'no-restricted-imports': 'off',
          'no-restricted-syntax': 'off',
          complexity: ['error', 1],
          'max-depth': ['error', 1],
          'max-params': ['error', 1],
          'max-lines-per-function': ['error', 1],
        },
      },
    ],
  });

  console.log(`扫描 ${SRC_GLOB} …`);
  const results = await eslint.lintFiles([SRC_GLOB]);

  const byRule: Record<string, Sample[]> = {};
  for (const r of results) {
    for (const m of r.messages) {
      if (!m.ruleId) continue;
      const probe = PROBES.find((p) => p.ruleId === m.ruleId);
      if (!probe) continue;
      const matched = probe.re.exec(m.message);
      if (!matched) continue;
      (byRule[probe.ruleId] ??= []).push({
        file: rel(r.filePath),
        line: m.line,
        value: parseInt(matched[1], 10),
      });
    }
  }

  for (const probe of PROBES) {
    const list = byRule[probe.ruleId] ?? [];
    console.log(`\n--- ${probe.label}（${probe.ruleId}）---`);
    if (list.length === 0) {
      console.log('  （无样本 —— 请确认 ESLint 是否正常工作）');
      continue;
    }
    const values = list.map((s) => s.value);
    console.log(
      `  样本 ${list.length} 个函数 · P50=${pct(values, 0.5)} · P90=${pct(
        values,
        0.9
      )} · P99=${pct(values, 0.99)} · max=${Math.max(...values)}`
    );
    const top = [...list].sort((a, b) => b.value - a.value).slice(0, TOP_N);
    console.log(`  Top ${top.length}：`);
    for (const s of top) {
      console.log(
        `    ${String(s.value).padStart(4)}${probe.unit}  ${s.file}:${s.line}`
      );
    }
    if (probe.thresholds) {
      const counts = probe.thresholds
        .map((t) => `≥${t}: ${values.filter((v) => v >= t).length}`)
        .join(' · ');
      console.log(`  阈值候选（函数数）：${counts}`);
    }
  }

  console.log('\n--- 分支覆盖率（来源：coverage/lcov.info）---');
  const bc = branchCoverage();
  const lcovExists = existsSync(resolve(APP_DIR, 'coverage', 'lcov.info'));
  if (bc) {
    const p = ((bc.hit / bc.found) * 100).toFixed(1);
    console.log(`  分支 ${bc.hit}/${bc.found} = ${p}%`);
  } else if (!lcovExists) {
    console.log(
      '  （未找到 coverage/lcov.info —— 需先 bun test --coverage --coverage-reporter=lcov）'
    );
  } else {
    console.log(
      '  （lcov 存在但**无 BRF/BRH 分支记录** —— 当前 bun 覆盖率仅产出 DA/FN（行/函数），\n' +
        '   不产出分支数据 ⇒ 「分支覆盖率」指标在当前工具链下**不可行**，需改用 c8/istanbul/vitest 覆盖）'
    );
  }

  console.log(
    '\n未纳入本脚本（如实）：依赖出度（部分已由 lint:arch 分层 R00-001/R03-002/R00-003 覆盖）· ' +
      '状态变量数 / 跨模块共享可变状态 / 异步调用深度（无轻量数据源，需自定义规则）'
  );
  console.log('本脚本非门禁：始终退出 0。');
}

main().catch((err: unknown) => {
  console.error('审计运行失败：', err);
  process.exit(1);
});

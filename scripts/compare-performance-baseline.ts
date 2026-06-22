#!/usr/bin/env bun
/**
 * 启动性能基线比对脚本
 *
 * 比对当前启动性能数据与上一次基线，检测性能劣化。
 * 用于 CI 门禁，劣化超过阈值时以非零退出码阻断。
 *
 * 用法:
 *   bun run scripts/compare-performance-baseline.ts [options]
 *
 * 选项:
 *   --baseline <path>       基线文件路径（默认为 app/docs/performance-baseline.json）
 *   --current <path>        当前性能数据路径（默认为 app/perf-summary.json）
 *   --total-threshold <n>   总启动耗时阈值百分比（默认 110，即劣化 ≤ 10%）
 *   --memory-threshold <n>  RSS 内存阈值百分比（默认 115，即劣化 ≤ 15%）
 *   --phase-threshold <n>   阶段耗时阈值百分比（默认 120，即劣化 ≤ 20%）
 *   --verbose               输出详细比对信息
 *
 * 退出码:
 *   0 — 性能在阈值范围内
 *   1 — 性能劣化超过阈值
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ============ 类型定义 ============

interface PerformanceBaseline {
  metadata: {
    timestamp: string;
    version: string;
    platform: string;
    arch: string;
    bootStrategy: string;
  };
  totalStartupMs: number;
  memory: {
    beforeRssMB: number;
    afterRssMB: number;
    rssDeltaMB: number;
    beforeHeapMB: number;
    afterHeapMB: number;
    heapDeltaMB: number;
  };
  phases: Array<{
    phase: string;
    durationMs: number;
    success: boolean;
    handlerCount: number;
    failedCount: number;
  }>;
  phaseSummary: Array<{
    phase: string;
    durationMs: number;
    ratio: number;
  }>;
  success: boolean;
}

interface ComparisonResult {
  /** 是否通过 */
  pass: boolean;
  /** 所有检查项 */
  checks: Array<{
    name: string;
    baseline: number;
    current: number;
    threshold: number;
    actualRatio: number;
    pass: boolean;
  }>;
}

// ============ 解析命令行参数 ============

const args = process.argv.slice(2);

function getArg(flag: string, defaultValue: string): string {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return defaultValue;
}

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

const baselinePath = resolve(
  getArg('--baseline', resolve(import.meta.dir, '../app/docs/performance-baseline.json')),
);
const currentPath = resolve(
  getArg('--current', resolve(import.meta.dir, '../app/perf-summary.json')),
);
const totalThreshold = Number.parseFloat(getArg('--total-threshold', '110'));
const memoryThreshold = Number.parseFloat(getArg('--memory-threshold', '115'));
const phaseThreshold = Number.parseFloat(getArg('--phase-threshold', '120'));
const verbose = hasFlag('--verbose');

// ============ 加载性能数据 ============

function loadJson(path: string): PerformanceBaseline | null {
  if (!existsSync(path)) {
    console.error(`[perf-compare] 文件不存在: ${path}`);
    return null;
  }
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as PerformanceBaseline;
  } catch (error) {
    console.error(`[perf-compare] 解析失败: ${path}`, error);
    return null;
  }
}

// ============ 核心比对逻辑 ============

function compare(
  baseline: PerformanceBaseline,
  current: PerformanceBaseline,
): ComparisonResult {
  const checks: ComparisonResult['checks'] = [];

  // 1. 总启动耗时比对
  const totalRatio = (current.totalStartupMs / baseline.totalStartupMs) * 100;
  checks.push({
    name: '总启动耗时',
    baseline: baseline.totalStartupMs,
    current: current.totalStartupMs,
    threshold: totalThreshold,
    actualRatio: Math.round(totalRatio * 100) / 100,
    pass: totalRatio <= totalThreshold,
  });

  // 2. RSS 内存增量比对
  const rssRatio = (current.memory.rssDeltaMB / baseline.memory.rssDeltaMB) * 100;
  checks.push({
    name: 'RSS 内存增量',
    baseline: baseline.memory.rssDeltaMB,
    current: current.memory.rssDeltaMB,
    threshold: memoryThreshold,
    actualRatio: Math.round(rssRatio * 100) / 100,
    pass: rssRatio <= memoryThreshold,
  });

  // 3. Heap 内存增量比对
  const heapRatio = (current.memory.heapDeltaMB / baseline.memory.heapDeltaMB) * 100;
  checks.push({
    name: 'Heap 内存增量',
    baseline: baseline.memory.heapDeltaMB,
    current: current.memory.heapDeltaMB,
    threshold: memoryThreshold,
    actualRatio: Math.round(heapRatio * 100) / 100,
    pass: heapRatio <= memoryThreshold,
  });

  // 4. 各阶段耗时比对（取基线中存在的阶段）
  const baselinePhaseMap = new Map(
    baseline.phases.map((p) => [p.phase, p.durationMs]),
  );
  for (const currentPhase of current.phases) {
    const baselineDuration = baselinePhaseMap.get(currentPhase.phase);
    if (baselineDuration && baselineDuration > 0) {
      const phaseRatio =
        (currentPhase.durationMs / baselineDuration) * 100;
      checks.push({
        name: `阶段耗时: ${currentPhase.phase}`,
        baseline: baselineDuration,
        current: currentPhase.durationMs,
        threshold: phaseThreshold,
        actualRatio: Math.round(phaseRatio * 100) / 100,
        pass: phaseRatio <= phaseThreshold,
      });
    }
  }

  // 汇总
  const allChecksPass = checks.every((c) => c.pass);
  return { pass: allChecksPass, checks };
}

// ============ 输出格式化 ============

function formatResult(result: ComparisonResult): void {
  console.log('');
  console.log('='.repeat(70));
  console.log('  启动性能基线比对报告');
  console.log('='.repeat(70));
  console.log('');
  console.log('  Baseline  Threshold  Current    Ratio   Status  检查项');
  console.log('  ' + '-'.repeat(64));

  for (const check of result.checks) {
    const statusMark = check.pass ? '✓ PASS' : '✗ FAIL';
    const ratioStr =
      check.actualRatio > 999
        ? `${check.actualRatio.toFixed(0)}%`
        : `${check.actualRatio.toFixed(1).padStart(6)}%`;
    const thresholdStr = `${check.threshold.toFixed(0)}%`.padStart(4);
    const baselineStr =
      check.baseline >= 100
        ? `${check.baseline.toFixed(0)}`.padStart(8)
        : `${check.baseline.toFixed(2)}`.padStart(8);
    const currentStr =
      check.current >= 100
        ? `${check.current.toFixed(0)}`.padStart(8)
        : `${check.current.toFixed(2)}`.padStart(8);

    console.log(
      `  ${baselineStr}  ${thresholdStr}  ${currentStr}  ${ratioStr}  ${statusMark}  ${check.name}`,
    );
  }

  console.log('  ' + '-'.repeat(64));
  console.log('');
  console.log(`  结果: ${result.pass ? '✅ 全部通过' : '❌ 存在劣化'}`);
  console.log('');
}

// ============ 主流程 ============

async function main(): Promise<void> {
  // 加载基线数据
  const baseline = loadJson(baselinePath);
  if (!baseline) {
    console.log('[perf-compare] 无基线文件可用，跳过比对（首次运行将建立基线）');
    process.exit(0);
  }

  // 加载当前数据
  const current = loadJson(currentPath);
  if (!current) {
    console.error(
      '[perf-compare] 当前性能数据不存在，请先运行 benchmark-startup.ts',
    );
    process.exit(1);
  }

  // 版本/平台兼容性检查
  if (baseline.metadata.bootStrategy !== current.metadata.bootStrategy) {
    console.warn(
      `[perf-compare] 警告: 启动策略不一致 (基线: ${baseline.metadata.bootStrategy}, 当前: ${current.metadata.bootStrategy})`,
    );
    console.warn('[perf-compare] 比对结果可能不准确');
  }

  if (baseline.metadata.platform !== current.metadata.platform) {
    console.warn(
      `[perf-compare] 警告: 运行平台不一致 (基线: ${baseline.metadata.platform}, 当前: ${current.metadata.platform})`,
    );
    console.warn('[perf-compare] 跳过比对（跨平台不可比）');
    process.exit(0);
  }

  // 执行比对
  const result = compare(baseline, current);
  formatResult(result);

  // 输出详细日志
  if (verbose && !result.pass) {
    const failedChecks = result.checks.filter((c) => !c.pass);
    console.log('  劣化详情:');
    for (const c of failedChecks) {
      console.log(
        `    - ${c.name}: 基线 ${c.baseline} → 当前 ${c.current} (${c.actualRatio}%, 阈值 ${c.threshold}%)`,
      );
    }
    console.log('');
  }

  process.exit(result.pass ? 0 : 1);
}

main();

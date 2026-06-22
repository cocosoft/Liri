#!/usr/bin/env bun
/**
 * 启动性能基线测量脚本 — BootPipeline 版本
 *
 * 通过新的 BootPipeline（executePipeline）采集启动性能基线数据：
 * - 各启动阶段耗时（BootResult.phases）
 * - 启动前后内存变化（rss / heapUsed）
 *
 * 基线数据写入 docs/performance-baseline.json，作为后续重构的性能参照。
 *
 * 用法：
 *   bun run scripts/benchmark-startup.ts
 *
 * 输出：
 *   docs/performance-baseline.json — 结构化基线数据
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

// ============================================================
// 1. 记录启动前内存基线
// ============================================================
const memBefore = process.memoryUsage();
const memBeforeRss = memBefore.rss;
const memBeforeHeap = memBefore.heapUsed;

// ============================================================
// 2. 启用性能分析模式
// ============================================================
process.env.Liri_PROFILE_STARTUP = '1';
process.env.LIRI_BENCHMARK_MODE = '1'; // 防止进入交互式 REPL

console.log('[benchmark] 开始启动性能基线测量...');
console.log(`[benchmark] 启动前 RSS: ${(memBeforeRss / 1024 / 1024).toFixed(2)} MB`);
console.log(`[benchmark] 启动前 Heap: ${(memBeforeHeap / 1024 / 1024).toFixed(2)} MB`);
console.log('');

// ============================================================
// 3. 通过 BootPipeline 执行启动流程
// ============================================================
const startTime = performance.now();

let bootResult;
try {
  const { executePipeline } = await import('../src/core/boot/BootPipelineIntegrator.ts');

  // executePipeline() 内部调用 registerStandardHandlers() 注册 8 阶段处理器，
  // 然后按顺序执行各阶段。其中 Phase 4 (DI_STARTUP) 已包含真实 DIContainer.bootstrap() 逻辑。
  bootResult = await executePipeline({
    mode: 'test',
    skipEnvInit: true,
  });
} catch (error) {
  console.error('[benchmark] BootPipeline 执行错误:', error);
  // 继续执行，收集已有的阶段数据
}

const totalStartupMs = performance.now() - startTime;
console.log(`[benchmark] BootPipeline 执行完成，总耗时: ${totalStartupMs.toFixed(2)} ms`);
console.log('');

// ============================================================
// 4. 采集性能数据
// ============================================================

// 4a. 从 BootResult 获取阶段耗时
const phases = bootResult?.phases ?? [];

// 4b. 记录启动后内存
const memAfter = process.memoryUsage();
const memAfterRss = memAfter.rss;
const memAfterHeap = memAfter.heapUsed;

// 4c. 格式化阶段时间为结构化数据
const phaseEntries = phases
  .filter((p) => p.duration > 0)
  .map((p) => ({
    phase: p.label,
    durationMs: Math.round(p.duration),
    success: p.success,
    handlerCount: p.handlerCount,
    failedCount: p.failedCount,
  }))
  .sort((a, b) => b.durationMs - a.durationMs);

// 4d. 计算阶段占比
const totalPhaseMs = phaseEntries.reduce((sum, p) => sum + p.durationMs, 0);
const phaseSummary = phaseEntries.map((entry) => ({
  phase: entry.phase,
  durationMs: entry.durationMs,
  ratio: totalPhaseMs > 0
    ? Math.round((entry.durationMs / totalPhaseMs) * 10000) / 10000
    : 0,
}));

// ============================================================
// 5. 构建基线 JSON
// ============================================================
const baseline = {
  /** 元数据 */
  metadata: {
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '0.0.0',
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    /** 标注使用 BootPipeline 路径 */
    bootStrategy: 'BootPipeline',
  },

  /** 总启动耗时 */
  totalStartupMs: Math.round(totalStartupMs * 100) / 100,

  /** 内存基线 */
  memory: {
    beforeRssMB: Math.round((memBeforeRss / 1024 / 1024) * 100) / 100,
    afterRssMB: Math.round((memAfterRss / 1024 / 1024) * 100) / 100,
    rssDeltaMB:
      Math.round(((memAfterRss - memBeforeRss) / 1024 / 1024) * 100) / 100,
    beforeHeapMB: Math.round((memBeforeHeap / 1024 / 1024) * 100) / 100,
    afterHeapMB: Math.round((memAfterHeap / 1024 / 1024) * 100) / 100,
    heapDeltaMB:
      Math.round(((memAfterHeap - memBeforeHeap) / 1024 / 1024) * 100) / 100,
  },

  /** 启动阶段耗时明细（来自 BootPipeline） */
  phases: phaseEntries,

  /** 阶段摘要（含占比） */
  phaseSummary,

  /** 启动是否全部成功 */
  success: bootResult?.success ?? false,
};

// ============================================================
// 6. 写入 docs/performance-baseline.json
// ============================================================
const docsDir = resolve(import.meta.dir, '../docs');
if (!existsSync(docsDir)) {
  mkdirSync(docsDir, { recursive: true });
}

const baselinePath = resolve(docsDir, 'performance-baseline.json');
writeFileSync(baselinePath, JSON.stringify(baseline, null, 2), 'utf-8');

console.log('='.repeat(60));
console.log('性能基线测量完成');
console.log('='.repeat(60));
console.log(`启动策略:       ${baseline.metadata.bootStrategy}`);
console.log(`总启动耗时:     ${baseline.totalStartupMs} ms`);
console.log(`启动前 RSS:     ${baseline.memory.beforeRssMB} MB`);
console.log(`启动后 RSS:     ${baseline.memory.afterRssMB} MB`);
console.log(`RSS 增长:       ${baseline.memory.rssDeltaMB} MB`);
console.log(`启动前 Heap:    ${baseline.memory.beforeHeapMB} MB`);
console.log(`启动后 Heap:    ${baseline.memory.afterHeapMB} MB`);
console.log(`Heap 增长:      ${baseline.memory.heapDeltaMB} MB`);
console.log(`阶段数:         ${baseline.phases.length}`);
console.log(`启动成功:       ${baseline.success}`);
console.log('');

// 输出各阶段耗时
if (phaseEntries.length > 0) {
  console.log('— 各阶段耗时（从高到低）—');
  for (const entry of phaseEntries) {
    const icon = entry.success ? '✓' : '✗';
    console.log(`  ${icon} ${entry.durationMs.toString().padStart(8)} ms  ${entry.phase}` +
      `  (handlers: ${entry.handlerCount}, failed: ${entry.failedCount})`);
  }
}

process.exit(baseline.success ? 0 : 1);

#!/usr/bin/env bun
/**
 * 覆盖率门槛检查脚本
 *
 * 读取 bun test --coverage 生成的 lcov.info 文件，
 * 计算整体行覆盖率并与预设门槛比较。
 * 低于门槛时以非零退出码退出，供 CI 门禁使用。
 *
 * 用法:
 *   bun run scripts/check-coverage-threshold.ts [threshold]
 *   默认门槛: 40（百分比）
 *
 * 依赖:
 *   需先执行 bun test --coverage --coverage-reporter=lcov
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import {
  evaluateCriticalModules,
  parseLcovByFile,
  type CriticalCoverageConfig,
} from './coverageCriticalCore';

const COVERAGE_DIR = resolve(import.meta.dir, '../coverage');
const LCOV_FILE = process.env['COVERAGE_LCOV_FILE']
  ? resolve(process.env['COVERAGE_LCOV_FILE'])
  : resolve(COVERAGE_DIR, 'lcov.info');
/** 关键模块专属门槛（2026-11-01）：不在配置里 ⇒ 跳过；配置非法 ⇒ fail-closed */
const CRITICAL_CONFIG = process.env['COVERAGE_CRITICAL_CONFIG']
  ? resolve(process.env['COVERAGE_CRITICAL_CONFIG'])
  : resolve(
      import.meta.dir,
      '../../.trae/architecture/coverage-critical-modules.json'
    );

/**
 * 解析 lcov.info 文件，提取行覆盖率数据
 */
function parseLcov(filePath: string): {
  /** 总行数 */
  totalLines: number;
  /** 已覆盖行数 */
  coveredLines: number;
} {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  let totalLines = 0;
  let coveredLines = 0;

  for (const line of lines) {
    // DA:<lineNumber>,<hitCount>
    if (line.startsWith('DA:')) {
      const [, hitCountStr] = line.split(',');
      totalLines++;
      if (parseInt(hitCountStr, 10) > 0) {
        coveredLines++;
      }
    }
  }

  return { totalLines, coveredLines };
}

/**
 * 关键模块专属门槛。返回违规条数（0 = 全部通过）。
 * 配置缺失 ⇒ 跳过（向后兼容）；解析失败 / 结构非法 ⇒ **fail-closed**（返回 1）。
 */
function checkCriticalModules(): number {
  if (!existsSync(CRITICAL_CONFIG)) {
    console.log(
      `[coverage-check] 关键模块门槛：未配置 ⇒ 跳过（${CRITICAL_CONFIG}）`
    );
    return 0;
  }

  let config: CriticalCoverageConfig;
  try {
    config = JSON.parse(
      readFileSync(CRITICAL_CONFIG, 'utf-8')
    ) as CriticalCoverageConfig;
  } catch (e) {
    console.error(
      `[coverage-check] ❌ 关键模块配置无法解析（fail-closed）: ${String(e)}`
    );
    return 1;
  }

  const modules = Array.isArray(config?.modules) ? config.modules : null;
  if (!modules) {
    console.error(
      '[coverage-check] ❌ 关键模块配置缺 modules 数组（fail-closed）'
    );
    return 1;
  }
  const invalid = modules.filter((m) => {
    const rule = m as Partial<{ path: unknown; minLineCoverage: unknown }>;
    return (
      typeof rule.path !== 'string' ||
      rule.path === '' ||
      typeof rule.minLineCoverage !== 'number'
    );
  });
  if (invalid.length > 0) {
    console.error(
      `[coverage-check] ❌ 关键模块配置有 ${invalid.length} 条缺 path/minLineCoverage（fail-closed）`
    );
    return 1;
  }
  if (modules.length === 0) {
    console.log('[coverage-check] 关键模块门槛：列表为空 ⇒ 跳过');
    return 0;
  }

  const files = parseLcovByFile(readFileSync(LCOV_FILE, 'utf-8'));
  const results = evaluateCriticalModules(files, { modules });
  let violations = 0;
  for (const r of results) {
    const label = `${r.rule.path} → ${r.percent}%（下限 ${r.rule.minLineCoverage}%）`;
    if (r.pass) {
      console.log(`[coverage-check] ✅ 关键模块 ${label}`);
      continue;
    }
    violations += 1;
    console.error(
      `[coverage-check] ❌ 关键模块 ${label} — ${r.reason ?? '未达标'}`
    );
  }
  if (violations === 0) {
    console.log(`[coverage-check] ✅ 关键模块全部达标（${results.length} 条）`);
  }
  return violations;
}

/**
 * 主函数
 */
function main(): void {
  // 阈值参数（默认 40%）
  const thresholdArg = process.argv[2];
  const threshold = thresholdArg ? parseInt(thresholdArg, 10) : 40;

  if (!existsSync(LCOV_FILE)) {
    console.error(`[coverage-check] 错误: 未找到覆盖率文件 ${LCOV_FILE}`);
    console.error(
      '[coverage-check] 请先执行: bun test --coverage --coverage-reporter=lcov'
    );
    process.exit(1);
  }

  const { totalLines, coveredLines } = parseLcov(LCOV_FILE);

  if (totalLines === 0) {
    console.error('[coverage-check] 错误: 覆盖率文件中无有效行数据');
    process.exit(1);
  }

  const coveragePercent = (coveredLines / totalLines) * 100;
  const rounded = Math.round(coveragePercent * 100) / 100;

  console.log(
    `[coverage-check] 行覆盖率: ${coveredLines}/${totalLines} = ${rounded}%`
  );
  console.log(`[coverage-check] 阈值: ${threshold}%`);

  let failed = false;
  if (coveragePercent >= threshold) {
    console.log(
      `[coverage-check] ✅ 通过 — 覆盖率 ${rounded}% >= ${threshold}%`
    );
  } else {
    console.error(
      `[coverage-check] ❌ 失败 — 覆盖率 ${rounded}% < ${threshold}%`
    );
    failed = true;
  }

  // 关键模块专属门槛（2026-11-01）：防止"全局达标掩盖关键模块 0 覆盖"
  if (checkCriticalModules() > 0) failed = true;

  process.exit(failed ? 1 : 0);
}

main();

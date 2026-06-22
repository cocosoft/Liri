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

const COVERAGE_DIR = resolve(import.meta.dir, '../coverage');
const LCOV_FILE = resolve(COVERAGE_DIR, 'lcov.info');

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
 * 主函数
 */
function main(): void {
  // 阈值参数（默认 40%）
  const thresholdArg = process.argv[2];
  const threshold = thresholdArg ? parseInt(thresholdArg, 10) : 40;

  if (!existsSync(LCOV_FILE)) {
    console.error(`[coverage-check] 错误: 未找到覆盖率文件 ${LCOV_FILE}`);
    console.error('[coverage-check] 请先执行: bun test --coverage --coverage-reporter=lcov');
    process.exit(1);
  }

  const { totalLines, coveredLines } = parseLcov(LCOV_FILE);

  if (totalLines === 0) {
    console.error('[coverage-check] 错误: 覆盖率文件中无有效行数据');
    process.exit(1);
  }

  const coveragePercent = (coveredLines / totalLines) * 100;
  const rounded = Math.round(coveragePercent * 100) / 100;

  console.log(`[coverage-check] 行覆盖率: ${coveredLines}/${totalLines} = ${rounded}%`);
  console.log(`[coverage-check] 阈值: ${threshold}%`);

  if (coveragePercent >= threshold) {
    console.log(`[coverage-check] ✅ 通过 — 覆盖率 ${rounded}% >= ${threshold}%`);
    process.exit(0);
  } else {
    console.error(`[coverage-check] ❌ 失败 — 覆盖率 ${rounded}% < ${threshold}%`);
    process.exit(1);
  }
}

main();

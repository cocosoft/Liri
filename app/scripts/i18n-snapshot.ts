/**
 * i18n 快照与覆盖率检查脚本
 *
 * 用法：
 *   bun run scripts/i18n-snapshot.ts check    — 覆盖率 + 快照对比
 *   bun run scripts/i18n-snapshot.ts snapshot — 生成/更新快照文件
 *
 * 运行目录：app/
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// 直接解析项目根目录，避免触发 configManager 等重量级模块初始化链
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

// 直接从源文件导入（不经过 barrel index，减少依赖链）
import {
  getI18nTranslationRegistry,
  initializeBuiltinTranslations,
} from '../src/system/i18n/extended';

const SNAPSHOT_FILE = resolve(PROJECT_ROOT, 'data', 'i18n-snapshot.json');

function runCheck(): void {
  const registry = getI18nTranslationRegistry();
  initializeBuiltinTranslations(registry);

  // ── 覆盖率检查 ──────────────────────────────
  const coverage = registry.checkCoverage();

  console.log('=== i18n 覆盖率报告 ===');
  console.log(`总 key 数: ${coverage.totalKeys}`);
  console.log(`已覆盖 locale: ${coverage.locales.join(', ')}`);

  for (const locale of coverage.locales) {
    const pct = coverage.completeness[locale] ?? 100;
    const status = pct === 100 ? '✓' : '✗';
    console.log(`  ${status} ${locale}: ${pct.toFixed(2)}%`);
  }

  if (!coverage.allComplete) {
    console.log('\n❌ 覆盖率不足 100%，缺失项:');
    for (const [locale, keys] of Object.entries(coverage.missingByLocale)) {
      console.log(`  ${locale} (${keys.length} 个): ${keys.join(', ')}`);
    }
    process.exit(1);
  }

  console.log('✓ 覆盖率 100%\n');

  // ── 快照对比 ───────────────────────────────
  if (!existsSync(SNAPSHOT_FILE)) {
    console.log('⚠ 快照文件不存在，请先运行: bun run i18n:snapshot');
    process.exit(0);
  }

  const snapshot = JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf-8'));
  const current = registry.exportAsJSON();

  const diffs: string[] = [];
  const allKeys = new Set([...Object.keys(snapshot), ...Object.keys(current)]);

  for (const key of allKeys) {
    const oldVal = snapshot[key];
    const newVal = current[key];

    if (oldVal === undefined && newVal !== undefined) {
      diffs.push(`  + ${key} = "${newVal}"`);
    } else if (newVal === undefined && oldVal !== undefined) {
      diffs.push(`  - ${key} = "${oldVal}"`);
    } else if (oldVal !== newVal) {
      diffs.push(`  ~ ${key}: "${oldVal}" → "${newVal}"`);
    }
  }

  if (diffs.length > 0) {
    console.log('=== i18n 快照差异 ===');
    console.log(diffs.join('\n'));
    console.log('\n⚠ 翻译快照已变更，如果是预期修改请运行: bun run i18n:snapshot');
    process.exit(1);
  }

  console.log('✓ 快照对比一致');
}

function runSnapshot(): void {
  const registry = getI18nTranslationRegistry();
  initializeBuiltinTranslations(registry);

  const current = registry.exportAsJSON();

  writeFileSync(SNAPSHOT_FILE, JSON.stringify(current, null, 2) + '\n', 'utf-8');

  const keyCount = Object.keys(current).length;
  console.log(`✓ 翻译快照已更新: ${SNAPSHOT_FILE} (${keyCount} keys)`);
}

// ── 入口 ──────────────────────────────────────
const mode = process.argv[2];

if (mode === 'snapshot') {
  runSnapshot();
} else {
  runCheck();
}

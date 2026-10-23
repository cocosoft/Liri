#!/usr/bin/env bun
/**
 * lint-critical-modules.ts — **CRITICAL 清单棘轮门禁**（内核瘦身 P2 / 方案 §3 B3）
 *
 * 做什么：把 `LazyModuleStrategy` 的 CRITICAL 清单与基线
 * `.trae/architecture/critical-modules-baseline.json` 比较 —— **只允许收窄**。
 *
 * 三条判据（口径实现在 `criticalModulesCore.ts`，与测试共用）：
 *   1. 新增 CRITICAL 未在基线报备 ⇒ exit 1（启动面回涨）；
 *   2. `MODULE_INITIALIZATION_ORDER` 里的模块未登记策略 ⇒ exit 1（任何阶段都不会初始化）；
 *   3. 登记为 CRITICAL 但 `trigger`（= 理由）为空 ⇒ exit 1。
 *
 * 为什么理由取 `trigger`：策略表已要求每条写"触发条件"，它就是"为什么必须进启动面"。
 * 再维护一份理由文案必然漂移（CS01）。
 *
 * 用法：
 *   bun run lint:critical-modules            # CI：比对基线
 *   bun run lint:critical-modules --update   # 收窄后下调基线，锁定成果
 *
 * 退出码：0 = 合规（或有可下调提示）；1 = 违规 / 基线非法。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  compareCriticalModules,
  toCriticalModulesBaseline,
  type CriticalModuleEntry,
  type CriticalModulesBaseline,
} from './criticalModulesCore';

const APP_DIR = resolve(import.meta.dir, '..');
const DEFAULT_BASELINE = resolve(
  APP_DIR,
  '../.trae/architecture/critical-modules-baseline.json'
);

const argUpdate = process.argv.includes('--update');

function loadBaseline(path: string): CriticalModulesBaseline {
  if (!existsSync(path)) {
    console.error(
      `基线不存在: ${path}（首次生成：bun run lint:critical-modules --update）`
    );
    process.exit(1);
  }
  try {
    const parsed = JSON.parse(
      readFileSync(path, 'utf-8')
    ) as CriticalModulesBaseline;
    if (!Array.isArray(parsed.modules)) {
      throw new Error('基线缺少 modules 数组');
    }
    return parsed;
  } catch (err) {
    console.error(`基线 JSON 非法: ${String(err)}`);
    process.exit(1);
  }
}

function today(): string {
  // 只用于基线元数据，不参与判定（避免时区/时钟影响门禁结论）
  return new Date().toISOString().slice(0, 10);
}

async function main(): Promise<number> {
  const baselinePath = process.env['CRITICAL_MODULES_BASELINE']
    ? resolve(APP_DIR, process.env['CRITICAL_MODULES_BASELINE'])
    : DEFAULT_BASELINE;

  // 运行时取事实源（零文本解析，策略表改写法也不会让门禁失效）
  const { getCriticalModuleRegistry, getDeclaredModuleIds } =
    await import('../../packages/kernel/src/core/LazyModuleStrategy');
  const { MODULE_INITIALIZATION_ORDER } =
    await import('../src/modules/ModuleDefinitions');

  const current: CriticalModuleEntry[] = getCriticalModuleRegistry();
  const declaredIds: string[] = getDeclaredModuleIds();
  const orderedIds: string[] = MODULE_INITIALIZATION_ORDER;

  if (argUpdate) {
    const next = toCriticalModulesBaseline(current, today());
    writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
    console.log(
      `✅ 基线已更新: ${baselinePath}（CRITICAL ${next.modules.length} 项 / 已登记模块 ${declaredIds.length}）`
    );
    return 0;
  }

  const baseline = loadBaseline(baselinePath);
  const comparison = compareCriticalModules(
    current,
    baseline,
    declaredIds,
    orderedIds
  );

  console.log('=== CRITICAL 清单棘轮（启动面只允许收窄） ===');
  console.log(
    `实测 CRITICAL ${current.length} 项 · 基线 ${baseline.modules.length} 项 · ` +
      `已登记模块 ${declaredIds.length} / 初始化顺序 ${orderedIds.length}`
  );
  console.log('----------------------------------------');

  for (const hint of comparison.hints) console.log(`ℹ️ ${hint}`);

  if (comparison.violations.length > 0) {
    console.error('❌ CRITICAL 清单违规：');
    for (const violation of comparison.violations) {
      console.error(`  - ${violation}`);
    }
    console.error(
      '（启动面棘轮：新模块默认 DEFERRED；确需进启动面请在基线登记理由并说明依据）'
    );
    return 1;
  }

  console.log('✅ 合规（无未报备的 CRITICAL，登记理由齐备）');
  return 0;
}

try {
  process.exit(await main());
} catch (err) {
  // 检查器自身失败不得当成通过（AR-3）
  console.error(`❌ CRITICAL 清单门禁执行失败（不视为通过）: ${String(err)}`);
  process.exit(1);
}

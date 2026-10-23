#!/usr/bin/env bun
/**
 * lint-kernel-surface.ts — **C2 内核面 allowlist 门禁**（内核瘦身 P3 / 方案 §2 C2、§6 D4）
 *
 * 做什么：扫描 `app/src/core` 的**顶层条目**（文件 / 目录），要求每个条目在
 * `.trae/architecture/kernel-surface-allowlist.json` 里**归入 6 个能力域之一**，
 * 或显式登记为 exceptions 并写明理由。
 *
 * 为什么按顶层条目、不按文件（D4）：子目录内部重构不该让清单漂移；而新增一个顶层子系统
 * 必然要选择"它属于哪个能力域" —— 那正是需要人裁定的时刻。
 *
 * 不做什么：出向依赖仍由既有 `lint:arch`（`core` 只允许依赖 `core`）负责，本门禁不重复实现。
 *
 * 用法：
 *   bun run lint:kernel-surface           # CI：未归类 / 域非法 / 理由缺失 ⇒ exit 1
 *
 * 退出码：0 = 合规（可有"清单过期"提示）；1 = 违规 / allowlist 非法。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  compareKernelSurface,
  KERNEL_DOMAINS,
  type KernelSurfaceActual,
  type KernelSurfaceAllowlist,
} from './kernelSurfaceCore';

const APP_DIR = resolve(import.meta.dir, '..');
/** 内核已物理迁出 `app/src/core` ⇒ 仓库根 `packages/kernel/src/core`（方案 §4-P4） */
const CORE_DIR = resolve(APP_DIR, '..', 'packages', 'kernel', 'src', 'core');
const DEFAULT_ALLOWLIST = resolve(
  APP_DIR,
  '../.trae/architecture/kernel-surface-allowlist.json'
);

/** 扫描内核面顶层条目：跳过测试目录、文档、空目录（git 不跟踪空目录） */
function scanSurface(): KernelSurfaceActual[] {
  const out: KernelSurfaceActual[] = [];
  for (const name of readdirSync(CORE_DIR).sort()) {
    if (name === '__tests__') continue;
    const full = join(CORE_DIR, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (readdirSync(full).length === 0) continue;
      out.push({ id: name, kind: 'dir' });
      continue;
    }
    if (name.endsWith('.md')) continue;
    if (name.endsWith('.test.ts') || name.endsWith('.spec.ts')) continue;
    if (!name.endsWith('.ts')) continue;
    out.push({ id: name, kind: 'file' });
  }
  return out;
}

function loadAllowlist(path: string): KernelSurfaceAllowlist {
  if (!existsSync(path)) {
    console.error(
      `allowlist 不存在: ${path}（见 .trae/architecture/kernel-surface-allowlist.json）`
    );
    process.exit(1);
  }
  try {
    const parsed = JSON.parse(
      readFileSync(path, 'utf-8')
    ) as KernelSurfaceAllowlist;
    if (!Array.isArray(parsed.entries) || !Array.isArray(parsed.exceptions)) {
      throw new Error('allowlist 缺少 entries / exceptions 数组');
    }
    return parsed;
  } catch (err) {
    console.error(`allowlist JSON 非法: ${String(err)}`);
    process.exit(1);
  }
}

async function main(): Promise<number> {
  const allowlistPath = process.env['KERNEL_SURFACE_ALLOWLIST']
    ? resolve(APP_DIR, process.env['KERNEL_SURFACE_ALLOWLIST'])
    : DEFAULT_ALLOWLIST;

  const actual = scanSurface();
  const allowlist = loadAllowlist(allowlistPath);
  const comparison = compareKernelSurface(actual, allowlist);

  console.log('=== C2 内核面 allowlist（按能力域） ===');
  console.log(
    `顶层条目 ${actual.length} 条（域内 ${allowlist.entries.length} / 例外 ${allowlist.exceptions.length}）`
  );
  const distribution = KERNEL_DOMAINS.map(
    (d) => `${d} ${comparison.domainCounts[d] ?? 0}`
  ).join(' · ');
  console.log(`域分布：${distribution}`);
  console.log('----------------------------------------');

  for (const hint of comparison.hints) console.log(`ℹ️ ${hint}`);

  if (comparison.violations.length > 0) {
    console.error('❌ 内核面 allowlist 违规：');
    for (const violation of comparison.violations) {
      console.error(`  - ${violation}`);
    }
    console.error(
      '（内核面只允许「已归域 / 已报备例外」的顶层条目；新增子系统请先在 allowlist 里裁定归属）'
    );
    return 1;
  }

  console.log('✅ 合规（每个内核面条目都已归域或登记例外）');
  return 0;
}

try {
  process.exit(await main());
} catch (err) {
  // 检查器自身失败不得当成通过（AR-3）
  console.error(`❌ 内核面门禁执行失败（不视为通过）: ${String(err)}`);
  process.exit(1);
}

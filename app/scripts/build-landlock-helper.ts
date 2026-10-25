#!/usr/bin/env bun
/**
 * build-landlock-helper.ts — 构建并复制 `landlock-run` helper 进发布包 · T25-11a（2026-10-25）
 *
 * 背景：helper 源码（纯 C11）在仓内，但**发布链从不构建/分发**它 ⇒ Linux 用户即使打开
 * `sandbox.landlock.bashEnabled` 也会 `capability-unavailable` 被拒；`code_run` 静默降级。
 *
 * 本脚本（仅在 **linux** 构建机上有效）：
 *   ① `cc -static`（优先，避免目标机 glibc 版本差异）→ 失败回退 `cc`；
 *   ② 输出到 `<target>/bin/landlock-run`（由 `resolveLandlockHelperPath()` 优先查找）；
 *   ③ `--require` ⇒ 构建失败即**失败**（发布链 fail-closed）。
 *
 * 用法（app 目录下）：
 *   bun run scripts/build-landlock-helper.ts --target=../dist/pkg --require
 */
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { LANDLOCK_HELPER_BIN_NAME } from '../src/sandbox/landlock/helperPaths';

/** 取参数：同时支持 `--key=value` 与 `--key value` */
function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const withEq = process.argv.find((a) => a.startsWith(prefix));
  if (withEq) return withEq.slice(prefix.length);
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const target = arg('target');
if (!target) {
  console.error(
    '用法: bun run scripts/build-landlock-helper.ts --target=<输出目录> [--require]'
  );
  process.exit(1);
}

const required = process.argv.includes('--require');

// 非 Linux：helper 无意义（Landlock 仅 Linux 内核），跳过且不算失败。
if (process.platform !== 'linux') {
  console.log(
    `[landlock-helper] 跳过：当前平台 ${process.platform} 不支持 Landlock（仅 Linux 需要该 helper）`
  );
  process.exit(0);
}

const source = resolve(
  import.meta.dir,
  '..',
  'src',
  'sandbox',
  'landlock',
  'native',
  'main.c'
);
if (!existsSync(source)) {
  const msg = `未找到 helper 源码：${source}`;
  if (required) {
    console.error(`[landlock-helper] 失败（--require）：${msg}`);
    process.exit(1);
  }
  console.warn(`[landlock-helper] 跳过：${msg}`);
  process.exit(0);
}

const destDir = join(resolve(target), 'bin');
const dest = join(destDir, LANDLOCK_HELPER_BIN_NAME);
mkdirSync(destDir, { recursive: true });

/** 先尝试静态链接；失败回退动态（与 CI sandbox-negative job 同口径） */
function compile(args: string[]): boolean {
  const r = spawnSync('cc', args, { stdio: 'inherit' });
  return r.status === 0;
}

const baseArgs = ['-O2', '-Wall', '-Wextra', '-o', dest, source];
const ok = compile(['-static', ...baseArgs]) || compile(baseArgs);

if (!ok) {
  const msg =
    '编译失败（需要 C 编译器 `cc`）。请安装 gcc/clang，或跳过 linux 包构建。';
  if (required) {
    console.error(`[landlock-helper] 失败（--require）：${msg}`);
    process.exit(1);
  }
  console.warn(`[landlock-helper] 跳过：${msg}`);
  process.exit(0);
}

chmodSync(dest, 0o755);
console.log(`[landlock-helper] ${LANDLOCK_HELPER_BIN_NAME} → ${dest}`);

// 自检：`--probe` 失败只告警（目标机内核可能不支持；发布物仍有效）
const probe = spawnSync(dest, ['--probe'], { stdio: 'ignore' });
if (probe.status !== 0) {
  console.warn(
    `[landlock-helper] 自检 --probe 未通过（status=${probe.status}）；` +
      '构建机内核可能不支持 Landlock，但不影响分发'
  );
}

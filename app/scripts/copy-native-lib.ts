#!/usr/bin/env bun
/**
 * copy-native-lib.ts — 把**当前平台**已构建的 Rust 原生库复制进发布包 · T25-09（2026-10-25）
 *
 * 背景：`app/native/index.js` 经 `bun:ffi dlopen` 加载 `target/release/libliri_native.*`。
 * 发布包的入口是打包后的 `dist/pkg/liri.js`（`__dirname` = 包根）⇒ 库必须落在
 * `<target>/target/release/`，否则运行时**静默降级 JS**（Rust 加速在发布包里等于未生效）。
 *
 * 用法（app 目录下）：
 *   bun run scripts/copy-native-lib.ts --target=../dist/pkg            # 缺库 ⇒ 告警后跳过
 *   bun run scripts/copy-native-lib.ts --target=../dist/pkg --require  # 缺库 ⇒ 失败（发布链 fail-closed）
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { nativeLibName, nativeSuffix } from '../native/loaderPaths';

/** 取参数：同时支持 `--key=value` 与 `--key value` 两种写法 */
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
    '用法: bun run scripts/copy-native-lib.ts --target=<输出目录> [--require]'
  );
  process.exit(1);
}

const required = process.argv.includes('--require');
const libName = nativeLibName(process.platform, nativeSuffix(process.platform));
const source = resolve(import.meta.dir, '..', 'native', 'target', 'release', libName);
const destDir = join(resolve(target), 'target', 'release');
const dest = join(destDir, libName);

if (!existsSync(source)) {
  const message =
    `未找到已构建的原生库：${source}\n` +
    '  先构建：cd native && cargo build --release（或 bun run native:build）';
  if (required) {
    console.error(`[copy-native-lib] 失败（--require）：${message}`);
    process.exit(1);
  }
  console.warn(`[copy-native-lib] 跳过：${message}`);
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(source, dest);
console.log(`[copy-native-lib] ${libName} → ${dest}`);

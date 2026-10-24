#!/usr/bin/env bun
/**
 * 发布产物冒烟 —— `dist/` 的唯一机检入口。
 *
 * 为什么需要它（2026-10-24 评审 A1/A3）：
 *  1. **单例一致性**：原先 `build` = tsc 逐模块产物 **再** `bun build` 覆盖 `dist/index.js`，
 *     `dist/` 里同时存在「桶内联副本」与「tsc 独立副本」⇒ 同时用桶与子路径的消费方会拿到
 *     两个模块实例（`globalEventBus` 订阅在 A、发布走 B，事件静默丢失）。本脚本断言
 *     **桶与子路径的同一导出必须是同一实例**；一旦有人把 bundler 加回 build，这里立刻红。
 *  2. **公开面不得通配**：`"./spi/*"` 这类目录通配会把 `dist` 下每个内部文件都变成公开 API
 *     （发布后不可回撤：收窄即破坏性变更）。故 exports 里出现 `*` 直接失败。
 *  3. **目标必须真实存在**：只「构建成功」不等于「发布后子路径可用」——曾出现 exports 指向
 *     `dist/core/*.js` 而 build 只产 `dist/index.js`，全部子路径 404。
 *
 * 调用方：`bun run smoke`（本包）、`prepublishOnly`、Kernel CI 的产物冒烟步骤。
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf8'));

const fail = (message) => {
  console.error(`❌ ${message}`);
  process.exit(1);
};

/** 相对包根的路径 → 可 import 的 file URL（Windows 绝对路径不能直接 import） */
const load = (rel) => import(pathToFileURL(resolve(pkgDir, rel)).href);

// ① 公开面不得有通配（A3）
const wildcards = Object.keys(pkg.exports).filter((key) => key.includes('*'));
if (wildcards.length > 0) {
  fail(`exports 不允许通配：${wildcards.join(', ')}（内部模块一旦可见即公开 API）`);
}

// ② 每个导出目标必须是真实文件
let checked = 0;
for (const [key, value] of Object.entries(pkg.exports)) {
  if (key === './package.json') continue;
  const targets =
    typeof value === 'string' ? [value] : [value.types, value.import].filter(Boolean);
  for (const target of targets) {
    if (!existsSync(resolve(pkgDir, target))) {
      fail(`exports 目标不存在：${key} -> ${target}`);
    }
    checked += 1;
  }
}

// ③ 桶面关键导出
const barrel = await load('dist/index.js');
for (const name of [
  'KERNEL_PACKAGE_NAME',
  'feature',
  'resolveDbPath',
  'AppError',
  'globalEventBus',
  'configureProductIdentity',
]) {
  if (barrel[name] === undefined) fail(`桶面缺失导出：${name}`);
}

// ④ 单例一致性（A1 的核心断言）
const deepEvents = await load('dist/core/events/EventBus.js');
if (barrel.globalEventBus !== deepEvents.globalEventBus) {
  fail('单例分裂：桶与 dist/core/events/EventBus.js 的 globalEventBus 不是同一实例');
}

// ⑤ 子路径产物真的可 import
await load('dist/core/paths.js');

console.log(
  `✅ dist 冒烟通过：${checked} 个 exports 目标存在 · 无通配 · 桶与子路径同实例（globalEventBus）`
);

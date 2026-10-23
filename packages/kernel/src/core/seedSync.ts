// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 首启种子数据同步 — 幂等
 *
 * 将打包内种子目录（<projectRoot>/app/data/pyapp，由 copy-seed-data 从
 * app/seed/pyapp 模板生成）中缺失的文件复制到用户数据目录（LIRI_HOME）。
 *
 * 规则：
 * - 仅同步种子白名单条目（SOUL.md / USER.md / knowledge / skills / memory-index）
 * - 目标文件已存在则跳过，绝不覆盖用户已有数据
 * - 源不存在时静默跳过（开发环境无打包种子属正常）
 */

import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { resolveProjectRoot, resolvePyappHome } from './paths';

/** 种子白名单（与 app/seed/pyapp 模板结构保持一致） */
const SEED_ENTRIES: readonly string[] = [
  'SOUL.md',
  'USER.md',
  'knowledge',
  'skills',
  'data/memory/memory-index.json',
];

/** 复制单个文件（目标已存在则跳过） */
function copyIfMissing(src: string, dest: string): void {
  if (existsSync(dest)) return;
  const destDir = dirname(dest);
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  copyFileSync(src, dest);
}

/** 递归复制目录（目标文件已存在则跳过） */
function syncDirIfMissing(srcDir: string, destDir: string): void {
  if (!existsSync(srcDir)) return;
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    const src = join(srcDir, entry);
    const dest = join(destDir, entry);
    if (existsSync(dest)) continue;
    if (statSync(src).isDirectory()) {
      syncDirIfMissing(src, dest);
    } else {
      copyFileSync(src, dest);
    }
  }
}

/**
 * 执行首启种子同步。
 * 打包/安装环境：把随包分发的种子模板落到用户数据目录；
 * 本地开发环境：source 为运行时数据目录，同样只同步白名单条目。
 */
export function syncSeedData(): void {
  const source = join(resolveProjectRoot(), 'app', 'data', 'pyapp');
  const target = resolvePyappHome();
  if (!existsSync(source)) return;

  for (const entry of SEED_ENTRIES) {
    const src = join(source, entry);
    if (!existsSync(src)) continue;
    const dest = join(target, entry);
    if (statSync(src).isDirectory()) {
      // 目录条目总是深入递归：内部按文件级判断，已有文件跳过、新文件补齐
      syncDirIfMissing(src, dest);
    } else {
      copyIfMissing(src, dest);
    }
  }
}

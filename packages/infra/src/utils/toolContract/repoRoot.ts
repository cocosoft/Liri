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
 * 取某目录**所属仓库根**（向上找 `.git`）。
 *
 * **要解决的事（P0-2 真机复核，2026-11-04 23:00–23:38）**：AlwaysOn 预置的工作区根是
 * **任务目标目录**（实测为 `app\src\ai\router` 这类叶子目录）；模型随后改兄弟目录
 * （`app\src\tasks\…`）就被判越界 ⇒ 15Z 窗口内 `工具路径越界` 41 次（14Z 仅 4 次）。
 * 只读列举/读取都在仓内，按**仓库根**授权才是这类编码任务的语义。
 *
 * **边界（不放松安全姿态）**
 *
 * - 只向上找 `.git`（目录或文件——worktree 的 `.git` 是文件），命中即返回该目录；
 * - 找不到（含目录不存在）⇒ `null`：调用方**保持原值**，行为与改造前逐字一致；
 * - 上限 `MAX_ASCEND` 层，避免异常路径一路走到盘符根再误判；
 * - 不做 `realpath`（symlink 逃逸仍由执行前的边界判定拦，本函数只管"种子根取哪层"）。
 */
import { existsSync } from 'node:fs';
import { join, parse, resolve } from 'node:path';

/** 向上攀升的最大层数（超过即视为"不在仓库内"） */
export const MAX_ASCEND_DEPTH = 12;

export function findEnclosingRepoRoot(
  dir: string | undefined
): string | null {
  if (!dir?.trim()) return null;
  let current = resolve(dir);
  for (let depth = 0; depth <= MAX_ASCEND_DEPTH; depth++) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = parse(current).dir;
    if (!parent || parent === current) return null;
    current = parent;
  }
  return null;
}

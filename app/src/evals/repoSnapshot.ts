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
 * S1（题源扩展 spec [`eval-task-source-expansion.md`](../../.trae/specs/eval-task-source-expansion.md) §4.1）
 * —— **真实修复类任务的历史快照**。
 *
 * 与 O1（从当前工作区派生纯函数）不同，S1 的**起点**是某个 fix commit 的**父提交树**：
 * "修复后的答案"必须从起点里**彻底移除**，否则被测 Agent 可直接抄答案。
 *
 * 三条取舍（均为 2026-09-26 实测所得，见 spec §4.5）：
 *  1. **用 `git archive` 导出，不用 `worktree` / `clone`** ⇒ 快照天然**不含 `.git`**；
 *     否则 `git log` / `git show` / `git diff` 会把修复 diff 直接交出去。
 *  2. **只导 ASCII 子树**：全量导 `app` 时 `tar.exe` 在中文目录（`app/docs/工具参考/**`）上**报错并静默缺文件**。
 *  3. **依赖供给按平台分流**：Windows 下 `..` 是**词法**解析（实测 `realpathSync` 不外溢）⇒ junction 可用；
 *     POSIX 下 `..` 会**穿出符号链接** ⇒ **禁用链接、改物理拷贝**（含体积闸；见下方 `supplyDeps`）。
 */

import { execFile } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * 快照要导出的路径（**只含 ASCII 路径** —— 见文件头取舍 2）。
 * 缺省即够跑 `bun test`：源码 + 测试 + 配置；文档/脚本不是判据所需。
 */
export const SNAPSHOT_PATHSPECS: readonly string[] = [
  'app/src',
  'app/tests',
  'app/package.json',
  'app/tsconfig.json',
  'app/bunfig.toml',
];

/** 子进程超时（`git archive` / `tar` 都是本地 IO，给足余量但不无限等） */
const GIT_TIMEOUT_MS = 120_000;

async function run(
  cmd: string,
  args: string[],
  cwd: string
): Promise<{ ok: boolean; stderr: string }> {
  try {
    await execFileAsync(cmd, args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      encoding: 'utf-8',
    });
    return { ok: true, stderr: '' };
  } catch (error) {
    const e = error as { stderr?: unknown; message?: unknown };
    return {
      ok: false,
      stderr: String(e.stderr ?? e.message ?? error),
    };
  }
}

/**
 * 候选路径中**该 commit 树里确实存在**的那些。
 *
 * 为什么需要：`git archive <commit> <path>` 只要有一个 pathspec 不匹配就**整体失败**
 * （不同历史提交里 `app/bunfig.toml` 之类未必存在）。
 */
export async function existingTreePaths(
  repoRoot: string,
  commit: string,
  candidates: readonly string[] = SNAPSHOT_PATHSPECS
): Promise<string[]> {
  const { stdout } = await execFileAsync(
    'git',
    ['ls-tree', '--name-only', commit, '--', ...candidates],
    {
      cwd: repoRoot,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
      encoding: 'utf-8',
    }
  );
  return String(stdout)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/** 递归统计文件数（快照完整性自检用：数量为 0 ⇒ 一定有问题） */
export function countFiles(dir: string): number {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += countFiles(join(dir, entry.name));
    else n += 1;
  }
  return n;
}

/**
 * 导出 `commit` 的**父提交**树到 `destRoot`（净化快照）。
 *
 * @returns `appDir`（快照内的 `app` 目录）+ 文件数 + 是否意外含 `.git`
 */
export async function createRepoSapshot(args: {
  repoRoot: string;
  commit: string;
  destRoot: string;
  paths?: readonly string[];
}): Promise<{ appDir: string; files: number; hasGitDir: boolean }> {
  const parent = `${args.commit}^`;
  // ⚠️ 路径必须按**被导出的那个提交（父提交）**判定存在性：fix 提交新增的目录（如 `app/tests`）
  // 在父提交里可能还不存在，若按 fix 提交判定会让 `git archive` 整体失败（合成仓库测试实测）。
  const paths = args.paths ?? (await existingTreePaths(args.repoRoot, parent));
  if (paths.length === 0) {
    throw new Error(`快照导出失败：${parent} 下没有任何候选路径存在`);
  }

  mkdirSync(args.destRoot, { recursive: true });
  const tarPath = join(args.destRoot, '_tree.tar');

  const archived = await run(
    'git',
    ['archive', '-o', tarPath, parent, ...paths],
    args.repoRoot
  );
  if (!archived.ok) {
    throw new Error(`git archive 失败（${parent}）：${archived.stderr}`);
  }
  const extracted = await run(
    'tar',
    ['-xf', tarPath, '-C', args.destRoot],
    args.destRoot
  );
  rmSync(tarPath, { force: true });
  if (!extracted.ok) {
    throw new Error(`tar 解包失败：${extracted.stderr}`);
  }

  const appDir = join(args.destRoot, 'app');
  if (!existsSync(appDir)) {
    throw new Error(`快照缺少 app 目录：${appDir}`);
  }
  return {
    appDir,
    files: countFiles(args.destRoot),
    hasGitDir: existsSync(join(args.destRoot, '.git')),
  };
}

/**
 * 把 `commit` 里的指定路径**覆盖**到快照（用于把该 commit **新增/修改的测试文件**放进去）。
 *
 * 测试文件是**判据**、不是答案（SWE-bench 同做法）；源码修复**不**覆盖。
 */
export async function overlayFromCommit(args: {
  repoRoot: string;
  commit: string;
  destRoot: string;
  paths: readonly string[];
}): Promise<void> {
  if (args.paths.length === 0) return;
  const tarPath = join(args.destRoot, '_overlay.tar');
  const archived = await run(
    'git',
    ['archive', '-o', tarPath, args.commit, ...args.paths],
    args.repoRoot
  );
  if (!archived.ok) {
    throw new Error(`覆盖测试文件失败（${args.commit}）：${archived.stderr}`);
  }
  const extracted = await run(
    'tar',
    ['-xf', tarPath, '-C', args.destRoot],
    args.destRoot
  );
  rmSync(tarPath, { force: true });
  if (!extracted.ok) {
    throw new Error(`覆盖解包失败：${extracted.stderr}`);
  }
}

/** 依赖供给方式（`junction` = Windows 链接；`copy` = 物理拷贝，用于 POSIX） */
export type DepsMode = 'junction' | 'copy';

/** POSIX 物理拷贝的体积闸（默认 1 GiB）：超过即 fail-closed 拒绝，避免一次意外的巨量拷贝 */
export const POSIX_DEPS_MAX_COPY_BYTES = 1_073_741_824;

/** 递归求目录字节数（仅用于**拷贝前的体积闸**；失败按 0 处理 ⇒ 不因统计失败而放大拷贝） */
function dirSizeBytes(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) total += dirSizeBytes(abs);
    else if (entry.isFile()) {
      // @ignore-catch 统计是**尽力而为**（符号链接/权限异常 ⇒ 该文件按 0 计）
      try {
        total += lstatSync(abs).size;
      } catch {
        /* 见上 */
      }
    }
  }
  return total;
}

/**
 * 给快照供给依赖（`app/node_modules`）。
 *
 * **平台分流**：
 * - `win32` ⇒ **junction**（实测 `..` 是**词法**解析、`realpathSync` 也不外溢 ⇒ 安全、零拷贝成本）；
 * - **其它平台** ⇒ **物理拷贝**（`fs.cpSync`）—— 因 POSIX 下 `..` 会**穿出符号链接**，
 *   junction/symlink 会把真实仓库暴露给被测 Agent ⇒ **禁用链接**。拷贝无链接 ⇒ 无越界面。
 *   为避免一次意外的巨量拷贝，超过 `maxCopyBytes`（默认 1 GiB）即 **fail-closed 拒绝**并把出路写进原因。
 *
 * 返回结构化结果（不抛错），使调用方能把"为什么跑不了"如实带进报告（不静默降级）。
 */
export function supplyDeps(
  appDir: string,
  realAppDir: string,
  platform: NodeJS.Platform = process.platform,
  maxCopyBytes: number = POSIX_DEPS_MAX_COPY_BYTES
):
  | { ok: true; mode: DepsMode; bytes?: number }
  | { ok: false; reason: string } {
  const link = join(appDir, 'node_modules');
  const target = join(realAppDir, 'node_modules');
  if (existsSync(link)) {
    return { ok: true, mode: platform === 'win32' ? 'junction' : 'copy' };
  }
  if (!existsSync(target)) {
    return { ok: false, reason: `真实依赖目录不存在：${target}` };
  }

  if (platform !== 'win32') {
    const bytes = dirSizeBytes(target);
    if (bytes > maxCopyBytes) {
      return {
        ok: false,
        reason:
          `依赖体积 ${Math.round(bytes / 1024 / 1024)}MB 超过拷贝闸 ` +
          `${Math.round(maxCopyBytes / 1024 / 1024)}MB ⇒ 拒绝（避免意外巨量拷贝）；` +
          '如需更大，请显式提高阈值，或改用"仓内快照 + 整仓屏蔽 + 白名单例外"（未实现）',
      };
    }
    cpSync(target, link, { recursive: true });
    return { ok: true, mode: 'copy', bytes };
  }

  symlinkSync(target, link, 'junction');
  return { ok: true, mode: 'junction' };
}

/**
 * 删除快照。
 *
 * ⚠️ **必须先以非递归方式删链接**：若直接递归删目录，某些实现会**跟随 junction**
 * 进而删掉真实仓库的 `node_modules`（本函数刻意不递归删链接本体）。
 */
export function removeRepoSapshot(destRoot: string): void {
  const link = join(destRoot, 'app', 'node_modules');
  // ⚠️ 必须区分两种供给方式（实测 2026-09-26）：
  //  - **链接**（junction/symlink，Windows）⇒ `rmdirSync` 只删重解析点、**不跟随**；
  //    （`rmSync(recursive:false)` 对 junction 报 `EFAULT`；`recursive:true` 有递归进目标的风险 ⇒ 都不用）
  //  - **物理拷贝**（POSIX）⇒ 是**真目录**，`rmdirSync` 会报 `ENOTEMPTY` ⇒ 必须递归删。
  if (existsSync(link)) {
    if (lstatSync(link).isSymbolicLink()) rmdirSync(link);
    else rmSync(link, { recursive: true, force: true });
  }
  rmSync(destRoot, { recursive: true, force: true });
}

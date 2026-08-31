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
 * WorkspaceApply — worktree 改动回灌主项目（G1，对标 PilotDeck WorkspaceApply）
 *
 * 将隔离 worktree 中 agent 产生的改动（含新建文件）生成 patch，并应用回主项目：
 *   1. `git -C <worktree> add -A` —— 暂存全部改动（diff HEAD 才能覆盖新建文件）
 *   2. `git -C <worktree> diff --cached HEAD --binary` —— 生成完整 patch
 *   3. `git -C <projectRoot> apply --3way` —— 三路合并应用；冲突即失败返回错误（不自动 merge）
 *
 * 安全边界：apply 流程本身只做本地 diff/apply，不涉及 push/remote 等远程操作；
 * 自主运行（always-on）场景的远程操作 deny 由 DreamDenyRules 负责。
 *
 * 所有 git 调用使用 spawn 数组参数（非 execSync 字符串拼接），避免命令注入。
 */
import { spawn } from 'child_process';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('workspaces:apply');

/** patch 内联上限（超大 diff 截断，避免内存/传输膨胀） */
export const MAX_INLINE_DIFF_CHARS = 80_000;

/** 生成的工作区 diff */
export interface WorkspaceDiff {
  diff: string;
  fileCount: number;
  truncated: boolean;
}

/** 回灌结果 */
export interface ApplyResult {
  applied: boolean;
  diff?: string;
  error?: string;
}

interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** 执行进程（数组参数 + 可选 stdin），避免 shell 注入 */
async function runProcess(
  bin: string,
  args: string[],
  stdin?: string
): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolve) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf-8');
    });
    child.on('error', (error) => {
      resolve({ exitCode: -1, stdout, stderr: error.message });
    });
    child.on('close', (code) => {
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
    if (stdin !== undefined) {
      child.stdin?.write(stdin);
    }
    child.stdin?.end();
  });
}

/**
 * 生成 worktree 相对其 base（HEAD）的改动 diff（含新建文件）
 *
 * 用 `git add -A -N`（intent-to-add）+ `git diff HEAD`：
 * - `-N` 将新文件标记为 intent-to-add，使 `diff HEAD` 能包含新建文件，
 *   且**不修改 index blob 内容**（区别于 `add -A` + `diff --cached`，
 *   后者在目标仓库应用时可能触发 index 检查冲突）。
 * - patch 的 pre-image 均为 HEAD blob，`git apply --3way` 可正确回灌。
 */
export async function generateWorkspaceDiff(
  worktreePath: string,
  gitBin = 'git'
): Promise<WorkspaceDiff> {
  const addAll = await runProcess(gitBin, [
    '-C',
    worktreePath,
    'add',
    '-A',
    '-N',
  ]);
  if (addAll.exitCode !== 0) {
    logger.warn('generateWorkspaceDiff: git add -A -N failed', {
      worktreePath,
      stderr: addAll.stderr.slice(0, 500),
    });
    return { diff: '', fileCount: 0, truncated: false };
  }

  const statResult = await runProcess(gitBin, [
    '-C',
    worktreePath,
    'diff',
    'HEAD',
    '--stat',
  ]);
  const fileCount =
    statResult.exitCode === 0
      ? (statResult.stdout.match(/\n/g) || []).length - 1
      : 0;

  const diffResult = await runProcess(gitBin, [
    '-C',
    worktreePath,
    'diff',
    'HEAD',
    '--binary',
  ]);
  if (diffResult.exitCode !== 0 || !diffResult.stdout.trim()) {
    return { diff: '', fileCount: Math.max(fileCount, 0), truncated: false };
  }

  const fullDiff = diffResult.stdout;
  if (fullDiff.length > MAX_INLINE_DIFF_CHARS) {
    logger.warn('generateWorkspaceDiff: diff 超长已截断', {
      worktreePath,
      length: fullDiff.length,
    });
    return {
      diff: fullDiff.slice(0, MAX_INLINE_DIFF_CHARS),
      fileCount: Math.max(fileCount, 0),
      truncated: true,
    };
  }
  return {
    diff: fullDiff,
    fileCount: Math.max(fileCount, 0),
    truncated: false,
  };
}

/**
 * 生成 snapshot-copy 隔离目录相对主项目的差异（`diff -ruN`，G2）
 *
 * 平台限制：需要 POSIX `diff` 命令（Windows 默认无）——不可用时返回空 diff。
 * diff 退出码 1 = 有差异，0 = 无差异，>1 = 错误。
 */
export async function generateSnapshotCopyDiff(
  projectRoot: string,
  snapshotCwd: string
): Promise<WorkspaceDiff> {
  const result = await runProcess('diff', [
    '-ruN',
    '--exclude=.git',
    '--exclude=node_modules',
    '--exclude=dist',
    '--exclude=output',
    '--exclude=downloads',
    projectRoot,
    snapshotCwd,
  ]);
  if (result.exitCode > 1) {
    // 平台无 diff 或执行错误 → 空 diff（publish 会返回占位）
    return { diff: '', fileCount: 0, truncated: false };
  }
  const fullDiff = result.stdout;
  const fileCount = (fullDiff.match(/^diff /gm) || []).length;
  if (fullDiff.length > MAX_INLINE_DIFF_CHARS) {
    return {
      diff: fullDiff.slice(0, MAX_INLINE_DIFF_CHARS),
      fileCount,
      truncated: true,
    };
  }
  return { diff: fullDiff, fileCount, truncated: false };
}

/**
 * 将 diff 应用回主项目（--3way：冲突即失败，不自动 merge）
 *
 * 用临时文件传递 patch（避免 Windows 上 `git apply` 读 stdin 的管道兼容问题）；
 * 失败判定 = 非零退出码 **或** stderr 含 error/fatal（git 可能部分应用后返回 0）。
 */
export async function applyWorkspaceDiff(
  diff: string,
  projectRoot: string,
  gitBin = 'git'
): Promise<{ applied: boolean; error?: string }> {
  if (!diff.trim()) {
    return { applied: true };
  }

  let patchFile: string | null = null;
  try {
    const { mkdtempSync, writeFileSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    const dir = mkdtempSync(join(tmpdir(), 'apply-patch-'));
    patchFile = join(dir, 'changes.patch');
    writeFileSync(patchFile, diff, 'utf-8');

    const applyResult = await runProcess(gitBin, [
      '-C',
      projectRoot,
      'apply',
      '--3way',
      patchFile,
    ]);
    const stderr = applyResult.stderr || applyResult.stdout;
    const failed =
      applyResult.exitCode !== 0 || /^error:|^fatal:/m.test(stderr);
    if (failed) {
      logger.warn('applyWorkspaceDiff: git apply failed（冲突或无法应用）', {
        projectRoot,
        stderr: stderr.slice(0, 500),
      });
      return {
        applied: false,
        error: `git apply failed: ${stderr}`,
      };
    }
    return { applied: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { applied: false, error: `applyWorkspaceDiff: ${msg}` };
  } finally {
    if (patchFile) {
      const { rmSync } = await import('fs');
      const { dirname } = await import('path');
      try {
        rmSync(dirname(patchFile), { recursive: true, force: true });
      } catch {
        // @ignore-catch — 临时目录清理失败不影响结果
      }
    }
  }
}

/**
 * 组合入口：worktree 全部改动 → 回灌主项目
 */
export async function applyWorktreeToProject(
  worktreePath: string,
  projectRoot: string,
  gitBin = 'git'
): Promise<ApplyResult> {
  const addAll = await runProcess(gitBin, [
    '-C',
    worktreePath,
    'add',
    '-A',
    '-N',
  ]);
  if (addAll.exitCode !== 0) {
    logger.warn('applyWorktreeToProject: git add -A -N failed', {
      worktreePath,
      stderr: addAll.stderr.slice(0, 500),
    });
    return { applied: false, error: `git add -A -N failed: ${addAll.stderr}` };
  }

  const diffResult = await runProcess(gitBin, [
    '-C',
    worktreePath,
    'diff',
    'HEAD',
    '--binary',
  ]);
  if (diffResult.exitCode !== 0) {
    return { applied: false, error: `git diff failed: ${diffResult.stderr}` };
  }

  const patch = diffResult.stdout;
  if (!patch.trim()) {
    return { applied: true, diff: '' };
  }

  const applyResult = await applyWorkspaceDiff(patch, projectRoot, gitBin);
  if (!applyResult.applied) {
    return {
      applied: false,
      diff: patch,
      error: applyResult.error,
    };
  }

  logger.info('applyWorktreeToProject: 回灌成功', {
    worktreePath,
    projectRoot,
    patchBytes: patch.length,
  });
  return { applied: true, diff: patch };
}

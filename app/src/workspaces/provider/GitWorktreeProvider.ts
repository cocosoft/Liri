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
 * GitWorktreeProvider — git worktree 隔离（G2，priority 1）
 *
 * 复用 WorkspaceGit（创建/移除 worktree）+ WorkspaceApply（diff 回灌）。
 * isApplicable：是 git 仓库且（可选）工作区干净。
 */
import { spawn } from 'child_process';
import { WorkspaceGit } from '../WorkspaceGit';
import { applyWorktreeToProject } from '../apply/WorkspaceApply';
import type {
  WorkspaceHandle,
  WorkspacePrepareInput,
  WorkspaceProvider,
  WorkspacePublishOutput,
} from './WorkspaceProvider';

export interface GitWorktreeProviderOptions {
  /** 主项目根目录（prepare 输入）；worktree 创建基于该仓库 */
  projectRoot: string;
  /** 工作区脏时拒绝 prepare（默认 true，对齐 PilotDeck refuseDirty） */
  refuseDirty?: boolean;
  gitBin?: string;
}

export class GitWorktreeProvider implements WorkspaceProvider {
  readonly id = 'git-worktree' as const;
  readonly priority = 1;

  /** 复用同一 WorkspaceGit 实例（createWorktree/removeWorktree 共享 Map，dispose 才能命中） */
  private readonly git: WorkspaceGit;

  constructor(private readonly options: GitWorktreeProviderOptions) {
    this.git = new WorkspaceGit({ baseDir: options.projectRoot });
  }

  private get gitBin(): string {
    return this.options.gitBin ?? 'git';
  }

  async isApplicable(projectRoot: string): Promise<boolean> {
    try {
      const top = await this.runGit([
        '-C',
        projectRoot,
        'rev-parse',
        '--show-toplevel',
      ]);
      if (top.exitCode !== 0 || !top.stdout.trim()) return false;
      const head = await this.runGit(['-C', projectRoot, 'rev-parse', 'HEAD']);
      if (head.exitCode !== 0) return false;
      if (this.options.refuseDirty !== false) {
        const status = await this.runGit([
          '-C',
          projectRoot,
          'status',
          '--porcelain',
        ]);
        if (status.exitCode !== 0 || status.stdout.trim().length > 0) {
          return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  async prepare(input: WorkspacePrepareInput): Promise<WorkspaceHandle> {
    const info = await this.git.createWorktree(input.runId);
    return {
      runId: input.runId,
      projectKey: input.projectRoot,
      strategy: this.id,
      cwd: info.worktreePath,
      metadata: {
        gitRoot: info.gitRoot,
        worktreeBranch: info.worktreeBranch,
      },
    };
  }

  async publish(handle: WorkspaceHandle): Promise<WorkspacePublishOutput> {
    const result = await applyWorktreeToProject(
      handle.cwd,
      handle.projectKey,
      this.gitBin
    );
    if (!result.applied) {
      throw new Error(result.error ?? 'applyWorktreeToProject failed');
    }
    return { diff: result.diff };
  }

  async dispose(
    handle: WorkspaceHandle,
    options: { keep: boolean }
  ): Promise<void> {
    if (options.keep) return;
    await this.git.removeWorktree(handle.runId);
    // 清理 worktree 分支（WorkspaceGit 创建了 bridge/{name}）
    const branch = handle.metadata.worktreeBranch as string | undefined;
    if (branch) {
      try {
        await this.runGit(['-C', handle.projectKey, 'branch', '-D', branch]);
      } catch {
        // @ignore-catch — 分支删除失败不阻断（worktree 已移除）
      }
    }
  }

  private runGit(args: string[]): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }> {
    return new Promise((resolvePromise) => {
      const child = spawn(this.gitBin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (c) => (stdout += c.toString('utf-8')));
      child.stderr?.on('data', (c) => (stderr += c.toString('utf-8')));
      child.on('error', (e) =>
        resolvePromise({ exitCode: -1, stdout, stderr: e.message })
      );
      child.on('close', (code) =>
        resolvePromise({ exitCode: code ?? -1, stdout, stderr })
      );
    });
  }
}

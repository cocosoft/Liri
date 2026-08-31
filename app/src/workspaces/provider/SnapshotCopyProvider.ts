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
 * SnapshotCopyProvider — 目录快照隔离（G2，priority 2，非 git 项目兜底）
 *
 * 复制主项目到隔离目录（排除 .git/node_modules/dist 等大目录），
 * agent 在快照目录中工作；publish 时用 `diff -ruN` 生成差异（需平台支持 diff）。
 *
 * 局限：非 git 项目 + Windows（无 POSIX diff）时，publish 仅返回快照位置占位，
 * 差异需人工合并——这与 PilotDeck 行为一致（snapshot 模式不保证自动回灌）。
 */
import { cp, mkdir, rm, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { generateSnapshotCopyDiff } from '../apply/WorkspaceApply';
import type {
  WorkspaceHandle,
  WorkspacePrepareInput,
  WorkspaceProvider,
  WorkspacePublishOutput,
} from './WorkspaceProvider';

export interface SnapshotCopyProviderOptions {
  /** 快照隔离区根目录 */
  baseDir: string;
  /** 源目录大小硬上限（默认 1 GiB） */
  maxBytes?: number;
  /** 排除的顶层路径（默认 .git/node_modules/dist 等） */
  ignorePaths?: string[];
}

const DEFAULT_IGNORES = ['.git', 'node_modules', 'dist', 'output', 'downloads'];

export class SnapshotCopyProvider implements WorkspaceProvider {
  readonly id = 'snapshot-copy' as const;
  readonly priority = 2;

  constructor(private readonly options: SnapshotCopyProviderOptions) {}

  private get maxBytes(): number {
    return this.options.maxBytes ?? 1024 * 1024 * 1024; // 1 GiB
  }

  private ignoreSet(): Set<string> {
    return new Set(this.options.ignorePaths ?? DEFAULT_IGNORES);
  }

  async isApplicable(projectRoot: string): Promise<boolean> {
    try {
      const info = await stat(projectRoot);
      return info.isDirectory();
    } catch {
      return false;
    }
  }

  async prepare(input: WorkspacePrepareInput): Promise<WorkspaceHandle> {
    const target = resolve(this.options.baseDir, input.runId);
    const ignores = this.ignoreSet();

    // 大小上限检查（fs.cp 前粗略估算：仅统计未排除的顶层子目录，避免递归全扫）
    const sizeBytes = await this.estimateSize(input.projectRoot, ignores);
    if (sizeBytes > this.maxBytes) {
      throw new AppError(
        `快照源大小 ${sizeBytes} 超过上限 ${this.maxBytes}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'WORKSPACE_SNAPSHOT_TOO_LARGE'
      );
    }

    await mkdir(resolve(target, '..'), { recursive: true });
    await cp(input.projectRoot, target, {
      recursive: true,
      filter: (src) => !this.isIgnored(src, input.projectRoot, ignores),
      errorOnExist: false,
    });

    return {
      runId: input.runId,
      projectKey: input.projectRoot,
      strategy: this.id,
      cwd: target,
      metadata: { baseSize: String(sizeBytes) },
    };
  }

  async publish(handle: WorkspaceHandle): Promise<WorkspacePublishOutput> {
    const diff = await generateSnapshotCopyDiff(handle.projectKey, handle.cwd);
    // 与 PilotDeck 一致：diff 为空（平台不支持）时返回快照位置占位，差异需人工合并
    return { diff: diff.diff || `snapshot at ${handle.cwd}` };
  }

  async dispose(
    handle: WorkspaceHandle,
    options: { keep: boolean }
  ): Promise<void> {
    if (options.keep) return;
    try {
      await rm(handle.cwd, { recursive: true, force: true });
    } catch {
      // @ignore-catch — 清理失败不影响结论
    }
  }

  private isIgnored(
    filePath: string,
    root: string,
    ignores: Set<string>
  ): boolean {
    if (filePath === root) return false;
    const rel = filePath.startsWith(root)
      ? filePath.slice(root.length).replace(/^[/\\]+/, '')
      : filePath;
    if (rel.length === 0) return false;
    const head = rel.split(/[/\\]/)[0];
    return ignores.has(head);
  }

  /** 粗略估算大小：仅遍历未排除的顶层子目录（避免全量递归扫描大项目） */
  private async estimateSize(
    root: string,
    ignores: Set<string>
  ): Promise<number> {
    try {
      const entries = await import('fs/promises').then((m) => m.readdir);
      const names = await entries(root, { withFileTypes: true });
      let total = 0;
      for (const entry of names) {
        if (ignores.has(entry.name)) continue;
        if (entry.isDirectory()) {
          total += await this.dirSize(join(root, entry.name));
        } else {
          const s = await stat(join(root, entry.name));
          total += s.size;
        }
      }
      return total;
    } catch {
      return 0;
    }
  }

  private async dirSize(dir: string): Promise<number> {
    const { readdir } = await import('fs/promises');
    let total = 0;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
          total += await this.dirSize(p);
        } else {
          const s = await stat(p);
          total += s.size;
        }
      }
    } catch {
      // @ignore-catch — 单目录统计失败忽略
    }
    return total;
  }
}

/** 判断目录是否存在（registry 兜底用） */
export function isDirectory(path: string): boolean {
  return existsSync(path);
}

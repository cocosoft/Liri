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
 * DevDocsDriver —— `dev_docs://` 只读驱动（AI-VFS 只读试点）。
 *
 * 底座 = `core/paths.resolveDocsDir()`（第一层知识库，`app/docs/`）。
 * `capabilities.write === false` ⇒ `write_vfs` **fail-closed** 拒绝（不静默降级，CS03）。
 *
 * 路径安全（**复用**既有底座，不自建第二套）：
 * 1. 结构拒绝：空字节 / 反斜杠（UNC） / `..` / `~` 段 ⇒ `VFS_DENIED`；
 * 2. 归一化后**必须**落在挂载根内（含符号链接逃逸：存在时以 `realpath` 二次判定）；
 * 3. 宿主真实路径**必须**过 `query/PathGuard`（`@modules/query` 的 `createPathGuard`）⇒ 命中拒绝列表即 `VFS_DENIED`。
 */

import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  type Stats,
} from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { resolveDocsDir } from '@modules/core/paths';
import { createPathGuard, type PathGuard } from '@modules/query';
import {
  vfsError,
  type IVfsDriver,
  type VfsDriverCapabilities,
  type VfsEntry,
  type VfsPath,
  type VfsReadResult,
  type VfsStat,
  type VfsWriteInput,
  type VfsWriteResult,
} from '../types.js';
import { vfsRelativePath } from '../VfsPath.js';

/** 读取截断口径（对齐 `ReadProjectFileTool` 的 50KB） */
const MAX_READ_BYTES = 50 * 1024;

/** 目录枚举默认上限 */
const DEFAULT_LIST_LIMIT = 200;

/** 默认挂载点 scheme（`stat.mount` 回显；装配面按该 scheme 注册） */
const DEFAULT_MOUNT_SCHEME = 'dev_docs';

/** 常见文档扩展名 → MIME（`stat` / `read` 出参用；无共享工具，故此处最小自持） */
const MIME_BY_EXT: Record<string, string> = {
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
};

function guessMimeType(fileName: string): string {
  return (
    MIME_BY_EXT[extname(fileName).toLowerCase()] ?? 'application/octet-stream'
  );
}

export class DevDocsDriver implements IVfsDriver {
  readonly capabilities: VfsDriverCapabilities = {
    read: true,
    write: false,
    list: true,
  };

  private readonly root: string;
  private readonly guard: PathGuard;
  /** 回显用挂载点 scheme（与注册表中的键一致） */
  private readonly scheme: string;

  constructor(
    root: string = resolveDocsDir(),
    guard: PathGuard = createPathGuard(),
    scheme: string = DEFAULT_MOUNT_SCHEME
  ) {
    this.root = resolve(root);
    this.guard = guard;
    this.scheme = scheme;
  }

  async list(
    vfsPath: VfsPath,
    opts: { recursive: boolean; limit: number }
  ): Promise<VfsEntry[]> {
    const host = this.resolveHostPath(vfsPath, 'read');
    const st = this.statFile(host, vfsPath);
    if (!st.isDirectory()) {
      throw vfsError('VFS_NOT_DIR', `不是目录: ${vfsRelativePath(vfsPath)}`);
    }

    const limit = opts.limit > 0 ? opts.limit : DEFAULT_LIST_LIMIT;
    const entries: VfsEntry[] = [];
    const walk = (dir: string, prefix: string): void => {
      if (entries.length >= limit) return;
      const dirents = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name)
      );
      for (const dirent of dirents) {
        if (entries.length >= limit) return;
        const abs = join(dir, dirent.name);
        const name = prefix ? `${prefix}/${dirent.name}` : dirent.name;
        if (dirent.isDirectory()) {
          entries.push({ name, kind: 'dir' });
          if (opts.recursive) walk(abs, name);
        } else {
          // `lstat`：枚举阶段不跟随符号链接（只回显自身元数据）
          const s = lstatSync(abs);
          entries.push({
            name,
            kind: 'file',
            size: s.size,
            mtime: s.mtimeMs,
          });
        }
      }
    };
    walk(host, '');
    return entries;
  }

  async stat(vfsPath: VfsPath): Promise<VfsStat> {
    const host = this.resolveHostPath(vfsPath, 'read');
    const st = this.statFile(host, vfsPath);
    const isDir = st.isDirectory();
    return {
      kind: isDir ? 'dir' : 'file',
      size: st.size,
      mtime: st.mtimeMs,
      ...(isDir ? {} : { mimeType: guessMimeType(host) }),
      mount: this.scheme,
      readOnly: true,
    };
  }

  async read(
    vfsPath: VfsPath,
    range?: { offset: number; limit: number }
  ): Promise<VfsReadResult> {
    const host = this.resolveHostPath(vfsPath, 'read');
    const st = this.statFile(host, vfsPath);
    if (st.isDirectory()) {
      throw vfsError(
        'VFS_IS_DIR',
        `目标是目录，不能读取: ${vfsRelativePath(vfsPath)}`
      );
    }

    let content = readFileSync(host, 'utf-8');
    if (range) {
      const lines = content.split('\n');
      const offset = Math.max(0, range.offset);
      const limit = range.limit > 0 ? range.limit : lines.length;
      content = lines.slice(offset, offset + limit).join('\n');
    }

    const fullSize = Buffer.byteLength(content, 'utf-8');
    let truncated = false;
    if (fullSize > MAX_READ_BYTES) {
      content = `${content.slice(0, MAX_READ_BYTES)}\n\n... (文件过大，已截断，完整大小: ${fullSize} 字节)`;
      truncated = true;
    }

    return {
      data: content,
      mimeType: guessMimeType(host),
      size: fullSize,
      truncated,
    };
  }

  async write(_path: VfsPath, _data: VfsWriteInput): Promise<VfsWriteResult> {
    // 只读驱动：fail-closed 拒绝（不静默降级）
    throw vfsError(
      'VFS_READ_ONLY_MOUNT',
      `挂载点 ${this.scheme}:// 为只读，不支持写入`
    );
  }

  /** 把 VFS 路径安全解析为挂载根内的宿主真实路径 */
  private resolveHostPath(vfsPath: VfsPath, op: 'read' | 'write'): string {
    const rel = vfsRelativePath(vfsPath);
    if (rel.includes('\0')) {
      throw vfsError('VFS_DENIED', '路径包含空字节，已拒绝');
    }
    // 反斜杠视为 UNC / Windows 分隔符注入 ⇒ 拒绝（VFS 路径统一用 `/`）
    if (rel.includes('\\')) {
      throw vfsError('VFS_DENIED', `路径包含非法分隔符 '\\': "${rel}"`);
    }

    const segments = rel.split('/').filter((s) => s.length > 0);
    for (const seg of segments) {
      if (seg === '..' || seg.startsWith('~')) {
        throw vfsError('VFS_DENIED', `路径穿越 / 主目录逃逸被拒绝: "${rel}"`);
      }
    }

    const host = resolve(this.root, ...segments);
    if (!this.isWithinRoot(host)) {
      throw vfsError('VFS_DENIED', `路径越出挂载根: "${rel}"`);
    }

    let target = host;
    if (existsSync(host)) {
      // 符号链接逃逸：以 realpath 二次判定（解析后的真实路径仍须在根内）
      const real = realpathSync(host);
      if (!this.isWithinRoot(real)) {
        throw vfsError('VFS_DENIED', `符号链接逃逸被拒绝: "${rel}"`);
      }
      target = real;
    }

    // 宿主真实路径过 PathGuard（唯一路径拒绝门禁）
    const check =
      op === 'write'
        ? this.guard.checkWrite(target)
        : this.guard.checkRead(target);
    if (!check.allowed) {
      throw vfsError(
        'VFS_DENIED',
        check.reason ?? `路径被安全策略拒绝: "${rel}"`
      );
    }
    return target;
  }

  /** 候选路径是否落在挂载根内（空相对 = 根本身，允许） */
  private isWithinRoot(candidate: string): boolean {
    const rel = relative(this.root, candidate);
    if (rel === '') return true;
    if (isAbsolute(rel)) return false;
    return rel.split(/[\\/]/)[0] !== '..';
  }

  /** stat 包装：不存在 ⇒ `VFS_NOT_FOUND` */
  private statFile(host: string, vfsPath: VfsPath): Stats {
    try {
      return statSync(host);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        throw vfsError(
          'VFS_NOT_FOUND',
          `路径不存在: ${vfsRelativePath(vfsPath)}`
        );
      }
      throw vfsError(
        'VFS_DENIED',
        `无法访问: ${vfsRelativePath(vfsPath)} (${code ?? 'unknown'})`
      );
    }
  }
}

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
 * Agent Workspace
 * 对标OpenClaw agents/workspace.ts
 * 工作区管理
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from 'fs';
import { join, relative, resolve, basename } from 'path';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('agent:sandbox:index');

export interface WorkspaceConfig {
  rootDir: string;
  name?: string;
  description?: string;
  maxSize?: number;
  allowSymlinks?: boolean;
  ignorePatterns?: string[];
}

export interface WorkspaceFile {
  path: string;
  relativePath: string;
  size: number;
  modifiedAt: number;
  isDirectory: boolean;
}

export interface WorkspaceStats {
  totalFiles: number;
  totalDirs: number;
  totalSize: number;
  fileTypes: Record<string, number>;
}

const DEFAULT_IGNORE = [
  'node_modules/**',
  '.git/**',
  'dist/**',
  'build/**',
  '.next/**',
  '*.log',
  '.DS_Store',
];

export class AgentWorkspace {
  private config: Required<WorkspaceConfig>;

  constructor(config: WorkspaceConfig) {
    this.config = {
      rootDir: resolve(config.rootDir),
      name: config.name ?? basename(config.rootDir),
      description: config.description ?? '',
      maxSize: config.maxSize ?? 100 * 1024 * 1024,
      allowSymlinks: config.allowSymlinks ?? false,
      ignorePatterns: [...DEFAULT_IGNORE, ...(config.ignorePatterns ?? [])],
    };
  }

  get rootDir(): string {
    return this.config.rootDir;
  }

  get name(): string {
    return this.config.name;
  }

  initialize(): void {
    if (!existsSync(this.config.rootDir)) {
      mkdirSync(this.config.rootDir, { recursive: true });
    }
  }

  resolvePath(...segments: string[]): string {
    const fullPath = resolve(this.config.rootDir, ...segments);

    if (!fullPath.startsWith(this.config.rootDir)) {
      throw new AppError(
        `Path escapes workspace: ${fullPath}`,
        ErrorCategory.PERMISSION,
        ErrorSeverity.HIGH,
        'PERMISSION_DENIED',
        { fullPath, rootDir: this.config.rootDir }
      );
    }

    return fullPath;
  }

  getRelativePath(absolutePath: string): string {
    return relative(this.config.rootDir, absolutePath);
  }

  isWithin(filePath: string): boolean {
    const resolved = resolve(filePath);
    return resolved.startsWith(this.config.rootDir);
  }

  readFile(filePath: string): string {
    const fullPath = this.resolvePath(filePath);

    if (!existsSync(fullPath)) {
      throw new AppError(
        `File not found: ${filePath}`,
        ErrorCategory.FILESYSTEM,
        ErrorSeverity.HIGH,
        'ENTITY_NOT_FOUND',
        { filePath, fullPath }
      );
    }

    const stat = statSync(fullPath);
    if (stat.size > 1024 * 1024) {
      throw new AppError(
        `File too large: ${filePath} (${stat.size} bytes)`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'INVALID_INPUT',
        { filePath, size: stat.size, maxSize: 1024 * 1024 }
      );
    }

    return readFileSync(fullPath, 'utf-8');
  }

  writeFile(filePath: string, content: string): void {
    const fullPath = this.resolvePath(filePath);
    const dir =
      filePath.includes('/') || filePath.includes('\\')
        ? join(fullPath, '..')
        : this.config.rootDir;

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(fullPath, content, 'utf-8');
  }

  listFiles(subDir?: string): WorkspaceFile[] {
    const targetDir = subDir ? this.resolvePath(subDir) : this.config.rootDir;

    if (!existsSync(targetDir)) {
      return [];
    }

    const results: WorkspaceFile[] = [];

    const walk = (dir: string): void => {
      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relPath = relative(this.config.rootDir, fullPath);

        if (this.shouldIgnore(relPath)) continue;

        if (!this.config.allowSymlinks && entry.isSymbolicLink()) continue;

        if (entry.isDirectory()) {
          results.push({
            path: fullPath,
            relativePath: relPath,
            size: 0,
            modifiedAt: statSync(fullPath).mtimeMs,
            isDirectory: true,
          });
          walk(fullPath);
        } else {
          const stat = statSync(fullPath);
          results.push({
            path: fullPath,
            relativePath: relPath,
            size: stat.size,
            modifiedAt: stat.mtimeMs,
            isDirectory: false,
          });
        }
      }
    };

    walk(targetDir);
    return results;
  }

  getStats(): WorkspaceStats {
    const files = this.listFiles();
    const stats: WorkspaceStats = {
      totalFiles: 0,
      totalDirs: 0,
      totalSize: 0,
      fileTypes: {},
    };

    for (const file of files) {
      if (file.isDirectory) {
        stats.totalDirs++;
      } else {
        stats.totalFiles++;
        stats.totalSize += file.size;

        const ext = file.path.split('.').pop()?.toLowerCase() ?? 'unknown';
        stats.fileTypes[ext] = (stats.fileTypes[ext] ?? 0) + 1;
      }
    }

    return stats;
  }

  fileExists(filePath: string): boolean {
    try {
      const fullPath = this.resolvePath(filePath);
      return existsSync(fullPath);
    } catch {
      return false;
    }
  }

  getConfig(): Readonly<Required<WorkspaceConfig>> {
    return { ...this.config };
  }

  private shouldIgnore(relPath: string): boolean {
    const normalized = relPath.replace(/\\/g, '/');

    for (const pattern of this.config.ignorePatterns) {
      const regexStr = pattern
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*');

      if (new RegExp(`^${regexStr}$`).test(normalized)) {
        return true;
      }

      if (new RegExp(`.*/${regexStr}$`).test(normalized)) {
        return true;
      }
    }

    return false;
  }
}

export function createWorkspace(config: WorkspaceConfig): AgentWorkspace {
  const workspace = new AgentWorkspace(config);
  workspace.initialize();
  return workspace;
}

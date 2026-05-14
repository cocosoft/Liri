/**
 * Agent Workspace
 * 对标OpenClaw agents/workspace.ts
 * 工作区管理
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, basename } from 'node:path';

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
      throw new Error(`Path escapes workspace: ${fullPath}`);
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
      throw new Error(`File not found: ${filePath}`);
    }

    const stat = statSync(fullPath);
    if (stat.size > 1024 * 1024) {
      throw new Error(`File too large: ${filePath} (${stat.size} bytes)`);
    }

    return readFileSync(fullPath, 'utf-8');
  }

  writeFile(filePath: string, content: string): void {
    const fullPath = this.resolvePath(filePath);
    const dir = filePath.includes('/') || filePath.includes('\\')
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

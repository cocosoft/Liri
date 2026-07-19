/**
 * 子目录范围限制
 * 限制 Shell 命令只能在指定的子目录范围内执行
 */

import { resolve, normalize, relative, sep } from 'path';
import { existsSync, statSync } from 'fs';
import { configManager } from '@modules/config';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'security:bash:DirectoryScopeRestriction',
  level: LogLevel.INFO,
});

/**
 * 路径验证结果
 */
export interface PathValidationResult {
  allowed: boolean;
  resolvedPath: string;
  scopePath: string;
  reason?: string;
}

/**
 * 命令检查结果
 */
export interface CommandScopeResult {
  allowed: boolean;
  blockedPaths: string[];
  reason?: string;
}

/**
 * 范围配置
 */
export interface DirectoryScopeConfig {
  allowedDirs: string[];
  denyDirs: string[];
  enableSymlinkCheck: boolean;
  enableTraversalCheck: boolean;
  enableWriteScope: boolean;
  maxDepth: number;
}

/**
 * 默认范围配置
 */
const DEFAULT_SCOPE_CONFIG: DirectoryScopeConfig = {
  allowedDirs: [],
  denyDirs: [
    '/etc',
    '/var',
    '/sys',
    '/proc',
    '/dev',
    '/boot',
    '/root',
    '/usr',
    '/bin',
    '/sbin',
    '/lib',
    'C:\\Windows',
    'C:\\Windows\\System32',
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    'C:\\SysWOW64',
  ],
  enableSymlinkCheck: true,
  enableTraversalCheck: true,
  enableWriteScope: true,
  maxDepth: 10,
};

/**
 * 危险目录遍历模式
 */
const TRAVERSAL_PATTERNS = [
  /\.\.\//g,
  /\.\.\\/g,
  /~(?:\/|\\)/,
  /\$HOME/i,
  /\$\(.*\)/,
  /`.*`/,
];

/**
 * 子目录范围限制器
 */
export class DirectoryScopeRestriction {
  private config: DirectoryScopeConfig;

  constructor(config: Partial<DirectoryScopeConfig> = {}) {
    this.config = { ...DEFAULT_SCOPE_CONFIG, ...config };

    // 从用户配置合并 denyDirs
    try {
      const permission = configManager.getConfigValue<any>('permission');
      const blacklist = permission?.customRules?.directoryRules?.blacklist;
      if (blacklist && blacklist.length > 0) {
        const userDirs = blacklist
          .map((r: any) => r.path)
          .filter((p: string) => p.includes('/') || p.includes('\\'));
        if (userDirs.length > 0) {
          this.config.denyDirs = [...this.config.denyDirs, ...userDirs];
        }
      }

      // 信任工作区路径自动加入 allowedDirs
      const workspaces = permission?.trustedWorkspaces;
      if (workspaces && workspaces.length > 0) {
        const wsDirs = workspaces
          .filter((ws: any) => ws.enabled !== false)
          .map((ws: any) => ws.path)
          .filter(Boolean);
        if (wsDirs.length > 0) {
          this.config.allowedDirs = [...this.config.allowedDirs, ...wsDirs];
        }
      }
    } catch (err) {
      // config 系统未初始化时静默降级

      logger.debug('Operation skipped', {
        context: 'config 系统未初始化时静默降级',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * 更新配置
   * @param config 部分配置
   */
  updateConfig(config: Partial<DirectoryScopeConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   * @returns 当前配置副本
   */
  getConfig(): DirectoryScopeConfig {
    return { ...this.config };
  }

  /**
   * 验证路径是否在允许范围内
   * @param targetPath 目标路径
   * @returns 验证结果
   */
  validatePath(targetPath: string): PathValidationResult {
    let resolvedPath: string;

    try {
      resolvedPath = resolve(targetPath);
    } catch {
      return {
        allowed: false,
        resolvedPath: targetPath,
        scopePath: this.getAllowedScope(),
        reason: `无法解析路径: ${targetPath}`,
      };
    }

    const scopePath = this.getAllowedScope();

    if (this.config.enableTraversalCheck) {
      const traversalCheck = this.checkTraversal(targetPath);

      if (traversalCheck) {
        return {
          allowed: false,
          resolvedPath,
          scopePath,
          reason: traversalCheck,
        };
      }
    }

    if (this.config.enableSymlinkCheck) {
      const symlinkCheck = this.checkSymlink(resolvedPath);

      if (symlinkCheck) {
        return {
          allowed: false,
          resolvedPath,
          scopePath,
          reason: symlinkCheck,
        };
      }
    }

    const denyCheck = this.checkDenyPaths(resolvedPath);

    if (denyCheck) {
      return {
        allowed: false,
        resolvedPath,
        scopePath,
        reason: denyCheck,
      };
    }

    if (this.config.allowedDirs.length > 0) {
      const inScope = this.config.allowedDirs.some((dir) => {
        const resolvedDir = resolve(dir);
        const normalizedTarget = normalize(resolvedPath);
        const normalizedDir = normalize(resolvedDir);

        return (
          normalizedTarget.startsWith(normalizedDir + sep) ||
          normalizedTarget === normalizedDir
        );
      });

      if (!inScope) {
        return {
          allowed: false,
          resolvedPath,
          scopePath,
          reason: `路径不在允许范围内: ${resolvedPath}，允许范围: ${scopePath}`,
        };
      }
    }

    if (this.config.maxDepth > 0) {
      const depthCheck = this.checkDepth(resolvedPath);

      if (depthCheck) {
        return {
          allowed: false,
          resolvedPath,
          scopePath,
          reason: depthCheck,
        };
      }
    }

    return { allowed: true, resolvedPath, scopePath };
  }

  /**
   * 检查命令中的路径是否在范围内
   * @param command 命令字符串
   * @param cwd 当前工作目录
   * @returns 检查结果
   */
  checkCommandScope(command: string, cwd: string = ''): CommandScopeResult {
    const blockedPaths: string[] = [];
    const workDir = cwd || process.cwd();

    const paths = this.extractPaths(command);

    for (const rawPath of paths) {
      const fullPath =
        rawPath.startsWith(sep) || rawPath.match(/^[A-Z]:/i)
          ? rawPath
          : resolve(workDir, rawPath);

      const result = this.validatePath(fullPath);

      if (!result.allowed) {
        blockedPaths.push(rawPath);
      }
    }

    if (blockedPaths.length > 0) {
      return {
        allowed: false,
        blockedPaths,
        reason: `以下路径不在允许范围内: ${blockedPaths.join(', ')}`,
      };
    }

    return { allowed: true, blockedPaths: [] };
  }

  /**
   * 检查文件写入操作是否在允许范围内
   * @param filePath 文件路径
   * @returns 验证结果
   */
  checkWriteScope(filePath: string): PathValidationResult {
    if (!this.config.enableWriteScope) {
      return this.validatePath(filePath);
    }

    const baseResult = this.validatePath(filePath);

    if (!baseResult.allowed) {
      return baseResult;
    }

    try {
      const resolvedPath = resolve(filePath);
      const dir = this.findParentDir(resolvedPath);

      if (dir && !this.isDirWritable(dir)) {
        return {
          allowed: false,
          resolvedPath,
          scopePath: this.getAllowedScope(),
          reason: `目录不可写: ${dir}`,
        };
      }
    } catch {
      return baseResult;
    }

    return baseResult;
  }

  /**
   * 从命令中提取路径
   * @param command 命令字符串
   * @returns 路径列表
   */
  private extractPaths(command: string): string[] {
    const paths: string[] = [];
    const tokens = command.match(
      /(?:^|\s)(?:cat|cd|ls|cp|mv|rm|mkdir|touch|chmod|chown|find|grep|sed|awk|echo|>|>>)(?:\s+)(\S+)/gi
    );

    if (tokens) {
      for (const token of tokens) {
        const parts = token.trim().split(/\s+/);

        for (let i = 1; i < parts.length; i++) {
          const part = parts[i];

          if (part && !part.startsWith('-') && !part.startsWith('--')) {
            paths.push(part);
          }
        }
      }
    }

    const redirectMatches = command.match(/(?:>|>>)\s*(\S+)/g);

    if (redirectMatches) {
      for (const match of redirectMatches) {
        const path = match.replace(/>+\s*/, '').trim();
        if (path) paths.push(path);
      }
    }

    const pathArgs = command.match(
      /(?:--cwd|--path|--dir|--output|--input|--file)\s+(\S+)/gi
    );

    if (pathArgs) {
      for (const match of pathArgs) {
        const path = match.split(/\s+/).pop();
        if (path) paths.push(path);
      }
    }

    return [...new Set(paths)];
  }

  /**
   * 检查路径遍历攻击
   * @param path 路径字符串
   * @returns 检测到遍历时返回原因，否则返回 null
   */
  private checkTraversal(path: string): string | null {
    for (const pattern of TRAVERSAL_PATTERNS) {
      const matches = path.match(pattern);

      if (matches) {
        for (const match of matches) {
          if (match === '..' || match === '../' || match === '..\\') {
            const depth = (path.match(/\.\.(\/|\\)/g) || []).length;

            if (depth > 1) {
              return `检测到路径遍历攻击 (深度 ${depth}): ${path}`;
            }
          }

          if (path.match(/(?:~|\$HOME|`|\$\(|\))/)) {
            return `检测到不安全的路径模式: ${path}`;
          }
        }
      }
    }

    return null;
  }

  /**
   * 检查符号链接是否指向范围外
   * @param resolvedPath 解析后的路径
   * @returns 检测到越界时返回原因，否则返回 null
   */
  private checkSymlink(resolvedPath: string): string | null {
    try {
      if (existsSync(resolvedPath)) {
        const stats = statSync(resolvedPath);

        if (stats.isSymbolicLink()) {
          const realPath = resolve(require('fs').readlinkSync(resolvedPath));

          const isInScope =
            this.config.allowedDirs.length === 0 ||
            this.config.allowedDirs.some((dir) => {
              const resolvedDir = resolve(dir);

              return (
                realPath.startsWith(resolvedDir + sep) ||
                realPath === resolvedDir
              );
            });

          if (!isInScope) {
            return `符号链接指向范围外: ${resolvedPath} -> ${realPath}`;
          }
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  /**
   * 检查路径是否在拒绝列表中
   * @param resolvedPath 解析后的路径
   * @returns 命中禁止列表时返回原因，否则返回 null
   */
  private checkDenyPaths(resolvedPath: string): string | null {
    const normalizedPath = normalize(resolvedPath);

    for (const denyDir of this.config.denyDirs) {
      const normalizedDeny = normalize(resolve(denyDir));

      if (
        normalizedPath.startsWith(normalizedDeny + sep) ||
        normalizedPath === normalizedDeny
      ) {
        return `路径在禁止列表中: ${denyDir}`;
      }
    }

    return null;
  }

  /**
   * 检查路径深度是否超过限制
   * @param resolvedPath 解析后的路径
   * @returns 超过深度时返回原因，否则返回 null
   */
  private checkDepth(resolvedPath: string): string | null {
    if (this.config.maxDepth <= 0) return null;

    const parts = resolvedPath.split(sep).filter(Boolean);
    const depth = parts.length;

    if (depth > this.config.maxDepth) {
      return `路径深度 ${depth} 超过限制 ${this.config.maxDepth}`;
    }

    return null;
  }

  /**
   * 查找父目录路径
   * @param filePath 文件路径
   * @returns 父目录路径
   */
  private findParentDir(filePath: string): string {
    return resolve(filePath, '..');
  }

  /**
   * 检查目录是否可写
   * @param dirPath 目录路径
   * @returns 是否可写
   */
  private isDirWritable(dirPath: string): boolean {
    try {
      if (!existsSync(dirPath)) {
        return this.isDirWritable(this.findParentDir(dirPath));
      }

      const stats = statSync(dirPath);

      return !!(stats.mode & 0o222);
    } catch {
      return false;
    }
  }

  /**
   * 获取允许范围的字符串表示
   * @returns 范围描述
   */
  private getAllowedScope(): string {
    if (this.config.allowedDirs.length === 0) {
      return '无限制（仅排除系统目录）';
    }
    return this.config.allowedDirs.join(', ');
  }
}

/**
 * 全局子目录范围限制实例（使用默认配置）
 */
export const directoryScopeRestriction = new DirectoryScopeRestriction();

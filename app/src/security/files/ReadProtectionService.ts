/**
 * 读取保护服务
 * 对标 Hermes get_read_block_error()，防止 Agent 读取内部缓存文件和敏感配置
 */
import path from 'path';
import os from 'node:os';
import { resolveProjectRoot } from '@modules/core';

/**
 * 内部缓存文件模式（禁止 Agent 读取）
 */
export const INTERNAL_CACHE_PATTERNS: RegExp[] = [
  // 内部缓存目录
  /[\\/]\.cache[\\/]/i,
  // 会话数据
  /[\\/]\.sessions[\\/]/i,
  // 内部状态文件
  /[\\/]\.state[\\/]/i,
  // Python 缓存
  /[\\/]__pycache__[\\/]/,
  /[\\/]\.pyc$/,
  // Node 缓存
  /[\\/]node_modules[\\/]\.cache[\\/]/,
  // 编译产物
  /[\\/]\.tsbuildinfo$/,
];

/**
 * 敏感配置文件列表（禁止 Agent 读取）
 */
export const SENSITIVE_CONFIG_FILES: string[] = (() => {
  const home = os.homedir();

  return [
    path.join(home, '.env'),
    path.join(home, '.git-credentials'),
    path.join(home, '.netrc'),
    path.join(home, '.npmrc'),
    path.join(home, '.docker', 'config.json'),
    path.join(resolveProjectRoot(), '.env'),
    path.join(resolveProjectRoot(), '.env.local'),
    path.join(resolveProjectRoot(), '.env.production'),
    path.join(resolveProjectRoot(), 'credentials.json'),
    path.join(resolveProjectRoot(), 'service-account.json'),
  ];
})();

/**
 * 读取保护服务
 */
export class ReadProtectionService {
  private blockedFiles: Set<string>;
  private blockedPatterns: RegExp[];
  private enabled: boolean;

  /**
   * 构造函数
   * @param enabled 是否启用
   */
  constructor(enabled: boolean = true) {
    this.enabled = enabled;
    this.blockedFiles = new Set(SENSITIVE_CONFIG_FILES);
    this.blockedPatterns = [...INTERNAL_CACHE_PATTERNS];
  }

  /**
   * 设置启用状态
   * @param enabled 是否启用
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * 添加拦截文件
   * @param filePath 文件路径
   */
  addBlockedFile(filePath: string): void {
    this.blockedFiles.add(path.resolve(filePath));
  }

  /**
   * 移除拦截文件
   * @param filePath 文件路径
   */
  removeBlockedFile(filePath: string): void {
    this.blockedFiles.delete(path.resolve(filePath));
  }

  /**
   * 添加拦截模式
   * @param pattern 正则模式
   */
  addBlockedPattern(pattern: RegExp): void {
    this.blockedPatterns.push(pattern);
  }

  /**
   * 检查文件读取是否被拒绝
   * @param filePath 待读取的文件路径
   * @returns 是否允许读取及原因
   */
  checkReadAccess(filePath: string): { allowed: boolean; reason?: string } {
    if (!this.enabled) {
      return { allowed: true };
    }

    const resolved = path.resolve(filePath);
    const normalized = resolved.replace(/\\/g, '/');

    if (this.blockedFiles.has(resolved)) {
      return {
        allowed: false,
        reason: `读取被阻止: '${filePath}' 在敏感配置文件列表中`,
      };
    }

    for (const pattern of this.blockedPatterns) {
      if (pattern.test(normalized)) {
        return {
          allowed: false,
          reason: `读取被阻止: '${filePath}' 匹配内部缓存文件模式 ${pattern.source}`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * 检查文件读取是否被拒绝（布尔版本）
   * @param filePath 待读取的文件路径
   * @returns 是否允许读取
   */
  isReadAllowed(filePath: string): boolean {
    return this.checkReadAccess(filePath).allowed;
  }

  /**
   * 获取读取阻止错误信息
   * @param filePath 文件路径
   * @returns 错误描述
   */
  getReadBlockError(filePath: string): string {
    const result = this.checkReadAccess(filePath);
    return result.reason || `读取被拒绝: '${filePath}'`;
  }

  /**
   * 获取所有拦截的文件路径
   * @returns 文件路径集合
   */
  getBlockedFiles(): string[] {
    return [...this.blockedFiles];
  }

  /**
   * 获取所有拦截的模式
   * @returns 正则模式数组
   */
  getBlockedPatterns(): RegExp[] {
    return [...this.blockedPatterns];
  }
}

/**
 * 全局读取保护服务实例
 */
let globalReadProtectionService: ReadProtectionService | null = null;

/**
 * 获取全局读取保护服务
 * @returns ReadProtectionService 实例
 */
export function getReadProtectionService(): ReadProtectionService {
  if (!globalReadProtectionService) {
    globalReadProtectionService = new ReadProtectionService();
  }

  return globalReadProtectionService;
}

/**
 * 重置全局读取保护服务
 */
export function resetReadProtectionService(): void {
  globalReadProtectionService = null;
}

/**
 * 文件权限检查器
 * 负责检查File工具的权限，包括路径安全检查、文件操作类型检查等
 */
import {
  PermissionDecision,
  PermissionDecisionType,
  createAllowDecision,
  createDenyDecision,
  createAskDecision,
} from '../types/PermissionDecision';
import { PermissionContext } from '../types/PermissionContext';
import path from 'path';

/**
 * 文件权限检查器类
 */
export class FilePermission {
  /**
   * 检查文件操作权限
   * @param input 工具输入
   * @param context 权限上下文
   * @returns 权限决策
   */
  static checkPermission(
    input: Record<string, unknown>,
    context: PermissionContext
  ): PermissionDecision {
    const filePath = input.path as string;
    if (!filePath) {
      return createDenyDecision('No file path provided');
    }

    // 检查路径安全性
    const pathCheckResult = this.checkPathSafety(filePath);
    if (!pathCheckResult.isSafe) {
      return createAskDecision(pathCheckResult.reason);
    }

    // 检查文件操作类型
    const operation = (input.operation as string) || 'read';
    const operationCheckResult = this.checkOperationSafety(operation, filePath);
    if (!operationCheckResult.isSafe) {
      return createAskDecision(operationCheckResult.reason);
    }

    // 检查文件扩展名
    const extensionCheckResult = this.checkFileExtension(filePath);
    if (!extensionCheckResult.isSafe) {
      return createAskDecision(extensionCheckResult.reason);
    }

    // 检查文件大小
    if (input.size) {
      const sizeCheckResult = this.checkFileSize(input.size as number);
      if (!sizeCheckResult.isSafe) {
        return createAskDecision(sizeCheckResult.reason);
      }
    }

    // 默认返回允许
    return createAllowDecision('Safe file operation');
  }

  /**
   * 检查路径安全性
   * @param filePath 文件路径
   * @returns 检查结果
   */
  private static checkPathSafety(filePath: string): {
    isSafe: boolean;
    reason: string;
  } {
    // 检查路径是否包含..
    if (filePath.includes('..')) {
      return {
        isSafe: false,
        reason: 'Potentially unsafe path detected (contains ..)',
      };
    }

    // 检查路径是否为绝对路径
    if (path.isAbsolute(filePath)) {
      return { isSafe: false, reason: 'Absolute path detected' };
    }

    // 检查路径是否以/或\开头
    if (filePath.startsWith('/') || filePath.startsWith('\\')) {
      return {
        isSafe: false,
        reason: 'Path starts with / or \\ (potential absolute path)',
      };
    }

    // 检查路径是否包含系统敏感目录
    const sensitiveDirs = [
      '/etc',
      '/proc',
      '/sys',
      '/dev',
      'C:\\Windows',
      'C:\\Windows\\System32',
    ];
    for (const sensitiveDir of sensitiveDirs) {
      if (filePath.includes(sensitiveDir)) {
        return {
          isSafe: false,
          reason: `Path contains sensitive directory: ${sensitiveDir}`,
        };
      }
    }

    return { isSafe: true, reason: 'Safe path' };
  }

  /**
   * 检查操作安全性
   * @param operation 操作类型
   * @param filePath 文件路径
   * @returns 检查结果
   */
  private static checkOperationSafety(
    operation: string,
    filePath: string
  ): { isSafe: boolean; reason: string } {
    const safeOperations = ['read', 'list', 'exists'];
    const potentiallyUnsafeOperations = [
      'write',
      'append',
      'delete',
      'create',
      'copy',
      'move',
      'rename',
    ];

    if (safeOperations.includes(operation)) {
      return { isSafe: true, reason: 'Safe operation' };
    }

    if (potentiallyUnsafeOperations.includes(operation)) {
      return {
        isSafe: false,
        reason: `Potentially unsafe operation: ${operation}`,
      };
    }

    return { isSafe: false, reason: `Unknown operation: ${operation}` };
  }

  /**
   * 检查文件扩展名
   * @param filePath 文件路径
   * @returns 检查结果
   */
  private static checkFileExtension(filePath: string): {
    isSafe: boolean;
    reason: string;
  } {
    const extension = path.extname(filePath).toLowerCase();
    const potentiallyUnsafeExtensions = [
      '.exe',
      '.bat',
      '.cmd',
      '.sh',
      '.ps1',
      '.js',
      '.jsx',
      '.ts',
      '.tsx',
      '.py',
      '.php',
      '.java',
      '.class',
      '.jar',
      '.dll',
      '.so',
      '.dylib',
    ];

    if (potentiallyUnsafeExtensions.includes(extension)) {
      return {
        isSafe: false,
        reason: `Potentially unsafe file extension: ${extension}`,
      };
    }

    return { isSafe: true, reason: 'Safe file extension' };
  }

  /**
   * 检查文件大小
   * @param size 文件大小（字节）
   * @returns 检查结果
   */
  private static checkFileSize(size: number): {
    isSafe: boolean;
    reason: string;
  } {
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (size > maxSize) {
      return {
        isSafe: false,
        reason: `File size too large: ${size} bytes (max: ${maxSize} bytes)`,
      };
    }

    return { isSafe: true, reason: 'Safe file size' };
  }
}

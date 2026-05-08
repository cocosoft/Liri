/**
 * 权限策略限制
 * 实现危险命令检测、路径验证等权限策略
 */

import { join, resolve, normalize } from 'path';
import { logger } from '../utils/log.js';
import type { PermissionDecision } from './PermissionResult.js';
import { createDenyDecision, createAskDecision } from './PermissionResult.js';

/**
 * 危险命令模式
 */
const DANGEROUS_COMMAND_PATTERNS = {
  bash: [
    /rm\s+-rf/i,
    /dd\s+if=/i,
    /mkfs\./i,
    /format\s+/i,
    /shutdown\s+/i,
    /reboot\s+/i,
    /poweroff\s+/i,
    /init\s+0/i,
    /init\s+6/i,
    /systemctl\s+poweroff/i,
    /systemctl\s+reboot/i,
    /kill\s+-9/i,
    /wget\s+.*\|\s*sh/i,
    /curl\s+.*\|\s*sh/i,
    /curl\s+.*\|\s*bash/i,
    /wget\s+.*\|\s*bash/i,
    /echo\s+.*\|\s*sh/i,
    /echo\s+.*\|\s*bash/i,
  ],
  powershell: [
    /Remove-Item\s+-Recurse\s+-Force/i,
    /Format-Volume/i,
    /Restart-Computer/i,
    /Stop-Computer/i,
    /Invoke-Expression/i,
    /iex\s+/i,
    /Start-Process\s+-FilePath\s+"powershell"/i,
    /Start-Process\s+-FilePath\s+"cmd"/i,
    /New-Object\s+System\.Net\.WebClient/i,
    /Invoke-WebRequest/i,
    /iwr\s+/i,
    /Invoke-RestMethod/i,
  ],
};

/**
 * 受保护的路径
 */
const PROTECTED_PATHS = [
  '/etc',
  '/var',
  '/sys',
  '/proc',
  '/dev',
  '/boot',
  '/usr',
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\System32',
  'C:\\SysWOW64',
];

/**
 * 检查命令是否危险
 */
export function checkDangerousCommand(
  toolName: string,
  command: string
): { isDangerous: boolean; reason: string } {
  const patterns =
    DANGEROUS_COMMAND_PATTERNS[
      toolName.toLowerCase() as keyof typeof DANGEROUS_COMMAND_PATTERNS
    ];
  if (!patterns) {
    return { isDangerous: false, reason: '' };
  }

  for (const pattern of patterns) {
    if (pattern.test(command)) {
      return {
        isDangerous: true,
        reason: `Command contains potentially dangerous pattern: ${pattern.source}`,
      };
    }
  }

  return { isDangerous: false, reason: '' };
}

/**
 * 验证路径是否安全
 */
export function validatePath(
  path: string,
  workingDir: string = process.cwd()
): { isValid: boolean; reason: string } {
  try {
    // 解析路径
    const resolvedPath = resolve(workingDir, path);
    const normalizedPath = normalize(resolvedPath);

    // 检查是否在受保护的路径中
    for (const protectedPath of PROTECTED_PATHS) {
      if (normalizedPath.startsWith(protectedPath)) {
        return {
          isValid: false,
          reason: `Path ${path} is in a protected directory: ${protectedPath}`,
        };
      }
    }

    // 检查是否包含路径遍历
    if (path.includes('..') || normalizedPath.includes('..')) {
      return {
        isValid: false,
        reason: `Path ${path} contains directory traversal`,
      };
    }

    return { isValid: true, reason: '' };
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error));
    logger.error('Error validating path:', e);
    return {
      isValid: false,
      reason: `Error validating path: ${(error as Error).message}`,
    };
  }
}

/**
 * 检查文件操作权限
 */
export function checkFileOperationPermission(
  operation: 'read' | 'write' | 'delete',
  path: string,
  workingDir: string = process.cwd()
): PermissionDecision | null {
  // 验证路径
  const pathValidation = validatePath(path, workingDir);
  if (!pathValidation.isValid) {
    return createDenyDecision(pathValidation.reason, {
      type: 'safetyCheck',
      reason: pathValidation.reason,
    });
  }

  // 对于删除操作，总是询问
  if (operation === 'delete') {
    return createAskDecision(`Are you sure you want to delete ${path}?`, {
      type: 'safetyCheck',
      reason: 'Delete operation requires confirmation',
    });
  }

  return null;
}

/**
 * 检查网络操作权限
 */
export function checkNetworkOperationPermission(
  url: string,
  method: string = 'GET'
): PermissionDecision | null {
  // 检查是否为本地地址
  const localPatterns = [
    /^http:\/\/localhost:/i,
    /^http:\/\/127\.0\.0\.1:/i,
    /^http:\/\/0\.0\.0\.0:/i,
    /^file:\//i,
  ];

  for (const pattern of localPatterns) {
    if (pattern.test(url)) {
      return createAskDecision(
        `Are you sure you want to access local resource ${url}?`,
        {
          type: 'safetyCheck',
          reason: 'Local network access requires confirmation',
        }
      );
    }
  }

  // 对于非GET请求，总是询问
  if (method.toUpperCase() !== 'GET') {
    return createAskDecision(
      `Are you sure you want to send ${method} request to ${url}?`,
      {
        type: 'safetyCheck',
        reason: 'Non-GET network requests require confirmation',
      }
    );
  }

  return null;
}

/**
 * 检查进程操作权限
 */
export function checkProcessOperationPermission(
  operation: 'start' | 'kill' | 'list',
  processName?: string,
  processId?: number
): PermissionDecision | null {
  // 对于kill操作，总是询问
  if (operation === 'kill') {
    const target = processId
      ? `process ${processId}`
      : processName
        ? `process ${processName}`
        : 'process';
    return createAskDecision(`Are you sure you want to kill ${target}?`, {
      type: 'safetyCheck',
      reason: 'Process kill operation requires confirmation',
    });
  }

  // 对于启动操作，检查是否为系统命令
  if (operation === 'start' && processName) {
    const systemCommands = [
      'sh',
      'bash',
      'cmd',
      'powershell',
      'python',
      'node',
      'npm',
      'yarn',
    ];
    if (systemCommands.includes(processName.toLowerCase())) {
      return createAskDecision(
        `Are you sure you want to start ${processName}?`,
        {
          type: 'safetyCheck',
          reason: 'System command execution requires confirmation',
        }
      );
    }
  }

  return null;
}

/**
 * 权限策略管理器
 */
export class PermissionPolicyManager {
  /**
   * 检查命令权限
   */
  static checkCommandPermission(
    toolName: string,
    command: string
  ): PermissionDecision | null {
    const dangerCheck = checkDangerousCommand(toolName, command);
    if (dangerCheck.isDangerous) {
      return createDenyDecision(dangerCheck.reason, {
        type: 'safetyCheck',
        reason: dangerCheck.reason,
      });
    }
    return null;
  }

  /**
   * 检查文件权限
   */
  static checkFilePermission(
    operation: 'read' | 'write' | 'delete',
    path: string,
    workingDir: string = process.cwd()
  ): PermissionDecision | null {
    return checkFileOperationPermission(operation, path, workingDir);
  }

  /**
   * 检查网络权限
   */
  static checkNetworkPermission(
    url: string,
    method: string = 'GET'
  ): PermissionDecision | null {
    return checkNetworkOperationPermission(url, method);
  }

  /**
   * 检查进程权限
   */
  static checkProcessPermission(
    operation: 'start' | 'kill' | 'list',
    processName?: string,
    processId?: number
  ): PermissionDecision | null {
    return checkProcessOperationPermission(operation, processName, processId);
  }
}

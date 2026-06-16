/**
 * 权限策略限制
 * 实现危险命令检测、路径验证等权限策略
 */

import { join, resolve, normalize } from 'path';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { handleError } from '@modules/error/handleError';
import type { PermissionDecision } from './PermissionResult';
import { createDenyDecision, createAskDecision } from './PermissionResult';

const logger = new Logger({ level: LogLevel.INFO });

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
  'C:\\Windows\\System32',
  'C:\\SysWOW64',
];

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

export function validatePath(
  path: string,
  workingDir: string = process.cwd()
): { isValid: boolean; reason: string } {
  try {
    const resolvedPath = resolve(workingDir, path);
    const normalizedPath = normalize(resolvedPath);

    for (const protectedPath of PROTECTED_PATHS) {
      if (normalizedPath.startsWith(protectedPath)) {
        return {
          isValid: false,
          reason: `Path ${path} is in a protected directory: ${protectedPath}`,
        };
      }
    }

    if (path.includes('..') || normalizedPath.includes('..')) {
      return {
        isValid: false,
        reason: `Path ${path} contains directory traversal`,
      };
    }

    return { isValid: true, reason: '' };
  } catch (error) {
    void handleError(error, { module: 'permission:policies', action: 'validate_path' });
    return {
      isValid: false,
      reason: `Error validating path: ${(error as Error).message}`,
    };
  }
}

export function checkFileOperationPermission(
  operation: 'read' | 'write' | 'delete',
  path: string,
  workingDir: string = process.cwd()
): PermissionDecision | null {
  const pathValidation = validatePath(path, workingDir);
  if (!pathValidation.isValid) {
    return createDenyDecision(pathValidation.reason, {
      type: 'safetyCheck',
      reason: pathValidation.reason,
    });
  }

  if (operation === 'delete') {
    return createAskDecision(`Are you sure you want to delete ${path}?`, {
      type: 'safetyCheck',
      reason: 'Delete operation requires confirmation',
    });
  }

  return null;
}

export function checkNetworkOperationPermission(
  url: string,
  method: string = 'GET'
): PermissionDecision | null {
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

export function checkProcessOperationPermission(
  operation: 'start' | 'kill' | 'list',
  processName?: string,
  processId?: number
): PermissionDecision | null {
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

export class PermissionPolicyManager {
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

  static checkFilePermission(
    operation: 'read' | 'write' | 'delete',
    path: string,
    workingDir: string = process.cwd()
  ): PermissionDecision | null {
    return checkFileOperationPermission(operation, path, workingDir);
  }

  static checkNetworkPermission(
    url: string,
    method: string = 'GET'
  ): PermissionDecision | null {
    return checkNetworkOperationPermission(url, method);
  }

  static checkProcessPermission(
    operation: 'start' | 'kill' | 'list',
    processName?: string,
    processId?: number
  ): PermissionDecision | null {
    return checkProcessOperationPermission(operation, processName, processId);
  }
}

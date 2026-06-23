/**
 * 权限策略限制
 * 实现危险命令检测、路径验证等权限策略
 */

import { join, resolve, normalize } from 'path';
import { handleError } from '@modules/error';
import type { PermissionDecision } from './PermissionResult';
import { createDenyDecision, createAskDecision } from './PermissionResult';
import { ALL_UNIFIED_RULES } from '../security/patterns/dangerousCommands';

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

/**
 * 路径权重映射
 * 用于删除规模阈值的动态计算
 */
const PATH_WEIGHTS: Record<string, number> = {
  safeZonePath: 0.1, // 安全操作区 ×0.1（阈值上浮 10x）
  normalPath: 1.0, // 普通路径 ×1.0
  protectedPath: 10.0, // 受保护路径 ×10（阈值下沉到 1/10）
};

/**
 * 安全区域配置
 * - protectedUserPaths: 受保护路径，删除需确认
 * - safeZonePaths:      安全操作区，删除可免确认
 * - deleteScaleThresholds: 按删除规模分级响应
 */
export interface UserDataConfig {
  /** 受保护路径（删除需 ask / deny） */
  protectedUserPaths: string[];
  /** 安全操作区（删除可免 confirm） */
  safeZonePaths: string[];
  /** 删除规模阈值 */
  deleteScaleThresholds: {
    ask: number; // 默认 5
    preview: number; // 默认 100
    deny: number; // 默认 1000
  };
  /** 强制批量删除走回收站 */
  enableRecycleBinForce: boolean;
}

/** 默认安全区域配置 */
export const DEFAULT_USER_DATA_CONFIG: UserDataConfig = {
  protectedUserPaths: [],
  safeZonePaths: [],
  deleteScaleThresholds: {
    ask: 5,
    preview: 100,
    deny: 1000,
  },
  enableRecycleBinForce: true,
};

/**
 * 删除规模级别
 */
export type DeleteScaleLevel = 'small' | 'medium' | 'large' | 'bulk';

/**
 * 删除规模分级响应
 */
export interface DeleteScaleResponse {
  level: DeleteScaleLevel;
  effectiveThreshold: number;
  fileCount: number;
  requirePreview: boolean;
  behavior: 'ask' | 'deny';
}

/**
 * 计算路径权重
 * @param path 目标路径
 * @param config 安全区域配置
 * @returns 路径权重
 */
function getPathWeight(path: string, config: UserDataConfig): number {
  if (config.protectedUserPaths.some((p) => path.startsWith(p))) {
    return PATH_WEIGHTS.protectedPath;
  }
  if (config.safeZonePaths.some((p) => path.startsWith(p))) {
    return PATH_WEIGHTS.safeZonePath;
  }
  return PATH_WEIGHTS.normalPath;
}

/**
 * 计算有效阈值
 * 根据路径权重动态调整基准阈值
 * @param base 基准阈值
 * @param path 目标路径
 * @param config 安全区域配置
 * @returns 有效阈值（最小为 1）
 */
export function effectiveThreshold(
  base: number,
  path: string,
  config: UserDataConfig
): number {
  const weight = getPathWeight(path, config);
  return Math.max(1, Math.round(base * weight));
}

/**
 * 判断删除操作的规模级别
 * @param fileCount 文件数量
 * @param path 目标路径
 * @param config 安全区域配置（可选）
 * @returns 删除规模分级响应
 */
export function classifyDeleteScale(
  fileCount: number,
  path: string,
  config: UserDataConfig = DEFAULT_USER_DATA_CONFIG
): DeleteScaleResponse {
  const askThreshold = effectiveThreshold(
    config.deleteScaleThresholds.ask,
    path,
    config
  );
  const previewThreshold = effectiveThreshold(
    config.deleteScaleThresholds.preview,
    path,
    config
  );
  const denyThreshold = effectiveThreshold(
    config.deleteScaleThresholds.deny,
    path,
    config
  );

  let level: DeleteScaleLevel;
  let requirePreview: boolean;
  let behavior: 'ask' | 'deny';

  if (fileCount <= askThreshold) {
    level = 'small';
    requirePreview = false;
    behavior = 'ask';
  } else if (fileCount <= previewThreshold) {
    level = 'medium';
    requirePreview = true;
    behavior = 'ask';
  } else if (fileCount <= denyThreshold) {
    level = 'large';
    requirePreview = true;
    behavior = 'deny';
  } else {
    level = 'bulk';
    requirePreview = true;
    behavior = 'deny';
  }

  return {
    level,
    effectiveThreshold:
      fileCount <= askThreshold
        ? askThreshold
        : fileCount <= previewThreshold
          ? previewThreshold
          : fileCount <= denyThreshold
            ? denyThreshold
            : denyThreshold,
    fileCount,
    requirePreview,
    behavior,
  };
}

export function checkDangerousCommand(
  toolName: string,
  command: string
): { isDangerous: boolean; reason: string; behavior?: 'ask' | 'deny' } {
  // 使用 ALL_UNIFIED_RULES（dangerousCommands.ts）进行危险命令检测
  const toolLower = toolName.toLowerCase();
  let platform: string;
  if (toolLower === 'bash') {
    platform = 'bash';
  } else if (toolLower === 'cmd' || toolLower === 'cmd.exe') {
    platform = 'cmd';
  } else {
    platform = 'powershell';
  }

  for (const rule of ALL_UNIFIED_RULES) {
    if (!rule.platforms.includes(platform)) continue;

    for (const pattern of rule.patterns) {
      if (pattern.test(command)) {
        return {
          isDangerous: true,
          reason: rule.message || `Matches dangerous pattern: ${rule.name}`,
          behavior: rule.defaultBehavior === 'deny' ? 'deny' : 'ask',
        };
      }
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
    void handleError(error, {
      module: 'permission:policies',
      action: 'validate_path',
    });
    return {
      isValid: false,
      reason: `Error validating path: ${(error as Error).message}`,
    };
  }
}

export function checkFileOperationPermission(
  operation: 'read' | 'write' | 'delete',
  path: string,
  workingDir: string = process.cwd(),
  fileCount: number = 1,
  userDataConfig: UserDataConfig = DEFAULT_USER_DATA_CONFIG
): PermissionDecision | null {
  const pathValidation = validatePath(path, workingDir);
  if (!pathValidation.isValid) {
    return createDenyDecision(pathValidation.reason, {
      type: 'safetyCheck',
      reason: pathValidation.reason,
    });
  }

  if (operation === 'delete') {
    // 使用路径感知的删除规模分级
    const scale = classifyDeleteScale(fileCount, path, userDataConfig);

    if (scale.behavior === 'deny') {
      const denyReason = `批量删除操作已拒绝：路径 "${path}" 删除 ${fileCount} 个文件超过阈值（级别: ${scale.level}）`;
      return createDenyDecision(denyReason, {
        type: 'safetyCheck',
        reason: denyReason,
      });
    }

    const askReason = scale.requirePreview
      ? `确认删除 ${fileCount} 个文件（路径: ${path}，级别: ${scale.level}，建议先预览）`
      : `确认删除路径: ${path}`;
    return createAskDecision(askReason, {
      type: 'safetyCheck',
      reason: askReason,
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
      if (dangerCheck.behavior === 'ask') {
        return createAskDecision(dangerCheck.reason, {
          type: 'safetyCheck',
          reason: dangerCheck.reason,
        });
      }
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

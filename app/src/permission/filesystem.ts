import * as path from 'path';
import { PermissionBehavior } from './types/PermissionRule';
import type { PermissionDecision, PermissionResult } from './PermissionResult';
import { configManager } from '@modules/config';
import { handleError } from '@modules/error';
import { isPathWithin, containsPathTraversal } from '@modules/core/paths';

// 重新导出，供 permission/index.ts 使用
export { containsPathTraversal };

import { getLogger } from '@modules/monitoring';
const logger = getLogger('permission:filesystem');

export const DANGEROUS_FILES = [
  '.gitconfig',
  '.gitmodules',
  '.bashrc',
  '.bash_profile',
  '.zshrc',
  '.zprofile',
  '.profile',
  '.mcp.json',
] as const;

export const DANGEROUS_DIRECTORIES = ['.git', '.vscode', '.idea'] as const;

/**
 * 获取合并后的危险文件列表（默认 + 用户 config.json 自定义）
 */
function getMergedDangerousFiles(): readonly string[] {
  try {
    const permission = configManager.getConfigValue<any>('permission');
    const rules = permission?.customRules?.directoryRules?.blacklist;
    if (!rules || rules.length === 0) return DANGEROUS_FILES;
    const userFiles = rules
      .map((r: any) => r.path)
      .filter((p: string) => !p.includes('/') && !p.includes('\\'));
    if (userFiles.length === 0) return DANGEROUS_FILES;
    return [...DANGEROUS_FILES, ...userFiles];
  } catch {
    // @ignore-catch: config 读取异常回退默认危险文件列表（fail-closed 方向）
    return DANGEROUS_FILES;
  }
}

/**
 * 获取合并后的危险目录列表（默认 + 用户 config.json 自定义）
 */
function getMergedDangerousDirectories(): readonly string[] {
  try {
    const permission = configManager.getConfigValue<any>('permission');
    const rules = permission?.customRules?.directoryRules?.blacklist;
    if (!rules || rules.length === 0) return DANGEROUS_DIRECTORIES;
    const userDirs = rules
      .map((r: any) => r.path)
      .filter((p: string) => p.includes('/') || p.includes('\\'))
      .map((p: string) => path.basename(p));
    if (userDirs.length === 0) return DANGEROUS_DIRECTORIES;
    return [...DANGEROUS_DIRECTORIES, ...userDirs];
  } catch {
    // @ignore-catch: config 读取异常回退默认危险目录列表（fail-closed 方向）
    return DANGEROUS_DIRECTORIES;
  }
}

export function isDangerousFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  const merged = getMergedDangerousFiles();
  return (merged as readonly string[]).includes(basename);
}

export function isInDangerousDirectory(filePath: string): boolean {
  const parts = filePath.replace(/\\/g, '/').split('/');
  const merged = getMergedDangerousDirectories();
  return parts.some((p) => (merged as readonly string[]).includes(p));
}

export function isWithinWorkingDirectory(
  filePath: string,
  cwd: string
): boolean {
  if (isPathWithin(cwd, filePath)) return true;

  // 检查是否在任何信任工作区内（多工作区支持）
  try {
    const permission = configManager.getConfigValue<any>('permission');
    const workspaces = permission?.trustedWorkspaces;
    if (workspaces && workspaces.length > 0) {
      const resolved = path.resolve(cwd, filePath);
      const normalizedPath = resolved.replace(/\\/g, '/');
      for (const ws of workspaces) {
        if (!ws.enabled) continue;
        const wsResolved = path.resolve(ws.path).replace(/\\/g, '/');
        if (isPathWithin(wsResolved, normalizedPath)) {
          return true;
        }
      }
    }
  } catch (err) {
    // config 不可用时静默降级，仅使用 cwd 检查
    handleError(err, {
      module: 'permission:filesystem',
      action: 'loadWorkspaceConfig',
    });
  }

  return false;
}

export function checkReadPermissionForTool(
  filePath: string,
  cwd: string
): PermissionResult {
  if (containsPathTraversal(filePath)) {
    return {
      behavior: PermissionBehavior.DENY,
      message: '路径遍历攻击被拒绝',
      decisionReason: { type: 'config', source: 'security' },
    };
  }

  if (!isWithinWorkingDirectory(filePath, cwd)) {
    return {
      behavior: PermissionBehavior.ASK,
      message: `文件在工作目录外: ${filePath}`,
      decisionReason: { type: 'config', source: 'filesystem' },
    };
  }

  if (isInDangerousDirectory(filePath)) {
    return {
      behavior: PermissionBehavior.ASK,
      message: `文件在受保护目录中: ${filePath}`,
      decisionReason: { type: 'config', source: 'filesystem' },
    };
  }

  return {
    behavior: PermissionBehavior.ALLOW,
    decisionReason: { type: 'default' },
  };
}

export function checkWritePermissionForTool(
  filePath: string,
  cwd: string
): PermissionResult {
  const readResult = checkReadPermissionForTool(filePath, cwd);
  if (readResult.behavior !== PermissionBehavior.ALLOW) {
    return readResult;
  }

  if (isDangerousFile(filePath)) {
    return {
      behavior: PermissionBehavior.DENY,
      message: `受保护文件不可写入: ${path.basename(filePath)}`,
      decisionReason: { type: 'config', source: 'security' },
    };
  }

  return {
    behavior: PermissionBehavior.ALLOW,
    decisionReason: { type: 'default' },
  };
}

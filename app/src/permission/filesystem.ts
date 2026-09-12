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

/**
 * O27① 修复（2026-09-12）：原 `checkReadPermissionForTool` / `checkWritePermissionForTool`
 * 全仓**无调用者**（只有定义 + re-export），属"能力层已实现但未接线"。
 * 其规则已**接线到实际决策点** `PermissionChecker.checkSafetyRules`：
 *   - 危险目录（`DANGEROUS_DIRECTORIES`）→ ASK
 *   - 危险文件（`DANGEROUS_FILES`）写入 → DENY
 * 未接线部分说明：`isWithinWorkingDirectory`（工作目录外 → ASK）**有意未启用** ——
 * 会对正常跨目录操作造成大量审批噪音，需要时再单独评估。
 */

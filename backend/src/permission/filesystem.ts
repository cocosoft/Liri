/**
 * 文件系统权限检查（基于CC源码 utils/permissions/filesystem.ts）
 */
import * as path from 'path';
import type { PermissionDecision, PermissionResult } from './PermissionResult';

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

export const DANGEROUS_DIRECTORIES = [
  '.git',
  '.vscode',
  '.idea',
] as const;

export function isDangerousFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  return (DANGEROUS_FILES as readonly string[]).includes(basename);
}

export function isInDangerousDirectory(filePath: string): boolean {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts.some(p => (DANGEROUS_DIRECTORIES as readonly string[]).includes(p));
}

export function containsPathTraversal(filePath: string): boolean {
  return filePath.includes('..');
}

export function isWithinWorkingDirectory(filePath: string, cwd: string): boolean {
  const resolved = path.resolve(cwd, filePath);
  return resolved.startsWith(path.resolve(cwd));
}

export function checkReadPermissionForTool(
  filePath: string,
  cwd: string,
): PermissionResult {
  if (containsPathTraversal(filePath)) {
    return {
      behavior: 'deny',
      message: '路径遍历攻击被拒绝',
      decisionReason: { type: 'config', source: 'security' },
    };
  }

  if (!isWithinWorkingDirectory(filePath, cwd)) {
    return {
      behavior: 'ask',
      message: `文件在工作目录外: ${filePath}`,
      decisionReason: { type: 'config', source: 'filesystem' },
    };
  }

  if (isInDangerousDirectory(filePath)) {
    return {
      behavior: 'ask',
      message: `文件在受保护目录中: ${filePath}`,
      decisionReason: { type: 'config', source: 'filesystem' },
    };
  }

  return { behavior: 'allow', decisionReason: { type: 'default' } };
}

export function checkWritePermissionForTool(
  filePath: string,
  cwd: string,
): PermissionResult {
  const readResult = checkReadPermissionForTool(filePath, cwd);
  if (readResult.behavior !== 'allow') {
    return readResult;
  }

  if (isDangerousFile(filePath)) {
    return {
      behavior: 'deny',
      message: `受保护文件不可写入: ${path.basename(filePath)}`,
      decisionReason: { type: 'config', source: 'security' },
    };
  }

  return { behavior: 'allow', decisionReason: { type: 'default' } };
}

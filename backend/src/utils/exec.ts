// @ts-nocheck
/**
 * 执行命令工具
 */

import { execSync } from 'child_process';

/**
 * 执行命令并返回输出
 * @param command 命令
 * @param options 选项
 * @returns 命令输出
 */
export function execSyncWithOutput(command: string, options: any = {}): { stdout: string; stderr: string } {
  try {
    const stdout = execSync(command, { ...options, encoding: 'utf8' });
    return { stdout, stderr: '' };
  } catch (error: any) {
    return { stdout: error.stdout || '', stderr: error.stderr || '' };
  }
}

/**
 * 执行命令
 * @param command 命令
 * @param options 选项
 * @returns 命令输出
 */
export function execSync(command: string, options: any = {}): string {
  return execSync(command, { ...options, encoding: 'utf8' });
}

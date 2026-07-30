//
/**
 * 执行命令工具
 */

import { execSync as cpExecSync } from 'child_process';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'utils:exec', level: LogLevel.INFO });

/**
 * 执行命令并返回输出
 * @param command 命令
 * @param options 选项
 * @returns 命令输出
 */
export function execSyncWithOutput(
  command: string,
  options: Record<string, unknown> = {}
): { stdout: string; stderr: string } {
  try {
    const stdout = cpExecSync(command, { ...options, encoding: 'utf8' });
    return { stdout, stderr: '' };
  } catch (error: unknown) {
    return {
      stdout: (error as { stdout?: string }).stdout || '',
      stderr: (error as { stderr?: string }).stderr || '',
    };
  }
}

/**
 * 执行命令
 * @param command 命令
 * @param options 选项
 * @returns 命令输出
 */
export function execSync(
  command: string,
  options: Record<string, unknown> = {}
): string {
  return cpExecSync(command, { ...options, encoding: 'utf8' });
}

/**
 * /commit 命令 - 智能Git提交
 * 基于CC源码 commands/commit.js 模式
 */
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface CommitCommandResult {
  success: boolean;
  message?: string;
  stagedFiles: string[];
  commitMessage?: string;
}

export async function getStagedFiles(cwd?: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync('git diff --cached --name-only', {
      cwd: cwd || process.cwd(),
      timeout: 10_000,
    });
    return stdout.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

export async function getStagedDiff(cwd?: string): Promise<string> {
  try {
    const { stdout } = await execAsync('git diff --cached --stat', {
      cwd: cwd || process.cwd(),
      timeout: 10_000,
    });
    return stdout.trim();
  } catch {
    return '';
  }
}

export async function commitChanges(
  message: string,
  cwd?: string,
): Promise<{ success: boolean; message: string }> {
  if (!message || message.trim() === '') {
    return { success: false, message: '请提供提交信息。用法: /commit <提交信息>' };
  }
  
  try {
    await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: cwd || process.cwd(),
      timeout: 30_000,
    });
    return { success: true, message: 'Commit successful' };
  } catch (e: any) {
    return { success: false, message: e.stderr || e.message };
  }
}

const Commit = {
  execute: commitChanges,
};

export default Commit;
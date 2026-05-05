/**
 * /git 命令 - Git操作封装
 * 提供常用的Git操作功能
 */
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface GitCommandResult {
  success: boolean;
  message: string;
  output?: string;
}

export async function executeGitCommand(
  args: string,
  cwd?: string,
): Promise<GitCommandResult> {
  if (!args || args.trim() === '') {
    return {
      success: false,
      message: '请提供Git命令参数。用法: /git <command> [options]\n例如: /git status, /git add ., /git commit -m "message"',
    };
  }

  try {
    const { stdout, stderr } = await execAsync(`git ${args}`, {
      cwd: cwd || process.cwd(),
      timeout: 30_000,
    });

    if (stderr && !stdout) {
      return {
        success: false,
        message: stderr.trim(),
      };
    }

    return {
      success: true,
      message: stdout.trim() || '命令执行成功',
      output: stdout.trim(),
    };
  } catch (e: any) {
    return {
      success: false,
      message: e.stderr || e.message || 'Git命令执行失败',
    };
  }
}

const Git = {
  execute: executeGitCommand,
};

export default Git;
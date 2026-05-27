/**
 * 轻量级外部命令执行工具
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export async function execFileNoThrow(
  command: string,
  args: string[],
  options?: { cwd?: string }
): Promise<{ stdout: string; stderr: string } | null> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
      ...options,
    });
    return { stdout, stderr };
  } catch {
    return null;
  }
}

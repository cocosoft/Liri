import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export async function execFileNoThrow(
  command: string,
  args: string[],
  options?: { timeout?: number }
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(command, args, {
      timeout: options?.timeout ?? 5000,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch {
    return { stdout: '', stderr: '' };
  }
}

import { execFile } from 'child_process';
import { promisify } from 'util';

export interface ExecFileNoThrowOptions {
  input?: string;
  useCwd?: boolean;
  timeout?: number;
}

const execFileAsync = promisify(execFile);

export async function execFileNoThrow(
  command: string,
  args: string[],
  options?: ExecFileNoThrowOptions
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const result = await execFileAsync(command, args, {
      timeout: options?.timeout ?? 5000,
      input: options?.input,
    });
    return { stdout: result.stdout, stderr: result.stderr, code: 0 };
  } catch {
    return { stdout: '', stderr: '', code: -1 };
  }
}

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
    } as any);
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    return { stdout, stderr, code: 0 };
  } catch {
    return { stdout: '', stderr: '', code: -1 };
  }
}

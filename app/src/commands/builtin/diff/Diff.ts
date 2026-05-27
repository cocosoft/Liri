/**
 * /diff 命令 - 差异查看
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(execFile);

export interface DiffResult {
  files: string[];
  additions: number;
  deletions: number;
  rawDiff: string;
}

const MAX_DIFF_SIZE = 50_000;

export async function getDiff(
  stagedOnly: boolean = false,
  cwd?: string
): Promise<DiffResult> {
  const args = ['diff', '--stat'];
  if (stagedOnly) args.splice(1, 0, '--cached');

  try {
    const { stdout: statOut } = await execAsync('git', args, {
      cwd: cwd || process.cwd(),
      timeout: 10_000,
    });

    const fullArgs = ['diff'];
    if (stagedOnly) fullArgs.push('--cached');
    const { stdout: rawDiff } = await execAsync('git', fullArgs, {
      cwd: cwd || process.cwd(),
      timeout: 10_000,
    });

    const files = statOut
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split('|')[0].trim());
    const additions = (rawDiff.match(/^\+[^+]/gm) || []).length;
    const deletions = (rawDiff.match(/^-[^-]/gm) || []).length;

    return {
      files,
      additions,
      deletions,
      rawDiff:
        rawDiff.length > MAX_DIFF_SIZE
          ? rawDiff.substring(0, MAX_DIFF_SIZE) + '\n...(truncated)'
          : rawDiff,
    };
  } catch {
    return { files: [], additions: 0, deletions: 0, rawDiff: '' };
  }
}

// @ts-nocheck
/**
 * Git状态检测器（参考CC源码 context.ts getGitStatus）
 * 提供memoize缓存的Git状态查询，MAX_STATUS_CHARS=2000限制
 */
import { execFileNoThrow } from './execUtils';
import * as path from 'path';
import * as fs from 'fs';

const MAX_STATUS_CHARS = 2000;

let gitAvailable: boolean | null = null;

async function checkGitAvailable(): Promise<boolean> {
  if (gitAvailable !== null) return gitAvailable;
  try {
    await execFileNoThrow('git', ['--version']);
    gitAvailable = true;
  } catch {
    gitAvailable = false;
  }
  return gitAvailable;
}

async function findGitRoot(dir: string): Promise<string | null> {
  let current = path.resolve(dir);
  for (let i = 0; i < 32; i++) {
    const gitDir = path.join(current, '.git');
    if (fs.existsSync(gitDir)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export interface GitInfo {
  branch: string | null;
  status: string | null;
  isGit: boolean;
  root: string | null;
}

let cachedGitInfo: GitInfo | null = null;

export async function getGitInfo(cwd: string = process.cwd()): Promise<GitInfo> {
  if (cachedGitInfo) return cachedGitInfo;

  const available = await checkGitAvailable();
  if (!available) {
    cachedGitInfo = { branch: null, status: null, isGit: false, root: null };
    return cachedGitInfo;
  }

  const root = await findGitRoot(cwd);
  if (!root) {
    cachedGitInfo = { branch: null, status: null, isGit: false, root: null };
    return cachedGitInfo;
  }

  let branch: string | null = null;
  try {
    const result = await execFileNoThrow('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root });
    branch = result.stdout?.trim() || null;
  } catch {}

  let status: string | null = null;
  try {
    const result = await execFileNoThrow('git', ['status', '--short'], { cwd: root });
    const raw = result.stdout || '';
    status = raw.length > MAX_STATUS_CHARS
      ? raw.substring(0, MAX_STATUS_CHARS) + '\n...(truncated)'
      : raw || '(clean)';
  } catch {}

  cachedGitInfo = { branch, status, isGit: true, root };
  return cachedGitInfo;
}

export function getDefaultBranch(gitRoot: string): string {
  return 'main';
}

export function clearGitCache(): void {
  cachedGitInfo = null;
  gitAvailable = null;
}

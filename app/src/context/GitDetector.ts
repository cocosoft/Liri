//
/**
 * Git状态检测器（参考CC源码 context.ts getGitStatus）
 * 提供memoize缓存的Git状态查询，MAX_STATUS_CHARS=2000限制
 */
import { execFileNoThrow } from './execUtils';
import * as path from 'path';
import * as fs from 'fs';
import { handleError } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('context:gitDetector');

/**
 * Git status 输出截断上限（字符）。
 *
 * **唯一真源**（硬编码治理「同名常量」B3-2）：原于本文件、`GitContextService.ts`、
 * `services/SystemContextService.ts` **各写一份**同值常量 ⇒ 统一由此导出（本文件为三者
 * 公共底座，其余两处 import；两处**都不反向被本文件引用** ⇒ 无成环）。
 */
export const MAX_STATUS_CHARS = 2000;

let gitAvailable: boolean | null = null;

async function checkGitAvailable(): Promise<boolean> {
  if (gitAvailable !== null) return gitAvailable;
  try {
    await execFileNoThrow('git', ['--version']);
    gitAvailable = true;
  } catch {
    // @ignore-catch: git detection failure
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

export async function getGitInfo(
  cwd: string = process.cwd()
): Promise<GitInfo> {
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
    const result = await execFileNoThrow(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd: root }
    );
    branch = result?.stdout?.trim() || null;
  } catch (err) {
    void handleError(err, {
      module: 'context:GitDetector.ts',
      action: 'catch_error',
    });
  }

  let status: string | null = null;
  try {
    const result = await execFileNoThrow('git', ['status', '--short'], {
      cwd: root,
    });
    const raw = result?.stdout || '';
    status =
      raw.length > MAX_STATUS_CHARS
        ? raw.substring(0, MAX_STATUS_CHARS) + '\n...(truncated)'
        : raw || '(clean)';
  } catch (err) {
    void handleError(err, {
      module: 'context:GitDetector.ts',
      action: 'catch_error',
    });
  }

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

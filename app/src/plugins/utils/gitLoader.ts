/**
 * Git仓库加载工具
 * 支持分支/标签指定、浅克隆等功能
 * 参考CC源码 cc_code/backend/utils/plugins/pluginLoader.ts 实现
 */

import { execSync } from 'child_process';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { logger } from '@modules/utils/log.js';

const execFileAsync = promisify(execFile);

async function execFileNoThrow(
  command: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; error?: Error }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args);
    return { stdout, stderr };
  } catch (error: any) {
    return { stdout: error.stdout || '', stderr: error.stderr || '', error };
  }
}

async function pathExists(path: string): Promise<boolean> {
  return existsSync(path);
}

/**
 * Git源配置
 */
export interface GitSourceConfig {
  url: string;
  branch?: string;
  tag?: string;
  commit?: string;
  subDir?: string;
  shallow?: boolean;
}

/**
 * Git克隆选项
 */
export interface GitCloneOptions {
  branch?: string;
  tag?: string;
  commit?: string;
  depth?: number;
  subDir?: string;
}

/**
 * Git克隆结果
 */
export interface GitCloneResult {
  success: boolean;
  path?: string;
  commitSha?: string;
  error?: string;
}

/**
 * 从URL解析Git源配置
 * 支持格式：
 * - https://github.com/user/repo
 * - https://github.com/user/repo#branch-name
 * - https://github.com/user/repo#v1.0.0 (tag)
 * - git@github.com:user/repo.git
 * - git@github.com:user/repo.git#branch-name
 */
export function parseGitSource(url: string): GitSourceConfig {
  const config: GitSourceConfig = { url };

  const hashIndex = url.indexOf('#');
  if (hashIndex === -1) {
    return config;
  }

  const baseUrl = url.substring(0, hashIndex);
  const ref = url.substring(hashIndex + 1);

  config.url = baseUrl;

  if (ref.startsWith('branch:')) {
    config.branch = ref.substring(7);
  } else if (ref.startsWith('tag:')) {
    config.tag = ref.substring(4);
  } else if (ref.startsWith('commit:')) {
    config.commit = ref.substring(7);
  } else if (/^\d+\.\d+/.test(ref)) {
    config.tag = ref;
  } else {
    config.branch = ref;
  }

  return config;
}

/**
 * 克隆Git仓库
 */
export async function cloneGitRepo(
  source: GitSourceConfig,
  targetDir: string,
  options: GitCloneOptions = {}
): Promise<GitCloneResult> {
  const { branch, tag, commit, depth = 1, subDir } = options;

  const args: string[] = ['clone'];

  if (depth > 0) {
    args.push('--depth', String(depth));
  }

  if (branch) {
    args.push('--branch', branch, '--single-branch');
  } else if (tag) {
    args.push('--branch', tag, '--single-branch');
  }

  args.push(source.url, targetDir);

  const { error } = await execFileNoThrow('git', args);

  if (error) {
    logger.error('Git clone failed:', error);
    return { success: false, error: String(error) };
  }

  if (commit) {
    const { error: checkoutError } = await execFileNoThrow('git', [
      '-C',
      targetDir,
      'checkout',
      commit,
    ]);
    if (checkoutError) {
      logger.error('Git checkout failed:', checkoutError);
      return { success: false, error: String(checkoutError) };
    }
  }

  let commitSha: string | undefined;
  if (source.shallow === false || depth === 0) {
    const { stdout } = await execFileNoThrow('git', [
      '-C',
      targetDir,
      'rev-parse',
      'HEAD',
    ]);
    commitSha = stdout.trim();
  }

  let actualPath = targetDir;
  if (subDir) {
    actualPath = `${targetDir}/${subDir}`;
  }

  return { success: true, path: actualPath, commitSha };
}

/**
 * 浅克隆仓库
 */
export async function shallowClone(
  source: GitSourceConfig,
  targetDir: string,
  subDir?: string
): Promise<GitCloneResult> {
  return cloneGitRepo(source, targetDir, {
    branch: source.branch,
    tag: source.tag,
    commit: source.commit,
    depth: 1,
    subDir,
  });
}

/**
 * 深克隆仓库（完整历史）
 */
export async function deepClone(
  source: GitSourceConfig,
  targetDir: string,
  subDir?: string
): Promise<GitCloneResult> {
  return cloneGitRepo(source, targetDir, {
    branch: source.branch,
    tag: source.tag,
    commit: source.commit,
    depth: 0,
    subDir,
  });
}

/**
 * 获取远程仓库的分支列表
 */
export async function getRemoteBranches(url: string): Promise<string[]> {
  const { stdout, error } = await execFileNoThrow('git', [
    'ls-remote',
    '--heads',
    url,
  ]);

  if (error) {
    logger.error('Failed to get remote branches:', error);
    return [];
  }

  const branches: string[] = [];
  const lines = stdout.trim().split('\n');

  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length === 2 && parts[1].startsWith('refs/heads/')) {
      branches.push(parts[1].substring(11));
    }
  }

  return branches;
}

/**
 * 获取远程仓库的标签列表
 */
export async function getRemoteTags(url: string): Promise<string[]> {
  const { stdout, error } = await execFileNoThrow('git', [
    'ls-remote',
    '--tags',
    url,
  ]);

  if (error) {
    logger.error('Failed to get remote tags:', error);
    return [];
  }

  const tags: string[] = [];
  const lines = stdout.trim().split('\n');

  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length === 2 && parts[1].startsWith('refs/tags/')) {
      const tagName = parts[1].substring(10);
      if (!tagName.endsWith('^{}')) {
        tags.push(tagName);
      }
    }
  }

  return tags;
}

/**
 * 检查指定引用（分支或标签）是否存在
 */
export async function refExists(url: string, ref: string): Promise<boolean> {
  const branches = await getRemoteBranches(url);
  if (branches.includes(ref)) return true;

  const tags = await getRemoteTags(url);
  if (tags.includes(ref)) return true;

  return false;
}

/**
 * 获取最新提交的SHA
 */
export async function getLatestCommitSha(
  url: string,
  branch?: string
): Promise<string | undefined> {
  const args = ['ls-remote', url];
  if (branch) {
    args.push(branch);
  } else {
    args.push('HEAD');
  }

  const { stdout, error } = await execFileNoThrow('git', args);

  if (error) {
    logger.error('Failed to get latest commit:', error);
    return undefined;
  }

  const parts = stdout.trim().split('\t');
  return parts[0];
}

/**
 * 验证Git URL格式
 */
export function isValidGitUrl(url: string): boolean {
  const httpsPattern = /^https:\/\/[^\/]+\/[^\/]+\/[^\/]+(\.git)?$/;
  const gitPattern = /^git@[^\:]+\:[^\/]+\/[^\/]+(\.git)?$/;

  return httpsPattern.test(url) || gitPattern.test(url);
}

/**
 * 标准化Git URL
 */
export function normalizeGitUrl(url: string): string {
  if (url.startsWith('git@')) {
    const match = url.match(/^git@([^:]+):(.+)$/);
    if (match) {
      return `https://${match[1]}/${match[2]}`;
    }
  }

  if (url.endsWith('.git')) {
    return url.slice(0, -4);
  }

  return url;
}

/**
 * 从Git URL提取仓库信息
 */
export function extractRepoInfo(
  url: string
): { owner: string; repo: string } | null {
  const normalized = normalizeGitUrl(url);
  const match = normalized.match(/https:\/\/[^\/]+\/([^\/]+)\/([^\/]+)/);

  if (match) {
    return { owner: match[1], repo: match[2] };
  }

  return null;
}

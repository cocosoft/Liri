//
/**
 * Git 文件系统操作
 *
 * 基于文件系统直接读取 git 状态，避免 shell out
 * 覆盖: .git 目录解析(worktree/submodule)、HEAD 解析、
 * ref 解析(loose files + packed-refs)、分支名安全校验
 *
 * 参考: cc_code/backend/utils/git/gitFilesystem.ts
 */

import { readdir, readFile, stat } from 'fs/promises';
import { join, resolve } from 'path';
import { existsSync } from 'fs';

const resolveGitDirCache = new Map<string, string | null>();

export function clearResolveGitDirCache(): void {
  resolveGitDirCache.clear();
}

function findGitRoot(startPath: string): string | null {
  let current = resolve(startPath);
  const root = resolve('/');
  while (current !== root) {
    const gitPath = join(current, '.git');
    if (existsSync(gitPath)) {
      return current;
    }
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export async function resolveGitDir(
  startPath?: string
): Promise<string | null> {
  const cwd = resolve(startPath ?? process.cwd());
  const cached = resolveGitDirCache.get(cwd);
  if (cached !== undefined) return cached;

  const root = findGitRoot(cwd);
  if (!root) {
    resolveGitDirCache.set(cwd, null);
    return null;
  }

  const gitPath = join(root, '.git');
  try {
    const st = await stat(gitPath);
    if (st.isFile()) {
      const content = (await readFile(gitPath, 'utf-8')).trim();
      if (content.startsWith('gitdir:')) {
        const rawDir = content.slice('gitdir:'.length).trim();
        const resolved = resolve(root, rawDir);
        resolveGitDirCache.set(cwd, resolved);
        return resolved;
      }
    }
    resolveGitDirCache.set(cwd, gitPath);
    return gitPath;
  } catch {
    resolveGitDirCache.set(cwd, null);
    return null;
  }
}

export function isSafeRefName(name: string): boolean {
  if (!name || name.startsWith('-') || name.startsWith('/')) return false;
  if (name.includes('..')) return false;
  if (name.split('/').some((c) => c === '.' || c === '')) return false;
  if (!/^[a-zA-Z0-9/._+@-]+$/.test(name)) return false;
  return true;
}

export async function readHeadRef(
  gitDir: string
): Promise<
  { type: 'branch'; name: string } | { type: 'detached'; sha: string } | null
> {
  try {
    const head = (await readFile(join(gitDir, 'HEAD'), 'utf-8')).trim();
    if (head.startsWith('ref: ')) {
      const ref = head.slice(5).trim();
      if (ref.startsWith('refs/heads/')) {
        const branch = ref.slice('refs/heads/'.length);
        if (isSafeRefName(branch)) {
          return { type: 'branch', name: branch };
        }
      }
      return null;
    }
    // Detached HEAD: raw SHA
    if (/^[0-9a-f]{40}$/.test(head)) {
      return { type: 'detached', sha: head };
    }
    return null;
  } catch {
    return null;
  }
}

export async function resolveRef(
  gitDir: string,
  ref: string
): Promise<string | null> {
  // Try loose ref
  try {
    const sha = (await readFile(join(gitDir, ref), 'utf-8')).trim();
    if (/^[0-9a-f]{40}$/.test(sha)) return sha;
  } catch {
    // not found as loose ref
  }

  // Try packed-refs
  try {
    const packed = await readFile(join(gitDir, 'packed-refs'), 'utf-8');
    for (const line of packed.split('\n')) {
      const trimmed = line.trim();
      if (
        trimmed.length === 0 ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('^')
      ) {
        continue;
      }
      const [sha, refname] = trimmed.split(/\s+/, 2);
      if (refname === ref && /^[0-9a-f]{40}$/.test(sha)) {
        return sha;
      }
    }
  } catch {
    // no packed-refs file
  }

  return null;
}

export async function isShallowRepository(gitDir: string): Promise<boolean> {
  try {
    await stat(join(gitDir, 'shallow'));
    return true;
  } catch {
    return false;
  }
}

export async function listBranches(gitDir: string): Promise<string[]> {
  const headsDir = join(gitDir, 'refs', 'heads');
  const branches: string[] = [];

  async function walk(dir: string, prefix: string) {
    let entries: string[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), `${prefix}${entry.name}/`);
      } else if (entry.isFile()) {
        const name = `${prefix}${entry.name}`;
        if (isSafeRefName(name)) {
          branches.push(name);
        }
      }
    }
  }

  await walk(headsDir, '');
  return branches.sort();
}

export async function getDefaultBranch(gitDir: string): Promise<string | null> {
  // Try reading symbolic-ref for origin/HEAD
  try {
    const ref = (
      await readFile(join(gitDir, 'refs', 'remotes', 'origin', 'HEAD'), 'utf-8')
    ).trim();
    if (ref.startsWith('ref: refs/remotes/origin/')) {
      const branch = ref.slice('ref: refs/remotes/origin/'.length);
      if (isSafeRefName(branch)) return branch;
    }
  } catch {
    // no origin/HEAD
  }

  // Try init.defaultBranch from config
  try {
    const config = await readFile(join(gitDir, 'config'), 'utf-8');
    for (const line of config.split('\n')) {
      const m = line.trim().match(/^\s*defaultBranch\s*=\s*(.+)$/);
      if (m) return m[1].trim();
    }
  } catch {
    // no config
  }

  return null;
}

export async function getRemoteUrl(
  gitDir: string,
  remote = 'origin'
): Promise<string | null> {
  try {
    const config = await readFile(join(gitDir, 'config'), 'utf-8');
    let inRemoteSection = false;
    for (const line of config.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === `[remote "${remote}"]`) {
        inRemoteSection = true;
        continue;
      }
      if (inRemoteSection && trimmed.startsWith('[')) {
        break;
      }
      if (inRemoteSection) {
        const m = trimmed.match(/^\s*url\s*=\s*(.+)$/);
        if (m) return m[1].trim();
      }
    }
    return null;
  } catch {
    return null;
  }
}

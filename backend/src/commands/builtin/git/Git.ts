/**
 * Git命令
 * 提供Git操作封装
 *
 * 基于CC源码 cc_code/backend/utils/git.ts 和 cc_code/backend/utils/git/gitFilesystem.ts 实现
 * 核心功能：
 * 1. 常用的git操作（status, log, branch, diff等）
 * 2. 工作树（worktree）支持
 * 3. 子模块支持
 * 4. 安全性验证
 * 5. 缓存和性能优化
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import type { CommandContext } from '@modules/commands/types';

const execAsync = promisify(exec);

interface GitResult {
  type: 'text' | 'error';
  value: string;
}

interface GitOptions {
  cwd?: string;
  timeout?: number;
}

interface GitStatus {
  branch: string;
  isDetached: boolean;
  staged: string[];
  modified: string[];
  untracked: string[];
  ahead: number;
  behind: number;
  sha?: string;
}

interface BranchInfo {
  name: string;
  isRemote: boolean;
  isCurrent: boolean;
  sha?: string;
}

const GIT_ROOT_NOT_FOUND = Symbol('GIT_ROOT_NOT_FOUND');

interface GitRootResult {
  found: boolean;
  path: string | null;
  isWorktree: boolean;
  worktreePath?: string;
}

function findGitRootImpl(startPath: string): string | typeof GIT_ROOT_NOT_FOUND {
  let current = resolve(startPath);
  const root = current.substring(0, current.indexOf(process.platform === 'win32' ? '\\' : '/') + 1) || '\\';
  const sep = process.platform === 'win32' ? '\\' : '/';

  while (current !== root) {
    try {
      const gitPath = join(current, '.git');
      const fs = require('fs');
      const stat = fs.statSync(gitPath);
      if (stat.isDirectory() || stat.isFile()) {
        return current;
      }
    } catch {
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  try {
    const gitPath = join(root, '.git');
    const fs = require('fs');
    const stat = fs.statSync(gitPath);
    if (stat.isDirectory() || stat.isFile()) {
      return root;
    }
  } catch {
  }

  return GIT_ROOT_NOT_FOUND;
}

function findGitRoot(startPath: string): string | null {
  const result = findGitRootImpl(startPath);
  return result === GIT_ROOT_NOT_FOUND ? null : result;
}

function isSafeRefName(name: string): boolean {
  if (!name || name.startsWith('-') || name.startsWith('/')) {
    return false;
  }
  if (name.includes('..')) {
    return false;
  }
  if (name.split('/').some(c => c === '.' || c === '')) {
    return false;
  }
  if (!/^[a-zA-Z0-9/._+@-]+$/.test(name)) {
    return false;
  }
  return true;
}

function isValidGitSha(s: string): boolean {
  return /^[0-9a-f]{40}$/.test(s) || /^[0-9a-f]{64}$/.test(s);
}

export class GitCommand {
  private gitRoot: string | null = null;

  async call(args: string, context: CommandContext): Promise<GitResult> {
    try {
      const { subcommand, options } = this.parseArgs(args);

      if (!subcommand) {
        return this.showHelp();
      }

      const cwd = context.cwd || process.cwd();
      this.gitRoot = findGitRoot(cwd);

      if (!this.gitRoot) {
        return {
          type: 'error',
          value: '错误: 当前目录不是Git仓库',
        };
      }

      switch (subcommand.toLowerCase()) {
        case 'status':
        case 's':
          return await this.showStatus(options);

        case 'branch':
        case 'b':
          return await this.showBranches(options);

        case 'log':
        case 'l':
          return await this.showLog(options);

        case 'diff':
        case 'd':
          return await this.showDiff(options);

        case 'stash':
          return await this.handleStash(options);

        case 'remote':
          return await this.showRemote(options);

        case 'worktree':
          return await this.handleWorktree(options);

        case ' submodule':
          return await this.handleSubmodule(options);

        case 'tag':
          return await this.showTags(options);

        case 'shortcut':
          return this.showShortcut();

        case 'info':
          return await this.showRepoInfo();

        default:
          return {
            type: 'error',
            value: `未知子命令: ${subcommand}\n\n输入 /git 查看所有可用子命令`,
          };
      }

    } catch (error) {
      return {
        type: 'error',
        value: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  }

  private parseArgs(args: string): { subcommand: string; options: Record<string, string> } {
    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0] || '';
    const options: Record<string, string> = {};

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (part.startsWith('--')) {
        const key = part.slice(2);
        if (parts[i + 1] && !parts[i + 1].startsWith('-')) {
          options[key] = parts[++i];
        } else {
          options[key] = 'true';
        }
      } else if (part.startsWith('-') && part.length > 1) {
        const key = part.slice(1);
        options[key] = 'true';
      }
    }

    return { subcommand, options };
  }

  private async execGit(command: string, cwd?: string): Promise<{ stdout: string; stderr: string }> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: cwd || this.gitRoot || process.cwd(),
        timeout: 30000,
        encoding: 'utf-8',
      });
      return { stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (error: any) {
      return { stdout: '', stderr: error.message || error.stderr || '命令执行失败' };
    }
  }

  private async getGitStatus(options: Record<string, string>): Promise<GitStatus> {
    const [branchResult, statusResult, diffResult, logResult] = await Promise.all([
      this.execGit('git branch --show-current'),
      this.execGit('git status --porcelain'),
      this.execGit('git diff --stat'),
      this.execGit('git log --oneline -1 --format="%H"'),
    ]);

    const isDetached = branchResult.stderr.includes('fatal: not a git repository');
    const branch = isDetached ? '( detached )' : (branchResult.stdout || 'unknown');
    const sha = logResult.stdout || undefined;

    const staged: string[] = [];
    const modified: string[] = [];
    const untracked: string[] = [];
    let ahead = 0;
    let behind = 0;

    if (statusResult.stdout) {
      const lines = statusResult.stdout.split('\n');
      for (const line of lines) {
        if (line.length >= 3) {
          const indexStatus = line[0];
          const workTreeStatus = line[1];
          const file = line.slice(3);

          if (indexStatus === '?' && workTreeStatus === '?') {
            untracked.push(file);
          } else if (indexStatus !== ' ' && indexStatus !== '?') {
            staged.push(file);
          }
          if (workTreeStatus !== ' ' && workTreeStatus !== '?') {
            modified.push(file);
          }
        }
      }
    }

    const branchInfoResult = await this.execGit(`git rev-list --left-right --count ${branch}...@{upstream}`);
    if (branchInfoResult.stdout) {
      const [a, b] = branchInfoResult.stdout.split('\t').map(Number);
      ahead = a || 0;
      behind = b || 0;
    }

    return { branch, isDetached, staged, modified, untracked, ahead, behind, sha };
  }

  private async showStatus(options: Record<string, string>): Promise<GitResult> {
    const status = await this.getGitStatus(options);
    const isShort = options.short || options.s;

    let output = '';

    if (status.isDetached) {
      output += `**分支**: ${status.branch} ( detached HEAD )\n`;
    } else {
      output += `**分支**: ${status.branch}\n`;
    }

    if (status.sha) {
      output += `**SHA**: ${status.sha.slice(0, 8)}\n`;
    }

    if (status.ahead > 0 || status.behind > 0) {
      output += `**同步状态**:`;
      if (status.ahead > 0) output += ` ↑${status.ahead}`;
      if (status.behind > 0) output += ` ↓${status.behind}`;
      output += '\n';
    }

    if (!isShort) {
      output += '\n';

      if (status.staged.length > 0) {
        output += '### 已暂存文件\n\n';
        for (const file of status.staged) {
          output += `  + ${file}\n`;
        }
        output += '\n';
      }

      if (status.modified.length > 0) {
        output += '### 已修改文件\n\n';
        for (const file of status.modified) {
          output += `  ~ ${file}\n`;
        }
        output += '\n';
      }

      if (status.untracked.length > 0) {
        output += '### 未跟踪文件\n\n';
        for (const file of status.untracked) {
          output += `  ? ${file}\n`;
        }
        output += '\n';
      }

      if (status.staged.length === 0 && status.modified.length === 0 && status.untracked.length === 0) {
        output += '✅ 工作区干净，没有变更\n';
      }
    } else {
      const lines: string[] = [];
      status.staged.forEach(f => lines.push(`A  ${f}`));
      status.modified.forEach(f => lines.push(` M ${f}`));
      status.untracked.forEach(f => lines.push(`?? ${f}`));
      if (lines.length > 0) {
        output += '\n' + lines.join('\n') + '\n';
      } else {
        output += '\n✅ 工作区干净\n';
      }
    }

    return { type: 'text', value: output };
  }

  private async showBranches(options: Record<string, string>): Promise<GitResult> {
    const isList = !options.a && !options.d && !options.r && !options.v;
    const isAll = options.a || options.all;
    const isRemote = options.r || isAll;
    const isVerbose = options.v || options.verbose;

    let command = 'git branch';
    if (isAll) command += ' -a';
    if (isRemote && !isAll) command += ' -r';
    if (isVerbose) command += ' -v';

    const result = await this.execGit(command);
    if (result.stderr && !result.stdout) {
      return { type: 'error', value: result.stderr };
    }

    const branches = result.stdout.split('\n').filter(Boolean);
    const currentBranch = (await this.execGit('git branch --show-current')).stdout;

    let output = '## Git 分支\n\n';

    if (isRemote) {
      output += '### 远程分支\n\n';
      branches.filter(b => b.startsWith('  remotes/')).forEach(branch => {
        const isCurrent = branch.includes(`->`);
        const displayName = branch.replace('  remotes/origin/', '');
        if (isCurrent) {
          output += `* ${displayName} (current)\n`;
        } else {
          output += `  ${displayName}\n`;
        }
      });
    } else {
      output += '### 本地分支\n\n';
      branches.forEach(branch => {
        const name = branch.replace(/^\*?\s*/, '');
        const isCurrent = branch.startsWith('*');

        if (isCurrent) {
          output += `* **${name}** (当前分支)\n`;
        } else {
          output += `  ${name}\n`;
        }
      });
    }

    return { type: 'text', value: output };
  }

  private async showLog(options: Record<string, string>): Promise<GitResult> {
    const limit = parseInt(options.n || options.limit || '10', 10);
    const isStat = options.stat;
    const isGraph = options.graph;
    const format = options.format || '%h %s (%an)';
    const file = options.file;

    let command = `git log --oneline -n ${limit}`;
    if (isStat) command += ' --stat';
    if (isGraph) command += ' --graph --all --decorate';
    command += ` --format="${format}"`;
    if (file) command += ` -- ${file}`;

    const result = await this.execGit(command);
    if (result.stderr && !result.stdout) {
      return { type: 'error', value: result.stderr };
    }

    let output = `## Git 提交历史 (最近 ${limit} 条)\n\n`;

    if (file) {
      output += `**文件**: ${file}\n\n`;
    }

    const commits = result.stdout.split('\n').filter(Boolean);
    commits.forEach((commit, index) => {
      const parts = commit.split(' ');
      const hash = parts[0] || '';
      const message = parts.slice(1).join(' ') || commit;

      output += `- **${hash}** ${message}\n`;
    });

    return { type: 'text', value: output };
  }

  private async showDiff(options: Record<string, string>): Promise<GitResult> {
    const isStaged = options.cached || options.staged;
    const isStat = options.stat;
    const file = options.file;

    let command = 'git diff';
    if (isStaged) command += ' --cached';
    if (isStat) command += ' --stat';
    if (file) command += ` -- ${file}`;

    const result = await this.execGit(command);
    if (result.stderr && !result.stdout) {
      return { type: 'error', value: result.stderr };
    }

    let output = isStaged ? '## 暂存区差异\n\n' : '## 工作区差异\n\n';

    if (isStat) {
      const stats = result.stdout.split('\n').filter(Boolean);
      stats.forEach(stat => {
        output += `  ${stat}\n`;
      });
    } else {
      const diffLines = result.stdout.split('\n').slice(0, 100);
      output += '```\n' + diffLines.join('\n') + '\n```\n';

      if (result.stdout.split('\n').length > 100) {
        output += '\n*（差异过大，仅显示前100行）*';
      }
    }

    return { type: 'text', value: output };
  }

  private async handleStash(options: Record<string, string>): Promise<GitResult> {
    const isList = !options.save && !options.pop && !options.apply && !options.drop;
    const isSave = options.save;
    const isPop = options.pop;
    const isApply = options.apply;
    const isDrop = options.drop;

    if (isList) {
      const result = await this.execGit('git stash list');
      let output = '## Git Stash\n\n';

      if (!result.stdout) {
        output += '没有保存的stash\n';
      } else {
        const stashes = result.stdout.split('\n').filter(Boolean);
        stashes.forEach(stash => {
          output += `  ${stash}\n`;
        });
      }

      return { type: 'text', value: output };
    }

    if (isSave) {
      const message = options.save || '未命名stash';
      const result = await this.execGit(`git stash save "${message}"`);
      if (result.stderr && !result.stdout) {
        return { type: 'error', value: result.stderr };
      }
      return { type: 'text', value: `✅ 已保存stash: ${message}` };
    }

    if (isPop) {
      const result = await this.execGit('git stash pop');
      if (result.stderr && !result.stdout) {
        return { type: 'error', value: result.stderr };
      }
      return { type: 'text', value: '✅ 已恢复stash并删除' };
    }

    if (isApply) {
      const stashIndex = options.apply === 'true' ? '0' : options.apply;
      const result = await this.execGit(`git stash apply stash@{${stashIndex}}`);
      if (result.stderr && !result.stdout) {
        return { type: 'error', value: result.stderr };
      }
      return { type: 'text', value: `✅ 已应用stash@{${stashIndex}}` };
    }

    if (isDrop) {
      const stashIndex = options.drop === 'true' ? '0' : options.drop;
      const result = await this.execGit(`git stash drop stash@{${stashIndex}}`);
      if (result.stderr && !result.stdout) {
        return { type: 'error', value: result.stderr };
      }
      return { type: 'text', value: `✅ 已删除stash@{${stashIndex}}` };
    }

    return this.showHelp();
  }

  private async showRemote(options: Record<string, string>): Promise<GitResult> {
    const isList = !options.add && !options.remove && !options.rename;
    const isVerbose = options.v || options.verbose;

    if (isList) {
      const result = await this.execGit(isVerbose ? 'git remote -v' : 'git remote');
      let output = '## Git 远程仓库\n\n';

      if (!result.stdout) {
        output += '没有配置远程仓库\n';
      } else {
        output += result.stdout.split('\n').map(line => `  ${line}`).join('\n') + '\n';
      }

      return { type: 'text', value: output };
    }

    return this.showHelp();
  }

  private async handleWorktree(options: Record<string, string>): Promise<GitResult> {
    const isList = !options.add && !options.remove && !options.prune;
    const isAdd = options.add;
    const isRemove = options.remove;

    if (isList) {
      const result = await this.execGit('git worktree list');
      let output = '## Git Worktree\n\n';

      const trees = result.stdout.split('\n').filter(Boolean);
      trees.forEach(tree => {
        output += `  ${tree}\n`;
      });

      return { type: 'text', value: output };
    }

    return this.showHelp();
  }

  private async handleSubmodule(options: Record<string, string>): Promise<GitResult> {
    const isStatus = !options.add && !options.update && !options.sync;
    const isInit = options.init;
    const isUpdate = options.update;

    if (isStatus || isInit || isUpdate) {
      const command = isStatus ? 'git submodule status' :
                     isInit ? 'git submodule init' : 'git submodule update';
      const result = await this.execGit(command);

      if (result.stderr && !result.stdout) {
        return { type: 'error', value: result.stderr };
      }

      let output = isStatus ? '## 子模块状态\n\n' :
                   isInit ? '## 初始化子模块\n\n' : '## 更新子模块\n\n';

      output += result.stdout.split('\n').map(line => `  ${line}`).join('\n') + '\n';

      return { type: 'text', value: output };
    }

    return this.showHelp();
  }

  private async showTags(options: Record<string, string>): Promise<GitResult> {
    const isList = !options.a && !options.d && !options.v;
    const isAll = options.a;
    const isDelete = options.d;
    const tagName = options.v || options.tag;

    if (isDelete && tagName) {
      if (!isSafeRefName(tagName)) {
        return { type: 'error', value: '无效的标签名' };
      }
      const result = await this.execGit(`git tag -d ${tagName}`);
      if (result.stderr && !result.stdout) {
        return { type: 'error', value: result.stderr };
      }
      return { type: 'text', value: `✅ 已删除标签: ${tagName}` };
    }

    if (isList) {
      const result = await this.execGit('git tag --list');
      let output = '## Git 标签\n\n';

      if (!result.stdout) {
        output += '没有标签\n';
      } else {
        result.stdout.split('\n').filter(Boolean).forEach(tag => {
          output += `  ${tag}\n`;
        });
      }

      return { type: 'text', value: output };
    }

    return this.showHelp();
  }

  private async showRepoInfo(): Promise<GitResult> {
    const [branchResult, remoteResult, rootResult] = await Promise.all([
      this.execGit('git branch --show-current'),
      this.execGit('git remote get-url origin'),
      this.execGit('git rev-parse --show-toplevel'),
    ]);

    let output = '## Git 仓库信息\n\n';
    output += `**分支**: ${branchResult.stdout || '( detached )'}\n`;
    output += `**仓库根目录**: ${rootResult.stdout || this.gitRoot}\n`;

    if (remoteResult.stdout) {
      output += `**远程仓库**: ${remoteResult.stdout}\n`;
    }

    const [tagResult, commitResult] = await Promise.all([
      this.execGit('git describe --tags --always'),
      this.execGit('git rev-parse --short HEAD'),
    ]);

    if (tagResult.stdout) {
      output += `**版本标签**: ${tagResult.stdout}\n`;
    }
    output += `**当前Commit**: ${commitResult.stdout}\n`;

    return { type: 'text', value: output };
  }

  private showShortcut(): GitResult {
    let output = '## Git 常用命令快捷方式\n\n';
    output += '| 快捷方式 | 完整命令 | 说明 |\n';
    output += '|---------|---------|------|\n';
    output += '| /git s  | /git status | 显示状态 |\n';
    output += '| /git b  | /git branch | 显示分支 |\n';
    output += '| /git l  | /git log | 显示日志 |\n';
    output += '| /git d  | /git diff | 显示差异 |\n';

    return { type: 'text', value: output };
  }

  private showHelp(): GitResult {
    let output = `## /git 命令 - Git操作封装

基于CC源码实现的完整Git操作命令。

### 子命令

| 子命令 | 说明 |
|--------|------|
| status | 显示工作区状态 |
| branch | 显示/管理分支 |
| log | 显示提交历史 |
| diff | 显示文件差异 |
| stash | 管理stash |
| remote | 管理远程仓库 |
| worktree |管理工作树 |
| submodule | 管理子模块 |
| tag | 管理标签 |
| info | 显示仓库信息 |
| shortcut | 显示快捷方式 |

### 选项

通用选项:
  --short, -s    简洁输出
  --verbose, -v  详细输出
  --stat         显示统计信息
  --file=<文件>  指定文件

### 使用示例

/git status           - 查看工作区状态
/git status --short   - 简洁模式
/git branch           - 查看所有分支
/git log -n 20        - 查看最近20条提交
/git diff --cached    - 查看暂存区差异
/git log --file=src/index.ts  - 查看文件历史
/git info             - 显示仓库信息
/git shortcut         - 显示快捷方式

### 快捷方式

/git s  = /git status
/git b  = /git branch
/git l  = /git log
/git d  = /git diff

`;

    return { type: 'text', value: output };
  }
}

export default new GitCommand();
/**
 * Commit命令
 * 智能Git提交
 * * 核心功能：
 * 1. 分析当前git状态和变更
 * 2. 检查git安全协议
 * 3. 支持多种提交模式
 * 4. 智能生成提交信息
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import type { CommandContext } from '@modules/commands';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'commands:builtin:commit:Commit',
  level: LogLevel.INFO,
});

const execAsync = promisify(exec);

interface CommitResult {
  type: 'text';
  value: string;
}

interface CommitOptions {
  message?: string;
  all?: boolean;
  noVerify?: boolean;
  amend?: boolean;
  dryRun?: boolean;
  status?: boolean;
}

interface GitInfo {
  branch: string;
  stagedFiles: string[];
  modifiedFiles: string[];
  untrackedFiles: string[];
  stagedDiff: string;
  fullDiff: string;
  recentCommits: string[];
}

const COMMIT_TYPES = [
  { name: 'feat', description: '新功能' },
  { name: 'fix', description: 'Bug修复' },
  { name: 'docs', description: '文档变更' },
  { name: 'style', description: '代码格式（不影响功能）' },
  { name: 'refactor', description: '重构（不是bug修复或新功能）' },
  { name: 'perf', description: '性能优化' },
  { name: 'test', description: '测试相关' },
  { name: 'build', description: '构建系统或依赖变更' },
  { name: 'ci', description: 'CI配置变更' },
  { name: 'chore', description: '其他杂项变更' },
  { name: 'revert', description: '回滚到之前的提交' },
];

const SAFETY_RULES = [
  '绝不更新git配置',
  '绝不跳过hooks（--no-verify, --no-gpg-sign等），除非用户明确要求',
  '总是创建新的提交，绝不使用git commit --amend，除非用户明确要求',
  '不要提交可能包含敏感信息的文件（.env, credentials.json等）',
  '如果没有变更要提交，不要创建空提交',
  '不使用需要交互输入的git命令（如git rebase -i, git add -i）',
];

export class CommitCommand {
  /**
   * 执行命令
   */
  async call(args: string, context: CommandContext): Promise<CommitResult> {
    try {
      const { message, options } = this.parseArgs(args);

      if (options.dryRun) {
        return await this.showCommitPreview(message);
      }

      if (options.status) {
        return await this.showGitStatus();
      }

      if (!message) {
        return await this.showInteractiveMode();
      }

      return await this.executeCommit(message, options);
    } catch (error) {
      return {
        type: 'text',
        value: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  }

  /**
   * 解析命令行参数
   */
  private parseArgs(args: string): { message: string; options: CommitOptions } {
    const trimmedArgs = args.trim();
    const options: CommitOptions = {
      all: false,
      noVerify: false,
      amend: false,
      dryRun: false,
      status: false,
    };

    let remainingArgs = trimmedArgs;

    if (remainingArgs.includes('--all') || remainingArgs.includes('-a')) {
      options.all = true;
      remainingArgs = remainingArgs.replace(/--all|-a/g, '').trim();
    }

    if (remainingArgs.includes('--no-verify')) {
      options.noVerify = true;
      remainingArgs = remainingArgs.replace('--no-verify', '').trim();
    }

    if (remainingArgs.includes('--amend')) {
      options.amend = true;
      remainingArgs = remainingArgs.replace('--amend', '').trim();
    }

    if (remainingArgs.includes('--dry-run')) {
      options.dryRun = true;
      remainingArgs = remainingArgs.replace('--dry-run', '').trim();
    }

    if (remainingArgs.includes('--status')) {
      options.status = true;
      remainingArgs = remainingArgs.replace('--status', '').trim();
    }

    const messageMatch = remainingArgs.match(/^["'](.+)["']$/);
    if (messageMatch) {
      options.message = messageMatch[1];
    } else if (remainingArgs) {
      options.message = remainingArgs;
    }

    return { message: options.message || '', options };
  }

  /**
   * 获取Git信息
   */
  private async getGitInfo(): Promise<GitInfo> {
    try {
      const [
        branchResult,
        stagedResult,
        modifiedResult,
        untrackedResult,
        stagedDiffResult,
        fullDiffResult,
        recentResult,
      ] = await Promise.all([
        this.execGit('git branch --show-current'),
        this.execGit('git diff --cached --name-only'),
        this.execGit('git diff --name-only'),
        this.execGit('git ls-files --others --exclude-standard'),
        this.execGit('git diff --cached'),
        this.execGit('git diff HEAD'),
        this.execGit('git log --oneline -10'),
      ]);

      return {
        branch: branchResult || 'unknown',
        stagedFiles: stagedResult
          ? stagedResult.split('\n').filter(Boolean)
          : [],
        modifiedFiles: modifiedResult
          ? modifiedResult.split('\n').filter(Boolean)
          : [],
        untrackedFiles: untrackedResult
          ? untrackedResult.split('\n').filter(Boolean)
          : [],
        stagedDiff: stagedDiffResult || '',
        fullDiff: fullDiffResult || '',
        recentCommits: recentResult
          ? recentResult.split('\n').filter(Boolean)
          : [],
      };
    } catch (error) {
      throw new AppError(
        '无法获取Git信息，请确保在Git仓库中',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  /**
   * 执行git命令
   */
  private async execGit(command: string): Promise<string> {
    try {
      const { stdout } = await execAsync(command, {
        timeout: 10_000,
        encoding: 'utf-8',
      });
      return stdout.trim();
    } catch {
      return '';
    }
  }

  /**
   * 显示Git状态
   */
  private async showGitStatus(): Promise<CommitResult> {
    const info = await this.getGitInfo();

    let output = '## Git 状态\n\n';
    output += `**分支**: ${info.branch}\n\n`;

    if (info.stagedFiles.length > 0) {
      output += '### 已暂存文件\n\n';
      for (const file of info.stagedFiles) {
        output += `- ${file}\n`;
      }
      output += '\n';
    }

    if (info.modifiedFiles.length > 0) {
      output += '### 已修改文件\n\n';
      for (const file of info.modifiedFiles) {
        output += `- ${file}\n`;
      }
      output += '\n';
    }

    if (info.untrackedFiles.length > 0) {
      output += '### 未跟踪文件\n\n';
      for (const file of info.untrackedFiles) {
        output += `- ${file}\n`;
      }
      output += '\n';
    }

    if (
      info.stagedFiles.length === 0 &&
      info.modifiedFiles.length === 0 &&
      info.untrackedFiles.length === 0
    ) {
      output += '没有发现任何变更。\n';
    }

    output += '\n**最近提交**:\n';
    for (const commit of info.recentCommits.slice(0, 5)) {
      output += `- ${commit}\n`;
    }

    return { type: 'text', value: output };
  }

  /**
   * 显示交互模式
   */
  private async showInteractiveMode(): Promise<CommitResult> {
    const info = await this.getGitInfo();

    if (
      info.stagedFiles.length === 0 &&
      info.modifiedFiles.length === 0 &&
      info.untrackedFiles.length === 0
    ) {
      return {
        type: 'text',
        value:
          '没有发现任何变更。请先使用 git add 添加文件。\n\n提示：\n  /commit --status    - 查看详细状态\n  /commit --all       - 暂存所有已跟踪文件的变更',
      };
    }

    let output = '## 智能Git提交\n\n';

    output += `**当前分支**: ${info.branch}\n\n`;

    output += '### 安全协议\n\n';
    for (const rule of SAFETY_RULES) {
      output += `- ${rule}\n`;
    }
    output += '\n';

    if (info.stagedFiles.length > 0) {
      output += '### 已暂存文件 (' + info.stagedFiles.length + ')\n\n';
      for (const file of info.stagedFiles.slice(0, 10)) {
        output += `- ${file}\n`;
      }
      if (info.stagedFiles.length > 10) {
        output += `- ... 还有 ${info.stagedFiles.length - 10} 个文件\n`;
      }
      output += '\n';
    }

    if (info.modifiedFiles.length > 0) {
      output += '### 未暂存文件 (' + info.modifiedFiles.length + ')\n\n';
      for (const file of info.modifiedFiles.slice(0, 10)) {
        output += `- ${file}\n`;
      }
      if (info.modifiedFiles.length > 10) {
        output += `- ... 还有 ${info.modifiedFiles.length - 10} 个文件\n`;
      }
      output += '\n提示：使用 /commit --all 暂存所有已跟踪文件的变更\n\n';
    }

    if (info.untrackedFiles.length > 0) {
      output += '### 未跟踪文件 (' + info.untrackedFiles.length + ')\n\n';
      for (const file of info.untrackedFiles.slice(0, 10)) {
        output += `- ${file}\n`;
      }
      if (info.untrackedFiles.length > 10) {
        output += `- ... 还有 ${info.untrackedFiles.length - 10} 个文件\n`;
      }
      output += '\n';
    }

    output += '### 提交类型\n\n';
    for (const type of COMMIT_TYPES) {
      output += `- **${type.name}**: ${type.description}\n`;
    }
    output += '\n';

    output += '### 使用方法\n\n';
    output += '```\n';
    output += '/commit "fix: 修复登录问题"\n';
    output += '/commit "feat: 添加新功能"\n';
    output += '/commit --all "refactor: 重构代码"\n';
    output += '/commit --dry-run "test: 添加测试"\n';
    output += '```\n\n';

    if (info.stagedFiles.length === 0) {
      output += '⚠️ 警告: 没有已暂存的文件。请先使用 git add 添加文件。\n';
    }

    return { type: 'text', value: output };
  }

  /**
   * 显示提交预览
   */
  private async showCommitPreview(message: string): Promise<CommitResult> {
    const info = await this.getGitInfo();

    let output = '## 提交预览 (Dry Run)\n\n';
    output += `**分支**: ${info.branch}\n`;
    output += `**提交信息**: ${message}\n\n`;

    if (info.stagedFiles.length > 0) {
      output += '### 将要提交的文件\n\n';
      for (const file of info.stagedFiles) {
        output += `+ ${file}\n`;
      }
    } else {
      output += '⚠️ 没有已暂存的文件\n';
    }

    if (info.modifiedFiles.length > 0) {
      output += '\n### 未暂存的文件（不会被提交）\n\n';
      for (const file of info.modifiedFiles.slice(0, 5)) {
        output += `- ${file}\n`;
      }
      if (info.modifiedFiles.length > 5) {
        output += `- ... 还有 ${info.modifiedFiles.length - 5} 个文件\n`;
      }
    }

    return { type: 'text', value: output };
  }

  /**
   * 执行提交
   */
  private async executeCommit(
    message: string,
    options: CommitOptions
  ): Promise<CommitResult> {
    const info = await this.getGitInfo();

    if (info.stagedFiles.length === 0 && !options.all) {
      return {
        type: 'text',
        value:
          '没有已暂存的文件。请先使用 git add 添加文件。\n\n提示：\n  /commit --all "提交信息"  - 暂存所有已跟踪文件的变更并提交',
      };
    }

    let command = 'git commit';

    if (options.noVerify) {
      command += ' --no-verify';
    }

    if (options.amend) {
      command += ' --amend';
    }

    command += ` -m "${this.escapeMessage(message)}"`;

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 30_000,
        encoding: 'utf-8',
      });

      let output = '✅ 提交成功！\n\n';
      output += `**分支**: ${info.branch}\n`;
      output += `**提交信息**: ${message}\n`;
      output += `**提交的文件**:\n`;
      for (const file of info.stagedFiles) {
        output += `  - ${file}\n`;
      }

      if (stdout) {
        output += `\n${stdout}`;
      }

      return { type: 'text', value: output };
    } catch (error) {
      const execErr = error as { stderr?: string; message?: string };
      const errorMessage = execErr.stderr || execErr.message || '';

      if (errorMessage.includes('nothing to commit')) {
        return {
          type: 'text',
          value:
            '没有变更需要提交。\n\n提示：\n  /commit --status    - 查看当前状态\n  /commit --all       - 暂存所有变更',
        };
      }

      if (errorMessage.includes('no changes added to the commit')) {
        return {
          type: 'text',
          value: '没有已暂存的文件。请先使用 git add 添加文件。',
        };
      }

      if (errorMessage.includes('please tell me who you are')) {
        return {
          type: 'text',
          value:
            'Git用户信息未配置。请先配置：\n\n  git config --global user.name "你的名字"\n  git config --global user.email "your.email@example.com"',
        };
      }

      return {
        type: 'text',
        value: `提交失败: ${errorMessage}`,
      };
    }
  }

  /**
   * 转义提交信息中的特殊字符
   */
  private escapeMessage(message: string): string {
    return message
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  }

  /**
   * 显示帮助信息
   */
  showHelp(): CommitResult {
    let output = '## /commit 命令 - 智能Git提交\n\n';
    output += '分析当前Git状态，智能引导完成提交操作。\n\n';

    output += '### 选项\n\n';
    output += '- `--status`     - 显示详细的Git状态\n';
    output += '- `--all`        - 暂存所有已跟踪文件的变更\n';
    output += '--dry-run`      - 预览提交（不实际执行）\n';
    output += '--no-verify`    - 跳过pre-commit hooks（不推荐）\n';
    output += '--amend`        - 修改最后一次提交（不推荐）\n\n';

    output += '### 使用示例\n\n';
    output += '```\n';
    output += '/commit --status\n';
    output += '/commit "feat: 添加新功能"\n';
    output += '/commit --all "fix: 修复bug"\n';
    output += '/commit --dry-run "refactor: 重构代码"\n';
    output += '```\n\n';

    output += '### 安全协议\n\n';
    for (const rule of SAFETY_RULES) {
      output += `- ${rule}\n`;
    }

    output += '\n### 提交类型\n\n';
    for (const type of COMMIT_TYPES) {
      output += `- **${type.name}**: ${type.description}\n`;
    }

    return { type: 'text', value: output };
  }
}

export default new CommitCommand();

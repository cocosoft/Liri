/**
 * 工作活动统计命令实现
 * 收集真实的系统运行数据、任务数据、代码数据
 */
import type { CommandContext, CommandResult } from '@modules/commands/types';
import { promises as fs } from 'fs';
import { join, extname } from 'path';
import { getCommandManager as getCmdMgr } from '@modules/commands/manager/CommandManager.js';

/**
 * 语言扩展名映射
 */
const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript React',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript React',
  '.py': 'Python',
  '.rs': 'Rust',
  '.go': 'Go',
  '.java': 'Java',
  '.c': 'C',
  '.cpp': 'C++',
  '.h': 'C/C++ Header',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.less': 'Less',
  '.html': 'HTML',
  '.json': 'JSON',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.md': 'Markdown',
  '.sql': 'SQL',
  '.sh': 'Shell',
  '.bash': 'Bash',
  '.toml': 'TOML',
  '.xml': 'XML',
};

/**
 * 需要排除的目录
 */
const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg',
  'dist', 'build', '.next', '.nuxt',
  '__pycache__', '.cache', 'target',
  'coverage', '.nyc_output',
]);

/**
 * 文件类型统计
 */
interface LanguageStat {
  name: string;
  files: number;
  lines: number;
  percent: number;
}

/**
 * 代码扫描结果
 */
interface CodeScanResult {
  totalFiles: number;
  totalLines: number;
  languages: LanguageStat[];
}

/**
 * 工作活动统计命令实现
 */
export class ActivityStats {
  /**
   * 执行命令入口
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0] || 'summary';

    switch (subcommand.toLowerCase()) {
      case 'summary':
        return this.handleSummary();
      case 'code':
        return this.handleCode();
      case 'tasks':
        return this.handleTasks();
      case 'time':
        return this.handleTime();
      case 'help':
        return this.handleHelp();
      default:
        return this.handleHelp();
    }
  }

  /**
   * 扫描项目代码文件，统计行数和文件数
   */
  private async scanProjectCode(rootDir?: string): Promise<CodeScanResult> {
    const targetDir = rootDir || process.cwd();
    const languageData: Record<string, { files: number; lines: number }> = {};
    let totalFiles = 0;
    let totalLines = 0;

    try {
      await this.walkDir(targetDir, targetDir, languageData, (stats) => {
        totalFiles += stats.files;
        totalLines += stats.lines;
      });
    } catch {
      // 扫描失败时返回空数据
    }

    const languages: LanguageStat[] = Object.entries(languageData)
      .map(([name, data]) => ({
        name,
        files: data.files,
        lines: data.lines,
        percent: totalLines > 0 ? Math.round((data.lines / totalLines) * 100) : 0,
      }))
      .sort((a, b) => b.lines - a.lines);

    return { totalFiles, totalLines, languages };
  }

  /**
   * 递归遍历目录
   */
  private async walkDir(
    baseDir: string,
    currentDir: string,
    languageData: Record<string, { files: number; lines: number }>,
    onProgress: (stats: { files: number; lines: number }) => void,
  ): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          await this.walkDir(baseDir, fullPath, languageData, onProgress);
        }
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        const langName = LANGUAGE_MAP[ext];
        if (!langName) continue;

        let lineCount = 0;
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          lineCount = content.split('\n').length;
        } catch {
          lineCount = 0;
        }

        if (!languageData[langName]) {
          languageData[langName] = { files: 0, lines: 0 };
        }
        languageData[langName].files += 1;
        languageData[langName].lines += lineCount;
        onProgress({ files: 1, lines: lineCount });
      }
    }
  }

  /**
   * 获取后台任务统计
   */
  private async getTaskStats(): Promise<{ completed: number; running: number; pending: number; failed: number; total: number }> {
    try {
      const { getBackgroundTaskManager } = await import('../../../tools/AgentTool/BackgroundTaskManager.js');
      const manager = getBackgroundTaskManager();
      const allTasks = manager.getAllTasks();
      const completed = allTasks.filter((t: any) => t.status === 'completed').length;
      const running = allTasks.filter((t: any) => t.status === 'running').length;
      const pending = allTasks.filter((t: any) => t.status === 'pending').length;
      const failed = allTasks.filter((t: any) => t.status === 'failed').length;

      return { completed, running, pending, failed, total: allTasks.length };
    } catch {
      return { completed: 0, running: 0, pending: 0, failed: 0, total: 0 };
    }
  }

  /**
   * 获取会话统计
   */
  private async getSessionStats(): Promise<{
    totalSessions: number;
    totalMessages: number;
    activeSessions: number;
  }> {
    try {
      const { createStorageAdapter } = await import('../../../session/StorageAdapter.js');
      const storage = createStorageAdapter();
      const stats = await storage.getSessionStats();
      return {
        totalSessions: stats.totalSessions || 0,
        totalMessages: stats.totalMessages || 0,
        activeSessions: stats.activeSessions || 0,
      };
    } catch {
      return { totalSessions: 0, totalMessages: 0, activeSessions: 0 };
    }
  }

  /**
   * 格式化持续时间
   */
  private formatDuration(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const parts: string[] = [];
    if (d > 0) parts.push(`${d}天`);
    if (h > 0) parts.push(`${h}小时`);
    if (m > 0) parts.push(`${m}分钟`);
    if (parts.length === 0) parts.push('不到1分钟');
    return parts.join(' ');
  }

  /**
   * 处理综合摘要
   */
  private async handleSummary(): Promise<CommandResult> {
    const cmdMgr = getCmdMgr();
    const uptime = process.uptime();
    const taskStats = await this.getTaskStats();
    const sessionStats = await this.getSessionStats();
    const codeStats = await this.scanProjectCode();

    const message = [
      '📊 工作活动摘要',
      '',
      '系统运行:',
      `  运行时间: ${this.formatDuration(uptime)}`,
      `  已注册命令: ${cmdMgr.getCommandCount()} 个`,
      `  会话数量: ${sessionStats.totalSessions} 个 (活跃 ${sessionStats.activeSessions})`,
      `  消息总数: ${sessionStats.totalMessages} 条`,
      '',
      '代码统计:',
      `  总文件数: ${codeStats.totalFiles} 个`,
      `  总代码行: ${codeStats.totalLines.toLocaleString()} 行`,
      '',
      '任务统计:',
      `  已完成: ${taskStats.completed} 个`,
      `  运行中: ${taskStats.running} 个`,
      `  待处理: ${taskStats.pending} 个`,
      `  失败: ${taskStats.failed} 个`,
    ].join('\n');

    return { success: true, message };
  }

  /**
   * 处理代码统计
     */
  private async handleCode(): Promise<CommandResult> {
    const codeStats = await this.scanProjectCode();

    if (codeStats.languages.length === 0) {
      return {
        success: true,
        message: '📝 代码统计\n\n未扫描到代码文件，请确认在项目目录下运行。',
      };
    }

    const langRows = codeStats.languages.map(l =>
      `${l.name.padEnd(18)} ${l.files.toString().padStart(6)} 个文件  ${l.lines.toLocaleString().padStart(10)} 行  ${l.percent}%`
    ).join('\n');

    const message = [
      '📝 代码统计',
      '',
      `总文件数: ${codeStats.totalFiles} 个`,
      `总代码行: ${codeStats.totalLines.toLocaleString()} 行`,
      '',
      '语言分布:',
      `${'语言'.padEnd(18)} ${'文件'.padStart(6)}        ${'代码行'.padStart(10)}  占比`,
      `${'─'.repeat(50)}`,
      langRows,
    ].join('\n');

    return { success: true, message };
  }

  /**
   * 处理任务统计
   */
  private async handleTasks(): Promise<CommandResult> {
    const taskStats = await this.getTaskStats();
    const sessionStats = await this.getSessionStats();

    const message = [
      '✅ 任务统计',
      '',
      '后台任务:',
      `  总计: ${taskStats.total} 个`,
      `  已完成: ${taskStats.completed} 个`,
      `  运行中: ${taskStats.running} 个`,
      `  待处理: ${taskStats.pending} 个`,
      `  失败: ${taskStats.failed} 个`,
      '',
      '会话活动:',
      `  总会话数: ${sessionStats.totalSessions} 个`,
      `  消息总数: ${sessionStats.totalMessages} 条`,
      `  活跃会话: ${sessionStats.activeSessions} 个`,
    ].join('\n');

    return { success: true, message };
  }

  /**
   * 处理时间统计
   */
  private async handleTime(): Promise<CommandResult> {
    const uptime = process.uptime();
    const startedAt = new Date(Date.now() - uptime * 1000);
    const now = new Date();
    const sessionStats = await this.getSessionStats();

    const avgMsgPerSession = sessionStats.totalSessions > 0
      ? (sessionStats.totalMessages / sessionStats.totalSessions).toFixed(1)
      : '0';

    const message = [
      '⏰ 时间统计',
      '',
      '当前会话:',
      `  运行时长: ${this.formatDuration(uptime)}`,
      `  启动时间: ${startedAt.toLocaleString()}`,
      `  当前时间: ${now.toLocaleString()}`,
      '',
      '会话概览:',
      `  总会话数: ${sessionStats.totalSessions} 个`,
      `  总消息数: ${sessionStats.totalMessages} 条`,
      `  平均每会话: ${avgMsgPerSession} 条消息`,
    ].join('\n');

    return { success: true, message };
  }

  /**
   * 显示帮助信息
   */
  private async handleHelp(): Promise<CommandResult> {
    const help = [
      '工作活动统计命令用法：',
      '',
      '/activity summary  - 显示综合活动摘要',
      '/activity code     - 显示代码统计',
      '/activity tasks    - 显示任务统计',
      '/activity time     - 显示时间统计',
      '/activity help     - 显示此帮助信息',
      '',
      '示例:',
      '  /activity summary',
      '  /activity code',
    ].join('\n');

    return { success: true, message: help };
  }
}

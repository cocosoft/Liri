/**
 * 工作活动统计命令实现
 * 收集真实的系统运行数据、任务数据、代码数据
 *
 * 对标 CC 源码 cc_code/backend/commands/stats/index.ts
 * CC 中以 Stats React 组件展示使用统计，Liri 使用纯文本 CLI 输出。
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
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '__pycache__',
  '.cache',
  'target',
  'coverage',
  '.nyc_output',
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
 * 扫描项目代码文件，统计行数和文件数
 */
async function scanProjectCode(rootDir?: string): Promise<CodeScanResult> {
  const targetDir = rootDir || process.cwd();
  const languageData: Record<string, { files: number; lines: number }> = {};
  let totalFiles = 0;
  let totalLines = 0;

  try {
    await walkDir(targetDir, targetDir, languageData, (stats) => {
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
async function walkDir(
  baseDir: string,
  currentDir: string,
  languageData: Record<string, { files: number; lines: number }>,
  onProgress: (stats: { files: number; lines: number }) => void
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
        await walkDir(baseDir, fullPath, languageData, onProgress);
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
async function getTaskStats(): Promise<{
  completed: number;
  running: number;
  pending: number;
  failed: number;
  total: number;
}> {
  try {
    const { taskRegistry } = await import('../../../tasks/TaskRegistry.js');
    const { TaskStatus } = await import('../../../tasks/types.js');
    const allTasks = taskRegistry.getAllTasks();
    let completed = 0,
      running = 0,
      pending = 0,
      failed = 0;
    for (const t of allTasks) {
      const s = t.taskState.status;
      if (s === TaskStatus.COMPLETED) completed++;
      else if (s === TaskStatus.RUNNING) running++;
      else if (s === TaskStatus.PENDING) pending++;
      else if (s === TaskStatus.FAILED) failed++;
    }
    return { completed, running, pending, failed, total: allTasks.length };
  } catch {
    return { completed: 0, running: 0, pending: 0, failed: 0, total: 0 };
  }
}

/**
 * 获取会话统计
 */
async function getSessionStats(): Promise<{
  totalSessions: number;
  totalMessages: number;
  activeSessions: number;
}> {
  try {
    const { createStorageAdapter } =
      await import('../../../session/StorageAdapter.js');
    const { MemoryStorage } =
      await import('../../../session/storage/MemoryStorage.js');
    const storage = createStorageAdapter(new MemoryStorage());
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
function formatDuration(seconds: number): string {
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
 * 工作活动统计命令
 */
const activityCommand = {
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const trimmed = args.trim().toLowerCase();

    try {
      if (trimmed === 'help') {
        return handleHelp();
      }

      if (trimmed === 'status') {
        return handleStatus();
      }

      if (trimmed === '--json') {
        return handleJson(context);
      }

      const parts = trimmed.split(/\s+/);
      const subcommand = parts[0] || 'summary';

      switch (subcommand) {
        case 'summary':
          return handleSummary();
        case 'code':
          return handleCode();
        case 'tasks':
          return handleTasks();
        case 'time':
          return handleTime();
        default:
          return handleHelp();
      }
    } catch (error) {
      return {
        success: false,
        message: `获取统计数据失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },
};

/**
 * 显示帮助信息
 */
async function handleHelp(): Promise<CommandResult> {
  return {
    success: true,
    message: [
      '工作活动统计命令用法:',
      '',
      '/activity              - 显示综合活动摘要',
      '/activity summary     - 显示综合活动摘要',
      '/activity code        - 显示代码统计',
      '/activity tasks       - 显示任务统计',
      '/activity time        - 显示时间统计',
      '/activity status      - 显示快速状态概览',
      '/activity --json      - 以 JSON 格式输出',
      '/activity help        - 显示此帮助信息',
      '',
      '摘要信息包含:',
      '  - 系统运行时间',
      '  - 已注册命令数',
      '  - 会话与消息统计',
      '  - 代码文件与行数统计',
      '  - 后台任务统计',
      '',
      '示例:',
      '  /activity',
      '  /activity code',
      '  /activity status',
      '  /activity --json',
      '',
      '别名: /act, /worksummary, /工作统计',
    ].join('\n'),
  };
}

/**
 * 处理快速状态概览
 */
async function handleStatus(): Promise<CommandResult> {
  const uptime = process.uptime();
  const taskStats = await getTaskStats();
  const sessionStats = await getSessionStats();

  return {
    success: true,
    message: [
      '活动状态概览:',
      '',
      `  运行时间: ${formatDuration(uptime)}`,
      `  总会话: ${sessionStats.totalSessions} 个, 消息: ${sessionStats.totalMessages} 条`,
      `  后台任务: ${taskStats.total} 个 (完成 ${taskStats.completed}, 运行 ${taskStats.running})`,
    ].join('\n'),
  };
}

/**
 * 处理综合摘要
 */
async function handleSummary(): Promise<CommandResult> {
  const cmdMgr = getCmdMgr();
  const uptime = process.uptime();
  const taskStats = await getTaskStats();
  const sessionStats = await getSessionStats();
  const codeStats = await scanProjectCode();

  (await import('@modules/services/analytics/index.js')).logEvent(
    'tengu_activity_summary',
    {
      sessionCount: sessionStats.totalSessions,
      messageCount: sessionStats.totalMessages,
      codeFiles: codeStats.totalFiles,
      codeLines: codeStats.totalLines,
    }
  );

  const message = [
    '📊 工作活动摘要',
    '',
    '系统运行:',
    `  运行时间: ${formatDuration(uptime)}`,
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
async function handleCode(): Promise<CommandResult> {
  const codeStats = await scanProjectCode();

  if (codeStats.languages.length === 0) {
    return {
      success: true,
      message: '📝 代码统计\n\n未扫描到代码文件，请确认在项目目录下运行。',
    };
  }

  const langRows = codeStats.languages
    .map(
      (l) =>
        `${l.name.padEnd(18)} ${l.files.toString().padStart(6)} 个文件  ${l.lines.toLocaleString().padStart(10)} 行  ${l.percent}%`
    )
    .join('\n');

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
async function handleTasks(): Promise<CommandResult> {
  const taskStats = await getTaskStats();
  const sessionStats = await getSessionStats();

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
async function handleTime(): Promise<CommandResult> {
  const uptime = process.uptime();
  const startedAt = new Date(Date.now() - uptime * 1000);
  const now = new Date();
  const sessionStats = await getSessionStats();

  const avgMsgPerSession =
    sessionStats.totalSessions > 0
      ? (sessionStats.totalMessages / sessionStats.totalSessions).toFixed(1)
      : '0';

  const message = [
    '⏰ 时间统计',
    '',
    '当前进程:',
    `  运行时长: ${formatDuration(uptime)}`,
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
 * 处理 JSON 格式输出
 */
async function handleJson(context: CommandContext): Promise<CommandResult> {
  const uptime = process.uptime();
  const taskStats = await getTaskStats();
  const sessionStats = await getSessionStats();
  const codeStats = await scanProjectCode();
  const cmdMgr = getCmdMgr();

  const data = {
    app: 'Liri',
    uptime: Math.floor(uptime),
    commands: cmdMgr.getCommandCount(),
    sessions: sessionStats,
    tasks: taskStats,
    code: codeStats,
  };

  return {
    success: true,
    message: JSON.stringify(data, null, 2),
  };
}

export default activityCommand;

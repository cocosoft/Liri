/**
 * Tasks命令执行逻辑
 * 对标 CC BackgroundTasksDialog 实现：
 * - 分类分组显示（按状态/类型）
 * - 统计头部（各类别运行数）
 * - 进度指示（运行时长/进度条）
 * - 筛选过滤（按状态查看）
 * - 批量操作（停止/清理）
 */

import type { CommandContext, CommandResult } from '@modules/commands/types';
import type { BackgroundTaskInfo, BackgroundTaskStatus } from '../../tools/AgentTool/BackgroundTaskManager.js';
import { getBackgroundTaskManager } from '../../tools/AgentTool/BackgroundTaskManager.js';

/**
 * 格式化时长
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * 格式化年龄
 */
function formatAge(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * 状态图标
 */
function statusIcon(status: BackgroundTaskStatus): string {
  switch (status) {
    case 'running': return '●';
    case 'completed': return '✓';
    case 'failed': return '✗';
    case 'aborted': return '○';
    case 'pending': return '◌';
    default: return '?';
  }
}

/**
 * 状态颜色（ANSI）
 */
function statusColor(status: BackgroundTaskStatus): string {
  switch (status) {
    case 'running': return '\x1b[36m';   // 青色
    case 'completed': return '\x1b[32m'; // 绿色
    case 'failed': return '\x1b[31m';    // 红色
    case 'aborted': return '\x1b[33m';   // 黄色
    case 'pending': return '\x1b[90m';   // 灰色
    default: return '\x1b[0m';
  }
}

const RESET = '\x1b[0m';

/**
 * 生成进度条
 */
function progressBar(current: number, total: number, width = 15): string {
  if (total <= 0) return '';
  const filled = Math.round((current / total) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${Math.round((current / total) * 100)}%`;
}

/**
 * 构建统计头部
 * 对标 CC subtitle 的"X active agents · Y active shells"风格
 */
function buildStatsHeader(tasks: BackgroundTaskInfo[]): string {
  const running = tasks.filter(t => t.status === 'running').length;
  const pending = tasks.filter(t => t.status === 'pending').length;
  const completed = tasks.filter(t => t.status === 'completed').length;
  const failed = tasks.filter(t => t.status === 'failed').length;
  const aborted = tasks.filter(t => t.status === 'aborted').length;
  const total = tasks.length;

  const parts: string[] = [];
  if (total > 0) parts.push(`总计 ${total}`);
  if (running > 0) parts.push(`${statusIcon('running')} 运行中 ${running}`);
  if (pending > 0) parts.push(`${statusIcon('pending')} 等待中 ${pending}`);
  if (completed > 0) parts.push(`${statusIcon('completed')} 已完成 ${completed}`);
  if (failed > 0) parts.push(`${statusIcon('failed')} 失败 ${failed}`);
  if (aborted > 0) parts.push(`${statusIcon('aborted')} 已中断 ${aborted}`);

  return `后台任务 — ${parts.join(' | ')}`;
}

/**
 * 按状态分组显示任务列表
 * 对标 CC 按 running/pending/completed 分组排序
 */
function formatTaskGroups(tasks: BackgroundTaskInfo[]): string {
  const groups: { label: string; statuses: BackgroundTaskStatus[]; tasks: BackgroundTaskInfo[] }[] = [
    { label: '运行中', statuses: ['running'], tasks: [] },
    { label: '等待中', statuses: ['pending'], tasks: [] },
    { label: '已完成', statuses: ['completed'], tasks: [] },
    { label: '失败', statuses: ['failed'], tasks: [] },
    { label: '已中断', statuses: ['aborted'], tasks: [] },
  ];

  for (const task of tasks) {
    const group = groups.find(g => g.statuses.includes(task.status));
    if (group) group.tasks.push(task);
  }

  const lines: string[] = [];

  for (const group of groups) {
    if (group.tasks.length === 0) continue;

    lines.push(`\n  ${group.label} (${group.tasks.length}):`);

    for (const task of group.tasks) {
      const icon = statusIcon(task.status);
      const color = statusColor(task.status);
      const sid = task.taskId.substring(0, 8);
      const desc = task.description || '无描述';
      const agentInfo = task.agentName || task.agentType || 'unknown';

      // 运行时长
      let elapsed = '';
      if (task.status === 'running' && task.startedAt) {
        elapsed = ` ${formatDuration(Date.now() - task.startedAt)}`;
      } else if (task.completedAt && task.startedAt) {
        elapsed = ` ${formatDuration(task.completedAt - task.startedAt)}`;
      } else if (task.completedAt) {
        elapsed = ` ${formatAge(task.completedAt)}`;
      }

      const age = formatAge(task.createdAt);

      // 进度消息
      const progress = task.progressMessage ? ` — ${task.progressMessage}` : '';

      lines.push(`    ${color}${icon}${RESET} [${sid}] ${desc} (${agentInfo}, ${age}${elapsed})${progress}`);
    }
  }

  return lines.join('\n');
}

/**
 * 格式化单任务详情
 * 对标 CC 各 DetailDialog 的丰富信息展示
 */
function formatTaskDetail(task: BackgroundTaskInfo): string {
  const lines: string[] = [];
  const color = statusColor(task.status);
  const icon = statusIcon(task.status);

  lines.push(`${color}${icon}${RESET} 任务详情`);
  lines.push('─'.repeat(50));
  lines.push(`  ID:          ${task.taskId}`);
  lines.push(`  Agent:        ${task.agentName || 'unknown'} (${task.agentType || 'unknown'})`);
  lines.push(` 描述:        ${task.description || '无'}`);
  lines.push(` 状态:        ${color}${task.status}${RESET}`);
  lines.push(` 创建时间:    ${new Date(task.createdAt).toLocaleString()} (${formatAge(task.createdAt)}前)`);

  if (task.startedAt) {
    lines.push(` 开始时间:    ${new Date(task.startedAt).toLocaleString()}`);
  }

  if (task.completedAt) {
    lines.push(` 完成时间:    ${new Date(task.completedAt).toLocaleString()}`);
  }

  if (task.startedAt) {
    const end = task.completedAt || Date.now();
    const dur = end - task.startedAt;
    lines.push(` 耗时:        ${formatDuration(dur)}`);
  }

  if (task.progressMessage) {
    lines.push(` 进度:        ${task.progressMessage}`);
  }

  if (task.tokenUsage) {
    const tu = task.tokenUsage;
    lines.push(` Token 用量:  ${tu.totalTokens} (prompt: ${tu.promptTokens}, completion: ${tu.completionTokens})`);
  }

  if (task.result) {
    const preview = task.result.length > 200 ? task.result.substring(0, 200) + '...' : task.result;
    lines.push(` 结果:        ${preview}`);
  }

  if (task.error) {
    lines.push(` 错误:        ${task.error}`);
  }

  // 按状态显示额外信息
  if (task.status === 'running' && task.startedAt) {
    const elapsed = Date.now() - task.startedAt;
    lines.push('');
    lines.push(` 运行中...    ${formatDuration(elapsed)}`);

    // 简单进度指示（10秒以上显示进度条）
    if (elapsed > 10000) {
      const estimated = Math.min(elapsed, 300000); // 最多5分钟
      const pct = Math.round((estimated / 300000) * 100);
      const barW = 20;
      const filled = Math.round((estimated / 300000) * barW);
      lines.push(` 进度:        [${'█'.repeat(filled)}${'░'.repeat(barW - filled)}] ${Math.min(pct, 100)}%`);
    }
  }

  lines.push('─'.repeat(50));

  return lines.join('\n');
}

/**
 * 筛选任务列表
 */
function filterTasksByStatus(tasks: BackgroundTaskInfo[], filter?: string): BackgroundTaskInfo[] {
  if (!filter) return tasks;

  const statusMap: Record<string, BackgroundTaskStatus[]> = {
    running: ['running'],
    pending: ['pending'],
    active: ['running', 'pending'],
    completed: ['completed'],
    done: ['completed'],
    failed: ['failed'],
    aborted: ['aborted'],
    stopped: ['aborted'],
    all: ['pending', 'running', 'completed', 'failed', 'aborted'],
  };

  const statuses = statusMap[filter];
  if (!statuses) return tasks;

  return tasks.filter(t => statuses.includes(t.status));
}

/**
 * 执行tasks命令
 */
export async function executeTasks(
  args: string,
  _context: CommandContext
): Promise<CommandResult> {
  try {
    const params = parseTasksArgs(args);
    const manager = getBackgroundTaskManager();

    // help 子命令
    if (params.subcommand === 'help') {
      return {
        type: 'text',
        success: true,
        message: [
          '用法:',
          '  /tasks                       显示所有后台任务（按状态分组）',
          '  /tasks list                  同上',
          '  /tasks running               显示运行中的任务',
          '  /tasks pending               显示等待中的任务',
          '  /tasks completed             显示已完成的任务',
          '  /tasks failed                显示失败的任务',
          '  /tasks aborted               显示已中断的任务',
          '  /tasks all                   显示所有任务（包括已完成的）',
          '  /tasks show <task-id>        查看任务详情',
          '  /tasks stop <task-id>        停止任务',
          '  /tasks clear                 清理已完成的任务',
          '  /tasks stats                 显示统计摘要',
        ].join('\n'),
      };
    }

    // stats 子命令 — 对标 CC 的统计信息
    if (params.subcommand === 'stats') {
      const allTasks = manager.getAllTasks();
      const stats = manager.getStats();

      const lines: string[] = [];
      lines.push('后台任务统计');
      lines.push('─'.repeat(40));
      lines.push(`  总任务数:    ${stats.total}`);
      lines.push(`  运行中:      ${stats.running}`);
      lines.push(`  等待中:      ${stats.pending}`);
      lines.push(`  已完成:      ${stats.completed}`);
      lines.push(`  失败:        ${stats.failed}`);
      lines.push(`  已中断:      ${stats.aborted}`);
      lines.push('');

      const runningTasks = allTasks.filter(t => t.status === 'running');
      if (runningTasks.length > 0) {
        lines.push('活跃任务:');
        for (const t of runningTasks) {
          const elapsed = t.startedAt ? formatDuration(Date.now() - t.startedAt) : '等待中';
          const progress = t.progressMessage ? ` — ${t.progressMessage}` : '';
          lines.push(`  ● [${t.taskId.substring(0, 8)}] ${t.description || t.agentName} (${elapsed})${progress}`);
        }
      }

      return {
        type: 'text',
        success: true,
        message: lines.join('\n'),
      };
    }

    // clear 子命令
    if (params.subcommand === 'clear') {
      const removed = manager.cleanup(0);

      return {
        type: 'text',
        success: true,
        message: removed > 0
          ? `已清理 ${removed} 个已完成的任务`
          : '没有已结束的任务需要清理',
      };
    }

    // stop / abort 子命令 — 支持按任务ID或批量停止
    if (params.subcommand === 'stop' || params.subcommand === 'abort') {
      if (!params.taskId) {
        return {
          type: 'text',
          success: false,
          message: '用法: /tasks stop <task-id>',
        };
      }

      const task = manager.getTask(params.taskId);

      if (!task) {
        return {
          type: 'text',
          success: false,
          message: `任务 "${params.taskId}" 不存在`,
        };
      }

      if (task.status !== 'running' && task.status !== 'pending') {
        return {
          type: 'text',
          success: false,
          message: `任务 "${params.taskId}" 当前状态为 "${task.status}"，无法停止`,
        };
      }

      manager.abortTask(params.taskId);

      const elapsed = task.startedAt ? formatDuration(Date.now() - task.startedAt) : '未开始';
      return {
        type: 'text',
        success: true,
        message: `任务已停止: ${task.description || task.taskId} (运行 ${elapsed})`,
      };
    }

    // show / get 子命令 — 详情展示
    if (params.subcommand === 'show' || params.subcommand === 'get') {
      if (!params.taskId) {
        return {
          type: 'text',
          success: false,
          message: '用法: /tasks show <task-id>',
        };
      }

      const task = manager.getTask(params.taskId);

      if (!task) {
        return {
          type: 'text',
          success: false,
          message: `任务 "${params.taskId}" 不存在。使用 /tasks 查看所有任务`,
        };
      }

      return {
        type: 'text',
        success: true,
        message: formatTaskDetail(task),
      };
    }

    // running / pending / completed / failed / aborted / all — 筛选子命令
    const filterKeywords = ['running', 'pending', 'completed', 'failed', 'aborted', 'active', 'done', 'stopped', 'all'];
    if (params.subcommand && filterKeywords.includes(params.subcommand)) {
      const allTasks = manager.getAllTasks();
      const filtered = filterTasksByStatus(allTasks, params.subcommand);

      if (filtered.length === 0) {
        return {
          type: 'text',
          success: true,
          message: `没有 ${params.subcommand === 'all' ? '' : params.subcommand + ' '}后台任务`,
        };
      }

      const header = buildStatsHeader(filtered);
      const body = formatTaskGroups(filtered);

      return {
        type: 'text',
        success: true,
        message: header + body,
      };
    }

    // 默认：list — 按状态分组显示所有任务
    const allTasks = manager.getAllTasks();

    if (allTasks.length === 0) {
      return {
        type: 'text',
        success: true,
        message: '没有运行中的后台任务',
      };
    }

    const header = buildStatsHeader(allTasks);
    const body = formatTaskGroups(allTasks);

    return {
      type: 'text',
      success: true,
      message: header + body,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      type: 'error',
      success: false,
      message: `Tasks命令执行失败: ${errorMessage}`,
    };
  }
}

/**
 * 解析tasks命令参数
 */
function parseTasksArgs(args: string): {
  subcommand?: string;
  taskId?: string;
} {
  const params: {
    subcommand?: string;
    taskId?: string;
  } = {};

  if (!args) return params;

  const parts = args.trim().split(/\s+/);
  params.subcommand = parts[0];

  if (['stop', 'abort', 'remove', 'rm', 'show', 'get'].includes(params.subcommand)) {
    params.taskId = parts[1];
  }

  return params;
}

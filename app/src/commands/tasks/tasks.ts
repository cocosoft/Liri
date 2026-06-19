/**
 * Tasks 命令实现
 * 列出和管理后台任务（BackgroundTask）
 * 对标 CC BackgroundTasksDialog 实现
 */
import type { CommandContext, CommandResult } from '@modules/commands';
import type {
  BackgroundTaskInfo,
  BackgroundTaskStatus,
} from '@modules/tasks/types.js';
import { taskRegistry } from '@modules/tasks/TaskRegistry.js';
import {
  TaskType,
  TaskStatus,
  isTerminalTaskStatus,
} from '@modules/tasks/types.js';
import type { BaseTask } from '@modules/tasks/BaseTask.js';

/**
 * 解析参数
 */
function parseFlags(args: string): {
  showJson: boolean;
  subcommand: string;
  taskId: string;
  limit: number;
} {
  const trimmed = args.trim();
  const showJson = /(^|\s)--json(\s|$)/.test(trimmed);
  const limitMatch = trimmed.match(/--limit\s+(\d+)/);
  const limit = limitMatch ? parseInt(limitMatch[1], 10) : 20;
  const cleaned = trimmed
    .replace(/--json\s*/g, '')
    .replace(/--limit\s+\d+/g, '')
    .trim();
  const parts = cleaned.split(/\s+/);
  const subcommand = parts[0]?.toLowerCase() || '';
  const taskId = parts.slice(1).join(' ');
  return { showJson, subcommand, taskId, limit };
}

/**
 * 显示帮助信息
 */
function showHelp(): CommandResult {
  return {
    success: true,
    message: [
      'Tasks 命令帮助:',
      '',
      '使用 "/tasks" 命令查看和管理后台运行的任务（BackgroundTask）。',
      '',
      '用法:',
      '  /tasks                       显示所有后台任务（按状态分组）',
      '  /tasks list                  同上',
      '  /tasks running               显示运行中的任务',
      '  /tasks pending               显示等待中的任务',
      '  /tasks completed             显示已完成的任务',
      '  /tasks failed                显示失败的任务',
      '  /tasks aborted               显示已中断的任务',
      '  /tasks active                显示活跃任务（运行中+等待中）',
      '  /tasks recent [n]            显示最近完成的任务（默认5条）',
      '  /tasks all                   显示所有任务（包括已完成的）',
      '  /tasks type                  按任务类型分组显示',
      '  /tasks show <task-id>        查看任务详情',
      '  /tasks stop <task-id>        停止任务',
      '  /tasks clear [hours]         清理已完成的任务（默认清理所有，指定小时数只清理早于此时的）',
      '  /tasks stats                 显示统计摘要',
      '  /tasks --json                以 JSON 格式输出任务列表',
      '  /tasks --limit N             限制输出任务数量（默认20）',
      '  /tasks help                  显示此帮助',
      '',
      '示例:',
      '  /tasks',
      '  /tasks running',
      '  /tasks recent',
      '  /tasks type',
      '  /tasks show bg-a1b2c3d4',
      '  /tasks stats --json',
      '  /tasks stop bg-a1b2c3d4',
      '  /tasks clear',
      '  /tasks clear 24',
      '  /tasks --limit 10',
      '',
      '别名: /bashes',
    ].join('\n'),
  };
}

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
    case 'running':
      return '●';
    case 'completed':
      return '✓';
    case 'failed':
      return '✗';
    case 'aborted':
      return '○';
    case 'pending':
      return '◌';
    default:
      return '?';
  }
}

/**
 * 状态颜色（ANSI）
 */
function statusColor(status: BackgroundTaskStatus): string {
  switch (status) {
    case 'running':
      return '\x1b[36m';
    case 'completed':
      return '\x1b[32m';
    case 'failed':
      return '\x1b[31m';
    case 'aborted':
      return '\x1b[33m';
    case 'pending':
      return '\x1b[90m';
    default:
      return '\x1b[0m';
  }
}

const RESET = '\x1b[0m';

/**
 * 构建统计头部
 */
function buildStatsHeader(tasks: BackgroundTaskInfo[]): string {
  const running = tasks.filter((t) => t.status === 'running').length;
  const pending = tasks.filter((t) => t.status === 'pending').length;
  const completed = tasks.filter((t) => t.status === 'completed').length;
  const failed = tasks.filter((t) => t.status === 'failed').length;
  const aborted = tasks.filter((t) => t.status === 'aborted').length;
  const total = tasks.length;

  const parts: string[] = [];
  if (total > 0) parts.push(`总计 ${total}`);
  if (running > 0) parts.push(`${statusIcon('running')} 运行中 ${running}`);
  if (pending > 0) parts.push(`${statusIcon('pending')} 等待中 ${pending}`);
  if (completed > 0)
    parts.push(`${statusIcon('completed')} 已完成 ${completed}`);
  if (failed > 0) parts.push(`${statusIcon('failed')} 失败 ${failed}`);
  if (aborted > 0) parts.push(`${statusIcon('aborted')} 已中断 ${aborted}`);

  return `后台任务 — ${parts.join(' | ')}`;
}

/**
 * 按任务类型分组显示（新增 P3-3.3 增强）
 */
function formatTypeGroups(tasks: BackgroundTaskInfo[], limit?: number): string {
  const typeMap = new Map<string, BackgroundTaskInfo[]>();
  for (const task of tasks) {
    const type = task.taskType || task.agentType || 'unknown';
    if (!typeMap.has(type)) typeMap.set(type, []);
    typeMap.get(type)!.push(task);
  }

  const lines: string[] = [];
  let shown = 0;

  for (const [type, typeTasks] of typeMap) {
    if (limit !== undefined && shown >= limit) break;
    lines.push(`\n  ${type} (${typeTasks.length}):`);
    for (const task of typeTasks) {
      if (limit !== undefined && shown >= limit) break;
      const icon = statusIcon(task.status);
      const color = statusColor(task.status);
      const sid = task.taskId.substring(0, 8);
      const desc = task.description || '无描述';
      const age = formatAge(task.createdAt);

      let extra = '';
      if (task.ownerKey) extra += ` owner:${task.ownerKey}`;
      if (task.sessionKey) {
        const shortSess = task.sessionKey.substring(0, 12);
        extra += ` sess:${shortSess}`;
      }

      let elapsed = '';
      if (task.status === 'running' && task.startedAt) {
        elapsed = ` ${formatDuration(Date.now() - task.startedAt)}`;
      } else if (task.completedAt && task.startedAt) {
        elapsed = ` ${formatDuration(task.completedAt - task.startedAt)}`;
      }

      lines.push(
        `    ${color}${icon}${RESET} [${sid}] ${desc} (${age}${elapsed})${extra}`
      );
      shown++;
    }
  }

  return lines.join('\n');
}

/**
 * 处理 type 子命令（按类型分组显示）
 */
function handleType(showJson: boolean, limit: number): CommandResult {
  const allTasks = getAllTasksFromRegistry();
  if (allTasks.length === 0) {
    return { success: true, message: '没有运行中的后台任务' };
  }

  if (showJson) {
    return {
      success: true,
      message: JSON.stringify(tasksToJson(allTasks.slice(0, limit)), null, 2),
    };
  }

  const header = buildStatsHeader(allTasks);
  return {
    success: true,
    message: header + formatTypeGroups(allTasks, limit),
  };
}

/**
 * 按状态分组显示任务列表
 */
function formatTaskGroups(tasks: BackgroundTaskInfo[], limit?: number): string {
  const groups: {
    label: string;
    statuses: BackgroundTaskStatus[];
    tasks: BackgroundTaskInfo[];
  }[] = [
    { label: '运行中', statuses: ['running'], tasks: [] },
    { label: '等待中', statuses: ['pending'], tasks: [] },
    { label: '已完成', statuses: ['completed'], tasks: [] },
    { label: '失败', statuses: ['failed'], tasks: [] },
    { label: '已中断', statuses: ['aborted'], tasks: [] },
  ];

  for (const task of tasks) {
    const group = groups.find((g) => g.statuses.includes(task.status));
    if (group) group.tasks.push(task);
  }

  const lines: string[] = [];
  let shown = 0;

  for (const group of groups) {
    if (group.tasks.length === 0) continue;

    lines.push(`\n  ${group.label} (${group.tasks.length}):`);

    for (const task of group.tasks) {
      if (limit !== undefined && shown >= limit) break;

      const icon = statusIcon(task.status);
      const color = statusColor(task.status);
      const sid = task.taskId.substring(0, 8);
      const desc = task.description || '无描述';
      const agentInfo = task.agentName || task.agentType || 'unknown';

      let elapsed = '';
      if (task.status === 'running' && task.startedAt) {
        elapsed = ` ${formatDuration(Date.now() - task.startedAt)}`;
      } else if (task.completedAt && task.startedAt) {
        elapsed = ` ${formatDuration(task.completedAt - task.startedAt)}`;
      } else if (task.completedAt) {
        elapsed = ` ${formatAge(task.completedAt)}`;
      }

      const age = formatAge(task.createdAt);
      const progress = task.progressMessage ? ` — ${task.progressMessage}` : '';

      lines.push(
        `    ${color}${icon}${RESET} [${sid}] ${desc} (${agentInfo}, ${age}${elapsed})${progress}`
      );
      shown++;
    }
  }

  return lines.join('\n');
}

/**
 * 格式化单任务详情
 */
function formatTaskDetail(task: BackgroundTaskInfo): string {
  const lines: string[] = [];
  const color = statusColor(task.status);
  const icon = statusIcon(task.status);

  lines.push(`${color}${icon}${RESET} 任务详情`);
  lines.push('─'.repeat(50));
  lines.push(`  ID:          ${task.taskId}`);
  if (task.taskType) {
    lines.push(` 来源路由:    ${task.taskType}`);
  }
  lines.push(
    `  Agent:       ${task.agentName || 'unknown'} (${task.agentType || 'unknown'})`
  );
  lines.push(` 描述:        ${task.description || '无'}`);
  lines.push(` 状态:        ${color}${task.status}${RESET}`);
  if (task.ownerKey) {
    lines.push(` 归属:        ${task.ownerKey}`);
  }
  if (task.sessionKey) {
    lines.push(` 会话:        ${task.sessionKey}`);
  }
  lines.push(
    ` 创建时间:    ${new Date(task.createdAt).toLocaleString()} (${formatAge(task.createdAt)}前)`
  );

  if (task.startedAt) {
    lines.push(` 开始时间:    ${new Date(task.startedAt).toLocaleString()}`);
  }

  if (task.completedAt) {
    lines.push(` 完成时间:    ${new Date(task.completedAt).toLocaleString()}`);
  }

  if (task.startedAt) {
    const end = task.completedAt || Date.now();
    lines.push(` 耗时:        ${formatDuration(end - task.startedAt)}`);
  }

  if (task.progressMessage) {
    lines.push(` 进度:        ${task.progressMessage}`);
  }

  if (task.tokenUsage) {
    const tu = task.tokenUsage;
    lines.push(
      ` Token 用量:  ${tu.totalTokens} (prompt: ${tu.promptTokens}, completion: ${tu.completionTokens})`
    );
  }

  if (task.result) {
    const preview =
      task.result.length > 200
        ? task.result.substring(0, 200) + '...'
        : task.result;
    lines.push(` 结果:        ${preview}`);
  }

  if (task.error) {
    lines.push('');
    lines.push(` 错误详情:`);
    lines.push(` ──────────────────────────────────────────`);
    lines.push(` ${task.error}`);
    lines.push(` ──────────────────────────────────────────`);
  }

  if (task.status === 'running' && task.startedAt) {
    const elapsed = Date.now() - task.startedAt;
    lines.push('');
    lines.push(` 运行中...    ${formatDuration(elapsed)}`);

    if (elapsed > 10000) {
      const estimated = Math.min(elapsed, 300000);
      const barW = 20;
      const filled = Math.round((estimated / 300000) * barW);
      lines.push(
        ` 进度:        [${'█'.repeat(filled)}${'░'.repeat(barW - filled)}] ${Math.min(Math.round((estimated / 300000) * 100), 100)}%`
      );
    }
  }

  lines.push('─'.repeat(50));

  return lines.join('\n');
}

/**
 * 筛选任务列表
 */
function filterTasksByStatus(
  tasks: BackgroundTaskInfo[],
  filter?: string
): BackgroundTaskInfo[] {
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

  return tasks.filter((t) => statuses.includes(t.status));
}

/**
 * 将任务列表转换为 JSON 结构
 */
function tasksToJson(tasks: BackgroundTaskInfo[]): Record<string, unknown> {
  const stats = { pending: 0, running: 0, completed: 0, failed: 0, aborted: 0 };
  for (const t of tasks) {
    if (t.status in stats) (stats as Record<string, number>)[t.status]++;
  }

  return {
    total: tasks.length,
    stats,
    tasks: tasks.map((t) => ({
      taskId: t.taskId,
      agentName: t.agentName,
      agentType: t.agentType,
      description: t.description,
      status: t.status,
      createdAt: t.createdAt,
      startedAt: t.startedAt || null,
      completedAt: t.completedAt || null,
      progressMessage: t.progressMessage || null,
      result: t.result || null,
      error: t.error || null,
      durationMs: t.durationMs || null,
      tokenUsage: t.tokenUsage || null,
    })),
  };
}

/**
 * 将统计信息转换为 JSON 结构
 */
function statsToJson(
  allTasks: BackgroundTaskInfo[],
  stats: {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    aborted: number;
  }
): Record<string, unknown> {
  const runningTasks = allTasks.filter((t) => t.status === 'running');

  return {
    total: stats.total,
    pending: stats.pending,
    running: stats.running,
    completed: stats.completed,
    failed: stats.failed,
    aborted: stats.aborted,
    activeTasks: runningTasks.map((t) => ({
      taskId: t.taskId,
      description: t.description || t.agentName,
      agentType: t.agentType,
      elapsed: t.startedAt ? Date.now() - t.startedAt : 0,
      progressMessage: t.progressMessage || null,
    })),
  };
}

/**
 * 将 TaskRegistry 中的 BaseTask 转换为 BackgroundTaskInfo 显示格式
 */
function taskToBgInfo(task: BaseTask): BackgroundTaskInfo {
  const state = task.taskState;
  const meta = state.metadata || {};
  return {
    taskId: state.id,
    agentName: state.type,
    agentType: state.type,
    description: state.description,
    status: mapTaskStatusToBg(state.status),
    createdAt: state.startTime,
    startedAt:
      state.status === TaskStatus.RUNNING ? state.startTime : undefined,
    completedAt: state.endTime,
    progressMessage: undefined,
    result: undefined,
    error: state.error,
    tokenUsage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: state.tokenCount,
    },
    durationMs: state.endTime ? state.endTime - state.startTime : undefined,
    taskType: meta.taskType as string | undefined,
    ownerKey: meta.ownerKey as string | undefined,
    sessionKey: meta.sessionKey as string | undefined,
  };
}

function mapTaskStatusToBg(status: TaskStatus): BackgroundTaskStatus {
  switch (status) {
    case TaskStatus.PENDING:
      return 'pending';
    case TaskStatus.RUNNING:
      return 'running';
    case TaskStatus.COMPLETED:
      return 'completed';
    case TaskStatus.FAILED:
      return 'failed';
    case TaskStatus.KILLED:
      return 'aborted';
    case TaskStatus.LOST:
      return 'aborted';
  }
}

/**
 * 从 TaskRegistry 获取所有任务
 */
function getAllTasksFromRegistry(): BackgroundTaskInfo[] {
  return taskRegistry.getAllTasks().map(taskToBgInfo);
}

/**
 * 获取任务统计
 */
function handleStats(showJson: boolean): CommandResult {
  const allTasks = getAllTasksFromRegistry();
  const stats = buildStatsFromTasks(allTasks);

  if (showJson) {
    return {
      success: true,
      message: JSON.stringify(statsToJson(allTasks, stats), null, 2),
    };
  }

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

  const runningTasks = allTasks.filter((t) => t.status === 'running');
  if (runningTasks.length > 0) {
    lines.push('活跃任务:');
    for (const t of runningTasks) {
      const elapsed = t.startedAt
        ? formatDuration(Date.now() - t.startedAt)
        : '等待中';
      const progress = t.progressMessage ? ` — ${t.progressMessage}` : '';
      lines.push(
        `  ● [${t.taskId.substring(0, 8)}] ${t.description || t.agentName} (${elapsed})${progress}`
      );
    }
  }

  return { success: true, message: lines.join('\n') };
}

/**
 * 构建统计对象
 */
function buildStatsFromTasks(allTasks: BackgroundTaskInfo[]): {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  aborted: number;
} {
  let pending = 0,
    running = 0,
    completed = 0,
    failed = 0,
    aborted = 0;
  for (const t of allTasks) {
    switch (t.status) {
      case 'pending':
        pending++;
        break;
      case 'running':
        running++;
        break;
      case 'completed':
        completed++;
        break;
      case 'failed':
        failed++;
        break;
      case 'aborted':
        aborted++;
        break;
    }
  }
  return {
    total: allTasks.length,
    pending,
    running,
    completed,
    failed,
    aborted,
  };
}

/**
 * 处理 clear 子命令
 */
function handleClear(args: string): CommandResult {
  const hours = parseInt(args, 10);
  const olderThanMs = isNaN(hours) ? 0 : hours * 3600000;

  const allTasks = getAllTasksFromRegistry();
  const now = Date.now();
  let removed = 0;

  for (const task of allTasks) {
    if (
      task.status === 'completed' ||
      task.status === 'failed' ||
      task.status === 'aborted'
    ) {
      if (
        olderThanMs === 0 ||
        (task.createdAt && now - task.createdAt > olderThanMs)
      ) {
        const registered = taskRegistry.getTask(task.taskId);
        if (registered) {
          taskRegistry.remove(task.taskId);
          removed++;
        }
      }
    }
  }

  if (isNaN(hours)) {
    return {
      success: true,
      message:
        removed > 0
          ? `已清理 ${removed} 个已完成的任务`
          : '没有已结束的任务需要清理',
    };
  }

  return {
    success: true,
    message:
      removed > 0
        ? `已清理 ${removed} 个 ${hours} 小时前完成的任务`
        : `没有 ${hours} 小时前完成的任务需要清理`,
  };
}

/**
 * 处理 stop 子命令
 */
function handleStop(taskId: string): CommandResult {
  if (!taskId) {
    return { success: false, message: '用法: /tasks stop <task-id>' };
  }

  const registered = taskRegistry.getTask(taskId);
  if (!registered) {
    return { success: false, message: `任务 "${taskId}" 不存在` };
  }

  const state = registered.taskState;
  if (
    state.status !== TaskStatus.RUNNING &&
    state.status !== TaskStatus.PENDING
  ) {
    return {
      success: false,
      message: `任务 "${taskId}" 当前状态为 "${state.status}"，无法停止`,
    };
  }

  taskRegistry.kill(taskId);

  const elapsed = state.startTime
    ? formatDuration(Date.now() - state.startTime)
    : '未开始';
  return {
    success: true,
    message: `任务已停止: ${state.description || taskId} (运行 ${elapsed})`,
  };
}

/**
 * 处理 show 子命令
 */
function handleShow(taskId: string): CommandResult {
  if (!taskId) {
    return { success: false, message: '用法: /tasks show <task-id>' };
  }

  const allTasks = getAllTasksFromRegistry();
  const task = allTasks.find((t) => t.taskId === taskId);

  if (!task) {
    return {
      success: false,
      message: `任务 "${taskId}" 不存在。使用 /tasks 查看所有任务`,
    };
  }

  return { success: true, message: formatTaskDetail(task) };
}

/**
 * 处理 recent 子命令
 */
function handleRecent(args: string, showJson: boolean): CommandResult {
  const limit = parseInt(args, 10) || 5;
  const allTasks = getAllTasksFromRegistry();
  const recentTasks = allTasks
    .filter(
      (t) =>
        t.status === 'completed' ||
        t.status === 'failed' ||
        t.status === 'aborted'
    )
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
    .slice(0, limit);

  if (recentTasks.length === 0) {
    return { success: true, message: '没有已完成的任务记录' };
  }

  if (showJson) {
    return {
      success: true,
      message: JSON.stringify(tasksToJson(recentTasks), null, 2),
    };
  }

  const lines: string[] = [];
  lines.push(`最近完成的任务（最近 ${limit} 条）:`);
  lines.push('');

  for (const task of recentTasks) {
    const icon = statusIcon(task.status);
    const color = statusColor(task.status);
    const sid = task.taskId.substring(0, 8);
    const desc = task.description || '无描述';
    const agentInfo = task.agentName || task.agentType || 'unknown';
    const duration = task.durationMs ? formatDuration(task.durationMs) : '-';
    const age = task.completedAt ? formatAge(task.completedAt) : '-';

    lines.push(`  ${color}${icon}${RESET} [${sid}] ${desc}`);
    lines.push(
      `      Agent: ${agentInfo}, 耗时: ${duration}, 完成于: ${age}前`
    );
    if (task.error) {
      lines.push(
        `      错误: ${task.error.substring(0, 100)}${task.error.length > 100 ? '...' : ''}`
      );
    }
    lines.push('');
  }

  return { success: true, message: lines.join('\n').trimEnd() };
}

/**
 * 处理筛选子命令（running/pending/completed/failed/aborted/all/active）
 */
function handleFilter(
  subcommand: string,
  showJson: boolean,
  limit: number
): CommandResult {
  const allTasks = getAllTasksFromRegistry();
  const filtered = filterTasksByStatus(allTasks, subcommand);

  if (filtered.length === 0) {
    return {
      success: true,
      message: `没有 ${subcommand === 'all' ? '' : subcommand + ' '}后台任务`,
    };
  }

  if (showJson) {
    return {
      success: true,
      message: JSON.stringify(tasksToJson(filtered.slice(0, limit)), null, 2),
    };
  }

  return {
    success: true,
    message: buildStatsHeader(filtered) + formatTaskGroups(filtered, limit),
  };
}

/**
 * 处理列表子命令（默认）
 */
function handleList(showJson: boolean, limit: number): CommandResult {
  const allTasks = getAllTasksFromRegistry();

  if (allTasks.length === 0) {
    return { success: true, message: '没有运行中的后台任务' };
  }

  if (showJson) {
    return {
      success: true,
      message: JSON.stringify(tasksToJson(allTasks.slice(0, limit)), null, 2),
    };
  }

  return {
    success: true,
    message: buildStatsHeader(allTasks) + formatTaskGroups(allTasks, limit),
  };
}

const tasksCommand = {
  /**
   * 执行 tasks 命令
   */
  async execute(
    args: string,
    _context: CommandContext
  ): Promise<CommandResult> {
    try {
      const { showJson, subcommand, taskId, limit } = parseFlags(args);

      if (subcommand === 'help') {
        return showHelp();
      }

      try {
        const { logEvent } = await import('@modules/analytics/index.js');
        logEvent('tengu_tasks_view', {
          subcommand: subcommand || 'list',
          showJson,
        });
      } catch {
        // analytics 非关键
      }

      if (subcommand === 'stats') {
        return handleStats(showJson);
      }

      if (subcommand === 'clear') {
        return handleClear(taskId);
      }

      if (subcommand === 'stop' || subcommand === 'abort') {
        return handleStop(taskId);
      }

      if (subcommand === 'show' || subcommand === 'get') {
        return handleShow(taskId);
      }

      if (subcommand === 'recent') {
        return handleRecent(taskId, showJson);
      }

      if (subcommand === 'type') {
        return handleType(showJson, limit);
      }

      const filterKeywords = [
        'running',
        'pending',
        'completed',
        'failed',
        'aborted',
        'active',
        'done',
        'stopped',
        'all',
      ];
      if (subcommand && filterKeywords.includes(subcommand)) {
        return handleFilter(subcommand, showJson, limit);
      }

      if (subcommand === '' || subcommand === 'list') {
        return handleList(showJson, limit);
      }

      return {
        success: false,
        message: `未知子命令: ${subcommand}\n使用 /tasks help 查看帮助`,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export default tasksCommand;

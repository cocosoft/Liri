/**
 * Tasks命令执行逻辑
 * 列出和管理后台任务
 * 参考CC源码 cc_code/backend/commands/tasks/tasks.tsx 实现
 */

import type { CommandContext, CommandResult } from '../types/index.js';

/**
 * 后台任务信息
 */
interface BackgroundTask {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  createdAt: number;
  completedAt?: number;
  exitCode?: number;
}

/**
 * 后台任务存储（模拟）
 */
const backgroundTasks: Map<string, BackgroundTask> = new Map();

/**
 * 获取所有后台任务
 */
function getAllTasks(): BackgroundTask[] {
  return Array.from(backgroundTasks.values());
}

/**
 * 获取任务
 */
function getTask(id: string): BackgroundTask | undefined {
  return backgroundTasks.get(id);
}

/**
 * 添加任务
 */
function addTask(task: BackgroundTask): void {
  backgroundTasks.set(task.id, task);
}

/**
 * 更新任务
 */
function updateTask(id: string, updates: Partial<BackgroundTask>): void {
  const task = backgroundTasks.get(id);
  if (task) {
    backgroundTasks.set(id, { ...task, ...updates });
  }
}

/**
 * 删除任务
 */
function removeTask(id: string): void {
  backgroundTasks.delete(id);
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

    // list子命令
    if (params.subcommand === 'list' || !params.subcommand) {
      const tasks = getAllTasks();

      if (tasks.length === 0) {
        return {
          type: 'text',
          success: true,
          message: '没有运行中的后台任务',
        };
      }

      const output = tasks
        .map((t) => {
          const age = formatAge(t.createdAt);
          const status = formatStatus(t.status);
          return `  ${status} [${t.id}] ${t.name} (${age})`;
        })
        .join('\n');

      return {
        type: 'text',
        success: true,
        message: `后台任务:\n\n${output}`,
      };
    }

    // stop子命令
    if (params.subcommand === 'stop') {
      if (!params.taskId) {
        return {
          type: 'text',
          success: false,
          message: 'Usage: /tasks stop <task-id>',
        };
      }

      const task = getTask(params.taskId);

      if (!task) {
        return {
          type: 'text',
          success: false,
          message: `任务 "${params.taskId}" 不存在`,
        };
      }

      if (task.status !== 'running') {
        return {
          type: 'text',
          success: false,
          message: `任务 "${params.taskId}" 未在运行中`,
        };
      }

      updateTask(params.taskId, {
        status: 'stopped',
        completedAt: Date.now(),
      });

      return {
        type: 'text',
        success: true,
        message: `任务 "${params.taskId}" 已停止`,
      };
    }

    // remove子命令
    if (params.subcommand === 'remove' || params.subcommand === 'rm') {
      if (!params.taskId) {
        return {
          type: 'text',
          success: false,
          message: 'Usage: /tasks remove <task-id>',
        };
      }

      const task = getTask(params.taskId);

      if (!task) {
        return {
          type: 'text',
          success: false,
          message: `任务 "${params.taskId}" 不存在`,
        };
      }

      removeTask(params.taskId);

      return {
        type: 'text',
        success: true,
        message: `任务 "${params.taskId}" 已移除`,
      };
    }

    // clear子命令
    if (params.subcommand === 'clear') {
      const tasks = getAllTasks();
      const nonRunningTasks = tasks.filter((t) => t.status !== 'running');

      if (nonRunningTasks.length === 0) {
        return {
          type: 'text',
          success: true,
          message: '没有已结束的任务需要清理',
        };
      }

      for (const task of nonRunningTasks) {
        removeTask(task.id);
      }

      return {
        type: 'text',
        success: true,
        message: `已清理 ${nonRunningTasks.length} 个已结束的任务`,
      };
    }

    return {
      type: 'text',
      success: false,
      message: `未知子命令: ${params.subcommand}`,
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

  if (params.subcommand === 'stop' || params.subcommand === 'remove' || params.subcommand === 'rm') {
    params.taskId = parts[1];
  }

  return params;
}

/**
 * 格式化任务状态
 */
function formatStatus(status: string): string {
  switch (status) {
    case 'running':
      return '●';
    case 'completed':
      return '✓';
    case 'failed':
      return '✗';
    case 'stopped':
      return '○';
    default:
      return '?';
  }
}

/**
 * 格式化任务年龄
 */
function formatAge(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * Tasks命令实现
 * 任务管理与跟踪
 */
import type { CommandContext, CommandResult } from '@modules/commands';
import { taskRegistry } from '@modules/tasks';
import { TaskStatus } from '@modules/tasks/types';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('commands:builtin:tasks:Tasks');

interface TaskItem {
  id: string;
  title: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  priority: 'low' | 'medium' | 'high' | 'critical';
  createdAt: string;
  updatedAt: string;
  assignee?: string;
  tags?: string[];
}

function statusToDisplay(status: TaskStatus): TaskItem['status'] {
  switch (status) {
    case TaskStatus.PENDING:
      return 'pending';
    case TaskStatus.RUNNING:
      return 'in-progress';
    case TaskStatus.COMPLETED:
      return 'completed';
    case TaskStatus.FAILED:
    case TaskStatus.LOST:
    case TaskStatus.KILLED:
      return 'failed';
  }
}

function taskToItem(task: any): TaskItem {
  const state = task.taskState || task;
  return {
    id: state.id,
    title: state.description || '未命名任务',
    status: statusToDisplay(state.status),
    priority: state.metadata?.priority || 'medium',
    createdAt: new Date(state.startTime).toISOString().split('T')[0],
    updatedAt: state.endTime
      ? new Date(state.endTime).toISOString().split('T')[0]
      : new Date(state.startTime).toISOString().split('T')[0],
    assignee: state.metadata?.assignee,
    tags: state.metadata?.tags,
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
    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0]?.toLowerCase() || '';

    if (
      subcommand === 'help' ||
      subcommand === '--help' ||
      subcommand === '-h'
    ) {
      return this.showHelp();
    }

    if (subcommand === 'list' || !subcommand) {
      const filter = parts.slice(1).join(' ').toLowerCase();
      return this.listTasks(filter || undefined);
    }

    if (subcommand === 'add' || subcommand === 'create') {
      const title = parts.slice(1).join(' ');
      if (!title) {
        return {
          success: false,
          type: 'text',
          message: '请提供任务标题: /tasks add <标题>',
        };
      }
      return this.addTask(title);
    }

    if (subcommand === 'done' || subcommand === 'complete') {
      const taskId = parts[1]?.toUpperCase();
      if (!taskId) {
        return {
          success: false,
          type: 'text',
          message: '请提供任务ID: /tasks done <ID>',
        };
      }
      return this.completeTask(taskId);
    }

    if (subcommand === 'delete' || subcommand === 'remove') {
      const taskId = parts[1]?.toUpperCase();
      if (!taskId) {
        return {
          success: false,
          type: 'text',
          message: '请提供任务ID: /tasks delete <ID>',
        };
      }
      return this.deleteTask(taskId);
    }

    if (subcommand === 'priority') {
      const taskId = parts[1]?.toUpperCase();
      const priority = parts[2]?.toLowerCase() as
        | TaskItem['priority']
        | undefined;
      if (
        !taskId ||
        !priority ||
        !['low', 'medium', 'high', 'critical'].includes(priority)
      ) {
        return {
          success: false,
          type: 'text',
          message: '用法: /tasks priority <ID> <low|medium|high|critical>',
        };
      }
      return this.setPriority(taskId, priority);
    }

    if (subcommand === 'stats' || subcommand === 'statistics') {
      return this.showStats();
    }

    if (subcommand) {
      const taskId = subcommand.toUpperCase();
      return this.showTask(taskId);
    }

    return this.listTasks();
  },

  /**
   * 显示帮助信息
   */
  showHelp(): CommandResult {
    const help = [
      'Tasks 任务管理命令',
      '',
      '用法:',
      '  /tasks                    - 列出所有任务',
      '  /tasks list [过滤词]      - 列出任务（可过滤）',
      '  /tasks <ID>               - 查看任务详情',
      '  /tasks add <标题>         - 添加新任务',
      '  /tasks done <ID>          - 完成任务',
      '  /tasks delete <ID>        - 删除任务',
      '  /tasks priority <ID> <级别> - 设置优先级',
      '  /tasks stats              - 查看任务统计',
      '  /tasks help               - 显示此帮助信息',
      '',
      '优先级: low, medium, high, critical',
      '',
      '示例:',
      '  /tasks list pending',
      '  /tasks add 修复登录页面Bug',
      '  /tasks done T003',
      '  /tasks priority T001 high',
    ].join('\n');

    return { success: true, type: 'text', message: help };
  },

  /**
   * 列出任务
   */
  listTasks(filter?: string): CommandResult {
    const allTasks = taskRegistry.getAllTasks();
    let filtered = allTasks.map(taskToItem);

    if (filter) {
      filtered = filtered.filter(
        (t) =>
          t.title.toLowerCase().includes(filter) ||
          t.status.toLowerCase().includes(filter) ||
          t.priority.toLowerCase().includes(filter) ||
          t.id.toLowerCase().includes(filter)
      );
    }

    if (filtered.length === 0) {
      return {
        success: true,
        type: 'text',
        message: filter
          ? `未找到与 "${filter}" 匹配的任务。`
          : '暂无任务。使用 /tasks add <标题> 添加新任务。',
      };
    }

    const statusIcon = (status: TaskItem['status']): string => {
      switch (status) {
        case 'completed':
          return '✅';
        case 'in-progress':
          return '🔄';
        case 'failed':
          return '❌';
        case 'pending':
          return '⏳';
      }
    };

    const priorityLabel = (p: TaskItem['priority']): string => {
      switch (p) {
        case 'critical':
          return '🔴 紧急';
        case 'high':
          return '🟠 高';
        case 'medium':
          return '🟡 中';
        case 'low':
          return '🟢 低';
      }
    };

    const lines = [
      `📋 任务列表 (${filtered.length} 项)`,
      '',
      ...filtered.map(
        (t) =>
          `  ${statusIcon(t.status)} [${t.id}] ${t.title}\n     ${priorityLabel(t.priority)} | ${t.status}`
      ),
      '',
      '使用 /tasks <ID> 查看详情，/tasks help 查看更多操作。',
    ];

    return {
      success: true,
      type: 'text',
      message: lines.join('\n'),
      data: filtered,
    };
  },

  /**
   * 查看任务详情
   */
  showTask(taskId: string): CommandResult {
    const task = taskRegistry.getTask(taskId);
    if (!task) {
      return {
        success: false,
        type: 'text',
        message: `未找到任务: ${taskId}\n使用 /tasks list 查看所有任务。`,
      };
    }

    const item = taskToItem(task);

    const statusLabel: Record<string, string> = {
      pending: '⏳ 待处理',
      'in-progress': '🔄 进行中',
      completed: '✅ 已完成',
      failed: '❌ 失败',
    };

    const priorityLabel: Record<string, string> = {
      low: '🟢 低',
      medium: '🟡 中',
      high: '🟠 高',
      critical: '🔴 紧急',
    };

    const lines = [
      `📋 任务详情: ${item.id}`,
      '',
      `  标题: ${item.title}`,
      `  状态: ${statusLabel[item.status] || item.status}`,
      `  优先级: ${priorityLabel[item.priority] || item.priority}`,
      `  创建时间: ${item.createdAt}`,
      `  更新时间: ${item.updatedAt}`,
      item.assignee ? `  负责人: ${item.assignee}` : '',
      item.tags ? `  标签: ${item.tags.join(', ')}` : '',
    ];

    return {
      success: true,
      type: 'text',
      message: lines.filter(Boolean).join('\n'),
      data: item,
    };
  },

  /**
   * 添加新任务
   */
  addTask(title: string): CommandResult {
    try {
      const task = taskRegistry.registerNoteTask(title);
      return {
        success: true,
        type: 'text',
        message: `✅ 任务已创建: [${task.id}] ${title}\n使用 /tasks ${task.id} 查看详情。`,
        data: { id: task.id, title },
      };
    } catch (error) {
      return {
        success: false,
        type: 'text',
        message: `创建任务失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  /**
   * 完成任务
   */
  async completeTask(taskId: string): Promise<CommandResult> {
    const task = taskRegistry.getTask(taskId);
    if (!task) {
      return { success: false, type: 'text', message: `未找到任务: ${taskId}` };
    }

    try {
      taskRegistry.updateState(taskId, {
        status: TaskStatus.COMPLETED,
        endTime: Date.now(),
      });
      const item = taskToItem(task);
      return {
        success: true,
        type: 'text',
        message: `✅ 任务已完成: [${item.id}] ${item.title}`,
        data: item,
      };
    } catch (error) {
      return {
        success: false,
        type: 'text',
        message: `完成任务失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  /**
   * 删除任务
   */
  async deleteTask(taskId: string): Promise<CommandResult> {
    const task = taskRegistry.getTask(taskId);
    if (!task) {
      return { success: false, type: 'text', message: `未找到任务: ${taskId}` };
    }

    try {
      const item = taskToItem(task);
      await taskRegistry.removeTask(taskId);
      return {
        success: true,
        type: 'text',
        message: `🗑️ 任务已删除: [${item.id}] ${item.title}`,
        data: item,
      };
    } catch (error) {
      return {
        success: false,
        type: 'text',
        message: `删除任务失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  /**
   * 设置优先级
   */
  setPriority(taskId: string, priority: TaskItem['priority']): CommandResult {
    const task = taskRegistry.getTask(taskId);
    if (!task) {
      return { success: false, type: 'text', message: `未找到任务: ${taskId}` };
    }

    try {
      const state = task.taskState;
      taskRegistry.updateState(taskId, {
        metadata: { ...state.metadata, priority },
      });
      const item = taskToItem(task);
      return {
        success: true,
        type: 'text',
        message: `✅ 任务优先级已更新: [${item.id}] ${item.title} -> ${priority}`,
        data: item,
      };
    } catch (error) {
      return {
        success: false,
        type: 'text',
        message: `更新优先级失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  /**
   * 显示任务统计
   */
  showStats(): CommandResult {
    const stats = taskRegistry.getTaskStats();

    const lines = [
      '📊 任务统计',
      '',
      `  总任务数: ${stats.total}`,
      `  ✅ 已完成: ${stats.completed}`,
      `  🔄 进行中: ${stats.running}`,
      `  ⏳ 待处理: ${stats.pending}`,
      `  ❌ 失败: ${stats.failed + stats.lost}`,
      '',
      `  完成率: ${stats.total > 0 ? ((stats.completed / stats.total) * 100).toFixed(1) : '0'}%`,
    ];

    return {
      success: true,
      type: 'text',
      message: lines.join('\n'),
      data: stats,
    };
  },
};

export default tasksCommand;

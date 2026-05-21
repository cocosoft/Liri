import type { CommandContext, CommandResult } from '@modules/commands/types';
import { taskRegistry } from '@modules/tasks/TaskRegistry.js';
import { TaskStatus } from '@modules/tasks/types.js';
import { NoteTask } from '@modules/tasks/NoteTask.js';

function statusIcon(s: TaskStatus): string {
  switch (s) {
    case TaskStatus.COMPLETED:
      return '✓';
    case TaskStatus.RUNNING:
      return '●';
    case TaskStatus.FAILED:
      return '✗';
    case TaskStatus.KILLED:
      return '−';
    default:
      return '○';
  }
}

function statusLabel(s: TaskStatus): string {
  switch (s) {
    case TaskStatus.PENDING:
      return 'pending';
    case TaskStatus.RUNNING:
      return 'in_progress';
    case TaskStatus.COMPLETED:
      return 'completed';
    case TaskStatus.FAILED:
      return 'failed';
    case TaskStatus.KILLED:
      return 'cancelled';
    default:
      return 'unknown';
  }
}

export default {
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0] || 'show';

    switch (subcommand.toLowerCase()) {
      case 'show':
        return this.handleShow(context);
      case 'create':
        return this.handleCreate(parts.slice(1), context);
      case 'add':
        return this.handleAdd(parts.slice(1), context);
      case 'remove':
        return this.handleRemove(parts.slice(1), context);
      case 'clear':
        return this.handleClear(context);
      case 'execute':
        return this.handleExecute(context);
      default:
        return this.handleHelp();
    }
  },

  async handleShow(_context: CommandContext): Promise<CommandResult> {
    const allTasks = taskRegistry.getAllTasks();
    const planTasks = allTasks.filter(
      (t) => t.taskState.status !== TaskStatus.KILLED
    );
    const total = planTasks.length;
    const completed = planTasks.filter(
      (t) => t.taskState.status === TaskStatus.COMPLETED
    ).length;
    const inProgress = planTasks.filter(
      (t) => t.taskState.status === TaskStatus.RUNNING
    ).length;

    if (total === 0) {
      return {
        success: true,
        type: 'text',
        message: '当前没有计划任务。使用 /plan add <任务描述> 添加任务。',
        data: { tasks: [], totalTasks: 0 },
      };
    }

    const lines = planTasks.map((task, i) => {
      const s = task.taskState;
      const idx = (i + 1).toString().padEnd(3);
      const icon = statusIcon(s.status);
      const label = statusLabel(s.status).padEnd(15);
      return `${icon} ${idx}${label} ${s.description}`;
    });

    const table = lines.join('\n');
    return {
      success: true,
      type: 'text',
      message:
        `当前计划:\n\n${table}\n\n` +
        `进度: ${completed}/${total} 任务完成` +
        (inProgress > 0 ? `, ${inProgress} 进行中` : ''),
      data: { tasks: planTasks.map((t) => t.taskState), totalTasks: total },
    };
  },

  async handleCreate(
    _args: string[],
    context: CommandContext
  ): Promise<CommandResult> {
    context.onDone?.('已创建新计划', { display: 'system' });
    return {
      success: true,
      type: 'text',
      message: '已创建新计划。使用 /plan add <任务描述> 添加任务。',
    };
  },

  async handleAdd(
    args: string[],
    context: CommandContext
  ): Promise<CommandResult> {
    const taskDescription = args.join(' ');
    if (!taskDescription) {
      return {
        success: false,
        type: 'error',
        error: '请提供任务描述',
        message: '用法: /plan add <任务描述>',
      };
    }

    const task = new NoteTask(taskDescription, taskDescription);
    taskRegistry.register(task, undefined);

    context.onDone?.(`已添加任务: ${taskDescription}`, { display: 'system' });
    return {
      success: true,
      type: 'text',
      message: `已添加任务: ${taskDescription}`,
      data: { taskId: task.taskState.id, description: taskDescription },
    };
  },

  async handleRemove(
    args: string[],
    context: CommandContext
  ): Promise<CommandResult> {
    const rawId = args[0];
    if (!rawId) {
      return {
        success: false,
        type: 'error',
        error: '请提供任务编号或ID',
        message: '用法: /plan remove <任务编号|任务ID>',
      };
    }

    const allTasks = taskRegistry.getAllTasks();
    const active = allTasks.filter(
      (t) => t.taskState.status !== TaskStatus.KILLED
    );

    const idx = parseInt(rawId, 10);
    let targetId: string | undefined;

    if (!Number.isNaN(idx) && idx >= 1 && idx <= active.length) {
      targetId = active[idx - 1].taskState.id;
    } else {
      const byId = allTasks.find((t) => t.taskState.id === rawId);
      if (byId) targetId = byId.taskState.id;
    }

    if (!targetId) {
      return {
        success: false,
        type: 'error',
        error: `未找到任务: ${rawId}`,
        message: `未找到任务 "${rawId}"。使用 /plan show 查看有效编号。`,
      };
    }

    const task = taskRegistry.getTask(targetId);
    if (task) await task.kill();
    await taskRegistry.remove(targetId);

    context.onDone?.(`已移除任务: ${targetId}`, { display: 'system' });
    return {
      success: true,
      type: 'text',
      message: `已移除任务: ${targetId}`,
      data: { taskId: targetId },
    };
  },

  async handleClear(context: CommandContext): Promise<CommandResult> {
    const allTasks = taskRegistry.getAllTasks();
    const active = allTasks.filter(
      (t) => t.taskState.status !== TaskStatus.KILLED
    );

    for (const task of active) {
      await task.kill();
      await taskRegistry.remove(task.taskState.id);
    }

    context.onDone?.('计划已清空', { display: 'system' });
    return {
      success: true,
      type: 'text',
      message: `已清空 ${active.length} 个计划任务。`,
    };
  },

  async handleExecute(_context: CommandContext): Promise<CommandResult> {
    const allTasks = taskRegistry.getAllTasks();
    const pending = allTasks.filter(
      (t) => t.taskState.status === TaskStatus.PENDING
    );

    if (pending.length === 0) {
      return {
        success: true,
        type: 'text',
        message: '没有待执行的计划任务。',
      };
    }

    const next = pending[0];
    return {
      success: true,
      type: 'text',
      message:
        `计划执行中...\n\n` +
        `当前任务: ${next.taskState.description}\n` +
        `剩余任务: ${pending.length - 1} 个`,
      data: { status: 'running', currentTask: next.taskState.id },
    };
  },

  async handleHelp(): Promise<CommandResult> {
    return {
      success: true,
      type: 'text',
      message: [
        '计划管理命令用法:',
        '',
        '/plan show        - 显示当前计划',
        '/plan create      - 创建新计划',
        '/plan add <任务>   - 添加任务',
        '/plan remove <编号> - 移除任务（支持编号或ID）',
        '/plan clear       - 清空计划',
        '/plan execute     - 执行计划',
        '/plan help        - 显示此帮助信息',
        '',
        '示例:',
        '  /plan add 实现用户登录功能',
        '  /plan show',
      ].join('\n'),
    };
  },
};

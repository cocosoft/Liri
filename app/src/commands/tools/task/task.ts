/**
 * Task命令
 * 管理任务（通过 TaskRegistry）
 */

import type { Command } from '@modules/commands';
import { taskRegistry } from '@modules/tasks/TaskRegistry.js';
import { TaskStatus } from '@modules/tasks/types.js';
import { BaseTask } from '@modules/tasks/BaseTask.js';
import { NoteTask } from '@modules/tasks/NoteTask.js';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('commands:tools:task:task');

const VALID_STATUSES = [
  'pending',
  'in_progress',
  'completed',
  'failed',
  'cancelled',
] as const;
type DisplayStatus = (typeof VALID_STATUSES)[number];

function hasJsonFlag(parts: string[]): boolean {
  return parts.includes('--json') || parts.includes('-j');
}

function getFlagValue(parts: string[], flag: string): string | undefined {
  const idx = parts.indexOf(`--${flag}`);
  if (idx !== -1 && idx + 1 < parts.length) {
    return parts[idx + 1];
  }
  return undefined;
}

function stripFlags(parts: string[]): string[] {
  return parts.filter((p) => !p.startsWith('-'));
}

/** 将 TaskTool 显示状态映射为 TaskRegistry 内部状态 */
function displayToTaskStatus(s: DisplayStatus): TaskStatus {
  switch (s) {
    case 'pending':
      return TaskStatus.PENDING;
    case 'in_progress':
      return TaskStatus.RUNNING;
    case 'completed':
      return TaskStatus.COMPLETED;
    case 'failed':
      return TaskStatus.FAILED;
    case 'cancelled':
      return TaskStatus.KILLED;
  }
}

/** 将 TaskRegistry 内部状态映射回 TaskTool 显示状态 */
function taskStatusToDisplay(s: TaskStatus): DisplayStatus {
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
    case TaskStatus.LOST:
      return 'cancelled';
  }
}

function getPromptForCommand(): string {
  return [
    '- Task: 管理后台任务（CRUD + 停止 + 输出查看 + 统计）',
    '  - 创建: /task create <subject> <description> [--activeForm <form>]',
    '  - 列出: /task list [status] [--json]',
    '  - 查看: /task get <id> [--json]',
    '  - 更新: /task update <id> <status> [subject] [--activeForm <form>] [--owner <name>] [--priority <level>]',
    '  - 统计: /task stats',
    '  - 删除: /task delete <id>',
    '  - 停止: /task stop <id>',
    '  - 输出: /task output <id> [--block] [--timeout ms]',
    '  - 状态值: pending, in_progress, completed, failed, cancelled',
    '  - 优先级值: low, medium, high, urgent',
  ].join('\n');
}

function showHelp(): { success: boolean; message: string } {
  return {
    success: true,
    message: `Task Command Help
=====================

Usage:
  /task create <subject> <description> [options]   - 创建任务
  /task list [status] [--json|-j]                  - 列出任务
  /task stats                                       - 查看统计摘要
  /task get <id> [--json|-j]                       - 获取任务详情
  /task update <id> <status> [subject] [options]    - 更新任务
  /task delete <id>                                 - 删除任务
  /task stop <id>                                   - 停止任务
  /task output <id> [--block] [--timeout ms]        - 获取任务输出
  /task help                                        - 显示此帮助

Status:
  pending        - 待处理
  in_progress    - 进行中
  completed      - 已完成
  failed         - 失败
  cancelled      - 已取消

Priority:
  low            - 低优先级
  medium         - 中优先级
  high           - 高优先级
  urgent         - 紧急

Options (create):
  --activeForm <form>   现在进行时描述（如 "Fixing the login bug"）

Options (update):
  --activeForm <form>   更新现在进行时描述
  --owner <name>        更新任务所有者
  --priority <level>    更新优先级 (low|medium|high|urgent)
  --metadata <json>     更新元数据（JSON字符串）

Options (output):
  --block               等待任务完成再返回
  --timeout <ms>        超时时间（毫秒，默认30000）

Examples:
  /task create "Refactor API" "Refactor the REST API endpoints"
  /task create "Fix login" "Fix the login redirect bug" --activeForm "Fixing login redirect"
  /task list
  /task list --json
  /task list in_progress
  /task stats
  /task get task_xxx
  /task get task_xxx --json
  /task update task_xxx completed
  /task update task_xxx in_progress --priority high
  /task update task_xxx in_progress --activeForm "Running database migration"
  /task update task_xxx in_progress --owner alice
  /task delete task_xxx
  /task stop task_xxx
  /task output task_xxx --block --timeout 60000

Scenarios:
  • 标记任务为进行中并设置优先级:
    /task update <id> in_progress --priority high

  • 标记任务完成并查看下一个任务:
    /task update <id> completed
    /task list in_progress

  • 创建带进行时描述的任务（显示在进度中）:
    /task create "Run tests" "Run the full test suite" --activeForm "Running full test suite"

  • 查看任务统计:
    /task stats

Best Practices:
  • 使用 subject 的祈使句形式（如 "Fix bug" 而非 "Fixing bug"）
  • 使用 activeForm 的现在进行时形式（如 "Fixing the login bug"）
  • 开始工作前将任务标记为 in_progress
  • 完成后立即将任务标记为 completed
  • 如果遇到阻塞，创建依赖任务并更新 blockedBy`,
  };
}

function buildTaskMetadata(parts: string[]): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const activeForm = getFlagValue(parts, 'activeForm');
  if (activeForm) metadata.activeForm = activeForm;
  return metadata;
}

async function handleCreate(
  parts: string[]
): Promise<{ success: boolean; message?: string; error?: string }> {
  const stripped = stripFlags(parts.slice(1));
  const subject = stripped[0];
  const description = stripped.slice(1).join(' ');

  if (!subject || !description) {
    return {
      success: false,
      error:
        'Error: Please specify subject and description\nUsage: /task create <subject> <description> [--activeForm <form>]',
    };
  }

  try {
    const metadata = buildTaskMetadata(parts);
    const descriptionFull = `${subject}: ${description}`;
    const task = new NoteTask(descriptionFull, descriptionFull);
    const taskId = taskRegistry.register(task, undefined);
    if (Object.keys(metadata).length > 0) {
      task.setMetadata(metadata);
    }

    let msg = `Task created successfully:\n  ID: ${taskId}\n  Subject: ${subject}`;
    if (metadata.activeForm) {
      msg += `\n  ActiveForm: ${metadata.activeForm}`;
    }

    return { success: true, message: msg };
  } catch (error) {
    return {
      success: false,
      error: `Error creating task: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function taskToJson(task: BaseTask): Record<string, unknown> {
  const s = task.taskState;
  return {
    id: s.id,
    subject: s.description,
    status: taskStatusToDisplay(s.status),
    owner:
      (s.metadata as Record<string, unknown> | undefined)?.owner || undefined,
    priority:
      (s.metadata as Record<string, unknown> | undefined)?.priority ||
      undefined,
    activeForm:
      (s.metadata as Record<string, unknown> | undefined)?.activeForm ||
      undefined,
    createdAt: s.startTime,
  };
}

async function handleList(
  parts: string[]
): Promise<{ success: boolean; message?: string; error?: string }> {
  const useJson = hasJsonFlag(parts);
  const stripped = stripFlags(parts.slice(1));
  const statusFilter = stripped[0] as DisplayStatus | undefined;

  if (statusFilter && !VALID_STATUSES.includes(statusFilter)) {
    return {
      success: false,
      error: `Error: Invalid status "${statusFilter}". Valid statuses: ${VALID_STATUSES.join(', ')}`,
    };
  }

  try {
    let tasks = taskRegistry.getAllTasks();

    if (statusFilter) {
      const targetStatus = displayToTaskStatus(statusFilter);
      tasks = tasks.filter((t) => t.taskState.status === targetStatus);
    }

    if (useJson) {
      const jsonTasks = tasks.map(taskToJson);
      return {
        success: true,
        message: JSON.stringify(
          { count: tasks.length, tasks: jsonTasks },
          null,
          2
        ),
      };
    }

    if (tasks.length > 0) {
      const formattedTasks = tasks
        .map((task, i) => {
          const s = task.taskState;
          const displayStatus = taskStatusToDisplay(s.status);
          const statusIcon =
            displayStatus === 'completed'
              ? '✓'
              : displayStatus === 'failed'
                ? '✗'
                : displayStatus === 'in_progress'
                  ? '▶'
                  : displayStatus === 'cancelled'
                    ? '■'
                    : '○';
          const owner = (s.metadata as Record<string, unknown> | undefined)
            ?.owner;
          let line = `${i + 1}. [${statusIcon}] ${s.description}\n   ID: ${s.id} | Status: ${displayStatus}`;
          if (owner) {
            line += ` | Owner: ${owner}`;
          }
          return line;
        })
        .join('\n\n');

      return {
        success: true,
        message: `Task List (${tasks.length}):\n\n${formattedTasks}`,
      };
    }

    return {
      success: true,
      message: statusFilter
        ? `No tasks with status: ${statusFilter}`
        : 'No tasks found',
    };
  } catch (error) {
    return {
      success: false,
      error: `Error listing tasks: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function handleStats(): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  try {
    const allTasks = taskRegistry.getAllTasks();

    const pending = allTasks.filter(
      (t) => t.taskState.status === TaskStatus.PENDING
    ).length;
    const inProgress = allTasks.filter(
      (t) => t.taskState.status === TaskStatus.RUNNING
    ).length;
    const completed = allTasks.filter(
      (t) => t.taskState.status === TaskStatus.COMPLETED
    ).length;
    const failed = allTasks.filter(
      (t) => t.taskState.status === TaskStatus.FAILED
    ).length;
    const cancelled = allTasks.filter(
      (t) => t.taskState.status === TaskStatus.KILLED
    ).length;
    const total = allTasks.length;

    let output = `Task Stats (${total} total):\n\n`;

    if (total > 0) {
      const barWidth = 20;
      const renderBar = (count: number) => {
        const filled = Math.round((count / total) * barWidth);
        return '█'.repeat(filled) + '░'.repeat(barWidth - filled);
      };

      output += `  Pending:      ${renderBar(pending)} ${pending}\n`;
      output += `  In Progress:  ${renderBar(inProgress)} ${inProgress}\n`;
      output += `  Completed:    ${renderBar(completed)} ${completed}\n`;
      output += `  Failed:       ${renderBar(failed)} ${failed}\n`;
      output += `  Cancelled:    ${renderBar(cancelled)} ${cancelled}\n`;
    }

    return { success: true, message: output };
  } catch (error) {
    return {
      success: false,
      error: `Error getting task stats: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function handleGet(
  parts: string[]
): Promise<{ success: boolean; message?: string; error?: string }> {
  const useJson = hasJsonFlag(parts);
  const stripped = stripFlags(parts.slice(1));
  const id = stripped[0];

  if (!id) {
    return {
      success: false,
      error: 'Error: Please specify task ID\nUsage: /task get <id> [--json]',
    };
  }

  try {
    const task = taskRegistry.getTask(id);
    if (!task) {
      return { success: false, error: `Task not found: ${id}` };
    }

    const s = task.taskState;
    const displayStatus = taskStatusToDisplay(s.status);
    const meta = (s.metadata || {}) as Record<string, unknown>;

    if (useJson) {
      return {
        success: true,
        message: JSON.stringify(taskToJson(task), null, 2),
      };
    }

    return {
      success: true,
      message: `Task Details:
  ID: ${s.id}
  Subject: ${s.description}
  Status: ${displayStatus}
  Priority: ${meta.priority || 'medium'}
  Owner: ${meta.owner || 'N/A'}
  Active Form: ${meta.activeForm || 'N/A'}
  Created: ${s.startTime ? new Date(s.startTime).toLocaleString() : 'N/A'}`,
    };
  } catch (error) {
    return {
      success: false,
      error: `Error getting task: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function handleUpdate(
  parts: string[]
): Promise<{ success: boolean; message?: string; error?: string }> {
  const stripped = stripFlags(parts.slice(1));
  const id = stripped[0];
  const status = stripped[1] as DisplayStatus;
  const subject = stripped[2];
  const description = stripped.slice(3).join(' ');

  const activeForm = getFlagValue(parts, 'activeForm');
  const owner = getFlagValue(parts, 'owner');
  const priority = getFlagValue(parts, 'priority');

  if (!id || !status) {
    return {
      success: false,
      error:
        'Error: Please specify task ID and status\nUsage: /task update <id> <status> [subject] [options]',
    };
  }

  if (!VALID_STATUSES.includes(status)) {
    return {
      success: false,
      error: `Error: Invalid status "${status}". Valid statuses: ${VALID_STATUSES.join(', ')}`,
    };
  }

  try {
    const task = taskRegistry.getTask(id);
    if (!task) {
      return { success: false, error: `Task not found: ${id}` };
    }

    const targetStatus = displayToTaskStatus(status);
    const updates: Record<string, unknown> = { status: targetStatus };
    if (subject)
      updates.description = description
        ? `${subject}: ${description}`
        : subject;
    if (description && subject)
      updates.description = `${subject}: ${description}`;

    const meta: Record<string, unknown> = {
      ...((task.taskState.metadata || {}) as Record<string, unknown>),
    };
    if (activeForm) meta.activeForm = activeForm;
    if (owner) meta.owner = owner;
    if (priority) meta.priority = priority;
    if (Object.keys(meta).length > 0) updates.metadata = meta;

    (task as NoteTask).patchState(updates);

    let msg = `Task updated successfully:\n  ID: ${id}\n  Status: ${status}`;
    if (activeForm) msg += `\n  ActiveForm: ${activeForm}`;
    if (owner) msg += `\n  Owner: ${owner}`;
    if (priority) msg += `\n  Priority: ${priority}`;
    return { success: true, message: msg };
  } catch (error) {
    return {
      success: false,
      error: `Error updating task: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function handleDelete(
  parts: string[]
): Promise<{ success: boolean; message?: string; error?: string }> {
  const stripped = stripFlags(parts.slice(1));
  const id = stripped[0];

  if (!id) {
    return {
      success: false,
      error: 'Error: Please specify task ID\nUsage: /task delete <id>',
    };
  }

  try {
    const task = taskRegistry.getTask(id);
    if (!task) {
      return { success: false, error: `Task not found: ${id}` };
    }

    await task.kill();
    await taskRegistry.remove(id);
    return { success: true, message: `Task deleted: ${id}` };
  } catch (error) {
    return {
      success: false,
      error: `Error deleting task: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function handleStop(
  parts: string[]
): Promise<{ success: boolean; message?: string; error?: string }> {
  const stripped = stripFlags(parts.slice(1));
  const id = stripped[0];

  if (!id) {
    return {
      success: false,
      error: 'Error: Please specify task ID\nUsage: /task stop <id>',
    };
  }

  try {
    const task = taskRegistry.getTask(id);
    if (!task) {
      return { success: false, error: `Task not found: ${id}` };
    }

    await task.kill();
    return { success: true, message: `Task stopped successfully: ${id}` };
  } catch (error) {
    return {
      success: false,
      error: `Error stopping task: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function handleOutput(
  parts: string[]
): Promise<{ success: boolean; message?: string; error?: string }> {
  const stripped = stripFlags(parts.slice(1));
  const id = stripped[0];

  if (!id) {
    return {
      success: false,
      error:
        'Error: Please specify task ID\nUsage: /task output <id> [--block] [--timeout ms]',
    };
  }

  try {
    const task = taskRegistry.getTask(id);
    if (!task) {
      return { success: false, error: `Task not found: ${id}` };
    }

    const s = task.taskState;
    const displayStatus = taskStatusToDisplay(s.status);

    return {
      success: true,
      message: `Task Output (${s.id}):
  Status: ${displayStatus}
  ToolUseCount: ${s.toolUseCount}
  TokenCount: ${s.tokenCount}`,
    };
  } catch (error) {
    return {
      success: false,
      error: `Error getting task output: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export const taskCommand: Command = {
  type: 'action',
  name: 'task',
  description: '管理任务',
  aliases: [],
  argumentHint: '[create|list|stats|get|update|delete|stop|output|help] [args]',
  whenToUse: '当你需要管理后台任务、跟踪多步骤任务进度、查看任务统计时',
  load: async () => ({
    execute: async (args: string) => {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase();

      if (!subcommand || subcommand === 'help') {
        return showHelp();
      }

      switch (subcommand) {
        case 'create':
          return handleCreate(parts);
        case 'list':
          return handleList(parts);
        case 'stats':
          return handleStats();
        case 'get':
          return handleGet(parts);
        case 'update':
          return handleUpdate(parts);
        case 'delete':
          return handleDelete(parts);
        case 'stop':
          return handleStop(parts);
        case 'output':
          return handleOutput(parts);
        default:
          return {
            success: false,
            error: `Error: Unknown subcommand "${subcommand}"\n\nUse /task help for help`,
          };
      }
    },
  }),
};

export { getPromptForCommand };

export default taskCommand;

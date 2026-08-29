/**
 * TaskOrchestratorTools - LLM 任务编排工具集
 *
 * 通过 TaskOrchestrator 提供 create_task_list / update_task_status / get_task_list
 * 三个 LLM 可调用工具，替代已废弃的 TaskTool 独立存储工具。
 */

import { Tool, ToolParam } from '../types/Tool';
import { ToolResult, createToolResult } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import { taskRegistry, DisplayStatus } from '@modules/tasks';
import { TaskStatus } from '@modules/tasks/types';
import { NoteTask } from '@modules/tasks';

const TASK_TOOL_PARAMS: ToolParam[] = [
  {
    name: 'action',
    type: 'string',
    description: 'Action to perform: create_list, update_status, list, delete',
    required: true,
  },
  {
    name: 'tasks',
    type: 'object',
    description:
      'Array of task descriptions for create_list action. Each item: { description: string, metadata?: Record<string, unknown> }',
    required: false,
  },
  {
    name: 'task_id',
    type: 'string',
    description: 'Task ID for update_status or delete action',
    required: false,
  },
  {
    name: 'status',
    type: 'string',
    description:
      'New status for update_status: pending, in_progress, completed, failed, cancelled',
    required: false,
  },
];

/**
 * 单次 create_task_list 调用允许创建的最大任务数。
 * 防止模型批量幻觉一次性输出大量（如 43 个）空参数 tool_call 造成任务爆炸。
 */
export const MAX_TASKS_PER_CALL = 20;

export class TaskCreateListTool implements Tool {
  name = 'create_task_list';
  description =
    'Create multiple tasks at once. ' +
    'Use this when the user provides a list of items they want to track as tasks (e.g. plan steps, todo items). ' +
    'Input: JSON array of task objects, each with description and optional metadata.';
  params = TASK_TOOL_PARAMS;

  isEnabled(): boolean {
    return true;
  }

  isReadOnly(_input?: Record<string, unknown>): boolean {
    return false;
  }

  isConcurrencySafe(_input?: Record<string, unknown>): boolean {
    return true;
  }

  getInfo() {
    return {
      name: this.name,
      description: this.description,
      params: this.params,
      enabled: true,
      readOnly: false,
      destructive: false,
      concurrencySafe: true,
      deferred: false,
      alwaysLoad: false,
      interruptBehavior: 'cancel' as const,
    };
  }

  validate(_params: Record<string, unknown>) {
    return { result: true as const };
  }

  async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    const tasks = input.tasks as
      | Array<{ description: string; metadata?: Record<string, unknown> }>
      | undefined;
    if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
      return createToolResult(null, {
        newMessages: [
          {
            role: 'system',
            content: 'Error: tasks array is required and must be non-empty',
          },
        ],
      });
    }

    // 空参数校验：过滤掉 description 缺失/非字符串/空白的无效项
    const validTasks = tasks.filter(
      (t): t is { description: string; metadata?: Record<string, unknown> } =>
        !!t &&
        typeof t.description === 'string' &&
        t.description.trim().length > 0
    );
    const skippedCount = tasks.length - validTasks.length;

    if (validTasks.length === 0) {
      return createToolResult(null, {
        newMessages: [
          {
            role: 'system',
            content:
              'Error: all task descriptions are empty. Each task must have a non-empty description string.',
          },
        ],
      });
    }

    // 单次调用数量限制：防止模型批量幻觉一次性创建过多任务
    if (validTasks.length > MAX_TASKS_PER_CALL) {
      return createToolResult(null, {
        newMessages: [
          {
            role: 'system',
            content: `Error: too many tasks in one call (${validTasks.length}). Max ${MAX_TASKS_PER_CALL} tasks per call. Please create them in smaller batches.`,
          },
        ],
      });
    }

    const created: Array<{ id: string; description: string }> = [];
    for (const t of validTasks) {
      const description = t.description.trim();
      const note = taskRegistry.registerNoteTask(description);
      if (t.metadata) {
        note.setMetadata(t.metadata);
      }
      created.push({ id: note.id, description });
    }

    const stats = taskRegistry.getTaskStats();
    const output = [
      `Created ${created.length} task(s):`,
      ...created.map((c) => `  - [${c.id}] ${c.description}`),
      '',
      `Stats: ${stats.total} total, ${stats.pending} pending`,
      ...(skippedCount > 0
        ? [`Note: ${skippedCount} invalid empty task(s) were skipped`]
        : []),
    ].join('\n');

    return createToolResult(output, {
      newMessages: [
        {
          role: 'system',
          content: `Created ${created.length} tasks${skippedCount > 0 ? ` (skipped ${skippedCount} empty)` : ''}`,
        },
      ],
    });
  }

  renderToolUseMessage() {
    return null;
  }
  renderToolUseResultMessage() {
    return null;
  }
  renderErrorResultMessage() {
    return null;
  }
}

/**
 * ViewTasksTool - 查询当前所有任务，支持按状态过滤
 */
export class ViewTasksTool implements Tool {
  name = 'view_tasks';
  description =
    'View the list of all tasks with their IDs, descriptions, and statuses. ' +
    'Supports optional filtering by status. ' +
    'Use this to show the user their task list, find task IDs, or check progress.';
  params = [
    {
      name: 'status',
      type: 'string',
      description:
        'Optional filter: pending, in_progress, completed, failed, cancelled. ' +
        'If omitted, all tasks are shown.',
      required: false,
    },
  ];

  isEnabled(): boolean {
    return true;
  }

  isReadOnly(_input?: Record<string, unknown>): boolean {
    return true;
  }

  isConcurrencySafe(_input?: Record<string, unknown>): boolean {
    return true;
  }

  getInfo() {
    return {
      name: this.name,
      description: this.description,
      params: this.params,
      enabled: true,
      readOnly: true,
      destructive: false,
      concurrencySafe: true,
      deferred: false,
      alwaysLoad: false,
      interruptBehavior: 'cancel' as const,
    };
  }

  validate(_params: Record<string, unknown>) {
    return { result: true as const };
  }

  async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    const statusFilter = input.status as string | undefined;

    let tasks: Array<{
      id: string;
      description: string;
      displayStatus: string;
    }>;

    if (statusFilter) {
      const validStatuses = [
        'pending',
        'in_progress',
        'completed',
        'failed',
        'cancelled',
      ];
      if (!validStatuses.includes(statusFilter)) {
        return createToolResult(null, {
          newMessages: [
            {
              role: 'system',
              content: `Error: invalid status "${statusFilter}". Valid: ${validStatuses.join(', ')}`,
            },
          ],
        });
      }
      tasks = taskRegistry.getTasksInfoByDisplayStatus(
        statusFilter as DisplayStatus
      );
    } else {
      tasks = taskRegistry.getAllTaskInfos();
    }

    const stats = taskRegistry.getTaskStats();

    if (tasks.length === 0) {
      const msg = statusFilter
        ? `No tasks found with status "${statusFilter}".`
        : 'No tasks found.';
      return createToolResult(msg, {
        newMessages: [{ role: 'system', content: msg }],
      });
    }

    const statusIcons: Record<string, string> = {
      pending: '○',
      in_progress: '◐',
      completed: '✓',
      failed: '✗',
      cancelled: '−',
    };

    const title = statusFilter
      ? `Tasks (status: ${statusFilter}) — ${tasks.length} items`
      : `All Tasks — ${tasks.length} items`;

    let output = `${title}\n`;
    output += `  ${stats.pending} pending | ${stats.running} running | ${stats.completed} completed | ${stats.failed} failed | ${stats.cancelled} cancelled\n`;
    output += `${'='.repeat(60)}\n\n`;

    tasks.forEach((task, index) => {
      const icon = statusIcons[task.displayStatus] || '○';
      output += `${index + 1}. [${icon}] [${task.id}] ${task.description}\n`;
      output += `   Status: ${task.displayStatus}\n\n`;
    });

    return createToolResult(output, {
      newMessages: [
        { role: 'system', content: `Listed ${tasks.length} tasks` },
      ],
    });
  }

  renderToolUseMessage() {
    return null;
  }
  renderToolUseResultMessage() {
    return null;
  }
  renderErrorResultMessage() {
    return null;
  }
}

/**
 * AbortTaskTool - 终止指定任务
 */
export class AbortTaskTool implements Tool {
  name = 'abort_task';
  description =
    'Abort/terminate a running or pending task by its ID. ' +
    'Use this when the user wants to cancel or stop a specific task. ' +
    'After aborting, the task status will be set to cancelled.';
  params = [
    {
      name: 'task_id',
      type: 'string',
      description: 'The ID of the task to abort',
      required: true,
    },
  ];

  isEnabled(): boolean {
    return true;
  }

  isReadOnly(_input?: Record<string, unknown>): boolean {
    return false;
  }

  isDestructive(_input?: Record<string, unknown>): boolean {
    return true;
  }

  isConcurrencySafe(_input?: Record<string, unknown>): boolean {
    return false;
  }

  interruptBehavior(): 'cancel' | 'block' {
    return 'cancel';
  }

  getInfo() {
    return {
      name: this.name,
      description: this.description,
      params: this.params,
      enabled: true,
      readOnly: false,
      destructive: true,
      concurrencySafe: false,
      deferred: false,
      alwaysLoad: false,
      interruptBehavior: 'cancel' as const,
    };
  }

  validate(_params: Record<string, unknown>) {
    return { result: true as const };
  }

  async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    const taskId = input.task_id as string | undefined;

    if (!taskId) {
      return createToolResult(null, {
        newMessages: [
          { role: 'system', content: 'Error: task_id is required' },
        ],
      });
    }

    const task = taskRegistry.getTask(taskId);
    if (!task) {
      return createToolResult(null, {
        newMessages: [
          { role: 'system', content: `Error: task ${taskId} not found` },
        ],
      });
    }

    await task.kill();

    return createToolResult(`Task ${taskId} has been aborted.`, {
      newMessages: [{ role: 'system', content: `Aborted task ${taskId}` }],
    });
  }

  renderToolUseMessage() {
    return null;
  }
  renderToolUseResultMessage() {
    return null;
  }
  renderErrorResultMessage() {
    return null;
  }
}

/**
 * ViewPlanTool - 查看计划详情和进度
 */
export class ViewPlanTool implements Tool {
  name = 'view_plan';
  description =
    'View the task plan overview with progress summary. ' +
    'Shows all tasks grouped by status with completion statistics. ' +
    'Use this to check overall progress of the current task plan.';
  params = [
    {
      name: 'plan_id',
      type: 'string',
      description:
        'Optional plan ID to filter by. ' +
        'If omitted, shows all tasks as a plan overview.',
      required: false,
    },
  ];

  isEnabled(): boolean {
    return true;
  }

  isReadOnly(_input?: Record<string, unknown>): boolean {
    return true;
  }

  isConcurrencySafe(_input?: Record<string, unknown>): boolean {
    return true;
  }

  getInfo() {
    return {
      name: this.name,
      description: this.description,
      params: this.params,
      enabled: true,
      readOnly: true,
      destructive: false,
      concurrencySafe: true,
      deferred: false,
      alwaysLoad: false,
      interruptBehavior: 'cancel' as const,
    };
  }

  validate(_params: Record<string, unknown>) {
    return { result: true as const };
  }

  async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    const planId = input.plan_id as string | undefined;

    let tasks: Array<{
      id: string;
      description: string;
      displayStatus: string;
    }>;

    if (planId) {
      const taskInfos = taskRegistry.getAllTaskInfos();
      tasks = taskInfos.filter(
        (t) =>
          t.metadata &&
          (t.metadata as Record<string, unknown>).plan_id === planId
      );
    } else {
      tasks = taskRegistry.getAllTaskInfos();
    }

    const stats = taskRegistry.getTaskStats();

    if (tasks.length === 0) {
      const msg = planId
        ? `No tasks found for plan "${planId}".`
        : 'No tasks found.';
      return createToolResult(msg, {
        newMessages: [{ role: 'system', content: msg }],
      });
    }

    const groups: Record<string, typeof tasks> = {
      pending: [],
      in_progress: [],
      completed: [],
      failed: [],
      cancelled: [],
    };

    for (const task of tasks) {
      const status = task.displayStatus || 'pending';
      if (groups[status]) {
        groups[status].push(task);
      } else {
        groups.pending.push(task);
      }
    }

    const total = tasks.length;
    const completed = groups.completed.length;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    let output = planId
      ? `Plan Overview [${planId}]\n`
      : 'Plan Overview (All Tasks)\n';
    output += `Progress: ${completed}/${total} tasks completed (${progress}%)\n`;
    output += `${'='.repeat(60)}\n\n`;

    for (const [status, groupTasks] of Object.entries(groups)) {
      if (groupTasks.length === 0) continue;

      const statusLabels: Record<string, string> = {
        pending: '○ Pending',
        in_progress: '◐ In Progress',
        completed: '✓ Completed',
        failed: '✗ Failed',
        cancelled: '− Cancelled',
      };

      output += `--- ${statusLabels[status] || status} (${groupTasks.length}) ---\n`;
      for (let i = 0; i < groupTasks.length; i++) {
        const t = groupTasks[i];
        output += `  ${i + 1}. [${t.id}] ${t.description}\n`;
      }
      output += '\n';
    }

    return createToolResult(output, {
      newMessages: [
        {
          role: 'system',
          content: `Plan overview: ${completed}/${total} completed (${progress}%)`,
        },
      ],
    });
  }

  renderToolUseMessage() {
    return null;
  }
  renderToolUseResultMessage() {
    return null;
  }
  renderErrorResultMessage() {
    return null;
  }
}

export class TaskUpdateStatusTool implements Tool {
  name = 'update_task_status';
  description =
    'Update the status of a task by ID. Supports: pending, in_progress, completed, failed, cancelled.';
  params = TASK_TOOL_PARAMS;

  isEnabled(): boolean {
    return true;
  }

  isReadOnly(_input?: Record<string, unknown>): boolean {
    return false;
  }

  isConcurrencySafe(_input?: Record<string, unknown>): boolean {
    return true;
  }

  getInfo() {
    return {
      name: this.name,
      description: this.description,
      params: this.params,
      enabled: true,
      readOnly: false,
      destructive: false,
      concurrencySafe: true,
      deferred: false,
      alwaysLoad: false,
      interruptBehavior: 'cancel' as const,
    };
  }

  validate(_params: Record<string, unknown>) {
    return { result: true as const };
  }

  async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    const taskId = input.task_id as string | undefined;
    const status = input.status as string | undefined;

    if (!taskId) {
      return createToolResult(null, {
        newMessages: [
          { role: 'system', content: 'Error: task_id is required' },
        ],
      });
    }
    if (!status) {
      return createToolResult(null, {
        newMessages: [{ role: 'system', content: 'Error: status is required' }],
      });
    }

    const task = taskRegistry.getTask(taskId);
    if (!task) {
      return createToolResult(null, {
        newMessages: [
          { role: 'system', content: `Error: task ${taskId} not found` },
        ],
      });
    }

    const statusMap: Record<string, TaskStatus> = {
      pending: TaskStatus.PENDING,
      in_progress: TaskStatus.RUNNING,
      completed: TaskStatus.COMPLETED,
      failed: TaskStatus.FAILED,
      cancelled: TaskStatus.KILLED,
    };

    const mapped = statusMap[status];
    if (mapped === undefined) {
      return createToolResult(null, {
        newMessages: [
          {
            role: 'system',
            content: `Error: invalid status "${status}". Valid: pending, in_progress, completed, failed, cancelled`,
          },
        ],
      });
    }

    if (task instanceof NoteTask) {
      task.setStatusDirect(mapped);
    }

    return createToolResult(`Updated task ${taskId} to ${status}`, {
      newMessages: [
        { role: 'system', content: `Updated task ${taskId} to ${status}` },
      ],
    });
  }

  renderToolUseMessage() {
    return null;
  }
  renderToolUseResultMessage() {
    return null;
  }
  renderErrorResultMessage() {
    return null;
  }
}

export class TaskGetListTool implements Tool {
  name = 'get_task_list';
  description =
    'Get the current list of all tasks with their IDs, descriptions, and statuses. ' +
    'Use this to show the user their task list or to find task IDs for updates.';
  params = TASK_TOOL_PARAMS;

  isEnabled(): boolean {
    return true;
  }

  isReadOnly(_input?: Record<string, unknown>): boolean {
    return true;
  }

  isConcurrencySafe(_input?: Record<string, unknown>): boolean {
    return true;
  }

  getInfo() {
    return {
      name: this.name,
      description: this.description,
      params: this.params,
      enabled: true,
      readOnly: true,
      destructive: false,
      concurrencySafe: true,
      deferred: false,
      alwaysLoad: false,
      interruptBehavior: 'cancel' as const,
    };
  }

  validate(_params: Record<string, unknown>) {
    return { result: true as const };
  }

  async execute(
    _input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    const tasks = taskRegistry.getAllTaskInfos();
    const stats = taskRegistry.getTaskStats();

    if (tasks.length === 0) {
      return createToolResult('No tasks found.', {
        newMessages: [{ role: 'system', content: 'No tasks found' }],
      });
    }

    const statusIcons: Record<string, string> = {
      pending: '○',
      in_progress: '◐',
      completed: '✓',
      failed: '✗',
      cancelled: '−',
    };

    let output = `Task List (${tasks.length} items):\n`;
    output += `  ${stats.pending} pending | ${stats.running} in_progress | ${stats.completed} completed | ${stats.failed} failed | ${stats.cancelled} cancelled\n`;
    output += `${'='.repeat(60)}\n\n`;

    tasks.forEach((task, index) => {
      const icon = statusIcons[task.displayStatus] || '○';
      output += `${index + 1}. [${icon}] [${task.id}] ${task.description}\n`;
      output += `   Status: ${task.displayStatus}\n\n`;
    });

    return createToolResult(output, {
      newMessages: [
        { role: 'system', content: `Listed ${tasks.length} tasks` },
      ],
    });
  }

  renderToolUseMessage() {
    return null;
  }
  renderToolUseResultMessage() {
    return null;
  }
  renderErrorResultMessage() {
    return null;
  }
}

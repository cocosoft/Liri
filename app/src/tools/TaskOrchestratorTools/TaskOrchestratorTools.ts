/**
 * TaskOrchestratorTools - LLM 任务编排工具集
 *
 * 通过 TaskOrchestrator 提供 create_task_list / update_task_status / get_task_list
 * 三个 LLM 可调用工具，替代已废弃的 TaskTool 独立存储工具。
 */

import { Tool, ToolParam } from '../types/Tool';
import { ToolResult, createToolResult, ErrorLevel } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import { taskRegistry, DisplayStatus } from '@modules/tasks';
import { TaskStatus } from '@modules/tasks/types';
import { NoteTask } from '@modules/tasks';
import { getTaskConcurrencyLimits } from '../../tasks/limits';
import { pickTaskText } from '../utils/ToolUtils';
import {
  CreateTaskListOutputSchema,
  GetTaskListOutputSchema,
  UpdateTaskStatusOutputSchema,
} from './schemas';

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
 * 1-4（2026-09-03）：值收敛到 tasks/limits.ts（env TASK_MAX_TASKS_PER_CALL 可覆盖）
 */
export const MAX_TASKS_PER_CALL = getTaskConcurrencyLimits().maxTasksPerCall;

/**
 * 任务编排工具的**失败结果**（单一实现，2026-09-29 台账**另案 ④**）。
 *
 * **为什么必须落 `error` 字段**：这是**模型与前端都能看到**的失败原因通道，范式同
 * [`failProjectTool`](../projectToolGuidance.ts)（该文件注释即引用项目约定
 * 「工具失败信息必须落 `error` 字段供前端展示」）。此前这些分支只写 `newMessages`，
 * 而 `newMessages` 在本仓 **`app/src/chat` 内零消费方** ⇒ 模型侧 `error || '{}'` 恒取到
 * **`{}`**，与"成功但空载荷"不可区分 ⇒ 实测模型据此误判并**绕道 `todo_write`**。
 */
function taskToolFail(message: string): ToolResult {
  return createToolResult(null, {
    success: false,
    error: message,
    errorLevel: ErrorLevel.RECOVERABLE,
    newMessages: [{ role: 'system', content: `Error: ${message}` }],
  });
}

export class TaskCreateListTool implements Tool {
  name = 'create_task_list';
  description =
    'Create multiple tasks at once. ' +
    'Use this when the user provides a list of items they want to track as tasks (e.g. plan steps, todo items). ' +
    'Input: JSON array of task objects, each with description and optional metadata.';

  /**
   * 出参契约（P1-3 A 档；2026-09-29 出参对象化同批接线）。
   * 出口见 `execute()` 成功分支的 `data`（对象）；失败分支 `createToolResult(null, …)` ⇒ 无载荷不校验。
   */
  outputSchema = CreateTaskListOutputSchema;
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
    const rawTasks = input.tasks;
    if (!rawTasks || !Array.isArray(rawTasks) || rawTasks.length === 0) {
      return taskToolFail('tasks array is required and must be non-empty');
    }

    // 入参归一化（2026-09-29，台账**另案 ④**）：模型描述任务的字段名不固定
    // （`description` / `title` / `name` / `task` / `subject` / `desc` / `content`）⇒ 复用
    // 同族兜底链 [`pickTaskText`](../utils/ToolUtils.ts)（与 `TodoWriteTool` **同一实现**），
    // **只丢弃"全部文本字段都为空"的项**（不臆造占位文本 —— CS04）。
    const validTasks = (rawTasks as unknown[])
      .map((t) => ({
        description: pickTaskText(t),
        metadata:
          t && typeof t === 'object'
            ? (t as { metadata?: Record<string, unknown> }).metadata
            : undefined,
      }))
      .filter((t) => t.description.length > 0);
    const skippedCount = rawTasks.length - validTasks.length;

    if (validTasks.length === 0) {
      return taskToolFail(
        'all task descriptions are empty — 每项都缺少可用的文本字段（description/title/name/task/subject/desc）'
      );
    }

    // 单次调用数量限制：防止模型批量幻觉一次性创建过多任务
    if (validTasks.length > MAX_TASKS_PER_CALL) {
      return taskToolFail(
        `too many tasks in one call (${validTasks.length}). Max ${MAX_TASKS_PER_CALL} tasks per call. Please create them in smaller batches.`
      );
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

    // 出参对象化（2026-09-29）：原为多行纯文本，与同族 `task_stop` 形态不一致且无法声明契约。
    return createToolResult(
      {
        created: created.map((c) => ({
          task_id: c.id,
          description: c.description,
        })),
        total: stats.total,
        pending: stats.pending,
        skipped: skippedCount,
      },
      {
        newMessages: [
          {
            role: 'system',
            content: `Created ${created.length} tasks${skippedCount > 0 ? ` (skipped ${skippedCount} empty)` : ''}`,
          },
        ],
      }
    );
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

  /**
   * 出参契约（P1-3 A 档；2026-09-29 出参对象化同批接线）。
   * 出口见 `execute()` 成功分支的 `data`（对象）；失败分支 `createToolResult(null, …)` ⇒ 无载荷不校验。
   */
  outputSchema = UpdateTaskStatusOutputSchema;
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
      return taskToolFail('task_id is required');
    }
    if (!status) {
      return taskToolFail('status is required');
    }

    const task = taskRegistry.getTask(taskId);
    if (!task) {
      return taskToolFail(`task ${taskId} not found`);
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
      return taskToolFail(
        `invalid status "${status}". Valid: pending, in_progress, completed, failed, cancelled`
      );
    }

    if (task instanceof NoteTask) {
      task.setStatusDirect(mapped);
    }

    return createToolResult(
      {
        task_id: taskId,
        status,
        success: true,
        message: `Updated task ${taskId} to ${status}`,
      },
      {
        newMessages: [
          { role: 'system', content: `Updated task ${taskId} to ${status}` },
        ],
      }
    );
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

  /**
   * 出参契约（P1-3 A 档；2026-09-29 出参对象化同批接线）。
   * 出口见 `execute()` 的 `data`（对象，含空列表分支）；无失败分支载荷。
   */
  outputSchema = GetTaskListOutputSchema;
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
      // 空列表同属"成功但为空" ⇒ 与成功分支**同形态**（否则出参契约校验会记为不合规）
      return createToolResult(
        {
          count: 0,
          stats: {
            pending: stats.pending,
            in_progress: stats.running,
            completed: stats.completed,
            failed: stats.failed,
            cancelled: stats.cancelled,
          },
          tasks: [],
        },
        { newMessages: [{ role: 'system', content: 'No tasks found' }] }
      );
    }

    // 出参对象化（2026-09-29）：原为对齐表格文本，与同族 `task_stop` 形态不一致且无法声明契约。
    return createToolResult(
      {
        count: tasks.length,
        stats: {
          pending: stats.pending,
          in_progress: stats.running,
          completed: stats.completed,
          failed: stats.failed,
          cancelled: stats.cancelled,
        },
        tasks: tasks.map((task) => ({
          task_id: task.id,
          description: task.description,
          status: task.displayStatus,
        })),
      },
      {
        newMessages: [
          { role: 'system', content: `Listed ${tasks.length} tasks` },
        ],
      }
    );
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

// @ts-nocheck
/**
 * 任务输出工具
 * 获取运行中或已完成任务的输出
 * 参考CC源码 cc_code/backend/tools/TaskOutputTool/TaskOutputTool.tsx 实现
 */

import { readFile } from 'fs/promises';
import { BaseTool } from '../BaseTool';
import type {
  ToolResult,
  ToolUseContext,
  ToolParam,
  ToolCallProgress,
  ValidationResult,
} from '../types';
import { createToolResult } from '../types/ToolResult';
import { taskRegistry } from '@modules/tasks/TaskRegistry';
import { TaskStatus, isTerminalTaskStatus } from '@modules/tasks/types';
import type { BaseTask } from '@modules/tasks/BaseTask';

/**
 * 任务输出数据类型
 */
export interface TaskOutputData {
  task_id: string;
  task_type: string;
  status: string;
  description: string;
  output: string;
  exitCode?: number | null;
  error?: string;
  prompt?: string;
  result?: string;
}

/**
 * 任务输出工具输入类型
 */
export interface TaskOutputToolInput {
  task_id: string;
  block?: boolean;
  timeout?: number;
}

/**
 * 任务输出工具输出类型
 */
export interface TaskOutputToolOutput {
  retrieval_status: 'success' | 'timeout' | 'not_ready';
  task: TaskOutputData | null;
}

/**
 * 等待任务完成
 * @param taskId 任务ID
 * @param timeoutMs 超时时间（毫秒）
 * @param abortSignal 中止信号
 * @returns 完成后的任务实例，超时返回当前状态
 */
async function waitForTaskCompletion(
  taskId: string,
  timeoutMs: number,
  abortSignal?: AbortSignal
): Promise<BaseTask | null> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (abortSignal?.aborted) {
      throw new Error('Aborted');
    }

    const task = taskRegistry.getTask(taskId);
    if (!task) return null;

    if (isTerminalTaskStatus(task.status)) return task;

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return taskRegistry.getTask(taskId) ?? null;
}

/**
 * 从任务中提取输出数据
 * 根据任务类型提取不同的输出信息
 * @param task 任务实例
 * @returns 任务输出数据
 */
async function getTaskOutputData(task: BaseTask): Promise<TaskOutputData> {
  const state = task.taskState;
  const progress = task.getProgress();
  let output = '';

  if (state.outputFile) {
    try {
      output = await readFile(state.outputFile, 'utf-8');
    } catch {
      output = '';
    }
  }

  if (!output) {
    const progressParts: string[] = [];
    if (progress.toolUseCount > 0) {
      progressParts.push(`Tool uses: ${progress.toolUseCount}`);
    }
    if (progress.tokenCount > 0) {
      progressParts.push(`Tokens: ${progress.tokenCount}`);
    }
    if (progress.lastActivity) {
      progressParts.push(`Last activity: ${progress.lastActivity.toolName}`);
    }
    if (progressParts.length > 0) {
      output = `(${progressParts.join(', ')})`;
    }
  }

  const baseOutput: TaskOutputData = {
    task_id: state.id,
    task_type: state.type,
    status: state.status,
    description: state.description,
    output,
    error: state.error,
  };

  if (state.type === 'local_bash') {
    const bashState = state as any;
    return {
      ...baseOutput,
      exitCode: bashState.result?.code ?? null,
    };
  }

  if (state.type === 'local_agent' || state.type === 'remote_agent') {
    const agentState = state as any;
    return {
      ...baseOutput,
      prompt: agentState.prompt || agentState.command,
      result: agentState.result?.output || baseOutput.output,
    };
  }

  return baseOutput;
}

/**
 * 任务输出工具
 * 允许获取正在运行或已完成任务的输出、状态和详细数据
 * 支持阻塞模式等待任务完成
 */
export class TaskOutputTool extends BaseTool<TaskOutputToolInput, TaskOutputToolOutput> {
  name = 'task_output';
  description = 'Get output from a running or completed task by its ID';

  params: ToolParam[] = [
    {
      name: 'task_id',
      type: 'string',
      description: 'The ID of the task to get output from',
      required: true,
    },
    {
      name: 'block',
      type: 'boolean',
      description: 'Whether to wait for task completion',
      required: false,
      default: true,
    },
    {
      name: 'timeout',
      type: 'number',
      description: 'Maximum wait time in milliseconds (0-600000)',
      required: false,
      default: 30000,
    },
  ];

  aliases = ['get_task_output', 'read_task_output'];
  searchHint = 'get task output logs read';
  maxResultSizeChars = 100000;

  isReadOnly(): boolean {
    return true;
  }

  isDestructive(): boolean {
    return false;
  }

  isConcurrencySafe(): boolean {
    return true;
  }

  interruptBehavior(): 'cancel' | 'block' {
    return 'cancel';
  }

  validateInput(input: TaskOutputToolInput): ValidationResult {
    if (!input.task_id || typeof input.task_id !== 'string') {
      return {
        result: false,
        message: 'task_id is required and must be a string',
        errorCode: 1,
      };
    }
    return { result: true };
  }

  userFacingName(input?: Partial<TaskOutputToolInput>): string {
    const taskId = input?.task_id || '';
    if (taskId) return `Task Output: ${taskId}`;
    return this.name;
  }

  getToolUseSummary(input?: Partial<TaskOutputToolInput>): string | null {
    const taskId = input?.task_id || '';
    if (taskId) return `Get output for task ${taskId}`;
    return null;
  }

  getActivityDescription(input?: Partial<TaskOutputToolInput>): string | null {
    const taskId = input?.task_id || '';
    if (taskId) return `Getting output for task ${taskId}`;
    return null;
  }

  toAutoClassifierInput(input: TaskOutputToolInput): unknown {
    return input.task_id;
  }

  async execute(
    input: TaskOutputToolInput,
    context: ToolUseContext,
    onProgress?: ToolCallProgress<any>
  ): Promise<ToolResult<TaskOutputToolOutput>> {
    const validation = this.validateInput(input);
    if (!validation.result) {
      return createToolResult(
        {
          retrieval_status: 'not_ready' as const,
          task: null,
        },
        {
          success: false,
          error: validation.message || 'Validation failed',
        }
      );
    }

    const { task_id } = input;
    const block = input.block !== false;
    const timeout = Math.min(Math.max(input.timeout || 30000, 0), 600000);

    try {
      const task = taskRegistry.getTask(task_id);
      if (!task) {
        return createToolResult(
          {
            retrieval_status: 'not_ready' as const,
            task: null,
          },
          {
            success: false,
            error: `No task found with ID: ${task_id}`,
          }
        );
      }

      if (!block) {
        const output = await getTaskOutputData(task);
        return createToolResult(
          {
            retrieval_status: isTerminalTaskStatus(task.status) ? 'success' : 'not_ready',
            task: output,
          },
          { success: true }
        );
      }

      if (onProgress) {
        onProgress({
          toolUseID: `task-output-waiting-${Date.now()}`,
          data: {
            type: 'waiting_for_task',
            taskDescription: task.taskState.description,
            taskType: task.taskState.type,
          },
        });
      }

      const completedTask = await waitForTaskCompletion(
        task_id,
        timeout,
        context.abortController?.signal
      );

      if (!completedTask) {
        return createToolResult(
          {
            retrieval_status: 'timeout' as const,
            task: null,
          },
          { success: false, error: `Task ${task_id} not found after wait` }
        );
      }

      const taskStatus = completedTask.status;
      if (!isTerminalTaskStatus(taskStatus)) {
        return createToolResult(
          {
            retrieval_status: 'timeout' as const,
            task: await getTaskOutputData(completedTask),
          },
          { success: true }
        );
      }

      return createToolResult(
        {
          retrieval_status: 'success' as const,
          task: await getTaskOutputData(completedTask),
        },
        { success: true }
      );
    } catch (error: any) {
      return createToolResult(
        {
          retrieval_status: 'timeout' as const,
          task: null,
        },
        {
          success: false,
          error: `Failed to get task output: ${error.message}`,
        }
      );
    }
  }
}

export default TaskOutputTool;

/**
 * 任务停止工具
 * 参考CC源码 cc_code/backend/tools/TaskTool/TaskStopTool.ts 实现
 * 提供停止正在运行任务的功能
 */

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
import { TaskStatus } from '@modules/tasks/types';

/**
 * 任务停止工具输入类型
 */
export interface TaskStopToolInput {
  /** 任务ID */
  task_id: string;
  /** 是否强制停止 */
  force?: boolean;
}

/**
 * 任务停止工具输出类型
 */
export interface TaskStopToolOutput {
  /** 任务ID */
  task_id: string;
  /** 停止前状态 */
  previous_status: string;
  /** 当前状态 */
  current_status: string;
  /** 是否成功 */
  success: boolean;
  /** 消息 */
  message: string;
}

/**
 * 任务停止工具
 */
export class TaskStopTool extends BaseTool<
  TaskStopToolInput,
  TaskStopToolOutput
> {
  name = 'task_stop';
  description = 'Stop a running task by its ID';

  params: ToolParam[] = [
    {
      name: 'task_id',
      type: 'string',
      description: 'The ID of the task to stop',
      required: true,
      default: '',
    },
    {
      name: 'force',
      type: 'boolean',
      description: 'Force stop the task (kill immediately)',
      required: false,
      default: false,
    },
  ];

  override aliases = ['stop_task', 'kill_task'];
  override searchHint = 'Stop a running task by its ID';
  override maxResultSizeChars = 10000;

  override isReadOnly(): boolean {
    return false;
  }

  override isDestructive(): boolean {
    return true;
  }

  override isConcurrencySafe(): boolean {
    return false;
  }

  override interruptBehavior(): 'cancel' | 'block' {
    return 'cancel';
  }

  override validateInput(input: TaskStopToolInput): ValidationResult {
    if (!input.task_id || typeof input.task_id !== 'string') {
      return {
        result: false,
        message: 'task_id is required and must be a string',
        errorCode: 1,
      };
    }

    return { result: true };
  }

  override userFacingName(input?: Partial<TaskStopToolInput>): string {
    const taskId = input?.task_id || '';
    if (taskId) {
      return `Task Stop: ${taskId}`;
    }
    return this.name;
  }

  override getToolUseSummary(input?: Partial<TaskStopToolInput>): string | null {
    const taskId = input?.task_id || '';
    if (taskId) {
      return `Stop task ${taskId}`;
    }
    return null;
  }

  override getActivityDescription(input?: Partial<TaskStopToolInput>): string | null {
    const taskId = input?.task_id || '';
    if (taskId) {
      return `Stopping task ${taskId}`;
    }
    return null;
  }

  override toAutoClassifierInput(input: TaskStopToolInput): unknown {
    return `stop ${input.task_id}`;
  }

  /**
   * 执行工具
   */
  async execute(
    input: TaskStopToolInput,
    context: ToolUseContext,
    onProgress?: ToolCallProgress<any>
  ): Promise<ToolResult<TaskStopToolOutput>> {
    const validation = this.validateInput(input);
    if (!validation.result) {
      return createToolResult(
        {
          task_id: input.task_id || '',
          previous_status: 'unknown',
          current_status: 'unknown',
          success: false,
          message: validation.message || 'Validation failed',
        },
        {
          success: false,
          error: validation.message,
        }
      );
    }

    try {
      const task = taskRegistry.getTask(input.task_id);

      if (!task) {
        const output: TaskStopToolOutput = {
          task_id: input.task_id,
          previous_status: 'not_found',
          current_status: 'not_found',
          success: false,
          message: `Task not found: ${input.task_id}`,
        };
        return createToolResult(output, {
          success: false,
          error: output.message,
        });
      }

      const previousStatus = task.status;

      // 检查任务是否已经在终端状态
      if (
        previousStatus === TaskStatus.COMPLETED ||
        previousStatus === TaskStatus.FAILED ||
        previousStatus === TaskStatus.KILLED
      ) {
        const output: TaskStopToolOutput = {
          task_id: input.task_id,
          previous_status: previousStatus,
          current_status: previousStatus,
          success: true,
          message: `Task ${input.task_id} is already in terminal state: ${previousStatus}`,
        };
        return createToolResult(output, {
          success: true,
          output: output.message,
        });
      }

      // 停止任务
      await taskRegistry.kill(input.task_id);

      // 重新获取任务状态
      const updatedTask = taskRegistry.getTask(input.task_id);
      const currentStatus = updatedTask?.status || TaskStatus.KILLED;

      const output: TaskStopToolOutput = {
        task_id: input.task_id,
        previous_status: previousStatus,
        current_status: currentStatus,
        success: true,
        message: `Task ${input.task_id} stopped successfully (was ${previousStatus}, now ${currentStatus})`,
      };

      return createToolResult(output, {
        success: true,
        output: output.message,
      });
    } catch (error: any) {
      const output: TaskStopToolOutput = {
        task_id: input.task_id,
        previous_status: 'unknown',
        current_status: 'error',
        success: false,
        message: `Failed to stop task ${input.task_id}: ${error.message}`,
      };
      return createToolResult(output, {
        success: false,
        error: output.message,
      });
    }
  }
}

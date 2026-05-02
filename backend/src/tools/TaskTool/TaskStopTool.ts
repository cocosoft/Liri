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
import { taskRegistry } from '../../tasks/TaskRegistry';
import { TaskStatus } from '../../tasks/types';

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

  aliases = ['stop_task', 'kill_task'];
  searchHint = 'Stop a running task by its ID';
  maxResultSizeChars = 10000;

  /**
   * 检查工具是否只读
   */
  isReadOnly(): boolean {
    return false;
  }

  /**
   * 检查工具是否破坏性操作
   */
  isDestructive(): boolean {
    return true;
  }

  /**
   * 检查工具是否并发安全
   */
  isConcurrencySafe(): boolean {
    return false;
  }

  /**
   * 获取中断行为策略
   */
  interruptBehavior(): 'cancel' | 'block' {
    return 'cancel';
  }

  /**
   * 验证输入
   */
  validateInput(input: TaskStopToolInput): ValidationResult {
    if (!input.task_id || typeof input.task_id !== 'string') {
      return {
        result: false,
        message: 'task_id is required and must be a string',
        errorCode: 1,
      };
    }

    return { result: true };
  }

  /**
   * 获取用户可见的工具名称
   */
  userFacingName(input?: Partial<TaskStopToolInput>): string {
    const taskId = input?.task_id || '';
    if (taskId) {
      return `Task Stop: ${taskId}`;
    }
    return this.name;
  }

  /**
   * 获取工具使用摘要
   */
  getToolUseSummary(input?: Partial<TaskStopToolInput>): string | null {
    const taskId = input?.task_id || '';
    if (taskId) {
      return `Stop task ${taskId}`;
    }
    return null;
  }

  /**
   * 获取活动描述
   */
  getActivityDescription(input?: Partial<TaskStopToolInput>): string | null {
    const taskId = input?.task_id || '';
    if (taskId) {
      return `Stopping task ${taskId}`;
    }
    return null;
  }

  /**
   * 获取工具用于自动分类器的输入
   */
  toAutoClassifierInput(input: TaskStopToolInput): unknown {
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

export default TaskStopTool;

/**
 * TaskUpdateTool - 更新任务
 */

import { Tool, ToolInfo, ValidationResult, ToolTag } from '../types/Tool';
import { ToolResult, createToolResult } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import { TASK_UPDATE_TOOL_NAME, TASK_UPDATE_DESCRIPTION } from './constants';
import type {
  TaskUpdateInput,
  TaskUpdateOutput,
  TaskStatus,
  TaskStorage,
} from './types';
import { defaultTaskStorage } from './TaskStorage';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'tools:TaskTool:TaskUpdateTool',
  level: LogLevel.INFO,
});

/**
 * TaskUpdateTool参数定义
 */
const TASK_UPDATE_PARAMS = [
  {
    name: 'id',
    type: 'string' as const,
    description: 'The ID of the task to update',
    required: true,
  },
  {
    name: 'status',
    type: 'string' as const,
    description:
      'New status: pending, in_progress, completed, failed, cancelled',
    required: false,
  },
  {
    name: 'subject',
    type: 'string' as const,
    description: 'New subject/title for the task',
    required: false,
  },
  {
    name: 'description',
    type: 'string' as const,
    description: 'New description for the task',
    required: false,
  },
  {
    name: 'activeForm',
    type: 'string' as const,
    description: 'New activeForm shown in spinner',
    required: false,
  },
  {
    name: 'priority',
    type: 'string' as const,
    description: 'New priority: low, medium, high, urgent',
    required: false,
  },
  {
    name: 'blockedBy',
    type: 'array' as const,
    description: 'Array of task IDs this task is blocked by',
    required: false,
  },
];

/**
 * 有效状态列表
 */
const VALID_STATUSES: TaskStatus[] = [
  'pending',
  'in_progress',
  'completed',
  'failed',
  'cancelled',
];

/**
 * TaskUpdateTool实现
 */
export class TaskUpdateTool implements Tool {
  /** 工具名称 */
  readonly name: string = TASK_UPDATE_TOOL_NAME;

  /** 工具描述 */
  readonly description: string = TASK_UPDATE_DESCRIPTION;

  /** 工具参数 */
  readonly params = TASK_UPDATE_PARAMS;

  /** 搜索提示 */
  readonly searchHint?: string = 'update task status';

  /** 任务存储 */
  private storage: TaskStorage;

  /**
   * 构造函数
   * @param storage 任务存储
   */
  constructor(storage: TaskStorage = defaultTaskStorage) {
    this.storage = storage;
  }

  /**
   * 获取工具信息
   */
  getInfo(): ToolInfo {
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
      interruptBehavior: 'block',
      tags: [ToolTag.WRITE],
    };
  }

  /**
   * 检查工具是否启用
   */
  isEnabled(): boolean {
    return true;
  }

  /**
   * 检查工具是否只读
   */
  isReadOnly(_input?: Record<string, unknown>): boolean {
    return false;
  }

  /**
   * 检查工具是否有破坏性
   */
  isDestructive(_input?: Record<string, unknown>): boolean {
    return false;
  }

  /**
   * 检查工具是否并发安全
   */
  isConcurrencySafe(_input?: Record<string, unknown>): boolean {
    return true;
  }

  /**
   * 验证输入参数
   */
  validateInput(input: Record<string, unknown>): ValidationResult {
    if (!input.id || typeof input.id !== 'string') {
      return {
        result: false,
        message: 'id is required and must be a string',
        errorCode: 400,
      };
    }

    if (input.status && !VALID_STATUSES.includes(input.status as TaskStatus)) {
      return {
        result: false,
        message: `status must be one of: ${VALID_STATUSES.join(', ')}`,
        errorCode: 400,
      };
    }

    return { result: true };
  }

  /**
   * 执行更新任务
   * @param input 输入
   * @param _context 执行上下文
   */
  async execute(
    input: Record<string, unknown>,
    _context?: ToolUseContext
  ): Promise<ToolResult> {
    const validation = this.validateInput(input);
    if (!validation.result) {
      return createToolResult(null, {
        newMessages: [
          {
            role: 'system',
            content: `Error: ${validation.message}`,
          },
        ],
      });
    }

    const taskInput = input as unknown as TaskUpdateInput;
    const startTime = Date.now();

    try {
      const existingTask = await this.storage.get(taskInput.id);
      if (!existingTask) {
        return createToolResult(null, {
          newMessages: [
            {
              role: 'system',
              content: `Error: Task with id ${taskInput.id} not found`,
            },
          ],
        });
      }

      const updates: Partial<import('./types').Task> = {};

      if (taskInput.status) {
        updates.status = taskInput.status;
      }
      if (taskInput.subject !== undefined) {
        updates.subject = taskInput.subject;
      }
      if (taskInput.description !== undefined) {
        updates.description = taskInput.description;
      }
      if (taskInput.activeForm !== undefined) {
        updates.activeForm = taskInput.activeForm;
      }
      if (taskInput.priority !== undefined) {
        updates.priority = taskInput.priority as import('./types').TaskPriority;
      }
      if (taskInput.blockedBy !== undefined) {
        updates.blockedBy = taskInput.blockedBy;
      }
      if (taskInput.metadata !== undefined) {
        updates.metadata = taskInput.metadata;
      }

      const updatedTask = await this.storage.update(taskInput.id, updates);

      const output: TaskUpdateOutput = {
        task: {
          id: updatedTask.id,
          subject: updatedTask.subject,
          status: updatedTask.status,
        },
      };

      return createToolResult(JSON.stringify(output), {
        newMessages: [
          {
            role: 'system',
            content: `Successfully updated task ${updatedTask.id}`,
          },
        ],
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      return createToolResult(null, {
        newMessages: [
          {
            role: 'system',
            content: `Error: ${errorMessage}`,
          },
        ],
      });
    }
  }
}

/**
 * 创建TaskUpdateTool实例
 */
export function createTaskUpdateTool(storage?: TaskStorage): TaskUpdateTool {
  return new TaskUpdateTool(storage);
}

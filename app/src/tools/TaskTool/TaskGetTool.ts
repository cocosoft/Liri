/**
 * TaskGetTool - 获取任务详情
 */

import { Tool, ToolInfo, ValidationResult, ToolTag } from '../types/Tool';
import { ToolResult } from '../types/ToolResult';
import { createToolResult } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import { TASK_GET_TOOL_NAME, TASK_GET_DESCRIPTION } from './constants';
import type { TaskOutput, TaskStorage } from './types';
import { defaultTaskStorage } from './TaskStorage';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'tools:TaskTool:TaskGetTool',
  level: LogLevel.INFO,
});

/**
 * TaskGetTool参数定义
 */
const TASK_GET_PARAMS = [
  {
    name: 'id',
    type: 'string' as const,
    description: 'The ID of the task to get',
    required: true,
  },
];

/**
 * TaskGetTool实现
 */
export class TaskGetTool implements Tool {
  /** 工具名称 */
  readonly name: string = TASK_GET_TOOL_NAME;

  /** 工具描述 */
  readonly description: string = TASK_GET_DESCRIPTION;

  /** 工具参数 */
  readonly params = TASK_GET_PARAMS;

  /** 搜索提示 */
  readonly searchHint?: string = 'get task details';

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
      readOnly: true,
      destructive: false,
      concurrencySafe: true,
      deferred: false,
      alwaysLoad: false,
      interruptBehavior: 'block',
      tags: [ToolTag.READ],
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
    return true;
  }

  /**
   * 检查工具是否并发安全
   */
  isConcurrencySafe(_input?: Record<string, unknown>): boolean {
    return true;
  }

  /**
   * 检查工具是否有破坏性
   */
  isDestructive(_input?: Record<string, unknown>): boolean {
    return false;
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

    return { result: true };
  }

  /**
   * 执行获取任务
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

    const taskId = input.id as string;
    const startTime = Date.now();

    try {
      const task = await this.storage.get(taskId);

      if (!task) {
        return createToolResult(null, {
          newMessages: [
            {
              role: 'system',
              content: `Error: Task with id ${taskId} not found`,
            },
          ],
        });
      }

      const output: TaskOutput = {
        id: task.id,
        subject: task.subject,
        status: task.status,
        description: task.description,
        activeForm: task.activeForm,
        priority: task.priority,
        blockedBy: task.blockedBy,
        owner: task.owner,
        metadata: task.metadata,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      };

      return createToolResult(JSON.stringify(output), {
        newMessages: [
          {
            role: 'system',
            content: `Successfully retrieved task ${taskId}`,
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
 * 创建TaskGetTool实例
 */
export function createTaskGetTool(storage?: TaskStorage): TaskGetTool {
  return new TaskGetTool(storage);
}

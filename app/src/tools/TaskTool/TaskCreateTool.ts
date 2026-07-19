/**
 * TaskCreateTool - 创建任务
 *
 * 参考CC源码实现: cc_code/backend/tools/TaskCreateTool/TaskCreateTool.ts
 */

import { Tool, ToolInfo, ValidationResult, ToolTag } from '../types/Tool';
import { ToolResult, createToolResult } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import { TASK_CREATE_TOOL_NAME, TASK_CREATE_DESCRIPTION } from './constants';
import type { TaskCreateInput, TaskCreateOutput, TaskStorage } from './types';
import { defaultTaskStorage } from './TaskStorage';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'tools:TaskTool:TaskCreateTool',
  level: LogLevel.INFO,
});

/**
 * TaskCreateTool参数定义
 */
const TASK_CREATE_PARAMS = [
  {
    name: 'subject',
    type: 'string' as const,
    description: 'A brief title for the task',
    required: true,
  },
  {
    name: 'description',
    type: 'string' as const,
    description: 'What needs to be done',
    required: false,
  },
  {
    name: 'activeForm',
    type: 'string' as const,
    description:
      'Present continuous form shown in spinner when in_progress (e.g., "Running tests")',
    required: false,
  },
  {
    name: 'metadata',
    type: 'object' as const,
    description: 'Arbitrary metadata to attach to the task',
    required: false,
  },
];

/**
 * TaskCreateTool实现
 */
export class TaskCreateTool implements Tool {
  /** 工具名称 */
  readonly name: string = TASK_CREATE_TOOL_NAME;

  /** 工具描述 */
  readonly description: string = TASK_CREATE_DESCRIPTION;

  /** 工具参数 */
  readonly params = TASK_CREATE_PARAMS;

  /** 搜索提示 */
  readonly searchHint?: string = 'create task todo';

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
    if (!input.subject || typeof input.subject !== 'string') {
      return {
        result: false,
        message: 'subject is required and must be a string',
        errorCode: 400,
      };
    }

    if (input.subject.length > 500) {
      return {
        result: false,
        message: 'subject must be 500 characters or less',
        errorCode: 400,
      };
    }

    return { result: true };
  }

  /**
   * 获取用户可见的工具名称
   */
  userFacingName(input?: Partial<Record<string, unknown>>): string {
    const subject = (input?.subject as string) || '';
    if (subject) {
      return `Create Task: ${subject}`;
    }
    return this.name;
  }

  /**
   * 获取活动描述
   */
  getActivityDescription(
    input?: Partial<Record<string, unknown>>
  ): string | null {
    const subject = (input?.subject as string) || '';
    if (subject) {
      return `Creating task: ${subject}`;
    }
    return null;
  }

  /**
   * 获取工具使用摘要
   */
  getToolUseSummary(input?: Partial<Record<string, unknown>>): string | null {
    const subject = (input?.subject as string) || '';
    if (subject) {
      return `Create task: ${subject}`;
    }
    return null;
  }

  /**
   * 执行创建任务
   * @param input 任务输入
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

    const taskInput = input as unknown as TaskCreateInput;
    const startTime = Date.now();

    try {
      const task = await this.storage.create({
        subject: taskInput.subject,
        description: taskInput.description,
        activeForm: taskInput.activeForm,
        status: 'pending',
        blockedBy: [],
        metadata: taskInput.metadata,
      });

      const output: TaskCreateOutput = {
        task: {
          id: task.id,
          subject: task.subject,
        },
      };

      return createToolResult(JSON.stringify(output), {
        newMessages: [
          {
            role: 'system',
            content: `Successfully created task ${task.id}`,
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
 * 创建TaskCreateTool实例
 */
export function createTaskCreateTool(storage?: TaskStorage): TaskCreateTool {
  return new TaskCreateTool(storage);
}

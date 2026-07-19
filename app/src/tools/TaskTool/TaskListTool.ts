/**
 * TaskListTool - 列出任务
 *
 * 参考CC源码实现: cc_code/backend/tools/TaskListTool/TaskListTool.ts
 */

import { Tool, ToolInfo, ToolTag } from '../types/Tool';
import { ToolResult, createToolResult } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import { TASK_LIST_TOOL_NAME, TASK_LIST_DESCRIPTION } from './constants';
import type { TaskListOutput, TaskStorage } from './types';
import { defaultTaskStorage } from './TaskStorage';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'tools:TaskTool:TaskListTool',
  level: LogLevel.INFO,
});

/**
 * TaskListTool实现
 */
export class TaskListTool implements Tool {
  /** 工具名称 */
  readonly name: string = TASK_LIST_TOOL_NAME;

  /** 工具描述 */
  readonly description: string = TASK_LIST_DESCRIPTION;

  /** 工具参数 */
  readonly params = [];

  /** 搜索提示 */
  readonly searchHint?: string = 'list tasks todos';

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
   * 执行列出任务
   * @param _input 输入
   * @param _context 执行上下文
   */
  async execute(
    _input: Record<string, unknown>,
    _context?: ToolUseContext
  ): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      const allTasks = await this.storage.list();

      const tasks = allTasks
        .filter((t) => !t.metadata?._internal)
        .map((task) => ({
          id: task.id,
          subject: task.subject,
          status: task.status,
          owner: task.owner,
          blockedBy: task.blockedBy || [],
        }));

      const output: TaskListOutput = { tasks };

      return createToolResult(JSON.stringify(output), {
        newMessages: [
          {
            role: 'system',
            content: `Successfully retrieved ${tasks.length} tasks`,
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
 * 创建TaskListTool实例
 */
export function createTaskListTool(storage?: TaskStorage): TaskListTool {
  return new TaskListTool(storage);
}

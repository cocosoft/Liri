/**
 * TaskStopTool - 停止运行中的后台任务
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { ErrorCodes } from '@modules/error';
import { z } from 'zod';
import { Text, Box } from '@modules/ink';
import type { Tool } from '../types/index.js';
import { buildTool, type ToolDef } from '../BaseTool.js';
import type { ValidationResult } from '../types/index.js';
import { jsonStringify } from '@modules/utils/json.js';

const TASK_STOP_TOOL_NAME = 'TaskStop';

const DESCRIPTION = `
- Stops a running background task by its ID
- Takes a task_id parameter identifying the task to stop
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task
`;

/**
 * 输入模式
 */
const inputSchema = z.strictObject({
  task_id: z.string().optional().describe('要停止的后台任务的ID'),
  shell_id: z.string().optional().describe('Deprecated: use task_id instead'),
});

type InputSchema = z.infer<typeof inputSchema>;

/**
 * 输出模式
 */
const outputSchema = z.object({
  message: z.string().describe('关于操作的状态消息'),
  task_id: z.string().describe('被停止的任务的ID'),
  task_type: z.string().describe('被停止的任务的类型'),
  command: z.string().optional().describe('被停止的任务的命令或描述'),
});

type OutputSchema = z.infer<typeof outputSchema>;

interface StopTaskResult {
  taskId: string;
  taskType: string;
  command?: string;
}

interface TaskInfo {
  id: string;
  type: string;
  command?: string;
  status: 'running' | 'stopped' | 'completed' | 'failed';
}

const runningTasks: Map<string, TaskInfo> = new Map();

/**
 * 注册任务
 */
export function registerTask(task: TaskInfo): void {
  runningTasks.set(task.id, task);
}

/**
 * 取消注册任务
 */
export function unregisterTask(taskId: string): void {
  runningTasks.delete(taskId);
}

/**
 * 获取所有运行中的任务
 */
export function getRunningTasks(): TaskInfo[] {
  return Array.from(runningTasks.values()).filter(
    (task) => task.status === 'running'
  );
}

/**
 * 停止任务
 */
async function stopTask(
  taskId: string,
  _getAppState?: () => any,
  _setAppState?: (state: any) => void
): Promise<StopTaskResult> {
  const task = runningTasks.get(taskId);

  if (!task) {
    throw new AppError(
      ErrorCodes.ENTITY_NOT_FOUND.message,
      ErrorCategory.VALIDATION,
      ErrorSeverity.MEDIUM,
      'TASK_NOT_FOUND',
      { taskId }
    );
  }

  if (task.status !== 'running') {
    throw new AppError(
      ErrorCodes.INVALID_STATE.message,
      ErrorCategory.VALIDATION,
      ErrorSeverity.MEDIUM,
      'TASK_NOT_RUNNING',
      { taskId, status: task.status }
    );
  }

  task.status = 'stopped';
  runningTasks.delete(taskId);

  return {
    taskId: task.id,
    taskType: task.type,
    command: task.command,
  };
}

/**
 * TaskStopTool
 */
export const TaskStopTool: Tool<InputSchema, OutputSchema> = buildTool({
  name: TASK_STOP_TOOL_NAME,
  searchHint: 'kill a running background task',
  aliases: ['KillShell'],
  maxResultSizeChars: 100000,
  shouldDefer: true,

  description: 'Stop a running background task by ID',

  prompt() {
    return DESCRIPTION;
  },

  get inputSchema() {
    return inputSchema as any;
  },

  get outputSchema() {
    return outputSchema as any;
  },

  userFacingName() {
    return 'Stop Task';
  },

  isConcurrencySafe() {
    return true;
  },

  toAutoClassifierInput(input) {
    return input.task_id ?? input.shell_id ?? '';
  },

  validateInput(input: InputSchema): ValidationResult {
    const { task_id, shell_id } = input;
    const id = task_id ?? shell_id;

    if (!id) {
      return {
        result: false,
        message: 'Missing required parameter: task_id',
        errorCode: 1,
      };
    }

    const task = runningTasks.get(id);

    if (!task) {
      return {
        result: false,
        message: `No task found with ID: ${id}`,
        errorCode: 1,
      };
    }

    if (task.status !== 'running') {
      return {
        result: false,
        message: `Task ${id} is not running (status: ${task.status})`,
        errorCode: 3,
      };
    }

    return { result: true };
  },

  renderToolUseMessage() {
    return null;
  },

  renderToolResultMessage(
    {
      message,
      task_id,
      task_type,
    }: {
      message: string;
      task_id: string;
      task_type: string;
      command?: string;
    },
    _toolUseId: string
  ) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="green">✓ {message}</Text>
        <Text color="inactive">
          Stopped {task_type} task: {task_id}
        </Text>
      </Box>
    );
  },

  renderToolUseRejectedMessage() {
    return (
      <Box flexDirection="row" marginTop={1}>
        <Text color="yellow">⚠ </Text>
        <Text>User declined to stop the task</Text>
      </Box>
    );
  },

  renderToolUseErrorMessage() {
    return null;
  },

  async call({ task_id, shell_id }, _context) {
    const id = task_id ?? shell_id;

    if (!id) {
      throw new AppError(
        ErrorCodes.INVALID_INPUT.message,
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM,
        'MISSING_TASK_ID'
      );
    }

    const result = await stopTask(id);

    return {
      data: {
        message: `Successfully stopped task: ${result.taskId} (${result.taskType})`,
        task_id: result.taskId,
        task_type: result.taskType,
        command: result.command,
      },
    };
  },

  mapToolResultToToolResultBlockParam(content, toolUseId) {
    return {
      tool_use_id: toolUseId,
      type: 'tool_result',
      content: jsonStringify(content),
    };
  },
});

export { TASK_STOP_TOOL_NAME };
export type { InputSchema, OutputSchema, TaskInfo, StopTaskResult };

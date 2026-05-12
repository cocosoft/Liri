/**
 * Cron创建工具
 * 基于CC源码 cc_code/backend/tools/ScheduleCronTool/CronCreateTool.ts 实现
 */

import { Tool } from '../types/Tool';
import { ToolResult } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import { ToolUtils } from '../utils/ToolUtils';
import {
  addCronTask,
  listAllCronTasks,
  nextCronRunMs,
} from '@modules/chronos/CronTasks';
import { cronToHuman, parseCronExpression } from '@modules/chronos/cron';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * 最大任务数量限制
 */
const MAX_JOBS = 50;

/**
 * Cron创建工具类
 */
export class CronCreateTool {
  /**
   * 创建Cron创建工具实例
   * @returns Cron创建工具实例
   */
  static create(): Tool {
    return {
      name: 'cron_create',
      description: 'Create a recurring or one-shot scheduled prompt',
      params: [
        {
          name: 'cron',
          type: 'string',
          description:
            'Standard 5-field cron expression in local time: "M H DoM Mon DoW" (e.g. "*/5 * * * *" = every 5 minutes)',
          required: true,
          example: '*/5 * * * *',
        },
        {
          name: 'prompt',
          type: 'string',
          description: 'The prompt to enqueue at each fire time',
          required: true,
          example: 'Check the project status',
        },
        {
          name: 'recurring',
          type: 'boolean',
          description:
            'true = fire on every cron match until deleted. false = fire once then auto-delete',
          required: false,
          default: true,
        },
        {
          name: 'durable',
          type: 'boolean',
          description:
            'true = persist to file and survive restarts. false = in-memory only',
          required: false,
          default: false,
        },
      ],
      aliases: ['schedule', 'cron_add'],
      searchTips: ['cron', 'schedule', 'recurring', 'reminder', 'timer'],
      isEnabled: () => true,
      isReadOnly: (_input?: Record<string, unknown>) => false,
      isDestructive: (_input?: Record<string, unknown>) => false,
      isConcurrencySafe: (_input?: Record<string, unknown>) => true,
      validateInput: (input) => {
        const cron = input.cron as string;
        if (!cron || typeof cron !== 'string') {
          return { result: false, message: 'cron expression is required' };
        }
        if (!parseCronExpression(cron)) {
          return { result: false, message: 'Invalid cron expression' };
        }
        if (nextCronRunMs(cron, Date.now()) === null) {
          return {
            result: false,
            message: 'Cron expression produces no future runs',
          };
        }
        if (!input.prompt || typeof input.prompt !== 'string') {
          return { result: false, message: 'prompt is required' };
        }
        return { result: true };
      },
      checkPermissions: async (input, context) => {
        return { behavior: 'allow' };
      },
      execute: async (input, context) => {
        const startTime = Date.now();
        const cron = input.cron as string;
        const prompt = input.prompt as string;
        const recurring = (input.recurring as boolean) ?? true;
        const durable = (input.durable as boolean) ?? false;

        try {
          const tasks = await listAllCronTasks();
          if (tasks.length >= MAX_JOBS) {
            throw new AppError(
              `Too many scheduled jobs (max ${MAX_JOBS}). Cancel one first.`
            , ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
          }

          const id = await addCronTask(cron, prompt, recurring, durable);

          const executionTime = ToolUtils.calculateExecutionTime(startTime);
          const humanSchedule = cronToHuman(cron);

          return ToolUtils.createSuccessResult(
            {
              id,
              humanSchedule,
              recurring,
              durable,
            },
            {
              executionTime,
              output: `Scheduled ${recurring ? 'recurring' : 'one-shot'} job ${id} (${humanSchedule}). ${durable ? 'Persisted to file' : 'Session-only'}`,
              toolName: 'cron_create',
              executionId: ToolUtils.generateExecutionId('cron_create'),
              timestamp: Date.now(),
            }
          );
        } catch (error) {
          const executionTime = ToolUtils.calculateExecutionTime(startTime);
          return ToolUtils.createFailureResult(
            error instanceof Error ? error.message : 'Unknown error',
            {
              executionTime,
              errorOutput: error instanceof Error ? error.stack || '' : '',
              toolName: 'cron_create',
              executionId: ToolUtils.generateExecutionId('cron_create'),
              timestamp: Date.now(),
            }
          );
        }
      },
      getInfo: function () {
        return {
          name: this.name,
          description: this.description,
          params: this.params,
          aliases: this.aliases,
          searchTips: this.searchTips,
          enabled: true,
          readOnly: false,
          destructive: false,
          concurrencySafe: true,
          deferred: false,
          alwaysLoad: false,
          interruptBehavior: 'block',
        };
      },
    };
  }
}

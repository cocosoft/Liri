/**
 * Cron删除工具
 * 基于CC源码 cc_code/backend/tools/ScheduleCronTool/CronDeleteTool.ts 实现
 */

import { Tool } from '../types/Tool';
import { ToolResult } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import { ToolUtils } from '../utils/ToolUtils';
import { listAllCronTasks, removeCronTasks } from '@modules/chronos/CronTasks';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * Cron删除工具类
 */
export class CronDeleteTool {
  /**
   * 创建Cron删除工具实例
   * @returns Cron删除工具实例
   */
  static create(): Tool {
    return {
      name: 'cron_delete',
      description: 'Cancel a scheduled cron job',
      params: [
        {
          name: 'id',
          type: 'string',
          description: 'Job ID returned by cron_create',
          required: true,
          example: 'abc123',
        },
      ],
      aliases: ['cron_cancel', 'unschedule'],
      searchTips: ['cron', 'delete', 'cancel', 'unschedule', 'remove'],
      isEnabled: () => true,
      isReadOnly: (_input?: Record<string, unknown>) => false,
      isDestructive: (_input?: Record<string, unknown>) => true,
      isConcurrencySafe: (_input?: Record<string, unknown>) => true,
      validateInput: (input: Record<string, unknown>) => {
        if (!input.id || typeof input.id !== 'string') {
          return {
            result: false,
            message: 'id is required and must be a string',
          };
        }
        return { result: true };
      },
      checkPermissions: async (
        input: Record<string, unknown>,
        context: ToolUseContext
      ) => {
        return { behavior: 'allow' };
      },
      execute: async (
        input: Record<string, unknown>,
        context: ToolUseContext
      ) => {
        const startTime = Date.now();
        const id = input.id as string;

        try {
          const tasks = await listAllCronTasks();
          const task = tasks.find((t) => t.id === id);
          if (!task) {
            throw new AppError(
              `No scheduled job with id '${id}'`,
              ErrorCategory.EXECUTION,
              ErrorSeverity.HIGH,
              '1000'
            );
          }

          await removeCronTasks([id]);

          const executionTime = ToolUtils.calculateExecutionTime(startTime);
          return ToolUtils.createSuccessResult(
            { id },
            {
              executionTime,
              output: `Cancelled job ${id}.`,
              toolName: 'cron_delete',
              executionId: ToolUtils.generateExecutionId('cron_delete'),
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
              toolName: 'cron_delete',
              executionId: ToolUtils.generateExecutionId('cron_delete'),
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
          destructive: true,
          concurrencySafe: true,
          deferred: false,
          alwaysLoad: false,
          interruptBehavior: 'block',
        };
      },
    };
  }
}

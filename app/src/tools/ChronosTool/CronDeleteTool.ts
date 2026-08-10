/**
 * Cron删除工具 - 接入新 CronJobStore
 */

import { Tool } from '../types/Tool';
import { ToolUseContext } from '../types/ToolUseContext';
import { ToolUtils } from '../utils/ToolUtils';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools\ChronosTool\CronDeleteTool');

export class CronDeleteTool {
  static create(): Tool {
    return {
      name: 'cron_delete',
      description: 'Cancel/delete a scheduled cron task by ID',
      params: [
        {
          name: 'id',
          type: 'string',
          description: 'Task ID returned by cron_create or shown in cron_list',
          required: true,
          example: 'cron-1234567890-abc123',
        },
      ],
      aliases: ['cron_cancel', 'unschedule', 'delete_task'],
      searchTips: ['cron', 'delete', 'cancel', 'unschedule', 'remove'],
      isEnabled: () => true,
      isReadOnly: () => false,
      isDestructive: () => true,
      isConcurrencySafe: () => true,
      validateInput: (input: Record<string, unknown>) => {
        if (!input.id || typeof input.id !== 'string') {
          return { result: false, message: 'id is required (string)' };
        }
        return { result: true };
      },
      checkPermissions: async () => ({ behavior: 'allow' as const }),
      execute: async (
        input: Record<string, unknown>,
        _context: ToolUseContext
      ) => {
        const startTime = Date.now();
        const id = input.id as string;
        try {
          const { CronJobStore } =
            await import('@modules/tasks/cron/CronJobStore');
          const { resolveDbPath } = await import('@modules/core/paths');
          const store = new CronJobStore(resolveDbPath());
          await store.init();

          const existing = await store.getJob(id);
          if (!existing) {
            await store.close();
            throw new AppError(
              `No task with id "${id}"`,
              ErrorCategory.EXECUTION,
              ErrorSeverity.HIGH,
              '1000'
            );
          }

          await store.deleteJob(id);
          await store.close();

          const executionTime = ToolUtils.calculateExecutionTime(startTime);
          return ToolUtils.createSuccessResult(
            { id, name: existing.name },
            {
              executionTime,
              output: `Deleted task "${existing.name}" (${id}).`,
              toolName: 'cron_delete',
              executionId: ToolUtils.generateExecutionId('cron_delete'),
              timestamp: Date.now(),
            }
          );
        } catch (error) {
          const executionTime = ToolUtils.calculateExecutionTime(startTime);
          const msg =
            error instanceof AppError
              ? error.message
              : error instanceof Error
                ? error.message
                : 'Unknown error';
          return ToolUtils.createFailureResult(msg, {
            executionTime,
            errorOutput: error instanceof Error ? error.stack || '' : '',
            toolName: 'cron_delete',
            executionId: ToolUtils.generateExecutionId('cron_delete'),
            timestamp: Date.now(),
          });
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
          interruptBehavior: 'block' as const,
        };
      },
    };
  }
}

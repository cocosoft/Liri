/**
 * Cron暂停/恢复工具 — P1-8 Agent 自调度能力补齐
 *
 * 对标优化方案 §二 P1-8：Agent 可通过此工具暂停或恢复定时任务。
 * 调用 CronJobStore.pauseJob() / resumeJob()，含状态流转守卫。
 */
import { Tool } from '../types/Tool';
import { ToolUseContext } from '../types/ToolUseContext';
import { ToolUtils } from '../utils/ToolUtils';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'tools:ChronosTool:CronStopTool',
  level: LogLevel.INFO,
});

export class CronStopTool {
  static create(): Tool {
    return {
      name: 'cron_stop',
      description:
        'Pause or resume a scheduled cron task by ID. Paused tasks will not fire until resumed.',
      params: [
        {
          name: 'id',
          type: 'string',
          description: 'Task ID returned by cron_create or shown in cron_list',
          required: true,
          example: 'cron-1234567890-abc123',
        },
        {
          name: 'action',
          type: 'string',
          description:
            '"pause" to temporarily stop the task, "resume" to restart a paused task',
          required: true,
          example: 'pause',
        },
      ],
      aliases: ['cron_pause', 'cron_resume', 'stop_task', 'pause_task'],
      searchTips: ['cron', 'pause', 'resume', 'stop', 'toggle'],
      isEnabled: () => true,
      isReadOnly: () => false,
      isDestructive: () => false,
      isConcurrencySafe: () => true,
      validateInput: (input: Record<string, unknown>) => {
        if (!input.id || typeof input.id !== 'string') {
          return { result: false, message: 'id is required (string)' };
        }
        const action = input.action as string;
        if (action !== 'pause' && action !== 'resume') {
          return {
            result: false,
            message: 'action must be "pause" or "resume"',
          };
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
        const action = (input.action as string)?.trim().toLowerCase();
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

          if (action === 'pause') {
            if (existing.state === 'paused') {
              await store.close();
              return ToolUtils.createSuccessResult(
                { id, name: existing.name, state: 'paused' },
                {
                  executionTime: ToolUtils.calculateExecutionTime(startTime),
                  output: `Task "${existing.name}" is already paused.`,
                  toolName: 'cron_stop',
                  executionId: ToolUtils.generateExecutionId('cron_stop'),
                  timestamp: Date.now(),
                }
              );
            }
            await store.pauseJob(
              id,
              'Agent requested pause via cron_stop tool'
            );
            await store.close();

            return ToolUtils.createSuccessResult(
              { id, name: existing.name, state: 'paused' },
              {
                executionTime: ToolUtils.calculateExecutionTime(startTime),
                output: `Paused task "${existing.name}" (${id}). It will not fire until resumed.`,
                toolName: 'cron_stop',
                executionId: ToolUtils.generateExecutionId('cron_stop'),
                timestamp: Date.now(),
              }
            );
          } else {
            // resume
            if (existing.state !== 'paused') {
              await store.close();
              return ToolUtils.createSuccessResult(
                { id, name: existing.name, state: existing.state },
                {
                  executionTime: ToolUtils.calculateExecutionTime(startTime),
                  output: `Task "${existing.name}" is not paused (current state: ${existing.state}).`,
                  toolName: 'cron_stop',
                  executionId: ToolUtils.generateExecutionId('cron_stop'),
                  timestamp: Date.now(),
                }
              );
            }

            // 计算下一个运行时间
            let nextRunAt = '';
            try {
              const { computeNextCronRun } =
                await import('@modules/tasks/cron/CronParser');
              if (
                existing.schedule?.kind === 'interval' &&
                existing.schedule.minutes
              ) {
                const nextMs =
                  Date.now() + existing.schedule.minutes * 60 * 1000;
                nextRunAt = new Date(nextMs).toISOString();
              } else if (
                existing.schedule?.kind === 'cron' &&
                existing.schedule.expr
              ) {
                const next = computeNextCronRun(
                  existing.schedule.expr,
                  Date.now()
                );
                if (next) nextRunAt = next;
              }
            } catch {
              nextRunAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // fallback: 5min
            }

            await store.resumeJob(id, nextRunAt);
            await store.close();

            return ToolUtils.createSuccessResult(
              { id, name: existing.name, state: 'scheduled', nextRunAt },
              {
                executionTime: ToolUtils.calculateExecutionTime(startTime),
                output: `Resumed task "${existing.name}" (${id}). Next run: ${nextRunAt ? new Date(nextRunAt).toLocaleString() : 'pending recalculation'}.`,
                toolName: 'cron_stop',
                executionId: ToolUtils.generateExecutionId('cron_stop'),
                timestamp: Date.now(),
              }
            );
          }
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
            toolName: 'cron_stop',
            executionId: ToolUtils.generateExecutionId('cron_stop'),
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
          destructive: false,
          concurrencySafe: true,
          deferred: false,
          alwaysLoad: false,
          interruptBehavior: 'block' as const,
        };
      },
    };
  }
}

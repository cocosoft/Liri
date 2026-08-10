/**
 * Cron创建工具 - 接入新 CronJobStore
 * AI 可通过此工具在聊天中创建定时任务
 */

import { Tool } from '../types/Tool';
import { ToolUseContext } from '../types/ToolUseContext';
import { ToolUtils } from '../utils/ToolUtils';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:ChronosTool:CronCreateTool');

const MAX_JOBS = 50;

export class CronCreateTool {
  static create(): Tool {
    return {
      name: 'cron_create',
      description:
        'Create a recurring or one-shot scheduled cron task. The task will execute at the specified schedule using the AI engine.',
      params: [
        {
          name: 'name',
          type: 'string',
          description: 'A short name for this cron task',
          required: true,
          example: 'Heartbeat Check',
        },
        {
          name: 'expression',
          type: 'string',
          description:
            'Standard 5-field cron expression: "min hour day month weekday". Examples: "*/30 * * * *" (every 30min), "0 8 * * *" (daily 8am), "0 9 * * 1" (Mon 9am)',
          required: true,
          example: '*/30 * * * *',
        },
        {
          name: 'prompt',
          type: 'string',
          description:
            'The instruction content to execute at each fire time. This is sent to the AI engine for execution.',
          required: true,
          example: 'Check the system health status and report any issues.',
        },
        {
          name: 'schedule_mode',
          type: 'string',
          description:
            'Schedule mode: "cron" for cron expression, "every" for interval mode (use every_value/every_unit), "at" for fixed time (use at_hour/at_minute)',
          required: false,
          default: 'cron',
        },
        {
          name: 'every_value',
          type: 'number',
          description:
            'For interval mode: how many units between runs (e.g. 30)',
          required: false,
        },
        {
          name: 'every_unit',
          type: 'string',
          description: 'For interval mode: "minutes", "hours", or "days"',
          required: false,
        },
        {
          name: 'at_hour',
          type: 'string',
          description: 'For at-time mode: hour of day (0-23)',
          required: false,
        },
        {
          name: 'at_minute',
          type: 'string',
          description: 'For at-time mode: minute (0-59)',
          required: false,
        },
        {
          name: 'description',
          type: 'string',
          description: 'Optional description for this task',
          required: false,
        },
        {
          name: 'silent',
          type: 'boolean',
          description: 'If true, skip notification on task completion',
          required: false,
          default: false,
        },
      ],
      aliases: ['schedule', 'cron_add', 'create_task', 'timer'],
      searchTips: [
        'cron',
        'schedule',
        'recurring',
        'reminder',
        'timer',
        'task',
      ],
      isEnabled: () => true,
      isReadOnly: () => false,
      isDestructive: () => false,
      isConcurrencySafe: () => true,
      validateInput: (input: Record<string, unknown>) => {
        const name = (input.name as string)?.trim();
        if (!name) {
          return { result: false, message: 'name is required' };
        }
        const prompt = (input.prompt as string)?.trim();
        if (!prompt) {
          return { result: false, message: 'prompt is required' };
        }
        if (
          (input.schedule_mode as string) !== 'every' &&
          (input.schedule_mode as string) !== 'at'
        ) {
          const expr = (input.expression as string)?.trim();
          if (!expr) {
            return {
              result: false,
              message: 'expression is required for cron mode',
            };
          }
        }
        return { result: true };
      },
      checkPermissions: async () => ({ behavior: 'allow' as const }),
      execute: async (
        input: Record<string, unknown>,
        context: ToolUseContext
      ) => {
        const startTime = Date.now();
        const name = (input.name as string).trim();
        const prompt = (input.prompt as string).trim();
        const scheduleMode = (input.schedule_mode as string) || 'cron';
        const silent = (input.silent as boolean) ?? false;
        const description = (input.description as string)?.trim() || prompt;

        // P2-10: Cron 防注入扫描 — 创建时即拦截恶意 prompt
        try {
          const { CronInjectionScanner } =
            await import('../../chronos/CronInjectionScanner');
          const scanner = new CronInjectionScanner();
          const scanResult = scanner.scan(prompt, 'strict');
          if (!scanResult.safe) {
            return ToolUtils.createFailureResult(
              `Cron prompt rejected: ${scanResult.threats.join('; ')}`,
              { executionTime: Date.now() - startTime }
            );
          }
        } catch (scanErr) {
          handleError(scanErr, {
            module: 'tools:chronos',
            action: 'scanCronPrompt',
          });
          return ToolUtils.createFailureResult(
            'Cron prompt security scan failed',
            { executionTime: Date.now() - startTime }
          );
        }

        try {
          // 构建 expression
          let expression = (input.expression as string)?.trim() || '';
          if (scheduleMode === 'every') {
            const v = (input.every_value as number) || 30;
            const u = (input.every_unit as string) || 'minutes';
            expression = `every ${v}${u === 'minutes' ? 'm' : u === 'hours' ? 'h' : 'd'}`;
          } else if (scheduleMode === 'at') {
            const h = (input.at_hour as string) || '14';
            const m = (input.at_minute as string) || '00';
            expression = `${m} ${h} * * *`;
          }

          // 解析调度
          const { parseSchedule } = await import('@modules/chronos/cron');
          const { computeNextCronRun } =
            await import('@modules/tasks/cron/CronParser');
          const { CronJobStore } =
            await import('@modules/tasks/cron/CronJobStore');
          const { resolveDbPath } = await import('@modules/core/paths');

          const parsed: any = parseSchedule(expression) || {
            kind: 'cron',
            expr: expression,
            display: expression,
          };

          if (scheduleMode === 'every') {
            const everyValue = (input.every_value as number) || 30;
            parsed.kind = 'interval';
            parsed.minutes = everyValue;
            parsed.expr = undefined;
          }

          // 检查任务数限制
          const store = new CronJobStore(resolveDbPath());
          await store.init();
          const allJobs = await store.loadJobs();
          if (allJobs.length >= MAX_JOBS) {
            await store.close();
            throw new AppError(
              `Too many cron jobs (max ${MAX_JOBS}). Delete some first.`,
              ErrorCategory.EXECUTION,
              ErrorSeverity.HIGH,
              '1000'
            );
          }

          const job: any = {
            id: `cron-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name,
            prompt,
            schedule: parsed,
            scheduleDisplay: parsed.display || expression,
            repeat: { times: null, completed: 0 },
            enabled: true,
            state: 'scheduled',
            createdAt: new Date().toISOString(),
            silent,
            deliver: 'origin',
            // sessionKey 供 dispatchDelivery 通过 ChannelSessionManager 反查渠道信息
            sessionKey: context.sessionId || undefined,
            // origin: platform 信息（来自 ToolUseContext.options.querySource）
            origin: context.options?.querySource
              ? { platform: context.options.querySource }
              : undefined,
          };

          // 计算首次运行时间
          const nowMs = Date.now();
          if (parsed.kind === 'interval') {
            const mins = parsed.minutes || 30;
            job.nextRunAt = new Date(nowMs + mins * 60 * 1000).toISOString();
          } else if (parsed.kind === 'cron' && parsed.expr) {
            const next = computeNextCronRun(parsed.expr, nowMs);
            if (next) job.nextRunAt = next;
          }

          await store.upsertJob(job);
          await store.close();

          // 唤醒全局调度器，确保新作业立即被检查
          try {
            const { wakeGlobalCronScheduler } =
              await import('@modules/tasks/cron/GlobalCronScheduler');
            wakeGlobalCronScheduler();
          } catch (err) {
            handleError(err, {
              module: 'tools:chronos',
              action: 'wakeGlobalCronScheduler',
            });
          }

          const humanSchedule = parsed.display || expression;
          const executionTime = ToolUtils.calculateExecutionTime(startTime);

          return ToolUtils.createSuccessResult(
            { id: job.id, name, humanSchedule, nextRunAt: job.nextRunAt },
            {
              executionTime,
              output: `Created task "${name}" (${humanSchedule}). Next run: ${job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : 'unknown'}`,
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
          interruptBehavior: 'block' as const,
        };
      },
    };
  }
}

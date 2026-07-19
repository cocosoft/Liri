/**
 * Cron列表工具 - 接入新 CronJobStore
 */

import { Tool } from '../types/Tool';
import { ToolUseContext } from '../types/ToolUseContext';
import { ToolUtils } from '../utils/ToolUtils';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'tools:ChronosTool:CronListTool',
  level: LogLevel.INFO,
});

export class CronListTool {
  static create(): Tool {
    return {
      name: 'cron_list',
      description: 'List all active cron/scheduled tasks',
      params: [],
      aliases: ['cron_jobs', 'list_cron', 'scheduled', 'tasks'],
      searchTips: ['cron', 'list', 'jobs', 'scheduled', 'tasks'],
      isEnabled: () => true,
      isReadOnly: () => true,
      isDestructive: () => false,
      isConcurrencySafe: () => true,
      validateInput: () => ({ result: true }),
      checkPermissions: async () => ({ behavior: 'allow' as const }),
      execute: async (_input, _context) => {
        const startTime = Date.now();
        try {
          const { CronJobStore } =
            await import('@modules/tasks/cron/CronJobStore');
          const { resolveDbPath } = await import('@modules/core/paths');
          const store = new CronJobStore(resolveDbPath());
          await store.init();
          const jobs = await store.loadJobs();
          await store.close();

          const list = jobs.map((j) => ({
            id: j.id,
            name: j.name,
            schedule: j.schedule?.display || j.schedule?.expr || '',
            prompt: j.prompt || '',
            enabled: j.enabled,
            state: j.state,
            nextRunAt: j.nextRunAt || undefined,
            lastRunAt: j.lastRunAt || undefined,
            silent: j.silent || false,
          }));

          const executionTime = ToolUtils.calculateExecutionTime(startTime);
          const output =
            list.length === 0
              ? 'No scheduled tasks.'
              : list
                  .map((j) => {
                    const status = j.enabled
                      ? j.state === 'running'
                        ? ' [running]'
                        : ' [active]'
                      : ' [disabled]';
                    const next = j.nextRunAt
                      ? ` | next: ${new Date(j.nextRunAt).toLocaleString()}`
                      : '';
                    const silent = j.silent ? ' (silent)' : '';
                    return `${j.id}: "${j.name}" — ${j.schedule}${status}${next}${silent}\n  ${j.prompt}`;
                  })
                  .join('\n\n');

          return ToolUtils.createSuccessResult(
            { jobs: list, count: list.length },
            {
              executionTime,
              output,
              toolName: 'cron_list',
              executionId: ToolUtils.generateExecutionId('cron_list'),
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
              toolName: 'cron_list',
              executionId: ToolUtils.generateExecutionId('cron_list'),
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
          readOnly: true,
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

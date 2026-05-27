/**
 * Cron列表工具
 */

import { Tool } from '../types/Tool';
import { ToolResult } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import { ToolUtils } from '../utils/ToolUtils';
import { listAllCronTasks } from '@modules/chronos/CronTasks';
import { cronToHuman } from '@modules/chronos/cron';

/**
 * 任务截断长度
 */
const PROMPT_TRUNCATE_LENGTH = 80;

/**
 * Cron列表工具类
 */
export class CronListTool {
  /**
   * 创建Cron列表工具实例
   * @returns Cron列表工具实例
   */
  static create(): Tool {
    return {
      name: 'cron_list',
      description: 'List all active cron jobs',
      params: [],
      aliases: ['cron_jobs', 'list_cron', 'scheduled'],
      searchTips: ['cron', 'list', 'jobs', 'scheduled', 'tasks'],
      isEnabled: () => true,
      isReadOnly: (_input?: Record<string, unknown>) => true,
      isDestructive: (_input?: Record<string, unknown>) => false,
      isConcurrencySafe: (_input?: Record<string, unknown>) => true,
      validateInput: (input) => {
        return { result: true };
      },
      checkPermissions: async (input, context) => {
        return { behavior: 'allow' };
      },
      execute: async (input, context) => {
        const startTime = Date.now();

        try {
          const tasks = await listAllCronTasks();
          const jobs = tasks.map((t) => ({
            id: t.id,
            cron: t.cron,
            humanSchedule: cronToHuman(t.cron),
            prompt: t.prompt,
            ...(t.recurring ? { recurring: true } : {}),
            ...(t.durable === false ? { durable: false } : {}),
          }));

          const executionTime = ToolUtils.calculateExecutionTime(startTime);
          return ToolUtils.createSuccessResult(
            { jobs },
            {
              executionTime,
              output:
                jobs.length > 0
                  ? jobs
                      .map((j) => {
                        const truncatedPrompt =
                          j.prompt.length > PROMPT_TRUNCATE_LENGTH
                            ? j.prompt.substring(0, PROMPT_TRUNCATE_LENGTH) +
                              '...'
                            : j.prompt;
                        return `${j.id} — ${j.humanSchedule}${j.recurring ? ' (recurring)' : ' (one-shot)'}${j.durable === false ? ' [session-only]' : ''}: ${truncatedPrompt}`;
                      })
                      .join('\n')
                  : 'No scheduled jobs.',
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
          interruptBehavior: 'block',
        };
      },
    };
  }
}

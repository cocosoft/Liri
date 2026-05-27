/**
 * TimeTool - 时间查询工具
 * 用于获取当前时间和日期信息
 */

import { Tool } from '../types/Tool';
import { ToolResult, createToolResult } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import { ToolUtils } from '../utils/ToolUtils';

/**
 * 时间工具类
 */
export class TimeTool {
  /**
   * 创建时间工具实例
   * @returns 时间工具实例
   */
  static create(): Tool {
    return {
      name: 'time',
      description: 'Get current date and time information',
      params: [
        {
          name: 'format',
          type: 'string',
          description: 'Time format (iso, local, unix)',
          required: false,
          default: 'local',
        },
        {
          name: 'timezone',
          type: 'string',
          description: 'Timezone (e.g., "Asia/Shanghai", "America/New_York")',
          required: false,
        },
      ],
      aliases: ['date', 'clock', 'now'],
      searchHint: 'time date clock current time now',
      isEnabled: () => true,
      isReadOnly: () => true,
      isDestructive: () => false,
      isConcurrencySafe: () => true,
      execute: async (
        input: Record<string, unknown>,
        context: ToolUseContext
      ) => {
        const startTime = Date.now();
        const format = (input.format as string) || 'local';
        const timezone = input.timezone as string;

        try {
          const now = new Date();
          let result: any = {};

          switch (format) {
            case 'iso':
              result = {
                iso: now.toISOString(),
                timestamp: now.getTime(),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              };
              break;
            case 'unix':
              result = {
                timestamp: now.getTime(),
                seconds: Math.floor(now.getTime() / 1000),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              };
              break;
            case 'local':
            default:
              result = {
                local: now.toString(),
                date: now.toDateString(),
                time: now.toTimeString(),
                timestamp: now.getTime(),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              };
              break;
          }

          const executionTime = ToolUtils.calculateExecutionTime(startTime);

          return createToolResult(JSON.stringify(result), {
            newMessages: [
              {
                role: 'system',
                content: `Current time: ${now.toString()}`,
              },
            ],
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          return createToolResult(null, {
            newMessages: [
              {
                role: 'system',
                content: `Error: ${errorMessage}`,
              },
            ],
          });
        }
      },
      getInfo: function () {
        return {
          name: this.name,
          description: this.description,
          params: this.params,
          aliases: this.aliases,
          enabled: this.isEnabled(),
          readOnly: this.isReadOnly(),
          destructive: this.isDestructive?.() || false,
          concurrencySafe: this.isConcurrencySafe(),
          deferred: false,
          alwaysLoad: true,
          interruptBehavior: 'block' as const,
        };
      },
    };
  }
}

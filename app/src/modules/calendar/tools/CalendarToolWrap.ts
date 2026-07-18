/**
 * 日历工具 — 注册到 ToolManager，供 AI Agent 调用日程管理
 */

import type { Tool, ToolParam } from '../../../tools/types/Tool';
import type { ToolResult } from '../../../tools/types/ToolResult';
import { ToolExecutionStatus } from '../../../tools/types/ToolResult';
import type { ToolUseContext } from '../../../tools/types/ToolUseContext';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ module: 'calendar:tool', level: LogLevel.INFO });

/** 公共参数 */
const ADD_PARAMS: ToolParam[] = [
  { name: 'summary', type: 'string', description: '日程标题', required: true },
  {
    name: 'start',
    type: 'string',
    description: '开始时间 (ISO 8601)',
    required: true,
  },
  {
    name: 'end',
    type: 'string',
    description: '结束时间 (ISO 8601)',
    required: false,
  },
  {
    name: 'description',
    type: 'string',
    description: '日程描述',
    required: false,
  },
  { name: 'location', type: 'string', description: '地点', required: false },
  {
    name: 'minutesBefore',
    type: 'number',
    description: '提前多少分钟提醒',
    required: false,
  },
];

/** 添加日程 */
export function createCalendarAddTool(): Tool {
  return {
    name: 'calendar:add',
    description: 'Add a calendar event. Optionally set a reminder.',
    params: ADD_PARAMS,
    aliases: ['cal_add', 'add_event'],
    searchTips: ['calendar', 'event', 'schedule'],
    isEnabled: () => true,
    isReadOnly: () => false,
    isDestructive: () => false,
    isConcurrencySafe: () => true,

    async execute(
      input: Record<string, unknown>,
      _context: ToolUseContext
    ): Promise<ToolResult> {
      const startTime = Date.now();
      const summary = (input.summary as string) || '';
      if (!summary) {
        return {
          status: ToolExecutionStatus.FAILURE,
          error: 'summary is required',
          executionTime: Date.now() - startTime,
          output: '',
          errorOutput: '',
          progress: [],
          metadata: {},
          executionId: `cal_add_${Date.now()}`,
          toolName: 'calendar:add',
          timestamp: Date.now(),
        };
      }

      try {
        const { CalendarTool } =
          await import('../../../../packages/office/calendar/CalendarTool');
        const cal = new CalendarTool();
        const event = await cal.add({
          summary,
          start: (input.start as string) || new Date().toISOString(),
          end: (input.end as string) || '',
          description: input.description as string | undefined,
          location: input.location as string | undefined,
          reminder: input.minutesBefore
            ? {
                minutesBefore: input.minutesBefore as number,
                method: 'push' as const,
              }
            : undefined,
        });

        return {
          status: ToolExecutionStatus.SUCCESS,
          result: event,
          output: JSON.stringify(event),
          errorOutput: '',
          progress: [],
          metadata: { id: event.id, summary },
          executionTime: Date.now() - startTime,
          executionId: `cal_add_${Date.now()}`,
          toolName: 'calendar:add',
          timestamp: Date.now(),
          content: `日程已添加: ${summary}`,
        };
      } catch (error) {
        logger.warn('日程添加失败', { error: String(error) });
        return {
          status: ToolExecutionStatus.FAILURE,
          error: error instanceof Error ? error.message : String(error),
          executionTime: Date.now() - startTime,
          output: '',
          errorOutput: String(error),
          progress: [],
          metadata: {},
          executionId: `cal_add_${Date.now()}`,
          toolName: 'calendar:add',
          timestamp: Date.now(),
        };
      }
    },

    getInfo() {
      return {
        name: 'calendar:add',
        description: this.description,
        params: ADD_PARAMS,
        aliases: ['cal_add', 'add_event'],
        searchTips: ['calendar', 'event', 'schedule'],
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

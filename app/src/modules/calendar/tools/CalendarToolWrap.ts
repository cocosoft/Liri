/**
 * 日历工具 — 注册到 ToolManager，供 AI Agent 调用日程管理
 */

import type { Tool, ToolParam } from '../../../tools/types/Tool';
import type { ToolResult } from '../../../tools/types/ToolResult';
import { ToolExecutionStatus } from '../../../tools/types/ToolResult';
import type { ToolUseContext } from '../../../tools/types/ToolUseContext';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('calendar:tool');

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

/** UPDATE 参数（与 ADD 类似，但 summary 非必填且需 id） */
const UPDATE_PARAMS: ToolParam[] = [
  { name: 'id', type: 'string', description: '日程 ID', required: true },
  { name: 'summary', type: 'string', description: '日程标题', required: false },
  {
    name: 'start',
    type: 'string',
    description: '开始时间 (ISO 8601)',
    required: false,
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
];

/** DELETE 参数 */
const DELETE_PARAMS: ToolParam[] = [
  { name: 'id', type: 'string', description: '日程 ID', required: true },
];

/** LIST 参数（支持可选过滤） */
const LIST_PARAMS: ToolParam[] = [
  {
    name: 'query',
    type: 'string',
    description: '搜索关键词（可选）',
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

/**
 * 创建日程列表工具
 * 查看所有日程，支持按关键词搜索
 */
export function createCalendarListTool(): Tool {
  return {
    name: 'calendar:list',
    description:
      'List calendar events. Use "query" parameter to search by keyword.',
    params: LIST_PARAMS,
    aliases: ['cal_list', 'list_events', '查看日程'],
    searchTips: ['calendar', 'event', 'list', 'schedule', '日程'],
    isEnabled: () => true,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,

    async execute(
      input: Record<string, unknown>,
      _context: ToolUseContext
    ): Promise<ToolResult> {
      const startTime = Date.now();
      try {
        const { CalendarTool } =
          await import('../../../../packages/office/calendar/CalendarTool');
        const cal = new CalendarTool();

        const query = (input.query as string) || '';
        const events = query ? await cal.search(query) : await cal.list();

        return {
          status: ToolExecutionStatus.SUCCESS,
          result: events,
          output: JSON.stringify(events),
          errorOutput: '',
          progress: [],
          metadata: { count: events.length, query },
          executionTime: Date.now() - startTime,
          executionId: `cal_list_${Date.now()}`,
          toolName: 'calendar:list',
          timestamp: Date.now(),
          content: `共 ${events.length} 条日程`,
        };
      } catch (error) {
        logger.warn('日程列表获取失败', { error: String(error) });
        return {
          status: ToolExecutionStatus.FAILURE,
          error: error instanceof Error ? error.message : String(error),
          executionTime: Date.now() - startTime,
          output: '',
          errorOutput: String(error),
          progress: [],
          metadata: {},
          executionId: `cal_list_${Date.now()}`,
          toolName: 'calendar:list',
          timestamp: Date.now(),
        };
      }
    },

    getInfo() {
      return {
        name: 'calendar:list',
        description: this.description,
        params: LIST_PARAMS,
        aliases: ['cal_list', 'list_events', '查看日程'],
        searchTips: ['calendar', 'event', 'list', 'schedule', '日程'],
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

/**
 * 创建日程更新工具
 * 修改已有日程的标题、时间、描述、地点等
 */
export function createCalendarUpdateTool(): Tool {
  return {
    name: 'calendar:update',
    description: 'Update an existing calendar event by its ID.',
    params: UPDATE_PARAMS,
    aliases: ['cal_update', 'edit_event', '修改日程'],
    searchTips: ['calendar', 'event', 'update', 'edit', '日程'],
    isEnabled: () => true,
    isReadOnly: () => false,
    isDestructive: () => false,
    isConcurrencySafe: () => true,

    async execute(
      input: Record<string, unknown>,
      _context: ToolUseContext
    ): Promise<ToolResult> {
      const startTime = Date.now();
      const id = (input.id as string) || '';
      if (!id) {
        return {
          status: ToolExecutionStatus.FAILURE,
          error: 'id is required',
          executionTime: Date.now() - startTime,
          output: '',
          errorOutput: '',
          progress: [],
          metadata: {},
          executionId: `cal_update_${Date.now()}`,
          toolName: 'calendar:update',
          timestamp: Date.now(),
        };
      }

      try {
        const { CalendarTool } =
          await import('../../../../packages/office/calendar/CalendarTool');
        const cal = new CalendarTool();

        const updates: Record<string, unknown> = {};
        if (input.summary !== undefined) updates.summary = input.summary;
        if (input.start !== undefined) updates.start = input.start;
        if (input.end !== undefined) updates.end = input.end;
        if (input.description !== undefined)
          updates.description = input.description;
        if (input.location !== undefined) updates.location = input.location;

        await cal.update(
          id,
          updates as Partial<import('@modules/calendar/types').CalendarEvent>
        );

        return {
          status: ToolExecutionStatus.SUCCESS,
          result: { id, updates },
          output: `日程 ${id} 已更新`,
          errorOutput: '',
          progress: [],
          metadata: { id },
          executionTime: Date.now() - startTime,
          executionId: `cal_update_${Date.now()}`,
          toolName: 'calendar:update',
          timestamp: Date.now(),
          content: `日程已更新: ${id}`,
        };
      } catch (error) {
        logger.warn('日程更新失败', { error: String(error) });
        return {
          status: ToolExecutionStatus.FAILURE,
          error: error instanceof Error ? error.message : String(error),
          executionTime: Date.now() - startTime,
          output: '',
          errorOutput: String(error),
          progress: [],
          metadata: {},
          executionId: `cal_update_${Date.now()}`,
          toolName: 'calendar:update',
          timestamp: Date.now(),
        };
      }
    },

    getInfo() {
      return {
        name: 'calendar:update',
        description: this.description,
        params: UPDATE_PARAMS,
        aliases: ['cal_update', 'edit_event', '修改日程'],
        searchTips: ['calendar', 'event', 'update', 'edit', '日程'],
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

/**
 * 创建日程删除工具
 * 按 ID 删除日程
 */
export function createCalendarDeleteTool(): Tool {
  return {
    name: 'calendar:delete',
    description: 'Delete a calendar event by its ID.',
    params: DELETE_PARAMS,
    aliases: ['cal_delete', 'remove_event', '删除日程'],
    searchTips: ['calendar', 'event', 'delete', 'remove', '日程'],
    isEnabled: () => true,
    isReadOnly: () => false,
    isDestructive: () => true,
    isConcurrencySafe: () => true,

    async execute(
      input: Record<string, unknown>,
      _context: ToolUseContext
    ): Promise<ToolResult> {
      const startTime = Date.now();
      const id = (input.id as string) || '';
      if (!id) {
        return {
          status: ToolExecutionStatus.FAILURE,
          error: 'id is required',
          executionTime: Date.now() - startTime,
          output: '',
          errorOutput: '',
          progress: [],
          metadata: {},
          executionId: `cal_delete_${Date.now()}`,
          toolName: 'calendar:delete',
          timestamp: Date.now(),
        };
      }

      try {
        const { CalendarTool } =
          await import('../../../../packages/office/calendar/CalendarTool');
        const cal = new CalendarTool();

        // G-3 修复：真正执行删除（原实现只有审批壳，审批通过后无任何删除代码）
        await cal.delete(id);

        return {
          status: ToolExecutionStatus.SUCCESS,
          result: { id, deleted: true },
          output: `日程 ${id} 已删除`,
          errorOutput: '',
          progress: [],
          metadata: { id, action: 'deleted' },
          executionTime: Date.now() - startTime,
          executionId: `cal_delete_${Date.now()}`,
          toolName: 'calendar:delete',
          timestamp: Date.now(),
          content: `日程已删除: ${id}`,
        };
      } catch (error) {
        logger.warn('日程删除失败', { error: String(error) });
        return {
          status: ToolExecutionStatus.FAILURE,
          error: error instanceof Error ? error.message : String(error),
          executionTime: Date.now() - startTime,
          output: '',
          errorOutput: String(error),
          progress: [],
          metadata: {},
          executionId: `cal_delete_${Date.now()}`,
          toolName: 'calendar:delete',
          timestamp: Date.now(),
        };
      }
    },

    getInfo() {
      return {
        name: 'calendar:delete',
        description: this.description,
        params: DELETE_PARAMS,
        aliases: ['cal_delete', 'remove_event', '删除日程'],
        searchTips: ['calendar', 'event', 'delete', 'remove', '日程'],
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

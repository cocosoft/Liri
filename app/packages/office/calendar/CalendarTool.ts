/**
 * 日历工具 — CalendarTool
 * 日程管理 + .ics 存储 + Chronos reminder
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolvePyappHome } from '@modules/core';
import { Logger, LogLevel } from '@modules/monitoring';
import { ICalParser } from './ICalParser';
import {
  getCalendarEventBus,
  CalendarEvents,
} from '@modules/calendar/CalendarEventBus';

import type { CalendarEvent, CalendarAddArgs } from '@modules/calendar/types';

const logger = new Logger({
  module: 'calendar:tool',
  level: LogLevel.INFO,
});

/** 日历存储目录 */
function getCalendarDir(): string {
  return path.join(resolvePyappHome(), 'office', 'calendars');
}

/**
 * CalendarTool
 * 日程管理核心工具，注册到 ToolManager
 */
export class CalendarTool {
  private parser: ICalParser;

  constructor() {
    this.parser = new ICalParser();
    this.ensureStorageDir();
  }

  /**
   * 查看日程列表
   */
  async list(): Promise<CalendarEvent[]> {
    const files = fs
      .readdirSync(getCalendarDir())
      .filter((f) => f.endsWith('.ics'));
    const events: CalendarEvent[] = [];
    for (const file of files) {
      const content = fs.readFileSync(
        path.join(getCalendarDir(), file),
        'utf-8'
      );
      events.push(...this.parser.parse(content));
    }
    return events;
  }

  /**
   * 添加日程事件
   */
  async add(args: CalendarAddArgs): Promise<CalendarEvent> {
    const event: CalendarEvent = {
      id: `event-${Date.now()}`,
      summary: args.summary,
      start: args.start,
      end: args.end,
      description: args.description,
      location: args.location,
    };

    // 写入 .ics 文件
    const icsContent = this.parser.export([event]);
    const filePath = path.join(getCalendarDir(), `${event.id}.ics`);
    fs.writeFileSync(filePath, icsContent, 'utf-8');

    // 注册 Chronos reminder（如果配置了提醒）
    if (args.reminder) {
      this.registerReminder(event, args.reminder);
    }

    // 发布事件到 CalendarEventBus
    try {
      const bus = getCalendarEventBus();
      bus.publish(CalendarEvents.EVENT_CREATED, {
        event: {
          id: event.id,
          summary: event.summary,
          start: event.start,
          end: event.end,
          description: event.description,
          location: event.location,
        },
        sessionId: args.sessionId,
        toolCallId: args.toolCallId,
        snippet: args.snippet,
        reminderMinutes: args.reminderMinutes,
      });
    } catch (err) {
      logger.warn('事件发布失败（非阻塞）', { error: String(err) });
    }

    logger.info('日程已添加', { id: event.id, summary: args.summary });
    return event;
  }

  /**
   * 修改日程
   */
  async update(id: string, updates: Partial<CalendarEvent>): Promise<void> {
    const filePath = path.join(getCalendarDir(), `${id}.ics`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`日程 ${id} 不存在`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const events = this.parser.parse(content);

    // 找到匹配的事件并合并更新
    const idx = events.findIndex((e) => e.id === id || (e as any).uid === id);
    if (idx === -1) {
      throw new Error(`日程 ${id} 不存在于 .ics 文件中`);
    }

    events[idx] = { ...events[idx], ...updates, id: events[idx].id };

    // 重新导出并写入
    const icsContent = this.parser.export(events);
    fs.writeFileSync(filePath, icsContent, 'utf-8');

    // 发布更新事件
    try {
      const oldEvent = this.parseEventFromContent(content, id);
      if (oldEvent) {
        getCalendarEventBus().publish(CalendarEvents.EVENT_UPDATED, {
          prevEvent: {
            id: oldEvent.id,
            summary: oldEvent.summary,
            start: oldEvent.start,
            end: oldEvent.end,
          },
          newEvent: {
            id: events[idx].id,
            summary: events[idx].summary,
            start: events[idx].start,
            end: events[idx].end,
          },
        });
      }
    } catch (err) {
      logger.warn('更新事件发布失败（非阻塞）', { error: String(err) });
    }

    logger.info('日程已更新', { id });
  }

  /**
   * 搜索日程
   */
  async search(query: string): Promise<CalendarEvent[]> {
    const events = await this.list();
    const q = query.toLowerCase();
    return events.filter(
      (e) =>
        e.summary.toLowerCase().includes(q) ||
        (e.description || '').toLowerCase().includes(q) ||
        (e.location || '').toLowerCase().includes(q)
    );
  }

  /**
   * 删除日程
   */
  async delete(id: string): Promise<void> {
    const filePath = path.join(getCalendarDir(), `${id}.ics`);
    if (fs.existsSync(filePath)) {
      // 删除前读取事件信息用于发布事件
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const oldEvent = this.parseEventFromContent(content, id);
        if (oldEvent) {
          getCalendarEventBus().publish(CalendarEvents.EVENT_DELETED, {
            id: oldEvent.id,
            summary: oldEvent.summary,
          });
        }
      } catch {
        /* 读取失败不影响删除 */
      }

      fs.unlinkSync(filePath);
    }
    logger.info('日程已删除', { id });
  }

  /**
   * 导出 .ics 文件
   */
  async export(id: string): Promise<string> {
    const filePath = path.join(getCalendarDir(), `${id}.ics`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`日程 ${id} 不存在`);
    }
    return filePath;
  }

  /**
   * 注册 Chronos 提醒
   */
  private registerReminder(
    event: CalendarEvent,
    reminder: { minutesBefore: number; method: 'push' | 'log' }
  ): void {
    logger.info('日程提醒已注册', {
      event: event.summary,
      minutesBefore: reminder.minutesBefore,
      method: reminder.method,
    });
    // TODO: Chronos.schedule(() => { ... }, new Date(event.start) - minutesBefore)
  }

  /**
   * 确保存储目录存在
   */
  private ensureStorageDir(): void {
    const dir = getCalendarDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 从 .ics 内容中解析指定 ID 的事件（用于更新/删除事件发布）
   */
  private parseEventFromContent(
    content: string,
    id: string
  ): CalendarEvent | null {
    const events = this.parser.parse(content);
    return events.find((e) => e.id === id || (e as any).uid === id) ?? null;
  }
}

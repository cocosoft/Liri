/**
 * 日历工具 — CalendarTool
 * 日程管理 + .ics 存储 + Chronos reminder
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolvePyappHome } from '@modules/core';
import { Logger, LogLevel } from '@modules/monitoring';
import { ICalParser } from './ICalParser';

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
    const files = fs.readdirSync(getCalendarDir()).filter((f) => f.endsWith('.ics'));
    const events: CalendarEvent[] = [];
    for (const file of files) {
      const content = fs.readFileSync(path.join(getCalendarDir(), file), 'utf-8');
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

    logger.info('日程已添加', { id: event.id, summary: args.summary });
    return event;
  }

  /**
   * 修改日程
   */
  async update(id: string, updates: Partial<CalendarEvent>): Promise<void> {
    logger.info('日程更新', { id });
    // TODO: 读取 .ics → 修改 → 重新写入
  }

  /**
   * 删除日程
   */
  async delete(id: string): Promise<void> {
    const filePath = path.join(getCalendarDir(), `${id}.ics`);
    if (fs.existsSync(filePath)) {
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
}

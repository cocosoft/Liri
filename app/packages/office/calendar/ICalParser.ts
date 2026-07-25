/**
 * iCal 解析/生成器
 * 基于 ical.js (RFC 5545)
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { EventStatus } from '@modules/calendar/types';
import type { CalendarEvent } from '@modules/calendar/types';

const logger = new Logger({
  module: 'calendar:tool',
  level: LogLevel.INFO,
});

/**
 * ICalParser
 * 当前使用手动解析和生成，后续可升级为 ical.js 完整集成
 */
export class ICalParser {
  /**
   * 解析 .ics 文件内容为 CalendarEvent 列表
   */
  parse(icsContent: string): CalendarEvent[] {
    try {
      const events: CalendarEvent[] = [];
      let currentEvent: Partial<CalendarEvent> = {};

      for (const line of icsContent.split('\n')) {
        const trimmed = line.trim();
        if (trimmed === 'BEGIN:VEVENT') {
          currentEvent = { id: `event-${Date.now()}`, status: EventStatus.PENDING };
        } else if (trimmed === 'END:VEVENT') {
          if (currentEvent.summary && currentEvent.start) {
            events.push(currentEvent as CalendarEvent);
          }
        } else if (trimmed.startsWith('DTSTART:')) {
          currentEvent.start = this.parseICalDate(trimmed.substring(8));
        } else if (trimmed.startsWith('DTEND:')) {
          currentEvent.end = this.parseICalDate(trimmed.substring(6));
        } else if (trimmed.startsWith('SUMMARY:')) {
          currentEvent.summary = trimmed.substring(8);
        } else if (trimmed.startsWith('DESCRIPTION:')) {
          currentEvent.description = trimmed.substring(12);
        } else if (trimmed.startsWith('LOCATION:')) {
          currentEvent.location = trimmed.substring(9);
        } else if (trimmed.startsWith('UID:')) {
          currentEvent.id = trimmed.substring(4);
        } else if (trimmed.startsWith('X-LIRI-STATUS:')) {
          const val = trimmed.substring(14);
          if (Object.values(EventStatus).includes(val as EventStatus)) {
            currentEvent.status = val as EventStatus;
          }
        } else if (trimmed.startsWith('X-LIRI-COMPLETED-AT:')) {
          currentEvent.completedAt = this.parseICalDate(trimmed.substring(21));
        } else if (trimmed.startsWith('X-LIRI-PRIORITY:')) {
          const p = parseInt(trimmed.substring(16), 10);
          if (!isNaN(p)) currentEvent.priority = p;
        } else if (trimmed.startsWith('X-LIRI-TAGS:')) {
          currentEvent.tags = trimmed.substring(12).split(',');
        }
      }

      return events;
    } catch (error) {
      logger.warn('iCal 解析失败', { error: String(error) });
      return [];
    }
  }

  /**
   * 将 CalendarEvent 列表导出为 .ics 格式
   */
  export(events: CalendarEvent[]): string {
    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Liri//Calendar//EN',
    ];

    for (const event of events) {
      lines.push('BEGIN:VEVENT');
      lines.push(`DTSTART:${this.formatICalDate(event.start)}`);
      lines.push(`DTEND:${this.formatICalDate(event.end)}`);
      lines.push(`SUMMARY:${event.summary}`);
      if (event.description) lines.push(`DESCRIPTION:${event.description}`);
      if (event.location) lines.push(`LOCATION:${event.location}`);
      lines.push(`UID:${event.id}`);
      // X-LIRI 自定义属性
      lines.push(`X-LIRI-STATUS:${event.status}`);
      if (event.completedAt) lines.push(`X-LIRI-COMPLETED-AT:${this.formatICalDate(event.completedAt)}`);
      if (event.priority != null) lines.push(`X-LIRI-PRIORITY:${event.priority}`);
      if (event.tags && event.tags.length > 0) lines.push(`X-LIRI-TAGS:${event.tags.join(',')}`);
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  /**
   * 解析 iCal 日期格式 → ISO 8601
   */
  private parseICalDate(dateStr: string): string {
    const cleaned = dateStr.replace(/[^0-9TZ]/g, '');
    const year = cleaned.substring(0, 4);
    const month = cleaned.substring(4, 6);
    const day = cleaned.substring(6, 8);
    const hour = cleaned.substring(9, 11) || '00';
    const min = cleaned.substring(11, 13) || '00';
    const sec = cleaned.substring(13, 15) || '00';
    return `${year}-${month}-${day}T${hour}:${min}:${sec}Z`;
  }

  /**
   * ISO 8601 → iCal 日期格式
   */
  private formatICalDate(isoStr: string): string {
    return isoStr.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  }
}

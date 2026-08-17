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
      // G-1 兜底 ID 唯一化（无 UID 时）
      let fallbackSeq = 0;

      for (const line of icsContent.split('\n')) {
        const trimmed = line.trim();
        if (trimmed === 'BEGIN:VEVENT') {
          fallbackSeq++;
          currentEvent = {
            id: `event-${Date.now()}-${fallbackSeq}`,
            status: EventStatus.PENDING,
          };
        } else if (trimmed === 'END:VEVENT') {
          if (currentEvent.summary && currentEvent.start) {
            events.push(currentEvent as CalendarEvent);
          }
        } else if (trimmed.startsWith('DTSTART;VALUE=DATE:')) {
          // D-4 全天事件：VALUE=DATE 只含日期，按本地时区解释为 00:00
          currentEvent.start = this.parseDateOnly(trimmed.substring(19));
        } else if (trimmed.startsWith('DTSTART:')) {
          currentEvent.start = this.parseICalDate(trimmed.substring(8));
        } else if (trimmed.startsWith('DTEND;VALUE=DATE:')) {
          currentEvent.end = this.parseDateOnly(trimmed.substring(17));
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
          // D-4 修复：前缀 "X-LIRI-COMPLETED-AT:" 为 20 字符，原 substring(21) 吃掉首字符
          currentEvent.completedAt = this.parseICalDate(trimmed.substring(20));
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
      lines.push(`SUMMARY:${this.escapeText(event.summary)}`);
      if (event.description)
        lines.push(`DESCRIPTION:${this.escapeText(event.description)}`);
      if (event.location)
        lines.push(`LOCATION:${this.escapeText(event.location)}`);
      lines.push(`UID:${event.id}`);
      // X-LIRI 自定义属性
      lines.push(`X-LIRI-STATUS:${event.status}`);
      if (event.completedAt)
        lines.push(
          `X-LIRI-COMPLETED-AT:${this.formatICalDate(event.completedAt)}`
        );
      if (event.priority != null)
        lines.push(`X-LIRI-PRIORITY:${event.priority}`);
      if (event.tags && event.tags.length > 0)
        lines.push(`X-LIRI-TAGS:${this.escapeText(event.tags.join(','))}`);
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  /**
   * G-18：RFC 5545 文本字段转义（SUMMARY/DESCRIPTION/LOCATION 等）。
   * 未转义时，含换行/冒号的内容会破坏 .ics 结构，重新解析后内容截断或丢失。
   */
  private escapeText(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  /**
   * 解析 iCal 日期格式 → ISO 8601
   * D-4：浮动时间（无 Z）按本地时区解释，不再强制拼 Z 当 UTC（避免东八区偏移 8 小时）
   */
  private parseICalDate(dateStr: string): string {
    const cleaned = dateStr.replace(/[^0-9TZ]/g, '');
    const year = cleaned.substring(0, 4);
    const month = cleaned.substring(4, 6);
    const day = cleaned.substring(6, 8);
    const hour = cleaned.substring(9, 11) || '00';
    const min = cleaned.substring(11, 13) || '00';
    const sec = cleaned.substring(13, 15) || '00';
    const isUtc = /Z$/i.test(dateStr);
    const iso = `${year}-${month}-${day}T${hour}:${min}:${sec}`;
    return isUtc ? `${iso}Z` : new Date(iso).toISOString();
  }

  /**
   * D-4 解析全天事件日期（DTSTART;VALUE=DATE:YYYYMMDD）
   * 按本地时区 00:00 解释，避免 UTC 截断成前一天
   */
  private parseDateOnly(dateStr: string): string {
    const cleaned = dateStr.replace(/[^0-9]/g, '');
    const year = cleaned.substring(0, 4);
    const month = cleaned.substring(4, 6);
    const day = cleaned.substring(6, 8);
    return new Date(Number(year), Number(month) - 1, Number(day)).toISOString();
  }

  /**
   * ISO 8601 → iCal 日期格式
   */
  private formatICalDate(isoStr: string): string {
    return isoStr.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  }
}

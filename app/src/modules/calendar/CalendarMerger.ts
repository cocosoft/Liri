/**
 * CalendarMerger — 日历数据聚合控制器
 * 聚合三种数据源：手动日程、Cron 定时任务、AI 提取日程
 *
 * 功能：
 * - Cron 实例展开（根据 cron 表达式计算时间范围内的所有执行日期）
 * - 时区转换（UTC 存储 → 用户时区展示）
 * - 降级策略（单源失败返回部分数据 + errors[]，不阻塞全景）
 */

import { getLogger } from '@modules/monitoring';
import { CronJobStore } from '@modules/tasks';
import { resolveDbPath } from '@modules/core';
import { computeNextCronRunMs } from '@modules/tasks';
import { AIScheduleIndex, type AIScheduleEvent } from './AIScheduleIndex';
import { EventStatus } from './types';
import type { CalendarEvent } from './types';

const logger = getLogger('calendar:merger');

const MAX_OCCURRENCES = 200;

/** Cron 日历事件（前端展示用） */
export interface CronCalendarEvent {
  jobId: string;
  calendarEventId?: string;
  taskDetailUrl?: string;
  name: string;
  schedule: string;
  cronExpression: string;
  occurrences: Array<{
    date: string;
    time: string;
  }>;
  state: string;
  canRunNow: boolean;
  truncated: boolean;
}

/** 合并响应 */
export interface MergedCalendarResponse {
  data: {
    calendarEvents: CalendarEvent[];
    cronEvents: CronCalendarEvent[];
    aiSchedules: AIScheduleEvent[];
  };
  errors: Array<{
    source: 'calendar' | 'cron' | 'ai';
    code: string;
    message: string;
  }>;
  timestamp: string;
}

/** 合并查询参数 */
export interface MergedCalendarParams {
  start: string;
  end: string;
  timezone?: string;
}

/**
 * CalendarMerger
 * 聚合三种数据源，提供 getMergedEvents API
 */
export class CalendarMerger {
  private cronStore: CronJobStore;
  private aiIndex: AIScheduleIndex;

  constructor(cronStore?: CronJobStore, aiIndex?: AIScheduleIndex) {
    this.cronStore = cronStore ?? new CronJobStore(resolveDbPath());
    this.aiIndex = aiIndex ?? new AIScheduleIndex(resolveDbPath());
  }

  /**
   * 初始化数据源连接
   */
  async init(): Promise<void> {
    await this.cronStore.init();
    await this.aiIndex.init();
    logger.info('CalendarMerger 已初始化');
  }

  /**
   * 获取合并的日历数据
   * @param params 查询参数（start/end 日期范围，timezone 用户时区）
   * @param calendarEvents 手动日程列表（由 handler 层提供）
   */
  async getMergedEvents(
    params: MergedCalendarParams,
    calendarEvents: CalendarEvent[]
  ): Promise<MergedCalendarResponse> {
    const errors: MergedCalendarResponse['errors'] = [];
    const timezone =
      params.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

    // 手动日程：由外部提供，直接使用
    const filteredCalendarEvents = this.filterCalendarByRange(
      calendarEvents,
      params.start,
      params.end
    );

    // 超时检测（内存中标记，不写回 .ics）
    this.applyOverdueInMemory(filteredCalendarEvents);

    // Cron 任务：加载 + 实例展开
    let cronEvents: CronCalendarEvent[] = [];
    try {
      const cronJobs = await this.cronStore.loadJobs({ enabled: true });
      cronEvents = this.expandCronJobs(
        cronJobs,
        params.start,
        params.end,
        timezone
      );
    } catch (err) {
      logger.warn('Cron 数据加载失败', { error: String(err) });
      errors.push({
        source: 'cron',
        code: 'CRON_LOAD_ERROR',
        message: '定时任务数据加载失败，请稍后重试',
      });
    }

    // AI 日程索引
    let aiSchedules: AIScheduleEvent[] = [];
    try {
      const entries = await this.aiIndex.listActive();
      aiSchedules = this.buildAIScheduleEvents(
        entries,
        calendarEvents,
        params.start,
        params.end
      );
    } catch (err) {
      logger.warn('AI 日程索引加载失败', { error: String(err) });
      errors.push({
        source: 'ai',
        code: 'AI_INDEX_ERROR',
        message: 'AI 日程数据加载失败，请稍后重试',
      });
    }

    return {
      data: {
        calendarEvents: filteredCalendarEvents,
        cronEvents,
        aiSchedules,
      },
      errors,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 按日期范围过滤手动日程
   */
  private filterCalendarByRange(
    events: CalendarEvent[],
    start: string,
    end: string
  ): CalendarEvent[] {
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();

    return events.filter((ev) => {
      const evStart = new Date(ev.start).getTime();
      const evEnd = new Date(ev.end).getTime();
      // 事件与范围有交集
      return evStart < endMs && evEnd > startMs;
    });
  }

  /**
   * 内存中的超时检测：pending 且 end 已过 → 标记为 overdue
   * 只在内存中标记，不写回 .ics 文件
   */
  private applyOverdueInMemory(events: CalendarEvent[]): void {
    const now = new Date().toISOString();
    for (const ev of events) {
      if (ev.status === EventStatus.PENDING && ev.end < now) {
        ev.status = EventStatus.OVERDUE;
      }
    }
  }

  /**
   * Cron 实例展开：根据 cron 表达式计算时间范围内的所有执行日期
   */
  private expandCronJobs(
    jobs: any[],
    rangeStart: string,
    rangeEnd: string,
    timezone: string
  ): CronCalendarEvent[] {
    const startMs = new Date(rangeStart).getTime();
    const endMs = new Date(rangeEnd).getTime();
    const results: CronCalendarEvent[] = [];

    for (const job of jobs) {
      const expr = job.schedule?.expr;
      if (!expr) continue;

      const occurrences: Array<{ date: string; time: string }> = [];
      let cursorMs = startMs;
      let truncated = false;
      const tz = job.schedule?.tz ?? timezone;

      // 迭代计算所有执行时间
      for (let i = 0; i < MAX_OCCURRENCES + 1; i++) {
        const nextMs = computeNextCronRunMs(expr, cursorMs, tz);
        if (nextMs === undefined || nextMs >= endMs) break;

        if (i >= MAX_OCCURRENCES) {
          truncated = true;
          break;
        }

        const nextDate = new Date(nextMs);
        occurrences.push({
          date: this.formatDate(nextDate),
          time: this.formatTime(nextDate),
        });

        cursorMs = nextMs + 1; // 前进 1ms 避免重复
      }

      if (occurrences.length > 0) {
        results.push({
          jobId: job.id,
          calendarEventId: undefined, // Cron 任务可能关联日历事件，后续补充
          taskDetailUrl: `/cron?jobId=${job.id}`,
          name: job.name,
          schedule: job.schedule?.display ?? expr,
          cronExpression: expr,
          occurrences,
          state: job.state,
          canRunNow: job.state === 'scheduled' || job.state === 'paused',
          truncated,
        });
      }
    }

    return results;
  }

  /**
   * 构建 AI 日程事件列表
   */
  private buildAIScheduleEvents(
    entries: any[],
    calendarEvents: CalendarEvent[],
    rangeStart: string,
    rangeEnd: string
  ): AIScheduleEvent[] {
    const startMs = new Date(rangeStart).getTime();
    const endMs = new Date(rangeEnd).getTime();
    const eventMap = new Map(calendarEvents.map((e) => [e.id, e]));
    const results: AIScheduleEvent[] = [];

    for (const entry of entries) {
      const event = eventMap.get(entry.calendarEventId);
      if (!event) continue;

      const evStart = new Date(event.start).getTime();
      if (evStart < startMs || evStart >= endMs) continue;

      results.push({
        id: entry.id,
        calendarEventId: entry.calendarEventId,
        date: this.formatDate(new Date(event.start)),
        time: this.formatTime(new Date(event.start)),
        summary: event.summary,
        sessionId: entry.sessionId,
        conversationSnippet: entry.conversationSnippet,
        source: 'ai',
      });
    }

    return results;
  }

  /** 格式化日期为 YYYY-MM-DD */
  private formatDate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** 格式化时间为 HH:mm */
  private formatTime(d: Date): string {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  /**
   * 关闭数据库连接
   * G-2 修复：同时关闭 cronStore 与 aiIndex 两个连接，防止每次请求泄漏
   */
  async close(): Promise<void> {
    await this.aiIndex.close();
    // cronStore 独立打开连接，必须显式关闭
    try {
      await this.cronStore.close();
    } catch (err) {
      logger.warn('cronStore 关闭失败', { error: String(err) });
    }
  }
}

/**
 * ScheduleHook — 日历事件生命周期 Hook
 * 订阅 CalendarEventBus 事件，管理 Cron 提醒和 AI 日程索引
 *
 * 生命周期：
 *   calendar:event:created → 创建 Cron 提醒 + 写入 ai_schedules
 *   calendar:event:updated  → 删除旧提醒 + 按新时间重建
 *   calendar:event:deleted  → 删除 Cron 任务 + 标记 ai_schedules
 *   calendar:cron:state_changed → 通过事件总线通知前端
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { CronJobStore } from '@modules/tasks/cron/CronJobStore';
import { resolveDbPath } from '@modules/core';
import {
  getCalendarEventBus,
  CalendarEvents,
  type CalendarEventCreatedPayload,
  type CalendarEventUpdatedPayload,
  type CalendarEventDeletedPayload,
  type CronStateChangedPayload,
} from './CalendarEventBus';
import { AIScheduleIndex } from './AIScheduleIndex';

const logger = new Logger({
  module: 'calendar:scheduleHook',
  level: LogLevel.INFO,
});

/**
 * ScheduleHook
 * 管理日历事件与 Cron 提醒之间的生命周期同步
 */
export class ScheduleHook {
  private cronStore: CronJobStore;
  private aiIndex: AIScheduleIndex;

  constructor(cronStore?: CronJobStore, aiIndex?: AIScheduleIndex) {
    this.cronStore = cronStore ?? new CronJobStore(resolveDbPath());
    this.aiIndex = aiIndex ?? new AIScheduleIndex(resolveDbPath());
  }

  /**
   * 初始化：订阅所有日历事件
   */
  async init(): Promise<void> {
    await this.cronStore.init();
    await this.aiIndex.init();

    const bus = getCalendarEventBus();

    bus.subscribe(
      CalendarEvents.EVENT_CREATED,
      (payload: CalendarEventCreatedPayload) => {
        this.onCalendarCreated(payload);
      }
    );

    bus.subscribe(
      CalendarEvents.EVENT_UPDATED,
      (payload: CalendarEventUpdatedPayload) => {
        this.onCalendarUpdated(payload);
      }
    );

    bus.subscribe(
      CalendarEvents.EVENT_DELETED,
      (payload: CalendarEventDeletedPayload) => {
        this.onCalendarDeleted(payload);
      }
    );

    bus.subscribe(
      CalendarEvents.CRON_STATE_CHANGED,
      (payload: CronStateChangedPayload) => {
        this.onCronStateChanged(payload);
      }
    );

    logger.info('ScheduleHook 已初始化 — 4 个事件监听器已注册');
  }

  /**
   * 日历事件创建 → 创建 Cron 提醒 + 写入 AI 索引
   */
  async onCalendarCreated(payload: CalendarEventCreatedPayload): Promise<void> {
    const { event, sessionId, toolCallId, snippet, reminderMinutes } = payload;

    try {
      // 写入 AI 日程索引（如果有 sessionId 说明是 AI 创建的）
      if (sessionId) {
        const entryId = `ais-${event.id}`;
        try {
          await this.aiIndex.insert({
            id: entryId,
            calendarEventId: event.id,
            sessionId,
            conversationSnippet: snippet ?? event.summary,
            createdByToolCallId: toolCallId,
          });
          logger.info('AI 日程索引已写入', { eventId: event.id, sessionId });
        } catch (idxErr) {
          logger.warn('AI 日程索引写入失败', { error: String(idxErr) });
        }
      }

      // 创建 Cron 提醒任务
      const minutes = reminderMinutes ?? [15];
      const reminderCronJobIds: string[] = [];

      for (const minsBefore of minutes) {
        const reminderTime = new Date(
          new Date(event.start).getTime() - minsBefore * 60 * 1000
        );
        const jobId = `cal-reminder-${event.id}-${minsBefore}m`;

        try {
          await this.cronStore.upsertJob({
            id: jobId,
            name: `提醒: ${event.summary}`,
            prompt: `日程"${event.summary}"将在 ${minsBefore} 分钟后开始`,
            skills: [],
            schedule: {
              kind: 'once',
              display: `${minsBefore}分钟前提醒`,
              runAt: reminderTime.toISOString(),
            },
            repeat: { times: 1, completed: 0 },
            enabled: true,
            state: 'scheduled',
            createdAt: new Date().toISOString(),
            nextRunAt: reminderTime.toISOString(),
            deliver: 'local',
            silent: false,
          });
          reminderCronJobIds.push(jobId);
        } catch (cronErr) {
          // 补偿机制：记录错误但不回滚日历事件
          logger.warn('Cron 提醒创建失败', {
            eventId: event.id,
            minsBefore,
            error: String(cronErr),
          });

          if (sessionId) {
            const entryId = `ais-${event.id}`;
            await this.aiIndex.setHookError(
              entryId,
              `提醒(${minsBefore}分钟前)创建失败: ${String(cronErr)}`
            );
          }
        }
      }

      logger.info('日程提醒已创建', {
        eventId: event.id,
        reminderCount: reminderCronJobIds.length,
        totalRequested: minutes.length,
      });
    } catch (err) {
      logger.error('onCalendarCreated 处理失败', {
        error: String(err),
        eventId: event.id,
      });
    }
  }

  /**
   * 日历事件更新 → 删除旧提醒 + 按新时间重建
   */
  async onCalendarUpdated(payload: CalendarEventUpdatedPayload): Promise<void> {
    const { prevEvent, newEvent } = payload;

    try {
      // 仅当时间变化时才重建提醒
      const timeChanged =
        prevEvent.start !== newEvent.start || prevEvent.end !== newEvent.end;

      if (timeChanged) {
        // 删除旧提醒
        await this.deleteRemindersForEvent(prevEvent.id);

        // 按新时间发布创建事件（让 onCalendarCreated 处理）
        getCalendarEventBus().publish(CalendarEvents.EVENT_CREATED, {
          event: newEvent,
        } as CalendarEventCreatedPayload);

        logger.info('日程时间变更，已重建提醒', {
          eventId: newEvent.id,
          oldStart: prevEvent.start,
          newStart: newEvent.start,
        });
      }
    } catch (err) {
      logger.error('onCalendarUpdated 处理失败', {
        error: String(err),
        eventId: newEvent.id,
      });
    }
  }

  /**
   * 日历事件删除 → 删除关联 Cron 任务 + 标记 AI 索引
   */
  async onCalendarDeleted(payload: CalendarEventDeletedPayload): Promise<void> {
    const { id } = payload;

    try {
      // 删除所有关联的 Cron 提醒任务
      await this.deleteRemindersForEvent(id);

      // 标记 AI 索引为已删除
      await this.aiIndex.markDeleted(id);

      logger.info('日程已删除，关联提醒和索引已清理', { eventId: id });
    } catch (err) {
      logger.error('onCalendarDeleted 处理失败', {
        error: String(err),
        eventId: id,
      });
    }
  }

  /**
   * Cron 状态变更 → 通过事件总线通知（前端轮询拉取）
   */
  async onCronStateChanged(payload: CronStateChangedPayload): Promise<void> {
    logger.info('Cron 状态变更', {
      jobId: payload.jobId,
      newState: payload.newState,
    });
    // 事件总线自动通知订阅者，无需额外处理
  }

  /**
   * 删除指定日历事件的所有提醒 Cron 任务
   */
  private async deleteRemindersForEvent(eventId: string): Promise<void> {
    try {
      const allJobs = await this.cronStore.loadJobs({});
      const reminderJobs = allJobs.filter((j) =>
        j.id.startsWith(`cal-reminder-${eventId}`)
      );

      for (const job of reminderJobs) {
        await this.cronStore.deleteJob(job.id);
      }

      if (reminderJobs.length > 0) {
        logger.info('已删除提醒任务', { eventId, count: reminderJobs.length });
      }
    } catch (err) {
      logger.warn('删除提醒任务失败', { eventId, error: String(err) });
    }
  }

  /**
   * 销毁：关闭数据库连接
   */
  async destroy(): Promise<void> {
    await this.aiIndex.close();
    logger.info('ScheduleHook 已销毁');
  }
}

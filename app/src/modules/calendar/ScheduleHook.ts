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

import { getLogger } from '@modules/monitoring';
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

const logger = getLogger('calendar:scheduleHook');

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
   * 日历事件创建 → 创建 Cron 提醒 + 写入 AI 索引 + 推送通知中心
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

      // 桥接写入通知中心（fire-and-forget，失败不影响主流程）
      void this._pushCalendarNotice(event);
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

        // 同时更新通知中心的到期时间
        void this._pushCalendarNotice(newEvent);

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
   * 日历事件删除 → 删除关联 Cron 任务 + 标记 AI 索引 + 消除通知
   */
  async onCalendarDeleted(payload: CalendarEventDeletedPayload): Promise<void> {
    const { id } = payload;

    try {
      // 删除所有关联的 Cron 提醒任务
      await this.deleteRemindersForEvent(id);

      // 标记 AI 索引为已删除
      await this.aiIndex.markDeleted(id);

      // 消除通知中心对应通知
      void this._dismissCalendarNotice(id);

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

  /**
   * 向通知中心推送日程提醒（category='notice'）
   * 日程开始时自动过期，点击可跳回日历
   */
  private async _pushCalendarNotice(event: {
    id: string;
    summary: string;
    start: string;
    end: string;
    description?: string;
  }): Promise<void> {
    try {
      const { notificationPersistence } =
        await import('@modules/runtime/NotificationPersistence.js');
      const startTs = Math.floor(new Date(event.start).getTime() / 1000);
      await notificationPersistence().create({
        category: 'notice',
        priority: 'normal',
        title: `日程: ${event.summary}`,
        content: event.description || `${event.start} 开始`,
        source: 'calendar',
        source_ref: event.id,
        link_to: {
          type: 'page',
          id: `/office/calendar?date=${event.start.slice(0, 10)}`,
          label: '查看日历',
        },
        expires_at: startTs,
      });
    } catch {
      /* 通知写入失败不影响日历主流程 */
    }
  }

  /**
   * 消除通知中心中对应日程的通知
   */
  private async _dismissCalendarNotice(eventId: string): Promise<void> {
    try {
      const { notificationPersistence } =
        await import('@modules/runtime/NotificationPersistence.js');
      await notificationPersistence().resolveBySourceRef(eventId);
    } catch {
      /* 通知消除失败不影响日历主流程 */
    }
  }
}

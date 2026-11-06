/**
 * ScheduleHook 提醒过期守卫（2026-11-03）
 *
 * 缺陷：`onCalendarCreated` 对每个 `reminderMinutes` 无条件建 Cron 作业 ⇒
 * 补建/改期到历史时间的日程会留下永远不会被回收的一次性作业
 * （`completed` 不被调度器清理，API 又把它映射为 idle ⇒ 永久显示在定时任务列表）。
 *
 * 口径：提醒时间 `<= now` 一律跳过，只建**尚未到点**的提醒。
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ScheduleHook,
  type CalendarNoticeSink,
} from '../../src/modules/calendar/ScheduleHook';
import { AIScheduleIndex } from '../../src/modules/calendar/AIScheduleIndex';
import {
  CalendarEvents,
  getCalendarEventBus,
  type CalendarEventCreatedPayload,
  type CalendarEventUpdatedPayload,
} from '../../src/modules/calendar/CalendarEventBus';
import { CronJobStore } from '../../src/tasks/cron/CronJobStore';

const MINUTE = 60 * 1000;

/** 录制到的通知（2026-11-06：测试不再写真实通知中心） */
interface NoticeRecord {
  title: string;
  source: string;
  sourceRef: string;
}

/**
 * 每个用例独立库：`ScheduleHook` 的两个依赖都落同一个临时 db。
 *
 * 通知端口**必须注入**：不注入时 `_pushCalendarNotice` 会取全局单例、落生产库
 * （实测曾写入 441 条 `日程: 日程 ev-*` 通知）。
 */
async function withHook(
  run: (ctx: {
    hook: ScheduleHook;
    store: CronJobStore;
    notices: NoticeRecord[];
  }) => Promise<void>
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'schedule-hook-guard-'));
  const dbPath = join(dir, 'app.db');
  const store = new CronJobStore(dbPath);
  const index = new AIScheduleIndex(dbPath);
  const notices: NoticeRecord[] = [];
  const noticeSink: CalendarNoticeSink = {
    async create(input) {
      notices.push({
        title: input.title,
        source: input.source,
        sourceRef: input.source_ref,
      });
      return { id: `notice-${input.source_ref}` };
    },
    async resolveBySourceRef() {
      return true;
    },
  };
  await store.init();
  await index.init();
  try {
    await run({
      hook: new ScheduleHook(store, index, noticeSink),
      store,
      notices,
    });
  } finally {
    await store.close();
    await index.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 创建载荷（开始时间 = 当前时刻 + 偏移） */
function createdPayload(
  id: string,
  startOffsetMs: number,
  reminderMinutes?: number[]
): CalendarEventCreatedPayload {
  const start = new Date(Date.now() + startOffsetMs);
  return {
    event: {
      id,
      summary: `日程 ${id}`,
      start: start.toISOString(),
      end: new Date(start.getTime() + 30 * MINUTE).toISOString(),
    },
    reminderMinutes,
  };
}

/**
 * 更新路径的重建由 `publish(EVENT_CREATED)`（fire-and-forget）触发。
 * 测试侧订阅同一事件并持有重建 Promise，确保断言前已落库。
 */
async function updateAndWaitRebuild(
  hook: ScheduleHook,
  payload: CalendarEventUpdatedPayload
): Promise<void> {
  const bus = getCalendarEventBus();
  let rebuild: Promise<void> = Promise.resolve();
  const sub = bus.subscribe(CalendarEvents.EVENT_CREATED, (data) => {
    rebuild = hook.onCalendarCreated(data as CalendarEventCreatedPayload);
  });
  try {
    await hook.onCalendarUpdated(payload);
    await rebuild;
  } finally {
    sub.unsubscribe();
  }
}

describe('ScheduleHook 提醒过期守卫', () => {
  test('未来事件仍创建提醒（对照）', async () => {
    await withHook(async ({ hook, store }) => {
      const payload = createdPayload('ev-future', 90 * MINUTE, [15]);
      await hook.onCalendarCreated(payload);

      const jobs = await store.loadJobs({});
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.id).toBe('cal-reminder-ev-future-15m');
      expect(jobs[0]!.nextRunAt).toBe(
        new Date(
          new Date(payload.event.start).getTime() - 15 * MINUTE
        ).toISOString()
      );
    });
  });

  test('提醒时间已过 ⇒ 不创建任务', async () => {
    await withHook(async ({ hook, store }) => {
      await hook.onCalendarCreated(
        createdPayload('ev-past', -60 * MINUTE, [15])
      );

      expect(await store.loadJobs({})).toHaveLength(0);
      expect(await store.getJob('cal-reminder-ev-past-15m')).toBeUndefined();
    });
  });

  test('多个提醒点 ⇒ 只建尚未到点的那些', async () => {
    await withHook(async ({ hook, store }) => {
      // start 在 30 分钟后：60 分钟前提醒已过 ⇒ 跳过；15 分钟前提醒未到 ⇒ 创建
      await hook.onCalendarCreated(
        createdPayload('ev-mixed', 30 * MINUTE, [60, 15])
      );

      const jobs = await store.loadJobs({});
      expect(jobs.map((j) => j.id)).toEqual(['cal-reminder-ev-mixed-15m']);
      expect(await store.getJob('cal-reminder-ev-mixed-60m')).toBeUndefined();
    });
  });

  test('更新重建：改到历史时间 ⇒ 旧提醒删除且不新建', async () => {
    await withHook(async ({ hook, store }) => {
      const created = createdPayload('ev-moved-back', 90 * MINUTE, [15]);
      await hook.onCalendarCreated(created);
      expect(await store.loadJobs({})).toHaveLength(1);

      const newStart = new Date(Date.now() - 120 * MINUTE);
      await updateAndWaitRebuild(hook, {
        prevEvent: created.event,
        newEvent: {
          id: created.event.id,
          summary: created.event.summary,
          start: newStart.toISOString(),
          end: new Date(newStart.getTime() + 30 * MINUTE).toISOString(),
        },
      });

      expect(await store.loadJobs({})).toHaveLength(0);
    });
  });

  test('更新重建：改到未来时间 ⇒ 按新时间重建提醒', async () => {
    await withHook(async ({ hook, store }) => {
      const created = createdPayload('ev-moved-forward', 90 * MINUTE, [15]);
      await hook.onCalendarCreated(created);

      const newStart = new Date(Date.now() + 180 * MINUTE);
      await updateAndWaitRebuild(hook, {
        prevEvent: created.event,
        newEvent: {
          id: created.event.id,
          summary: created.event.summary,
          start: newStart.toISOString(),
          end: new Date(newStart.getTime() + 30 * MINUTE).toISOString(),
        },
      });

      const jobs = await store.loadJobs({});
      expect(jobs.map((j) => j.id)).toEqual([
        'cal-reminder-ev-moved-forward-15m',
      ]);
      expect(jobs[0]!.nextRunAt).toBe(
        new Date(newStart.getTime() - 15 * MINUTE).toISOString()
      );
    });
  });

  test('通知中心走注入端口：标题为「日程: …」，不写真实库', async () => {
    await withHook(async ({ hook, notices }) => {
      await hook.onCalendarCreated(
        createdPayload('ev-notice', 90 * MINUTE, [15])
      );
      // 通知推送是 fire-and-forget ⇒ 让出一轮事件循环等它完成
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(notices).toHaveLength(1);
      expect(notices[0]).toEqual({
        title: '日程: 日程 ev-notice',
        source: 'calendar',
        sourceRef: 'ev-notice',
      });
    });
  });
});

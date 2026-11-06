/**
 * 通知落库的「测试来源」护栏（2026-11-06）
 *
 * **要防的事（实测）**：真实通知中心 `~/.pyapp/data/app.db` 的 `notifications` 表里
 * 447 条 `source='calendar'` 通知中有 **441 条**来自 5 个单测 fixture
 * （`ev-future` / `ev-mixed` / `ev-moved-back` / `ev-past` / `ev-moved-forward`，
 * 出自 `app/tests/calendar/scheduleHookReminderGuard.test.ts`），每次 `bun test` 继续追加。
 *
 * 根因：`ScheduleHook._pushCalendarNotice()` 走**全局单例** `notificationPersistence()`，
 * 默认落 `resolveDbPath()`（生产库）；测试只隔离了 CronJobStore / AIScheduleIndex 的临时库。
 *
 * **与既有护栏同源（CS01）**：判据逐字对齐
 * `packages/infra/src/cost/costPersistenceGuard.ts#shouldSkipCostEventPersistence`
 * 与 `app/src/ai/UsageTracker.ts#shouldSkipUsagePersistence`：
 *   ① `NODE_ENV === 'test'`；
 *   ② 调用方**没有**显式隔离数据目录（`LIRI_DATA_DIR` / `LIRI_HOME` / `setUserDataDirOverride`）；
 *   ③ 且该实例**没有**显式传入 dbPath（直接 `new NotificationPersistence(tmpPath)` 的单测不受影响）。
 *
 * ⚠️ 只跳过**落库**：调用方拿到的仍是形状完整的对象（不抛错、不改调用约定）。
 */
import { getUserDataDirOverride } from '@openliri/infra/environment';

export function shouldSkipNotificationPersistence(
  env: NodeJS.ProcessEnv = process.env,
  dataDirOverride: string | null = getUserDataDirOverride(),
  hasExplicitDbPath = false
): boolean {
  if (hasExplicitDbPath) return false;
  if (env.NODE_ENV !== 'test') return false;
  if (dataDirOverride) return false;
  return !env.LIRI_DATA_DIR?.trim() && !env.LIRI_HOME?.trim();
}

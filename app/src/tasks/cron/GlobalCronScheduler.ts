/**
 * 全局 CronScheduler 单例
 * 保证整个进程只有一份调度器实例，HTTP handler 和守护进程共享
 */

import { CronScheduler } from './CronScheduler';
import { CronJobStore } from './CronJobStore';
import { CronRunLog } from './CronRunLog';
import { CronAlertService } from './CronAlertService';
import { runInCronOwnerScope } from './cronOwnership';
import type { CronJob, CronJobResult } from './types';
import type { SchedulerCallbacks } from './CronScheduler';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('GlobalCronScheduler');

let instance: CronScheduler | null = null;
let store: CronJobStore | null = null;
let initialized = false;

/** 获取或初始化调度器存储 */
async function getStore(): Promise<CronJobStore> {
  if (!store) {
    const { resolveDbPath } = await import('@openliri/kernel/paths');
    store = new CronJobStore(resolveDbPath());
    await store.init();
  }
  return store;
}

/** 默认的作业执行器 */
function defaultExecutor(job: CronJob): Promise<CronJobResult> {
  const output = job.prompt || `作业 "${job.name}" 执行完成（无具体指令）`;
  return Promise.resolve({
    success: true,
    output,
    finalResponse: output,
    durationMs: 0,
  });
}

/**
 * 确保全局调度器已启动（幂等）
 * 在应用启动时调用一次，后续调用无副作用
 */
export async function ensureGlobalCronSchedulerStarted(
  callbacks?: Partial<SchedulerCallbacks>,
  deliveryQueue?: any
): Promise<CronScheduler> {
  if (instance) return instance;

  const s = await getStore();

  // 使用与 CronJobStore 相同的 db 路径
  const { resolveDbPath } = await import('@openliri/kernel/paths');
  const rl = new CronRunLog(resolveDbPath());
  await rl.init();

  // 简单日志告警
  const alertService = new CronAlertService((job, reason, count) => {
    logger.warn('Cron 告警', {
      jobName: job.name,
      reason,
      consecutiveErrors: count,
    });
  });

  const baseExecutor = callbacks?.executeJob ?? defaultExecutor;

  instance = new CronScheduler(
    s,
    {
      // 多租户 P3：租户作业在**归属者身份作用域**内执行 —— 工具 cwd（P3）、存储（P1）、
      // 事件投递（P2）才都落到作业归属者名下；无归属（本地作业 / 历史数据）⇒ 原样执行。
      executeJob: (job: CronJob) =>
        runInCronOwnerScope(job, () => baseExecutor(job)),
      dispatchDelivery: callbacks?.dispatchDelivery,
    },
    {
      checkIntervalMs: undefined, // CronTimer 自己管理
      maxParallelJobs: 3,
      jobTimeoutMs: 5 * 60_000,
      enableLock: false,
    },
    deliveryQueue,
    rl,
    alertService
  );

  await instance.start();
  initialized = true;

  return instance;
}

/** 唤醒全局调度器（新作业创建后调用） */
export function wakeGlobalCronScheduler(): void {
  if (instance) {
    instance.wake();
  }
}

/** 获取全局调度器（可能为 null 如果未启动） */
export function getGlobalCronScheduler(): CronScheduler | null {
  return instance;
}

/** 已否已初始化 */
export function isGlobalCronSchedulerStarted(): boolean {
  return initialized && instance !== null;
}

/** 停止全局调度器 */
export async function stopGlobalCronScheduler(): Promise<void> {
  if (instance) {
    instance.stop();
    instance = null;
  }
  if (store) {
    await store.close();
    store = null;
  }
  initialized = false;
}

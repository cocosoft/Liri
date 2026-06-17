/**
 * 全局 CronScheduler 单例
 * 保证整个进程只有一份调度器实例，HTTP handler 和守护进程共享
 */

import { CronScheduler } from './CronScheduler';
import { CronJobStore } from './CronJobStore';
import { CronRunLog } from './CronRunLog';
import { CronAlertService } from './CronAlertService';
import type { CronJob, CronJobResult } from './types';
import type { SchedulerCallbacks } from './CronScheduler';

let instance: CronScheduler | null = null;
let store: CronJobStore | null = null;
let initialized = false;

/** 获取或初始化调度器存储 */
async function getStore(): Promise<CronJobStore> {
  if (!store) {
    const { resolveDbPath } = await import('@modules/core/paths');
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
  callbacks?: Partial<SchedulerCallbacks>
): Promise<CronScheduler> {
  if (instance) return instance;

  const s = await getStore();

  // 使用与 CronJobStore 相同的 db 路径
  const { resolveDbPath } = await import('@modules/core/paths');
  const rl = new CronRunLog(resolveDbPath());
  await rl.init();

  // 简单日志告警
  const alertService = new CronAlertService((job, reason, count) => {
    // eslint-disable-next-line no-console
    console.warn(
      `[CronAlert] ${job.name} ${reason} | consecutiveErrors=${count}`
    );
  });

  instance = new CronScheduler(
    s,
    {
      executeJob: callbacks?.executeJob ?? defaultExecutor,
      dispatchDelivery: callbacks?.dispatchDelivery,
    },
    {
      checkIntervalMs: undefined, // CronTimer 自己管理
      maxParallelJobs: 3,
      jobTimeoutMs: 5 * 60_000,
      enableLock: false,
    },
    undefined, // deliveryQueue
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

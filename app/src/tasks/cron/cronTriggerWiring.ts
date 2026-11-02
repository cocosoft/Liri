/**
 * Cron → Source → Trigger → Ticket 生产接线（P35，2026-11-02）
 *
 * 方案：`dev_docs/20261102/Liri常驻自主执行升级方案-20261102.md` §5 P35。
 *
 * 数据流：
 * ```
 * CronScheduler 到点
 *   → onJobStart: 发出 CronTick（幂等 id = jobId@scheduledAt）
 *   → SourceRegistry: 位点过滤 → Trigger 落台账（重复只留一条）→ 同线程串行
 *   → ticketSink: 创建 status='queued' 的 workitems 行（create-if-absent）
 *   → onJobEnd: 把同一 Ticket 推进到 completed/failed（带 tokens）
 * ```
 *
 * 为什么 Ticket id 由 `jobId@计划时刻` 派生：`job.nextRunAt` 在执行期间仍是**本次计划时刻**，
 * 开始/结束两处能算出同一个 id，无需在内存里传递句柄；重启后也天然幂等。
 *
 * 诚实边界（本阶段）：
 * - **执行仍由现有 Cron 执行器完成**；本模块只保证"每次到点都有唯一 Ticket 记录"，
 *   不改变调度/执行语义（P33 的准入判定接在这里，见 P33-a）；
 * - 写入串行化：Ticket 的创建与状态推进共用一条 Promise 链 ⇒ 不会出现
 *   `completed` 被迟到的 `queued` 覆盖。
 */
import { getLogger } from '@openliri/infra/monitoring';

import { SourceCursorStore } from '../sources/cursor';
import { SourceRegistry } from '../sources/registry';
import {
  CRON_SOURCE_ID,
  createCronSource,
  type CronTick,
  type CronTickFeed,
} from '../sources/cronSource';
import {
  createTriggerTicketSink,
  triggerTicketId,
  type TicketSinkDeps,
} from '../sources/ticketSink';
import {
  asThreadKey,
  computeTriggerId,
  THREAD_KEY_PREFIX,
  type Trigger,
} from '../sources/types';
import { readPdcaWorkItem, writePdcaWorkItem } from '../PdcaWorkItemBridge';
import type { CronJob, CronJobResult } from './types';

const logger = getLogger('tasks:cron:trigger-wiring');

export interface CronTriggerPipelineOptions {
  /** 注入位点库（测试用 `:memory:`；缺省 `resolveDbPath()`） */
  store?: SourceCursorStore;
  /** 注入 Ticket 读写（测试用；缺省走 `workitems`） */
  readTicket?: TicketSinkDeps['read'];
  writeTicket?: TicketSinkDeps['write'];
  now?: () => number;
}

/** 供 `CronScheduler` 调用的作业生命周期钩子 */
export interface CronTriggerPipeline {
  /** 作业开始：发出 Trigger（不写 Ticket 状态，避免与 sink 竞争） */
  onJobStart(job: CronJob, scheduledAt: number): Promise<void>;
  /** 作业结束：把同一 Ticket 推进到终态（缺失则补建） */
  onJobEnd(
    job: CronJob,
    result: CronJobResult,
    scheduledAt: number
  ): Promise<void>;
  /** 取消订阅并释放位点库（注入的库不关闭） */
  stop(): Promise<void>;
}

/** 组装 Trigger（唯一组装点；`onJobStart` 与 `onJobEnd` 必须算出同一个 id） */
function cronTriggerOf(job: CronJob, scheduledAt: number): Trigger {
  const threadKey = asThreadKey(THREAD_KEY_PREFIX.cron, job.id);
  return {
    triggerId: computeTriggerId(CRON_SOURCE_ID, {
      externalId: `${job.id}@${scheduledAt}`,
      type: 'cron_tick',
    }),
    sourceId: CRON_SOURCE_ID,
    threadKey,
    type: 'cron_tick',
    externalId: `${job.id}@${scheduledAt}`,
    payload: {
      jobId: job.id,
      ...(job.name ? { name: job.name } : {}),
      ...(job.prompt ? { message: job.prompt } : {}),
    },
    receivedAt: scheduledAt,
  };
}

/**
 * 启动 cron 触发流水线（**幂等由调用方保证**：同一进程只调用一次）。
 *
 * 失败向上抛：调用方（`startCronEngine`）记录后继续启动 cron（新流水线不应阻断旧轨）。
 */
export async function startCronTriggerPipeline(
  options: CronTriggerPipelineOptions = {}
): Promise<CronTriggerPipeline> {
  const now = options.now ?? Date.now;
  const listeners = new Set<(tick: CronTick) => void>();
  const feed: CronTickFeed = {
    subscribe(handler) {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
  };

  const store = options.store ?? new SourceCursorStore();
  const read = options.readTicket ?? readPdcaWorkItem;
  const write = options.writeTicket ?? writePdcaWorkItem;
  const rawSink = createTriggerTicketSink({ read, write, now });

  /** Ticket 写入串行链：sink 的 create-if-absent 与 onJobEnd 的终态推进互不覆盖 */
  let chain: Promise<unknown> = Promise.resolve();
  const withTicketWrite = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  };

  const registry = new SourceRegistry({
    store,
    handleTriggers: (threadKey, triggers) =>
      withTicketWrite(() => rawSink(threadKey, triggers)),
  });
  registry.register(createCronSource({ feed }));
  await registry.start();

  return {
    async onJobStart(job, scheduledAt) {
      // 发出即返回：落库/串行由 Registry 负责（不阻塞调度器）
      for (const listener of listeners) {
        listener({
          jobId: job.id,
          firedAt: scheduledAt,
          ...(job.name ? { name: job.name } : {}),
          ...(job.prompt ? { message: job.prompt } : {}),
        });
      }
    },

    async onJobEnd(job, result, scheduledAt) {
      const trigger = cronTriggerOf(job, scheduledAt);
      await withTicketWrite(async () => {
        // 先确保 Ticket 存在（create-if-absent；已存在则不动）
        await rawSink(trigger.threadKey, [trigger]);
        const id = triggerTicketId(trigger.triggerId);
        const existing = await read(id);
        if (!existing) {
          logger.warn('Trigger Ticket 在终态推进时仍缺失（记录未写入?）', {
            jobId: job.id,
            ticketId: id,
          });
          return;
        }
        const tokens = (result.inputTokens ?? 0) + (result.outputTokens ?? 0);
        await write({
          ...existing,
          id,
          status: result.success ? 'completed' : 'failed',
          ...(tokens > 0 ? { costTokens: tokens } : {}),
          ...(job.workdir ? { workspaceDir: job.workdir } : {}),
          ...(result.error ? { lastError: result.error } : {}),
          updatedAt: new Date(now()).toISOString(),
          lastAction: 'cron_executed',
        });
      });
    },

    async stop() {
      await registry.stop();
      if (!options.store) store.close();
    },
  };
}

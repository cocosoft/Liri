/**
 * cronSource —— 把「cron 到点」翻译成入站事件（P35，2026-11-02）
 *
 * 方案：`dev_docs/20261102/Liri常驻自主执行升级方案-20261102.md` §5 P35。
 *
 * 为什么用**注入 feed** 而不是直接改 `startCronEngine`：
 * - 方案 §5 P35 明确「不"复活即接入"」，接入需要先补消费者登记与接线测试（CD02）；
 * - 本文件只做**翻译**（`CronTick → InboundEvent`），生产接线留给后续批次。
 *
 * 线程键：`cron:<jobId>` ⇒ 同一任务串行、不同任务并行（对齐参考 `docs/001-domain.md:43`）。
 * 幂等：`externalId = <jobId>@<firedAt>`；同一 firedAt 重投只产生一个 Trigger。
 */
import {
  asThreadKey,
  THREAD_KEY_PREFIX,
  type EventSource,
  type InboundEvent,
} from './types';

export const CRON_SOURCE_ID = 'cron';

/** 一次"到点"事实（由 cron 引擎侧提供） */
export interface CronTick {
  jobId: string;
  /** 触发时刻（ms）；同时用作读位点（单调） */
  firedAt: number;
  name?: string;
  message?: string;
}

/** 到点事件源（cron 引擎侧实现；测试用假实现） */
export interface CronTickFeed {
  subscribe(handler: (tick: CronTick) => void): () => void;
}

/** 纯函数：`CronTick → InboundEvent`（唯一翻译点） */
export function cronTickToInbound(tick: CronTick): InboundEvent {
  return {
    threadKey: asThreadKey(THREAD_KEY_PREFIX.cron, tick.jobId),
    externalId: `${tick.jobId}@${tick.firedAt}`,
    type: 'cron_tick',
    cursor: tick.firedAt,
    payload: {
      jobId: tick.jobId,
      ...(tick.name !== undefined ? { name: tick.name } : {}),
      ...(tick.message !== undefined ? { message: tick.message } : {}),
    },
  };
}

/** 由 feed 构造事件来源（`subscribe` 即转发；disposer 直接透传） */
export function createCronSource(options: {
  feed: CronTickFeed;
  id?: string;
}): EventSource {
  const id = options.id ?? CRON_SOURCE_ID;
  return {
    id,
    subscribe(handler) {
      const dispose = options.feed.subscribe((tick) => {
        void handler(cronTickToInbound(tick));
      });
      return Promise.resolve(dispose);
    },
  };
}

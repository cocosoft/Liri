/**
 * effects 队列计数（P39-b-2，2026-11-02）
 *
 * 面板的「回传中 / 投递失败」观测面。**单例连接**：`counts()` 是只读聚合，
 * 不得每请求新建 `EffectQueue`（每次构造都会开一条 SQLite 连接）。
 */
import { getLogger } from '@openliri/infra/monitoring';

import { EffectQueue } from './EffectQueue';
import {
  EFFECT_STATUS_ATTEMPTING,
  EFFECT_STATUS_FAILED,
  EFFECT_STATUS_PENDING,
  EFFECT_STATUS_SETTLED,
  type EffectStatus,
} from './types';

const logger = getLogger('effects:counts');

let queue: EffectQueue | null = null;

/**
 * 按状态计数；读取失败 ⇒ `null`（面板显示 —，**不按 0 计**：0 是"确无"，不是"读不到"）。
 */
export async function getEffectCounts(): Promise<Record<
  EffectStatus,
  number
> | null> {
  queue ??= new EffectQueue();
  try {
    return await queue.counts();
  } catch (err) {
    // @ignore-catch: 观测面失败不得让「工作项」面板整页失败；如实留痕 + 指标缺失
    logger.warn('effects:counts-failed', { error: String(err) });
    return null;
  }
}

/** 供 DTO 映射的稳定字段（避免上层直接依赖 effect 状态字面量） */
export interface EffectCountsSummary {
  pending: number;
  attempting: number;
  settled: number;
  failed: number;
}

/** 把内部 4 态映射为面板 DTO；`null` ⇒ 读不到（上层保留 undefined） */
export function toEffectCountsSummary(
  counts: Record<EffectStatus, number> | null
): EffectCountsSummary | null {
  if (!counts) return null;
  return {
    pending: counts[EFFECT_STATUS_PENDING],
    attempting: counts[EFFECT_STATUS_ATTEMPTING],
    settled: counts[EFFECT_STATUS_SETTLED],
    failed: counts[EFFECT_STATUS_FAILED],
  };
}

/** 测试用：注入队列 / 复位单例 */
export function setEffectCountsQueueForTest(
  injected: EffectQueue | null
): void {
  queue = injected;
}

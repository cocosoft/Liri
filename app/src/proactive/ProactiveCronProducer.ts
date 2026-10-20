/**
 * G-10 生产者（2026-10-19）：把 **cron 任务完成/失败** 接入主动消息队列。
 *
 * 决策口径（用户 2026-10-19 裁定）：
 * - 第一个生产者来源 = cron 完成/失败；
 * - DND 内的消息**延迟到窗口结束**（门禁返回 `queue.retryAt` → `next_attempt_at`）；
 * - `high` 仅保留给内核规则 ⇒ cron 结果最高 `normal`（失败 normal / 成功 low）；
 * - 暂不引入多用户维度。
 *
 * 设计真源：`dev_docs/20261019/proactive-draft.md` §2/§3/§8。
 * 行为边界：`PROACTIVE` 关闭（无活动队列）⇒ 返回 false，调用方走原通知中心链路。
 */

import { randomUUID } from 'crypto';
import { configManager } from '@modules/config';
import { getLogger } from '@modules/monitoring';
import { DEFAULT_TIMEZONE, MS_PER_DAY } from '@modules/constants';
import { getActiveProactiveQueue } from './ProactiveRuntime';
import { evaluateProactiveNotification } from './ProactiveNotificationGate';
import { resolveProactiveTarget } from './ProactiveTargetResolver';
import type {
  ProactiveDndWindow,
  ProactiveGatePrefs,
  ProactiveMessagePayload,
} from './types';

const logger = getLogger('proactive:cronProducer');

export interface CronProactiveInput {
  job: { id?: string; name: string };
  result: { success?: boolean; error?: string };
  title: string;
  body: string;
}

/** 门禁输入依赖（测试可注入；生产缺省读配置与活动队列） */
export interface CronProactiveDeps {
  queue?: Pick<
    NonNullable<ReturnType<typeof getActiveProactiveQueue>>,
    'enqueue' | 'listRecentDelivered'
  > | null;
  prefs?: ProactiveGatePrefs;
  timezone?: string;
  now?: number;
  /** 投递目标（缺省按 `proactive.target.*` 配置解析；测试可注入） */
  target?: ProactiveMessagePayload['target'];
}

function asDndWindow(value: unknown): ProactiveDndWindow | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const start = (value as { start?: unknown }).start;
  const end = (value as { end?: unknown }).end;
  return typeof start === 'string' && typeof end === 'string'
    ? { start, end }
    : undefined;
}

/** 从配置读取门禁偏好（`proactive.*` 键；缺省值见设计稿 §8） */
export function resolveProactiveGatePrefs(): ProactiveGatePrefs {
  const enabled = configManager.getValue<boolean>('proactive.enabled', true);
  const maxPerHour = configManager.getValue<number>('proactive.maxPerHour', 3);
  const cooldownMs = configManager.getValue<
    Partial<Record<'task_result', number>>
  >('proactive.cooldownMs', {});
  return {
    // U-01（2026-10-19）：读取 `proactive.enabled`（原硬编码 true，用户关不掉）
    enabled: enabled !== false,
    dnd: asDndWindow(configManager.getValue('proactive.dnd')),
    maxPerHour: typeof maxPerHour === 'number' ? maxPerHour : 3,
    cooldownMs:
      cooldownMs && typeof cooldownMs === 'object' ? cooldownMs : undefined,
  };
}

/**
 * 构造 cron 结果的主动消息载荷（纯函数，供单测锁定优先级/去重/过期口径）。
 *
 * `priority`：失败 `normal`、成功 `low` —— 用户裁定「仅内核规则可 high」。
 */
export function buildCronProactivePayload(
  input: CronProactiveInput,
  now: number,
  target: ProactiveMessagePayload['target'] = { mode: 'local' }
): ProactiveMessagePayload {
  const jobRef = input.job.id || input.job.name;
  const failed = input.result.success === false;
  // U-01（2026-10-19）：去重键加入**时间窗**（分钟桶）——原键不含 runId/时间，
  // 同 job 当日第二次运行会被 24h 投递回看判为 duplicate 而静默丢弃。
  // 同一次运行的重试落在同一分钟桶内仍可去重；不同运行不再互相吞掉。
  const runBucket = Math.floor(now / 60_000);
  return {
    id: `proactive-cron-${randomUUID()}`,
    kind: 'task_result',
    priority: failed ? 'normal' : 'low',
    dedupeKey: `cron:${jobRef}:${failed ? 'fail' : 'ok'}:${runBucket}`,
    title: input.title,
    body: input.body,
    target,
    createdAt: now,
    expiresAt: now + MS_PER_DAY,
    source: { type: 'cron', ref: jobRef },
  };
}

/**
 * 入队一条 cron 结果消息。
 *
 * @returns true = 已入队；false = 队列未启用 / 门禁 drop / pending 去重命中
 */
export async function enqueueCronResultProactive(
  input: CronProactiveInput,
  deps: CronProactiveDeps = {}
): Promise<boolean> {
  const queue =
    deps.queue === undefined ? getActiveProactiveQueue() : deps.queue;
  if (!queue) return false;

  const now = deps.now ?? Date.now();
  const prefs = deps.prefs ?? resolveProactiveGatePrefs();
  const timezone = deps.timezone ?? DEFAULT_TIMEZONE;
  // U-01 方案 A（2026-10-20 用户裁定）：仅当显式配置了通道目标时才外发，否则维持通知中心。
  const target = deps.target ?? resolveProactiveTarget(configManager);
  const payload = buildCronProactivePayload(input, now, target);

  // 近期投递窗口覆盖最长冷却（默认风险告警 5min；这里取 1 天以覆盖限流窗口）
  const recent = await queue.listRecentDelivered(now - MS_PER_DAY);
  const decision = evaluateProactiveNotification(payload, {
    now,
    timezone,
    prefs,
    recent,
  });

  if (decision.action === 'drop') {
    logger.debug('proactive:cron_dropped', {
      jobRef: payload.source?.ref,
      reason: decision.reason,
    });
    return false;
  }

  const nextAttemptAt = decision.action === 'queue' ? decision.retryAt : now;
  const inserted = await queue.enqueue(payload, now, nextAttemptAt);
  logger.info('proactive:cron_enqueued', {
    jobRef: payload.source?.ref,
    priority: payload.priority,
    dedupeKey: payload.dedupeKey,
    reason: decision.reason,
    nextAttemptAt,
    inserted,
  });
  return inserted;
}

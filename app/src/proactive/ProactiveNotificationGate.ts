// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * G-10（2026-10-19）：主动消息门禁 —— **纯函数（P1）**。
 *
 * 设计真源：`dev_docs/20261019/proactive-draft.md` §3。判定顺序固定：
 * 总开关 → 过期 → 去重 → CRITICAL 例外 → DND → 同类冷却 → 每小时上限 → 放行。
 *
 * 边界：
 * - **无副作用**：不读写队列 / 配置 / 日志；调用方负责持久化 `queue` 决定。
 * - **不做字符串状态判断**：去重只用 `dedupeKey`，类别只用枚举（CS02）。
 * - DND 按 `timezone` 解析本地时间（跨午夜支持）；DST 切换日的「窗口结束」可能偏差 1 小时，
 *   属已知边界（P1 不引入时区库）。
 */
import {
  MINUTES_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  PROACTIVE_REMINDER_NO_COOLDOWN,
  PROACTIVE_RISK_ALERT_COOLDOWN_MS,
  PROACTIVE_SUGGESTION_COOLDOWN_MS,
  PROACTIVE_TASK_RESULT_COOLDOWN_MS,
} from '@modules/constants';
import type {
  ProactiveGateContext,
  ProactiveGateDecision,
  ProactiveKind,
  ProactiveMessagePayload,
} from './types';

/** 默认冷却（用户未配置时生效） */
export const DEFAULT_PROACTIVE_COOLDOWNS_MS: Readonly<
  Record<ProactiveKind, number>
> = {
  task_result: PROACTIVE_TASK_RESULT_COOLDOWN_MS,
  risk_alert: PROACTIVE_RISK_ALERT_COOLDOWN_MS,
  reminder: PROACTIVE_REMINDER_NO_COOLDOWN,
  suggestion: PROACTIVE_SUGGESTION_COOLDOWN_MS,
};

/**
 * **来源级**每小时预算默认值（2026-10-31 根因修复）。
 *
 * 背景：AlwaysOn 每 5 分钟一拍、25 个项目，且成功/失败都播报 ⇒ 收件箱被
 * 671 条「AlwaysOn · X 执行完成」占满（占通知总数 95%）。全局 `maxPerHour`
 * 无法约束"单个来源吃满全局预算"，故加来源级上限作为**结构性兜底**。
 *
 * 约定：生产者 `dedupeKey` 以 `<source.type>:` 开头（`alwayson:` / `cron:` …），
 * 门禁据此统计同来源的已承诺投递量（`listRecentCommitted`，含 pending）。
 */
export const DEFAULT_SOURCE_MAX_PER_HOUR: Readonly<Record<string, number>> = {
  alwayson: 2,
};

/** 取来源级上限（配置覆盖 > 默认表 > 0=不限制） */
function sourceLimitOf(
  sourceType: string,
  overrides?: Record<string, number>
): number {
  const raw =
    overrides?.[sourceType] ?? DEFAULT_SOURCE_MAX_PER_HOUR[sourceType] ?? 0;
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

/** `HH:MM` → 当日分钟数；非法格式 ⇒ `null`（调用方按"未配置 DND"处理） */
function parseClockMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** 取某时刻在指定时区的本地分钟数（非法时区 ⇒ 回退 UTC，不中断门禁） */
function localMinutesOf(now: number, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(now));
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return hour * 60 + minute;
  } catch {
    const d = new Date(now);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }
}

/** 当前是否处于 DND 窗口（支持跨午夜） */
function isWithinDnd(
  now: number,
  timezone: string,
  start: number,
  end: number
): boolean {
  const current = localMinutesOf(now, timezone);
  return start <= end
    ? current >= start && current < end
    : current >= start || current < end;
}

/** DND 窗口结束时刻（epoch ms；取**下一个**结束边界） */
function nextDndEnd(now: number, timezone: string, end: number): number {
  const current = localMinutesOf(now, timezone);
  const delta =
    (end - current + MINUTES_PER_DAY) % MINUTES_PER_DAY || MINUTES_PER_DAY;
  return now + delta * MS_PER_MINUTE;
}

/** 同类冷却（配置优先，缺省按默认表） */
function cooldownOf(
  kind: ProactiveKind,
  configured?: Partial<Record<ProactiveKind, number>>
): number {
  const value = configured?.[kind];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : DEFAULT_PROACTIVE_COOLDOWNS_MS[kind];
}

/** 每小时上限（非法/<=0 ⇒ 0：所有非 CRITICAL 都排队） */
function hourlyLimitOf(maxPerHour: number): number {
  return Number.isFinite(maxPerHour) && maxPerHour > 0
    ? Math.floor(maxPerHour)
    : 0;
}

/**
 * 评估一条主动消息（纯函数）。
 *
 * 调用方须保证 `ctx.recent` 已按**去重 TTL** 过滤（只传仍有效的投递记录）；
 * `duplicate` 判定只比对 `dedupeKey`，不看标题/正文（CS02）。
 */
export function evaluateProactiveNotification(
  payload: ProactiveMessagePayload,
  ctx: ProactiveGateContext
): ProactiveGateDecision {
  const { now, prefs, timezone, recent } = ctx;

  // ① 总开关
  if (!prefs.enabled) return { action: 'drop', reason: 'disabled' };

  // ② 过期
  if (!Number.isFinite(payload.expiresAt) || now >= payload.expiresAt) {
    return { action: 'drop', reason: 'expired' };
  }

  // ③ 去重（`recent` 由调用方按 TTL 过滤）
  if (recent.some((r) => r.dedupeKey === payload.dedupeKey)) {
    return { action: 'drop', reason: 'duplicate' };
  }

  // ④ CRITICAL 例外：唯一可穿透 DND / 冷却 / 速率限制的路径
  if (payload.priority === 'critical') {
    return { action: 'deliver', reason: 'critical_bypass' };
  }

  // ⑤ 免打扰
  const dnd = prefs.dnd;
  if (dnd) {
    const start = parseClockMinutes(dnd.start);
    const end = parseClockMinutes(dnd.end);
    if (
      start !== null &&
      end !== null &&
      isWithinDnd(now, timezone, start, end)
    ) {
      return {
        action: 'queue',
        reason: 'dnd',
        retryAt: nextDndEnd(now, timezone, end),
      };
    }
  }

  // ⑥ 同类冷却（取最近一条同类投递）
  const cooldown = cooldownOf(payload.kind, prefs.cooldownMs);
  if (cooldown > 0) {
    const lastOfKind = recent
      .filter((r) => r.kind === payload.kind)
      .reduce<
        number | null
      >((latest, r) => (latest === null || r.deliveredAt > latest ? r.deliveredAt : latest), null);
    if (lastOfKind !== null && now - lastOfKind < cooldown) {
      return {
        action: 'queue',
        reason: 'cooldown',
        retryAt: lastOfKind + cooldown,
      };
    }
  }

  // ⑦ 每小时上限（CRITICAL 已在 ④ 返回，不计入）
  const limit = hourlyLimitOf(prefs.maxPerHour);
  if (limit <= 0) {
    // 上限为 0（显式关闭非 CRITICAL 投递）⇒ 排到 1 小时后
    return {
      action: 'queue',
      reason: 'rate_limited',
      retryAt: now + MS_PER_HOUR,
    };
  }
  const lastHour = recent.filter((r) => now - r.deliveredAt < MS_PER_HOUR);
  if (lastHour.length >= limit) {
    const earliest = Math.min(...lastHour.map((r) => r.deliveredAt));
    return {
      action: 'queue',
      reason: 'rate_limited',
      retryAt: earliest + MS_PER_HOUR,
    };
  }

  // ⑧ 来源级预算（结构性兜底，2026-10-31）：同一 `source.type` 每小时最多 N 条。
  // 与 ⑦ 互补：⑦ 是全局预算，这里限制"单个来源"——否则一个 5 分钟一拍的机器来源
  // 可以合法吃满全局预算（真机：25 个项目同拍、671 条播报占通知总数 95%）。
  const sourceType = payload.source?.type;
  if (sourceType) {
    const sourceLimit = sourceLimitOf(sourceType, prefs.sourceMaxPerHour);
    if (sourceLimit > 0) {
      // 生产者约定：dedupeKey 以 `<source.type>:` 开头 ⇒ 无需额外列即可归属来源
      const prefix = `${sourceType}:`;
      const sameSource = recent.filter(
        (r) =>
          now - r.deliveredAt < MS_PER_HOUR && r.dedupeKey.startsWith(prefix)
      );
      if (sameSource.length >= sourceLimit) {
        return {
          action: 'queue',
          reason: 'rate_limited',
          retryAt:
            Math.min(...sameSource.map((r) => r.deliveredAt)) + MS_PER_HOUR,
        };
      }
    }
  }

  return { action: 'deliver', reason: 'ok' };
}

/** 门禁接口（供调用方注入；P1 只有纯函数实现） */
export interface ProactiveNotificationGate {
  evaluate(
    payload: ProactiveMessagePayload,
    ctx: ProactiveGateContext
  ): ProactiveGateDecision;
}

/** 创建门禁（P1：无状态；后续可注入仓储做 `recent` 查询） */
export function createProactiveNotificationGate(): ProactiveNotificationGate {
  return { evaluate: evaluateProactiveNotification };
}

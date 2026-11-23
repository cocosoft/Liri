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
 * 按**规则**维度的命中计数（R3 `hitCount` 与 ⑤「90 天未命中提示」的数据源）
 *
 * 背景：治理方案 §5「规则命中率」原只有工具/原因维度（`PermissionMetricsStore`），
 * 无法回答"这条规则到底还用不用得上" ⇒ R3 的 `hitCount` 与 ⑤ 只能返回 `null`（如实）。
 * 本模块补上最小必要事实：**每条规则 id 的命中次数 / 首次 / 最近命中时间**。
 *
 * 计数口径（与判定链一致）：
 * - 只在**真实判定**（`checkPermissionInner`）里计数，且只统计"决策由某条规则给出"的那次；
 * - `simulate`（设置页只读模拟）**不计数** —— 它直接调 `handleAuto/handleDefault`，不过本模块；
 * - 审批缓存命中（`ApprovedCommandRegistry`）不是规则 → 不计入。
 *
 * 持久化：`<pyapp-home>/data/permission/rule_hits.json`（节流写盘，最多每 5s 一次；
 * 崩溃最多丢最后 5s 的计数 —— 观测数据，可接受）。`PERMISSION_RULE_HIT_STATS` 可覆盖路径。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { configManager } from '@openliri/infra/config';
import { resolvePyappHome } from '@openliri/infra/environment';
import { getLogger } from '@openliri/infra/monitoring';

import { resolveRuleOrigin, type PermissionRule } from './types/PermissionRule';
import { filterPausedApprovalRules } from './approvalPause';

const logger = getLogger('permission:ruleHitStats');

/** 「长期未命中」判定窗口（天）——治理方案 §11.6-⑤ */
export const RULE_HIT_STALE_DAYS = 90;

/** 写盘节流间隔 */
const FLUSH_THROTTLE_INTERVAL = 5000;

/** 最多跟踪多少条规则（超出按最近命中时间裁剪，防止文件无界增长） */
const MAX_TRACKED_RULES = 500;

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

export interface RuleHitEntry {
  /** 命中次数 */
  count: number;
  /** 首次命中时间（epoch ms） */
  firstHitAt: number;
  /** 最近命中时间（epoch ms） */
  lastHitAt: number;
}

export interface RuleHitStatsSnapshot {
  version: 1;
  /** 开始计数的时刻（epoch ms）——「观察期不足」时不得报"未命中" */
  countingSince: number;
  rules: Record<string, RuleHitEntry>;
}

/** 命中统计文件路径（env 覆盖优先，测试/排障用；经统一出入口 configManager.env，R05-012） */
export function resolveRuleHitStatsPath(): string {
  const override = configManager.env('PERMISSION_RULE_HIT_STATS')?.trim();
  if (override) return override;
  return join(resolvePyappHome(), 'data', 'permission', 'rule_hits.json');
}

let state: RuleHitStatsSnapshot | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

/** 惰性加载（首次使用时读盘；损坏 ⇒ 重新开始并留 warn，不阻塞判定） */
function loadStats(): RuleHitStatsSnapshot {
  if (state) return state;
  const path = resolveRuleHitStatsPath();
  const fresh: RuleHitStatsSnapshot = {
    version: 1,
    countingSince: Date.now(),
    rules: {},
  };
  try {
    if (!existsSync(path)) {
      state = fresh;
      return state;
    }
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<
      RuleHitStatsSnapshot
    >;
    const rules =
      raw.rules && typeof raw.rules === 'object' && !Array.isArray(raw.rules)
        ? (raw.rules as Record<string, RuleHitEntry>)
        : {};
    state = {
      version: 1,
      countingSince:
        typeof raw.countingSince === 'number' && Number.isFinite(raw.countingSince)
          ? raw.countingSince
          : Date.now(),
      rules,
    };
  } catch (err) {
    logger.warn('规则命中统计读取失败，重新开始计数', {
      path,
      error: String(err),
    });
    state = fresh;
  }
  return state;
}

/** 裁剪到上限（保留最近命中的条目） */
function trimRules(rules: Record<string, RuleHitEntry>): Record<string, RuleHitEntry> {
  const entries = Object.entries(rules);
  if (entries.length <= MAX_TRACKED_RULES) return rules;
  entries.sort((a, b) => b[1].lastHitAt - a[1].lastHitAt);
  return Object.fromEntries(entries.slice(0, MAX_TRACKED_RULES));
}

/** 立即写盘（节流回调用；失败只 debug，不影响判定） */
export function flushRuleHitStats(): void {
  if (!dirty || !state) return;
  const path = resolveRuleHitStatsPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    state.rules = trimRules(state.rules);
    writeFileSync(path, `${JSON.stringify(state)}\n`, 'utf8');
    dirty = false;
  } catch (err) {
    // @ignore-catch — 观测数据写盘失败不得影响权限判定（CS03）
    logger.debug('规则命中统计写盘失败（忽略）', { path, error: String(err) });
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushRuleHitStats();
  }, FLUSH_THROTTLE_INTERVAL);
  flushTimer.unref?.();
}

/**
 * 记录一次规则命中（决策链唯一调用点；`simulate` 不调用）。
 *
 * @param ruleId 规则 id（缺失 ⇒ 忽略：无归属的决策无法计数）
 * @param at 命中时间（测试注入）
 */
export function recordRuleHit(ruleId: string, at: number = Date.now()): void {
  if (!ruleId) return;
  const stats = loadStats();
  const entry = stats.rules[ruleId] ?? {
    count: 0,
    firstHitAt: at,
    lastHitAt: at,
  };
  entry.count += 1;
  entry.lastHitAt = at;
  stats.rules[ruleId] = entry;
  dirty = true;
  scheduleFlush();
}

/** 当前统计快照（只读；未命中过的规则 ⇒ 无条目，调用方按 0 处理） */
export function readRuleHitStats(): RuleHitStatsSnapshot {
  return loadStats();
}

/** 单条规则的命中条目（未命中过 ⇒ `undefined`） */
export function getRuleHitEntry(ruleId: string): RuleHitEntry | undefined {
  return loadStats().rules[ruleId];
}

/** 仅供测试：清空内存态并取消待写盘（生产不应调用） */
export function resetRuleHitStatsForTest(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  state = null;
  dirty = false;
}

/** 长期未命中的规则（提示清理用） */
export interface StaleRuleInfo {
  ruleId: string;
  toolName: string;
  behavior: string;
  origin: 'user' | 'approval';
  contentPattern?: string;
  /** 最近命中时间（从未命中 ⇒ null） */
  lastHitAt: number | null;
  createdAt: number;
}

export interface RuleHitReport {
  /** 判定"未命中"的窗口（天） */
  staleDays: number;
  /** 开始计数的时刻 */
  countingSince: number;
  /** 已观察天数（向下取整） */
  observationDays: number;
  /**
   * 观察期是否已满 `staleDays`。
   *
   * 未满 ⇒ **不产出一条"未命中"结论**（否则会把"还没开始计数"误报成"规则没用"）。
   */
  observationComplete: boolean;
  /** 长期未命中的规则（按最近命中时间升序；`observationComplete=false` 时恒为空） */
  staleRules: StaleRuleInfo[];
}

/**
 * 生成"长期未命中"报告（纯函数）。
 *
 * 判定：`now - (lastHitAt ?? createdAt) >= staleDays` ⇒ 命中窗口内没被用过。
 * 观察期闸：`countingSince` 距今不足 `staleDays` ⇒ `observationComplete=false` 且不列规则。
 */
export function buildRuleHitReport(
  rules: PermissionRule[],
  stats: RuleHitStatsSnapshot,
  now: number = Date.now(),
  staleDays: number = RULE_HIT_STALE_DAYS
): RuleHitReport {
  const observationDays = Math.max(
    0,
    Math.floor((now - stats.countingSince) / MILLIS_PER_DAY)
  );
  const observationComplete = observationDays >= staleDays;
  if (!observationComplete) {
    return {
      staleDays,
      countingSince: stats.countingSince,
      observationDays,
      observationComplete: false,
      staleRules: [],
    };
  }

  const threshold = now - staleDays * MILLIS_PER_DAY;
  // F2（2026-11-17）：暂停「持久化放行」期间，审批生成规则**不参与判定** ⇒ 也不该被
  // 报成「未命中」。否则暂停越久，健康视图越像"这些规则该删"——把"有意不用"误报成"没用"。
  // 只按**全局**暂停判定：报告没有会话 / 工作区上下文，不臆造细粒度结论。
  const considered = filterPausedApprovalRules(rules);
  const staleRules: StaleRuleInfo[] = [];
  for (const rule of considered) {
    const entry = stats.rules[rule.id];
    const createdAt =
      rule.createdAt instanceof Date
        ? rule.createdAt.getTime()
        : new Date(rule.createdAt).getTime();
    const lastHitAt = entry?.lastHitAt ?? null;
    if ((lastHitAt ?? createdAt) > threshold) continue;
    staleRules.push({
      ruleId: rule.id,
      toolName: rule.toolName,
      behavior: String(rule.behavior),
      origin: resolveRuleOrigin(rule),
      ...(rule.contentPattern !== undefined
        ? { contentPattern: rule.contentPattern }
        : {}),
      lastHitAt,
      createdAt,
    });
  }
  staleRules.sort(
    (a, b) => (a.lastHitAt ?? a.createdAt) - (b.lastHitAt ?? b.createdAt)
  );
  return {
    staleDays,
    countingSince: stats.countingSince,
    observationDays,
    observationComplete: true,
    staleRules,
  };
}

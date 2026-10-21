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
 * dailyBudgetPersistence.ts — 日 Token 预算**用量状态**的轻量落盘
 *
 * `DailyBudgetManager.todayUsed` 原为**纯内存**（`restore()` 无生产消费者）⇒ 重启即清零，
 * 用户当日触及上限后重启即可继续消耗（日限额被绕过）。此处按既有
 * `buddy/growthPersistence.ts` 同款形态落盘 `{ date, used }` 到
 * `~/.pyapp/data/daily-budget-state.json`，供启动时恢复当日用量。
 *
 * 边界：仅持久化**用量状态**；上限/阈值属**配置**，走 ConfigManager 持久化配置
 * （键 `costControl.dailyTokenBudget`，见 `DailyBudgetManager` 的 D1 决策）。
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { readFileSync } from 'fs';
import { dirname } from 'path';
import { resolveScopedDataDir } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('query:dailyBudgetPersistence');

/** 可序列化的日预算状态快照（`date` 为**本地**自然日 YYYY-MM-DD） */
export interface DailyBudgetPersistedState {
  date: string;
  used: number;
  /**
   * D-d（2026-10-11）：**透支欠账**（`waive-once` 消耗）——次日计入用量扣回。
   * 缺省（旧文件）按 0 读取。
   */
  debt?: number;
  /**
   * D-b（2026-10-11）：**放行状态**（`boost` / `unlock-today`）——重启后按 `expiresAt`
   * 判定是否仍生效（**已过期即作废**，防"重启即提额"）。缺省（旧文件）按无放行读取。
   */
  relief?: {
    kind: 'boost' | 'waive-once' | 'unlock-today';
    expiresAt: number | null;
    factor?: number;
    amount?: number;
  } | null;
  /**
   * 债四 S5（T3-5/6/7，2026-10-13）：USD 口径**已用**（与 `used` 并行的第二本账）。
   *
   * ⚠️ **不臆造**：旧文件无此字段 ⇒ 按 **0** 读取，**绝不**由 token 反推金额（避免用未知价表污染账目）。
   * 上限（`limitUsd`）**不在此文件** —— 它属**配置**（键 `costControl.dailyBudgetUSD`，见 §5 与 §12 Q-U3）。
   */
  usedUsd?: number;
  /** 债四 S5：USD 口径**透支欠账**（次日由 `_rolloverIfNeeded()` 计入用量扣回）。缺省按 0。 */
  debtUsd?: number;
}

/**
 * 日预算状态文件路径。
 *
 * 多租户 P1（2026-10-21）：**随身份分区** —— 本地身份仍是
 * `<data>/daily-budget-state.json`（零变更）；已认证身份为
 * `<data>/tenants/<tenantId>/users/<userId>/daily-budget-state.json`。
 */
export function dailyBudgetStatePath(): string {
  return `${resolveScopedDataDir()}/daily-budget-state.json`;
}

/**
 * 解析状态文件内容（同步/异步读取共用的**唯一**校验逻辑）。
 * 形状非法 ⇒ `null`（不臆造、不半读）。
 */
function parseDailyBudgetState(raw: string): DailyBudgetPersistedState | null {
  const parsed = JSON.parse(raw) as Partial<DailyBudgetPersistedState>;
  const used = Number(parsed.used);
  if (typeof parsed.date !== 'string' || !Number.isFinite(used)) {
    logger.warn('日预算状态文件格式非法，忽略', {
      date: parsed.date,
      used: parsed.used,
    });
    return null;
  }
  const debt = Number(parsed.debt);
  // 债四 S5：USD 两字段**各自独立**校验；缺失/非法 ⇒ 0（**不**由 token 反推，见接口注释）
  const usedUsd = Number(parsed.usedUsd);
  const debtUsd = Number(parsed.debtUsd);
  return {
    date: parsed.date,
    used: Math.max(0, Math.floor(used)),
    // 旧文件无 `debt` ⇒ 按 0 读取（见接口注释）
    debt: Number.isFinite(debt) ? Math.max(0, Math.floor(debt)) : 0,
    relief: normalizeRelief(parsed.relief),
    usedUsd: Number.isFinite(usedUsd) ? Math.max(0, usedUsd) : 0,
    debtUsd: Number.isFinite(debtUsd) ? Math.max(0, debtUsd) : 0,
  };
}

/**
 * 同步读取（多租户 P1：首次进入某身份作用域时**同步**恢复用量）。
 *
 * 为什么需要同步版：预算管理器按身份懒建，创建发生在**同步**的 `getDailyBudget()` 里
 * （热路径，不能改成 async）；若先返回未恢复的空账，会让该身份的当日用量从 0 起算
 * ⇒ 预算闸门被绕过。单文件很小，同步读一次可接受。
 */
export function loadDailyBudgetStateSync(): DailyBudgetPersistedState | null {
  try {
    return parseDailyBudgetState(readFileSync(dailyBudgetStatePath(), 'utf-8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('同步读取日预算状态失败，忽略', { error: String(e) });
    }
    return null;
  }
}

/**
 * 放行状态的**边界校验**（持久化文件属外部输入：旧版本无此字段、用户可能手改）。
 * 形状不合规 ⇒ 按"无放行"读取（丢弃），避免半截状态被当成有效放行（防"重启即提额"）。
 */
function normalizeRelief(input: unknown): DailyBudgetPersistedState['relief'] {
  if (!input || typeof input !== 'object') return null;
  const r = input as Record<string, unknown>;
  const kind = r.kind;
  if (kind !== 'boost' && kind !== 'waive-once' && kind !== 'unlock-today') {
    return null;
  }
  // `expiresAt`：`null`（unlock-today 至日界）或时间戳；缺失/非法 ⇒ 丢弃
  if (r.expiresAt !== null && typeof r.expiresAt !== 'number') return null;
  return {
    kind,
    expiresAt: r.expiresAt as number | null,
    ...(typeof r.factor === 'number' ? { factor: r.factor } : {}),
    ...(typeof r.amount === 'number' ? { amount: r.amount } : {}),
  };
}

/**
 * 读取持久化的日预算状态。
 * 文件缺失（首次运行）或内容损坏 ⇒ 返回 `null`（调用方按 0 起算）。
 *
 * D-b/D-d 修复（2026-10-11）：本条**必须与 `_persistedState()` 写入形状对称** ——
 * 写入侧含 `{date, used, debt, relief}`，此前读取侧只回 `{date, used}` ⇒
 * `initDailyBudget().restore({debt, relief})` 恒拿到 `undefined` ⇒ **欠账与放行重启即丢**
 * （D-d 次日扣回静默失效、D-b 放行丢失），违反 spec §8「持久化往返」/§10-2。
 */
export async function loadDailyBudgetState(): Promise<DailyBudgetPersistedState | null> {
  try {
    return parseDailyBudgetState(
      await readFile(dailyBudgetStatePath(), 'utf-8')
    );
  } catch (e) {
    // 文件不存在 ⇒ 首次运行，属正常路径，不告警
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('读取日预算状态失败，忽略', { error: String(e) });
    }
    return null;
  }
}

/**
 * 写入日预算状态。落盘失败不影响本次运行（内存态仍准确），仅记录以便排查。
 */
export async function saveDailyBudgetState(
  state: DailyBudgetPersistedState
): Promise<void> {
  try {
    const file = dailyBudgetStatePath();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(state), 'utf-8');
  } catch (e) {
    logger.warn('保存日预算状态失败', { error: String(e) });
  }
}

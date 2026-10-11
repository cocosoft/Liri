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
import { dirname } from 'path';
import { resolveDataDir } from '@modules/core/paths';
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
}

export function dailyBudgetStatePath(): string {
  return `${resolveDataDir()}/daily-budget-state.json`;
}

/**
 * 读取持久化的日预算状态。
 * 文件缺失（首次运行）或内容损坏 ⇒ 返回 `null`（调用方按 0 起算）。
 */
export async function loadDailyBudgetState(): Promise<DailyBudgetPersistedState | null> {
  try {
    const raw = await readFile(dailyBudgetStatePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<DailyBudgetPersistedState>;
    const used = Number(parsed.used);
    if (typeof parsed.date !== 'string' || !Number.isFinite(used)) {
      logger.warn('日预算状态文件格式非法，忽略', {
        date: parsed.date,
        used: parsed.used,
      });
      return null;
    }
    return { date: parsed.date, used: Math.max(0, Math.floor(used)) };
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

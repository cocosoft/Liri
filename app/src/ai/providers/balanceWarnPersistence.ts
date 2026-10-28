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
 * balanceWarnPersistence.ts — 余额查询「持续性告警已记过」的轻量落盘
 *
 * 为什么需要（台账 `BALANCE-WARN-DEDUPE` 的续作 `BALANCE-WARN-PERSIST`）：余额查询的持续性故障
 * （如 SiliconFlow `/user/info` 官方下线）在**每次进程重启**后会再刷一条 warning —— 而本仓 dev
 * 模式每次保存源码都会重启、生产也会重启 ⇒ 「进程内闸门」只解决了一半噪音。
 *
 * 落盘内容 = **「同一状态已经告警过」这一事实**（不是「永久静音」）：键为 `${provider}|${kind}`，
 * 值含 `warnedAt`（便于排查「什么时候第一次发现」）。**查询成功时由调用方清除对应 provider 的条目**
 * ⇒ 状态真的恢复（或再次故障）时仍会重新告警，不掩盖状态变化。
 *
 * 形态对齐既有先例 `query/dailyBudgetPersistence.ts`（同款：`resolveDataDir()` 下 `*-state.json`、
 * 读取容错 ENOENT、写盘失败只告警不抛）。
 *
 * **落盘文件**：`~/.pyapp/data/balance-warn-state.json`
 * ```json
 * { "version": 1, "entries": { "siliconflow|retired": { "warnedAt": 1792199937886, "apiCode": 20092 } } }
 * ```
 * 排查用法：想知道「某 provider 的某类故障**首次**是什么时候发现的」看 `warnedAt`；
 * 想让它**重新告警**（例如确认已修复后想再观察）删掉对应键（或整个文件）即可。
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { resolveDataDir } from '@modules/environment';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('ai:providers:balanceWarnPersistence');

/** 单条「已告警」记录 */
export interface RecurringWarnRecord {
  /** 首次告警时刻（epoch ms；仅用于排查，不参与判定） */
  warnedAt: number;
  /** 可选：触发时的平台错误码（便于排查同类错误是否换了码） */
  apiCode?: number;
}

/** 可序列化的落盘快照 */
export interface BalanceWarnPersistedState {
  version: 1;
  /** 键 = `${provider}|${kind}`（与内存闸门同口径） */
  entries: Record<string, RecurringWarnRecord>;
}

/**
 * 条目数上限（防「provider × 错误码」组合无限增长）。
 * 超出 ⇒ 按 `warnedAt` **丢弃最旧**的 —— 丢最旧即「最可能再次告警」，是保守选择。
 *
 * 命名带域前缀（`BALANCE_WARN_`）：全仓 `MAX_ENTRIES` 已有 2 处定义 ⇒ 按仓内惯例「同名常量按域消歧」
 * （另起通用名会触发 `lint:consts` 棘轮红）。
 */
const BALANCE_WARN_MAX_ENTRIES = 200;

export function balanceWarnStatePath(): string {
  return `${resolveDataDir()}/balance-warn-state.json`;
}

/**
 * 读取落盘状态。文件缺失（首次运行）／内容损坏／形状非法 ⇒ 一律回**空表**（不抛、不臆造）。
 */
export async function loadBalanceWarnState(): Promise<BalanceWarnPersistedState> {
  const empty: BalanceWarnPersistedState = { version: 1, entries: {} };
  try {
    const raw = await readFile(balanceWarnStatePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<BalanceWarnPersistedState>;
    const src = parsed.entries;
    if (!src || typeof src !== 'object') {
      logger.warn('余额告警状态文件缺少 entries，按空表读取');
      return empty;
    }
    const entries: Record<string, RecurringWarnRecord> = {};
    for (const [key, value] of Object.entries(src)) {
      // 逐条校验：形状不合规的条目**丢弃**（持久化文件属外部输入，可能被旧版本/手改污染）
      if (!value || typeof value !== 'object') continue;
      const rec = value as Partial<RecurringWarnRecord>;
      if (typeof rec.warnedAt !== 'number') continue;
      entries[key] = {
        warnedAt: rec.warnedAt,
        ...(typeof rec.apiCode === 'number' ? { apiCode: rec.apiCode } : {}),
      };
    }
    return { version: 1, entries };
  } catch (e) {
    // 文件不存在 ⇒ 首次运行，属正常路径，不告警
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('读取余额告警状态失败，按空表处理', { error: String(e) });
    }
    return empty;
  }
}

/**
 * 写入落盘状态（**永不抛**：落盘失败不影响本次运行，内存闸门仍生效，仅记录以便排查）。
 * 写入前按 `warnedAt` 截断至 `MAX_ENTRIES`（丢最旧）。
 */
export async function saveBalanceWarnState(
  state: BalanceWarnPersistedState
): Promise<void> {
  try {
    const keys = Object.keys(state.entries);
    let entries = state.entries;
    if (keys.length > BALANCE_WARN_MAX_ENTRIES) {
      const kept = keys
        .sort((a, b) => state.entries[b]!.warnedAt - state.entries[a]!.warnedAt)
        .slice(0, BALANCE_WARN_MAX_ENTRIES);
      entries = Object.fromEntries(kept.map((k) => [k, state.entries[k]!]));
    }
    const file = balanceWarnStatePath();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ version: 1, entries }), 'utf-8');
  } catch (e) {
    logger.warn('保存余额告警状态失败（内存闸门仍生效）', { error: String(e) });
  }
}

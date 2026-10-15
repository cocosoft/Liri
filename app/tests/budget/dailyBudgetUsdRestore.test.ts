// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// USD 台账「重启恢复」回归（2026-10-15，USD 日限额启用前置）：
//
// 缺陷（真机实证）：状态文件 `daily-budget-state.json` 含 `usedUsd:0.863076`，而运行时
// `GET /v1/cost/daily-budget` 返回 `usedUsd: 0` —— **仅 USD 轨丢失**（同响应的 token 侧
// `todayUsed` 恢复正确）。根因：`initDailyBudget()` 调 `restore()` 时**漏传 `usedUsd`/`debtUsd`**
// （读取侧 `loadDailyBudgetState()` 已补该两字段，调用侧未同步透传 —— 与
// `dailyBudgetPersistence.ts` 注释所载 D-b/D-d 历史缺陷**同型**）。
// 后果：USD 闸门启用后「重启即清零」⇒ 用户可通过重启绕过限额。

import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DailyBudgetManager } from '../../src/query/DailyBudgetManager.js';

describe('USD 台账：restore 往返（重启不丢）', () => {
  it('① 同一天恢复 ⇒ usedUsd / debtUsd 如实回填（不再恒为 0）', () => {
    const mgr = new DailyBudgetManager();
    mgr.restore({
      todayUsed: 12_345,
      // date 缺省 ⇒ sameDay（保持历史语义），避免依赖本地日期
      usedUsd: 1.5,
      debtUsd: 0.25,
    });
    const usd = mgr.getUsdState();
    expect(usd.usedUsd).toBe(1.5);
    expect(usd.debtUsd).toBe(0.25);
  });

  it('② 跨日恢复 ⇒ USD 已用归零、欠账计入新的一天（与 token 口径同法）', () => {
    const mgr = new DailyBudgetManager();
    mgr.restore({
      todayUsed: 9_999,
      date: '1970-01-01',
      usedUsd: 8.8,
      debtUsd: 0.4,
    });
    const usd = mgr.getUsdState();
    expect(usd.usedUsd).toBe(0.4); // carriedDebtUsd
    expect(usd.debtUsd).toBe(0); // 新的一天重新计欠
  });

  it('③ 源码守卫：`initDailyBudget` 的 restore 必须透传 usedUsd / debtUsd', () => {
    const src = readFileSync(
      join(__dirname, '..', '..', 'src', 'query', 'DailyBudgetManager.ts'),
      'utf-8'
    );
    const idx = src.indexOf('export async function initDailyBudget');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 900);
    expect(block).toContain('usedUsd: persisted.usedUsd');
    expect(block).toContain('debtUsd: persisted.debtUsd');
  });
});

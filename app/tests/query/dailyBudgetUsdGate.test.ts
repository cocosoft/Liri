/**
 * USD-4 —— 日预算闸门**金额轨「双轨从严」**（治理方案 §6.3 / §6.4；债四 S3）。
 *
 * 契约（四条硬约束，逐条钉死）：
 *  ① **单一判定点**：金额轨在既有**唯一收口** `checkDailyBudget` 内判定，**不新增第二个闸门**；
 *  ② **不新增账本**：金额轨只**读** S5/S8 既有 `usedUsd` / `limitUsd`（闸门内不预留/不结算）；
 *  ③ **从严 = 任一先踩线即拒**：`金额已越界 OR Token 轨已越界` ⇒ 拒（`allowed=false`）；
 *  ④ **启用条件** = 开关 `USD_BUDGET_GATE` 开 **且** 用户已配置 `limitUsd`（**无默认值**）。
 *
 * **零行为变更口径（最重要）**：未配置 `limitUsd`（或开关关）⇒ 判定与快照与"没有金额轨"时
 * **逐字一致**（快照仍为 `unit: 'tokens'`，用户文案不变）。
 */
import { beforeEach, afterEach, describe, expect, it } from 'bun:test';
import {
  getDailyBudget,
  resetDailyBudgetForTest,
} from '../../src/query/DailyBudgetManager';
import {
  checkDailyBudget,
  formatBudget,
  formatBudgetExhausted,
  formatUsdAmount,
} from '../../src/query/dailyBudgetGate';

const ENV_TOKENS = 'LIRI_DAILY_BUDGET_TOKENS';
const ENV_USD = 'LIRI_DAILY_BUDGET_USD';
const ENV_FLAG = 'FEATURE_USD_BUDGET_GATE';

/** 用户"已保存金额上限"（配置面；本用例经 env 等价注入，避免写盘） */
function setUsdLimit(limit: number): void {
  process.env[ENV_USD] = String(limit);
}
function enableUsdGate(): void {
  process.env[ENV_FLAG] = 'true';
}

beforeEach(() => {
  resetDailyBudgetForTest();
  delete process.env[ENV_TOKENS];
  delete process.env[ENV_USD];
  delete process.env[ENV_FLAG];
});

afterEach(() => {
  resetDailyBudgetForTest();
  delete process.env[ENV_TOKENS];
  delete process.env[ENV_USD];
  delete process.env[ENV_FLAG];
});

describe('USD-4 · 启用条件与零行为变更（约束④）', () => {
  it('未配置 limitUsd（开关开）⇒ 判定与快照与「开关关」**逐字一致**', () => {
    getDailyBudget().setLimit(100);
    getDailyBudget().recordUsage(50);
    const withoutFlag = checkDailyBudget({
      sessionId: 's1',
      estimatedTokens: 10,
    });
    enableUsdGate(); // 开关开，但**用户未配置**金额上限 ⇒ 金额轨不启用
    const withFlag = checkDailyBudget({ sessionId: 's1', estimatedTokens: 10 });
    expect(withFlag).toEqual(withoutFlag);
    expect(withFlag.snapshot.unit).toBe('tokens');
  });

  it('开关关 + 金额已越界 ⇒ **仍放行**（金额轨不参与判定）', () => {
    setUsdLimit(1);
    getDailyBudget().recordUsdUsage(5); // 5 >= 1 ⇒ 金额越界，但开关关
    const r = checkDailyBudget({ sessionId: 's1', estimatedTokens: 0 });
    expect(r.allowed).toBe(true);
    expect(r.snapshot.unit).toBe('tokens');
  });

  it('开关开 + 已配置 + 金额未越界 ⇒ 放行，快照仍为 Token 轨', () => {
    // ⚠️ **顺序不变量**：单例在**首次取用时**才 `resolveDailyBudgetConfig()`（读配置）
    // ⇒ 必须先设 env / 先建单例，再改状态；反之会读到"未配置"（用例将**因错误原因通过**）。
    setUsdLimit(100);
    enableUsdGate();
    getDailyBudget().setLimit(1_000_000);
    getDailyBudget().recordUsdUsage(1); // 1 < 100
    const r = checkDailyBudget({ sessionId: 's1', estimatedTokens: 0 });
    expect(r.allowed).toBe(true);
    expect(r.snapshot.unit).toBe('tokens');
  });
});

describe('USD-4 · 金额轨独占拒绝（约束③ 前半 + 归因）', () => {
  it('金额越界（Token 轨放行）⇒ 拒发，快照归因 `usd`（金额值 + `$` 展示串）', () => {
    setUsdLimit(1); // 先设配置（单例创建时读）
    enableUsdGate();
    getDailyBudget().setLimit(1_000_000); // Token 轨余量充足
    getDailyBudget().recordUsdUsage(1.5); // 1.5 >= 1
    const r = checkDailyBudget({ sessionId: 's1', estimatedTokens: 0 });
    expect(r.allowed).toBe(false);
    expect(r.snapshot.unit).toBe('usd');
    expect(r.snapshot.used).toBe(1.5);
    expect(r.snapshot.limit).toBe(1);
    expect(r.snapshot.formatted).toBe('$1.50');
    expect(r.snapshot.mode).toBe('normal'); // USD **不参与**档位计算（档位仍看 Token）
  });
});

describe('USD-4 · 双轨从严（约束③：任一先踩线即拒）', () => {
  it('金额未越界但 **Token 越界** ⇒ 仍拦（归因 Token）', () => {
    setUsdLimit(1_000);
    enableUsdGate();
    getDailyBudget().setLimit(100);
    getDailyBudget().recordUsage(100); // Token 越界
    getDailyBudget().recordUsdUsage(1); // 金额远未越界
    const r = checkDailyBudget({ sessionId: 's1', estimatedTokens: 0 });
    expect(r.allowed).toBe(false);
    expect(r.snapshot.unit).toBe('tokens');
  });

  it('两轨**同时**越界 ⇒ 仍拦，归因 Token（用户文案与历史一致）', () => {
    setUsdLimit(1);
    enableUsdGate();
    getDailyBudget().setLimit(100);
    getDailyBudget().recordUsage(100);
    getDailyBudget().recordUsdUsage(9);
    const r = checkDailyBudget({ sessionId: 's1', estimatedTokens: 0 });
    expect(r.allowed).toBe(false);
    expect(r.snapshot.unit).toBe('tokens');
  });
});

describe('USD-4 · 单位无关快照与文案（Token 轨逐字不变）', () => {
  it('预算已用完文案：Token 轨**逐字保留**、金额轨走货币格式', () => {
    expect(
      formatBudgetExhausted({
        used: 12,
        limit: 100,
        unit: 'tokens',
        formatted: '12 Tokens',
        mode: 'normal',
      })
    ).toBe('今日 Token 预算已用完（已用 12 / 上限 100）');
    expect(
      formatBudgetExhausted({
        used: 1.5,
        limit: 1,
        unit: 'usd',
        formatted: '$1.50',
        mode: 'normal',
      })
    ).toBe('今日金额预算已用完（已用 $1.50 / 上限 $1.00）');
  });

  it('金额展示：最少 2 位 / 最多 4 位小数（小额不被抹成 $0.00）', () => {
    expect(formatUsdAmount(0)).toBe('$0.00');
    expect(formatUsdAmount(1.5)).toBe('$1.50');
    expect(formatUsdAmount(0.0031)).toBe('$0.0031');
    expect(formatUsdAmount(1234.5)).toBe('$1,234.50');
    expect(formatBudget(1.5, 'usd')).toBe('$1.50');
    // Token 轨既有格式不变
    expect(formatBudget(901200, 'tokens')).toBe('901.2 K Tokens');
  });
});

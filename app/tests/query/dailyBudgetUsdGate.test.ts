/**
 * 债四 **S3「闸门切金额」** —— 日预算**主口径**（治理方案 D1 / §6.3–§6.4；2026-10-15 落地）。
 *
 * 契约（**取代**原「USD-4 双轨从严」，逐条钉死）：
 *  ① **单一判定点**：仍在**唯一收口** `checkDailyBudget` 内判定，**不新增第二个闸门**；
 *  ② **不新增账本**：金额口径只**读** S5/S8 既有 `usedUsd` / `limitUsd`；
 *  ③ **单轨从严（主口径）**：USD 轨启用 ⇒ **金额是唯一硬闸门**；Token 轨**降级为观测告警**
 *     （用户 2026-10-15 裁定）—— Token 越界**不再**拒发（旧"任一先踩线即拒"已废）；
 *  ④ **启用条件** = `FEATURE_USD_BUDGET_GATE` 开 **且** 用户已配置 `limitUsd`（**无默认值**）；
 *     不满足 ⇒ **回落** Token 口径（降级可用，不 fail；`unified-budget-and-accounting.md` §225 回退②）。
 *
 * 口径切换点：`DailyBudgetManager._primaryUnit()`；生效面：`_computeState()`
 * （档位 / `percentUsed` / `remaining`）与 `checkDailyBudget()` 的快照。
 *
 * ⚠️ `FEATURE_USD_BUDGET_GATE` 的**静态默认已为 `true`**（2026-10-15 启用）⇒ 用例要"关开关"
 * 必须**显式**注入 `FEATURE_USD_BUDGET_GATE=false`，**不能**靠 `delete env`（删了会落回静态 true）。
 */
import { beforeEach, afterEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/**
 * 用户"已配置金额上限"。
 *
 * ⚠️ **必须走运行时 API**（不能用 env）：`resolveDailyBudgetConfig()` 读的是 ConfigManager 的
 * **初始化快照**且「配置键 > env」⇒ 开发机 `config.json` 里已有 `costControl.dailyBudgetUSD` 时
 * env 注入会被配置键压过（2026-10-15 实测：env 设 1，实际读到 10）。
 * `resetDailyBudgetForTest()` 已保证默认不继承配置面 USD 上限 ⇒ 显式开启由本函数负责。
 */
function setUsdLimit(limit: number): void {
  getDailyBudget().setLimitUsd(limit);
}
function enableUsdGate(): void {
  process.env[ENV_FLAG] = 'true';
}
function disableUsdGate(): void {
  process.env[ENV_FLAG] = 'false';
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

describe('S3 · 启用条件（约束④：不满足即回落 Token 口径）', () => {
  it('开关**显式关** + 金额已越界 ⇒ 回落 Token：仍放行，快照 unit=tokens', () => {
    setUsdLimit(1);
    disableUsdGate();
    getDailyBudget().recordUsdUsage(5); // 5 >= 1 ⇒ 金额越界，但开关关
    const r = checkDailyBudget({ sessionId: 's1', estimatedTokens: 0 });
    expect(r.allowed).toBe(true);
    expect(r.snapshot.unit).toBe('tokens');
  });

  it('开关开 + **未配** limitUsd ⇒ 回落 Token（不 fail，档位仍按 Token）', () => {
    enableUsdGate();
    getDailyBudget().setLimit(100);
    getDailyBudget().recordUsage(100); // Token 越界
    const r = checkDailyBudget({ sessionId: 's1', estimatedTokens: 0 });
    expect(r.snapshot.unit).toBe('tokens');
    expect(r.allowed).toBe(false); // 回落口径下 Token 仍拦（降级可用而非失效）
    expect(r.snapshot.mode).toBe('locked');
  });
});

describe('S3 · 金额为主口径（约束③ 前半）', () => {
  it('已配 + 金额未越界 ⇒ 放行，快照为**金额**口径', () => {
    // ⚠️ **顺序不变量**：单例在**首次取用时**才 `resolveDailyBudgetConfig()`（读 env/配置）
    // ⇒ 必须先注入 env，再建单例；反之会读到"未配置"（用例将**因错误原因通过**）。
    setUsdLimit(100);
    enableUsdGate();
    getDailyBudget().setLimit(1_000_000); // Token 余量充足
    getDailyBudget().recordUsdUsage(1); // 1 < 100
    const r = checkDailyBudget({ sessionId: 's1', estimatedTokens: 0 });
    expect(r.allowed).toBe(true);
    expect(r.snapshot.unit).toBe('usd');
    expect(r.snapshot.used).toBe(1);
    expect(r.snapshot.limit).toBe(100);
    expect(r.snapshot.mode).toBe('normal');
  });

  it('金额越界 ⇒ **拒发**，快照为金额值 + `$` 展示串，档位按金额 = locked', () => {
    setUsdLimit(1);
    enableUsdGate();
    getDailyBudget().setLimit(1_000_000); // Token 轨余量充足
    getDailyBudget().recordUsdUsage(1.5); // 1.5 >= 1
    const r = checkDailyBudget({ sessionId: 's1', estimatedTokens: 0 });
    expect(r.allowed).toBe(false);
    expect(r.snapshot.unit).toBe('usd');
    expect(r.snapshot.used).toBe(1.5);
    expect(r.snapshot.limit).toBe(1);
    expect(r.snapshot.formatted).toBe('$1.50');
    expect(r.snapshot.mode).toBe('locked');
  });
});

describe('S3 · Token 轨降级为观测告警（Plan A 核心）', () => {
  it('金额未越界而 **Token 严重越界** ⇒ **仍放行**（旧"任一踩线即拒"已废）', () => {
    setUsdLimit(1_000);
    enableUsdGate();
    getDailyBudget().setLimit(100); // Token 基数很小
    getDailyBudget().recordUsage(1_000_000); // Token 越界 1 万倍
    getDailyBudget().recordUsdUsage(1); // 金额远未越界
    const r = checkDailyBudget({ sessionId: 's1', estimatedTokens: 0 });
    expect(r.allowed).toBe(true);
    expect(r.snapshot.unit).toBe('usd');
    // Token 轨数字仍在快照/状态里**可见**（观测不删）
    expect(getDailyBudget().getMode().todayUsed).toBe(1_000_000);
  });

  it('kill-switch **不可**被 waive-once 绕过（硬锁优先，S3 一并收紧）', () => {
    setUsdLimit(1_000);
    enableUsdGate();
    getDailyBudget().setLimit(1_000_000);
    getDailyBudget().applyRelief({ kind: 'waive-once' }); // 在途通行证
    getDailyBudget().enableKillSwitch();
    const r = checkDailyBudget({ sessionId: 's1', estimatedTokens: 0 });
    expect(r.allowed).toBe(false);
    expect(r.snapshot.mode).toBe('locked');
  });

  it('`canExecute` / `canSpawnSubAgent` 在 USD 主口径下**不再**被 Token 轨阻断', () => {
    setUsdLimit(1_000);
    enableUsdGate();
    getDailyBudget().setLimit(100);
    getDailyBudget().recordUsage(1_000_000); // Token 越界 1 万倍
    getDailyBudget().recordUsdUsage(1); // 金额远未越界
    // TAORLoop / AgentTool 两侧的准入判据同样随主口径走（不再被 Token 轨拦）
    expect(getDailyBudget().canExecute('s1')).toBe(true);
    expect(getDailyBudget().canSpawnSubAgent()).toBe(true);
  });

  it('USD 越界 ⇒ `canExecute` = false（硬闸门在**所有**准入点一致生效）', () => {
    setUsdLimit(1);
    enableUsdGate();
    getDailyBudget().setLimit(1_000_000);
    getDailyBudget().recordUsdUsage(2); // 2 >= 1
    expect(getDailyBudget().canExecute('s1')).toBe(false);
  });
});

describe('S3 · 源码守卫（防回流到「双轨从严」）', () => {
  it('闸门判定式**不得**再出现 Token 轨 conjunct（`tokenAllowed && !usdExceeded`）', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../src/query/dailyBudgetGate.ts'),
      'utf8'
    );
    expect(src).not.toContain('tokenAllowed && !usdExceeded');
    // 主口径分流必须存在（`state.unit === 'usd'` 分支即回退路径的载体）
    expect(src).toContain("state.unit === 'usd'");
  });
});

describe('USD · 单位无关快照与文案', () => {
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

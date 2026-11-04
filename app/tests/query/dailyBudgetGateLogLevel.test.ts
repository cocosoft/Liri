// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P2-1（2026-11-04）：`dailyBudgetGate:decision` 日志分级。
 *
 * 真机窗口内该行 56 583 条 / 26.9 MB，绝大多数是"稳态放行"（信息量为零）；但它同时是
 * `BUDGET-USD-PRIMARY` 的哨兵（核对 `primary.exceeded` 与 `allowed` 是否不一致）⇒
 * 只把**稳态**降 debug，下列情形仍 INFO：
 *   拒发 / 主口径已越界却放行（waive-once）/ kill-switch / waiver。
 *
 * 两层验证：① 纯函数判据（`shouldLogBudgetDecisionAtInfo`）；② 真实 `checkDailyBudget()`
 * 接线（防"判据对了但没接线"）。
 */
import { beforeEach, afterEach, describe, expect, it, spyOn } from 'bun:test';
import { getLogger } from '@openliri/infra/monitoring';
import {
  getDailyBudget,
  resetDailyBudgetForTest,
} from '../../src/query/DailyBudgetManager';
import {
  checkDailyBudget,
  shouldLogBudgetDecisionAtInfo,
} from '../../src/query/dailyBudgetGate';

const ENV_FLAG = 'FEATURE_USD_BUDGET_GATE';
const gateLogger = getLogger('query:dailyBudgetGate');

beforeEach(() => {
  resetDailyBudgetForTest();
  delete process.env[ENV_FLAG];
});

afterEach(() => {
  resetDailyBudgetForTest();
  delete process.env[ENV_FLAG];
});

describe('shouldLogBudgetDecisionAtInfo：分级判据', () => {
  it('稳态放行 ⇒ false（降 debug）', () => {
    expect(
      shouldLogBudgetDecisionAtInfo({
        allowed: true,
        exceeded: false,
        killSwitch: false,
        waiver: false,
      })
    ).toBe(false);
  });

  it('拒发 / 越界 / kill-switch / waiver 任一成立 ⇒ true（保留 INFO）', () => {
    for (const over of [
      { allowed: false },
      { exceeded: true },
      { killSwitch: true },
      { waiver: true },
    ]) {
      expect(
        shouldLogBudgetDecisionAtInfo({
          allowed: true,
          exceeded: false,
          killSwitch: false,
          waiver: false,
          ...over,
        })
      ).toBe(true);
    }
  });
});

describe('checkDailyBudget 接线：哪条走哪个级别', () => {
  let infoSpy: ReturnType<typeof spyOn>;
  let debugSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    infoSpy = spyOn(gateLogger, 'info');
    debugSpy = spyOn(gateLogger, 'debug');
  });

  afterEach(() => {
    infoSpy.mockRestore();
    debugSpy.mockRestore();
  });

  const countInfo = () =>
    infoSpy.mock.calls.filter((c) => c[0] === 'dailyBudgetGate:decision')
      .length;
  const countDebug = () =>
    debugSpy.mock.calls.filter((c) => c[0] === 'dailyBudgetGate:decision')
      .length;

  it('默认（Token 只观测、未越界）⇒ debug，INFO 为 0', () => {
    const r = checkDailyBudget({ sessionId: 's1', estimatedTokens: 0 });
    expect(r.allowed).toBe(true);
    expect(countInfo()).toBe(0);
    expect(countDebug()).toBe(1);
  });

  it('USD 轨越界 ⇒ 拒发，仍进 INFO', () => {
    process.env[ENV_FLAG] = 'true';
    getDailyBudget().setLimitUsd(1);
    getDailyBudget().recordUsdUsage(5);

    const r = checkDailyBudget({ sessionId: 's1', estimatedTokens: 0 });
    expect(r.allowed).toBe(false);
    expect(countInfo()).toBe(1);
    expect(countDebug()).toBe(0);
  });

  it('waive-once 放行（已越界却允许）⇒ 进 INFO（哨兵要比对 exceeded/allowed）', () => {
    process.env[ENV_FLAG] = 'true';
    getDailyBudget().setLimitUsd(1);
    getDailyBudget().recordUsdUsage(5);
    getDailyBudget().applyRelief({ kind: 'waive-once' });

    const r = checkDailyBudget({ sessionId: 's1', estimatedTokens: 0 });
    expect(r.allowed).toBe(true);
    expect(countInfo()).toBe(1);
    expect(countDebug()).toBe(0);
    const payload = infoSpy.mock.calls.find(
      (c) => c[0] === 'dailyBudgetGate:decision'
    )?.[1] as { primary?: { exceeded?: boolean }; allowed?: boolean };
    expect(payload?.primary?.exceeded).toBe(true);
    expect(payload?.allowed).toBe(true);
  });

  it('kill-switch ⇒ 拒发，仍进 INFO', () => {
    getDailyBudget().enableKillSwitch();

    const r = checkDailyBudget({ sessionId: 's1', estimatedTokens: 0 });
    expect(r.allowed).toBe(false);
    expect(countInfo()).toBe(1);
    expect(countDebug()).toBe(0);
  });
});

// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P2-1（2026-11-04，《运行态问题排查与修复方案》）：预算检查日志的**级别口径**。
 *
 * 实测（窗口 `since=2026-11-04T04:00`，189 011 行）：
 * - `tokenBudget:checkBudget` **13 060 条、status 全是 normal** —— 每次 check 都打；
 * - `unified:checkBeforeRequest` 2 663 条里 **2 217 条是 skip**（水位远低于阈值）。
 *
 * 现两者 steady-state 降为 debug，压力态 / 决策态仍 INFO。本文件钉住该边界，
 * 防止有人把"每次请求都打"的 info 又加回来。
 */
import { describe, it, expect, spyOn, afterEach } from 'bun:test';
// 被测模块经 kernel 日志门面取 logger（延迟绑定代理，按 module 缓存身份）⇒ 直接对该实例打桩
import { getLogger } from '@openliri/kernel/loggerFacade.js';
import { TokenBudgetController } from '../../src/tokenBudget/TokenBudgetController';
import { shouldLogUnifiedCheckAtInfo } from '../../src/tokenBudget/UnifiedTokenTracker';

const CHECK_MSG = 'tokenBudget:checkBudget';
const budgetLogger = getLogger('tokenBudget:controller');

function callsOf(spy: ReturnType<typeof spyOn>, msg: string): unknown[][] {
  return (spy.mock.calls as unknown[][]).filter((c) => c[0] === msg);
}

describe('P2-1：tokenBudget:checkBudget 日志级别', () => {
  let infoSpy: ReturnType<typeof spyOn>;
  let debugSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    infoSpy?.mockRestore();
    debugSpy?.mockRestore();
  });

  it('NORMAL（steady-state）⇒ 只进 debug，INFO 不再出现该单点', () => {
    infoSpy = spyOn(budgetLogger, 'info');
    debugSpy = spyOn(budgetLogger, 'debug');
    const controller = new TokenBudgetController('m-normal', {
      total: 1000,
      remaining: 1000,
    });

    controller.checkBudget();

    expect(callsOf(infoSpy, CHECK_MSG).length).toBe(0);
    expect(callsOf(debugSpy, CHECK_MSG).length).toBe(1);
  });

  it('WARNING（压力态）⇒ 仍为 INFO（信号不降级）', () => {
    infoSpy = spyOn(budgetLogger, 'info');
    debugSpy = spyOn(budgetLogger, 'debug');
    // 80% ⇒ ≥ WARNING(0.75) 且 < COMPACT_DEEP(0.85)
    const controller = new TokenBudgetController('m-warn', {
      total: 1000,
      remaining: 200,
      used: 800,
    });

    controller.checkBudget();

    const infos = callsOf(infoSpy, CHECK_MSG);
    expect(infos.length).toBe(1);
    expect((infos[0][1] as { status: string }).status).toBe('warning');
    expect(callsOf(debugSpy, CHECK_MSG).length).toBe(0);
  });
});

describe('P2-1：unified:checkBeforeRequest 日志级别', () => {
  it('无理由 skip（steady-state）⇒ 不进 INFO', () => {
    expect(shouldLogUnifiedCheckAtInfo('skip')).toBe(false);
    expect(shouldLogUnifiedCheckAtInfo('skip', '')).toBe(false);
  });

  it('trigger / warn / 带理由的 skip ⇒ 仍进 INFO', () => {
    expect(shouldLogUnifiedCheckAtInfo('trigger')).toBe(true);
    expect(shouldLogUnifiedCheckAtInfo('warn')).toBe(true);
    expect(
      shouldLogUnifiedCheckAtInfo(
        'skip',
        'anti-flapping: last compactions each saved < 10%'
      )
    ).toBe(true);
  });
});

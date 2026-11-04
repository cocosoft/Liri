// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P2-1（2026-11-04，《运行态问题排查与修复方案》）：**计费/用量逐调用日志**分级。
 *
 * 真机窗口（`since=2026-11-04T04:00Z`）：
 * - `LLM 调用记录` 11 486 条、`API 调用` 11 486 条、`成本累加` 6 882 条 —— 每次调用各一条；
 * - 同一事实已有结构化承载：`appendLogEntry()`（日志查看器的 LLM 调用列表）、
 *   `COST_RECORDED` 事件 + SQLite 持久化、用量落盘。
 *
 * 口径：稳态累加 ⇒ debug；**零成本（未命中定价）仍是 warn** —— 这是必须看见的计费异常。
 */
import { describe, it, expect, spyOn, afterEach, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CostTracker, resolveCostLogLevel } from '@openliri/infra/cost';
import { OTelAwareLogger } from '@openliri/infra/monitoring/logs/OTelAwareLogger';
import { LLMTracker } from '@openliri/infra/monitoring/llm/LLMTracker';

// LLMTracker 的异步 `persistCall` 会解析数据库路径 ⇒ 隔离到临时目录，不碰用户真实库
const dataDir = mkdtempSync(join(tmpdir(), 'p21-llm-'));
const prevDataDir = process.env['LIRI_DATA_DIR'];
process.env['LIRI_DATA_DIR'] = dataDir;

afterAll(() => {
  if (prevDataDir === undefined) delete process.env['LIRI_DATA_DIR'];
  else process.env['LIRI_DATA_DIR'] = prevDataDir;
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // @ignore-catch — Windows 下句柄可能仍占用临时目录（清理尽力而为）
  }
});

describe('P2-1：resolveCostLogLevel（零成本是异常信号）', () => {
  it('cost = 0 ⇒ warn（未命中定价必须可见）', () => {
    expect(resolveCostLogLevel(0)).toBe('warn');
  });

  it('cost > 0 ⇒ debug（稳态累加不刷屏）', () => {
    expect(resolveCostLogLevel(0.0001)).toBe('debug');
    expect(resolveCostLogLevel(12.5)).toBe('debug');
  });
});

describe('P2-1：CostTracker 接线（未知模型 ⇒ 零成本仍 warn）', () => {
  let warnSpy: ReturnType<typeof spyOn>;
  let debugSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    warnSpy?.mockRestore();
    debugSpy?.mockRestore();
  });

  it('成本为 0（无用量 / 未命中定价）⇒ 仍走 warn「成本累加」', () => {
    warnSpy = spyOn(OTelAwareLogger.prototype, 'warn');
    debugSpy = spyOn(OTelAwareLogger.prototype, 'debug');
    const tracker = new CostTracker();

    // 0 token ⇒ 金额 0（真机上"无用量/未命中定价"即此形态）
    const cost = tracker.addCost(
      'p21-zero-cost-model',
      0,
      0,
      0,
      0,
      0,
      false,
      0,
      'req-p21'
    );

    expect(cost).toBe(0);
    const warns = (warnSpy.mock.calls as unknown[][]).filter(
      (c) => c[0] === '成本累加'
    );
    const debugs = (debugSpy.mock.calls as unknown[][]).filter(
      (c) => c[0] === '成本累加'
    );
    expect(warns.length).toBe(1);
    expect(debugs.length).toBe(0);
  });
});

describe('P2-1：LLMTracker 的「LLM 调用记录」走 debug', () => {
  let infoSpy: ReturnType<typeof spyOn>;
  let debugSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    infoSpy?.mockRestore();
    debugSpy?.mockRestore();
  });

  it('记录一次调用 ⇒ INFO 不再出现该单点（结构化日志仍保留）', () => {
    infoSpy = spyOn(OTelAwareLogger.prototype, 'info');
    debugSpy = spyOn(OTelAwareLogger.prototype, 'debug');

    new LLMTracker().recordLLMCall({
      sessionId: 'sess-p21',
      requestId: 'req-p21-llm',
      model: 'm1',
      provider: 'p1',
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.01,
      durationMs: 120,
    });

    const infos = (infoSpy.mock.calls as unknown[][]).filter(
      (c) => c[0] === 'LLM 调用记录'
    );
    const debugs = (debugSpy.mock.calls as unknown[][]).filter(
      (c) => c[0] === 'LLM 调用记录'
    );
    expect(infos.length).toBe(0);
    expect(debugs.length).toBe(1);
  });
});

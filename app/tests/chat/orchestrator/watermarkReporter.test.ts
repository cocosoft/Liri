/**
 * P2-1h —— S4「流式水位上报」节流决策 + 载荷契约测试（2026-10-10）。
 *
 * 依据：`.trae/specs/stream-message-flow-split.md` §5-P2-1h；实现见
 * `src/chat/orchestrator/streamMessageWatermark.ts`。
 *
 * 锁定（对应 2026-09-27「compact 级无节流 ⇒ 单会话单日 14852 条 warn」事故）：
 * 1. `normal` ⇒ `debug`（**不节流**）；
 * 2. 非 `normal`：**状态跃迁必记** + **同级时间节流**（距上次真正记录 ≥ `throttleMs` 才再记）；
 * 3. **无论是否记录都刷新「上次 severity」**；`normal` **不消耗**节流窗口；
 * 4. **进度载荷每次采样都产出**（含被节流时）；0 值显 `?`。
 */
import { describe, expect, it } from 'bun:test';

import { createWatermarkReporter } from '../../../src/chat/orchestrator/streamMessageWatermark.js';
import type { WatermarkState } from '@modules/tokenBudget/UnifiedTokenTracker';

const state = (over: Partial<WatermarkState> = {}): WatermarkState => ({
  currentTokens: 1000,
  contextLimit: 10_000,
  outputTokensSoFar: 0,
  ratio: 0.1,
  severity: 'normal',
  ...over,
});

describe('P2-1h S4 流式水位上报 · 节流决策 + 载荷', () => {
  it('`normal` ⇒ `debug`（不受节流）；载荷 `ratio` 保留 3 位；进度载荷完整', () => {
    const r = createWatermarkReporter('s1', 15_000);
    const s = r.sample(state({ severity: 'normal', ratio: 0.123456 }), 1000);
    expect(s.logLevel).toBe('debug');
    expect(s.logPayload.sessionId).toBe('s1');
    expect(s.logPayload.ratio).toBe(0.123);
    expect(s.logPayload.severity).toBe('normal');
    expect(s.progress.stage).toBe('generating');
    expect(s.progress.message).toBe(
      '上下文水位: 12% (1K/10K) | severity:normal | ratio:0.123 | tokens:1000/10000'
    );
    expect(s.progress.watermarkState).toEqual({
      currentTokens: 1000,
      contextLimit: 10_000,
      ratio: 0.123456,
      severity: 'normal',
    });
  });

  it('非 `normal` 首次（跃迁）⇒ `warn`；同级窗口内 ⇒ `none`', () => {
    const r = createWatermarkReporter('s1', 15_000);
    expect(r.sample(state({ severity: 'warn' }), 1000).logLevel).toBe('warn');
    expect(r.sample(state({ severity: 'warn' }), 2000).logLevel).toBe('none');
    expect(r.sample(state({ severity: 'warn' }), 15_999).logLevel).toBe('none');
  });

  it('同级超过节流窗口 ⇒ 再记 `warn`', () => {
    const r = createWatermarkReporter('s1', 15_000);
    expect(r.sample(state({ severity: 'compact' }), 1000).logLevel).toBe(
      'warn'
    );
    expect(r.sample(state({ severity: 'compact' }), 16_000).logLevel).toBe(
      'warn'
    );
  });

  it('`severity` 跃迁 ⇒ 即使仍在窗口内也必记 `warn`', () => {
    const r = createWatermarkReporter('s1', 15_000);
    expect(r.sample(state({ severity: 'warn' }), 1000).logLevel).toBe('warn');
    expect(r.sample(state({ severity: 'compact' }), 1500).logLevel).toBe(
      'warn'
    );
  });

  it('`normal` 不消耗节流窗口（其后非 normal 仍必记）', () => {
    const r = createWatermarkReporter('s1', 15_000);
    expect(r.sample(state({ severity: 'warn' }), 1000).logLevel).toBe('warn');
    // normal 不刷新 lastWarnAt（仅刷新 lastSeverity）
    expect(r.sample(state({ severity: 'normal' }), 1200).logLevel).toBe(
      'debug'
    );
    expect(r.sample(state({ severity: 'warn' }), 1300).logLevel).toBe('warn');
  });

  it('进度载荷：0 值显 `?`（`currentTokens` / `contextLimit` 均 0）', () => {
    const r = createWatermarkReporter('s1', 15_000);
    const s = r.sample(
      state({
        severity: 'compact',
        currentTokens: 0,
        contextLimit: 0,
        ratio: 1.5,
      }),
      1000
    );
    expect(s.progress.message).toBe(
      '上下文水位: 150% (?/?) | severity:compact | ratio:1.500 | tokens:0/0'
    );
  });

  it('被节流（`none`）时进度载荷仍产出', () => {
    const r = createWatermarkReporter('s1', 15_000);
    r.sample(state({ severity: 'warn' }), 1000);
    const throttled = r.sample(state({ severity: 'warn' }), 2000);
    expect(throttled.logLevel).toBe('none');
    expect(throttled.progress.stage).toBe('generating');
  });
});

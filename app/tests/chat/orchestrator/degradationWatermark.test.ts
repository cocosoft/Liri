/**
 * P2-1d-4 —— S6 degradation 段**水位载荷**纯函数契约测试（2026-10-10）。
 *
 * 依据：`.trae/specs/stream-message-flow-split.md` §3-S6 / §5；实现见
 * `src/chat/orchestrator/streamMessageHelpers.ts`。
 *
 * 锁定（与拆分前**逐字等价**）：`ratio = contextLimit / originalLimit`；
 * `severity`：`ratio ≤ 0.5` ⇒ `'compact'`，否则 `'warn'`；`currentTokens` 固定 `0`。
 */
import { describe, expect, it } from 'bun:test';

import { buildDegradationWatermark } from '../../../src/chat/orchestrator/streamMessageHelpers.js';

describe('P2-1d-4 S6 degradation · 水位载荷（纯函数）', () => {
  it('降幅不足一半（ratio > 0.5）⇒ `warn`', () => {
    // 100000 → 60000 ⇒ ratio 0.6
    expect(buildDegradationWatermark(60000, 100000)).toEqual({
      currentTokens: 0,
      contextLimit: 60000,
      ratio: 0.6,
      severity: 'warn',
    });
  });

  it('降幅达一半（ratio ≤ 0.5）⇒ `compact`', () => {
    expect(buildDegradationWatermark(50000, 100000).severity).toBe('compact');
    expect(buildDegradationWatermark(25000, 100000).severity).toBe('compact');
  });

  it('边界：`ratio` **恰为** 0.5 ⇒ `compact`（判据是 `≤`）', () => {
    const w = buildDegradationWatermark(8192, 16384);
    expect(w.ratio).toBe(0.5);
    expect(w.severity).toBe('compact');
  });

  it('`currentTokens` 恒为 0（降级重发前未统计新窗口用量，不猜）', () => {
    expect(buildDegradationWatermark(1234, 4321).currentTokens).toBe(0);
  });
});

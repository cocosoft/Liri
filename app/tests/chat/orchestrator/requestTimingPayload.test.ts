/**
 * P2-1m —— 请求级延迟 `metric/timing` 载荷构造契约测试（2026-10-10）。
 *
 * 依据：`.trae/specs/stream-message-flow-split.md` §5-P2-1m；实现见
 * `src/chat/orchestrator/streamMessageHelpers.ts`。
 *
 * 锁定「有值才写」口径（防口径失真）：
 * 1. `ttfb` **必写**（`stage:'request'`；= 端到端首块字节延迟）；
 * 2. `ttft` **仅在拿到首个内容 chunk 时刻时写** —— 纯 tool_call 响应无内容 chunk ⇒ **不写**
 *    （**不拿 TTFB 冒充 TTFT**）；
 * 3. `requestId` 拿不到（`undefined`）⇒ **不写**（读端如实视为「无可配对区间」）。
 */
import { describe, expect, it } from 'bun:test';

import { buildRequestTimingPayload } from '../../../src/chat/orchestrator/streamMessageHelpers.js';

describe('P2-1m 请求级延迟 · `metric/timing` 载荷构造', () => {
  it('三字段齐备 ⇒ 全写，且 `ttft` = `ttftAt - requestStartAt`', () => {
    const p = buildRequestTimingPayload({
      ttfbMs: 100,
      ttftAt: 200,
      requestStartAt: 50,
      requestId: 7,
    });
    expect(p).toEqual({
      stage: 'request',
      ttfb: 100,
      ttft: 150,
      requestId: 7,
    });
  });

  it('无内容 chunk（`ttftAt === null`）⇒ **不含** `ttft` 键（不拿 TTFB 冒充）', () => {
    const p = buildRequestTimingPayload({
      ttfbMs: 100,
      ttftAt: null,
      requestStartAt: 50,
      requestId: 7,
    });
    expect('ttft' in p).toBe(false);
    expect(p.ttfb).toBe(100);
  });

  it('`requestId === undefined` ⇒ **不含** `requestId` 键', () => {
    const p = buildRequestTimingPayload({
      ttfbMs: 100,
      ttftAt: 200,
      requestStartAt: 50,
      requestId: undefined,
    });
    expect('requestId' in p).toBe(false);
    expect(p.ttft).toBe(150);
  });

  it('仅 `ttfb`（无内容 chunk + 无 requestId）⇒ 只有 `stage` / `ttfb`', () => {
    const p = buildRequestTimingPayload({
      ttfbMs: 12,
      ttftAt: null,
      requestStartAt: 0,
      requestId: undefined,
    });
    expect(Object.keys(p).sort()).toEqual(['stage', 'ttfb']);
  });
});

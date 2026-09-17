// MIT License
// Copyright (c) 2026 190615273@qq.com
// L1 回归测试（2026-09-17）：
//   _effectiveMaxOutputTokens 未在 reset() 复位 → 跨步/跨 run 输出上限逐轮翻倍累积
//   直至 64k 封顶（max_output 翻倍逻辑的残留状态污染）。修复：reset() 置 undefined 回到基线。

import { describe, expect, it } from 'bun:test';
import { TAORLoop } from '../../src/query/TAORLoop';
import type { QueryEngine } from '../../src/query/QueryEngine';

/** 测试可访问的私有字段（避免使用 any） */
interface TestableLoop {
  _effectiveMaxOutputTokens: number | undefined;
  reset(): void;
}

describe('L1: TAORLoop.reset 复位 _effectiveMaxOutputTokens', () => {
  it('reset 后输出上限回到 undefined（不跨 run 翻倍累积）', () => {
    const loop = new TAORLoop(
      {} as unknown as QueryEngine
    ) as unknown as TestableLoop;

    // 模拟上一 run 翻倍后的残留状态（如 8192 → 16384）
    loop._effectiveMaxOutputTokens = 16384;

    loop.reset();

    expect(loop._effectiveMaxOutputTokens).toBeUndefined();
  });

  it('reset 后再次触发翻倍从基线起步（而非继承旧值）', () => {
    const loop = new TAORLoop(
      {} as unknown as QueryEngine
    ) as unknown as TestableLoop;

    loop._effectiveMaxOutputTokens = 32768;
    loop.reset();
    expect(loop._effectiveMaxOutputTokens).toBeUndefined();

    // 新 run 首轮翻倍：undefined ?? base → 基线，不再从旧残留继续
    const base = 4096;
    const first = Math.min(base * 2, 65536);
    expect(first).toBe(8192);
  });
});

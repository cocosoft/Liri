// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// L3 回归测试（2026-09-17）：
//   maxTurns 单一判定——isTurnLimitReached 统一收敛为 >= 语义
//   （原 4 个判定点 :700/:1433/:1448 用 >=、:1864 用 >，边界相差 1 轮）。
//   允许执行 maxTurns 轮，第 maxTurns+1 轮前停止。

import { describe, expect, it } from 'bun:test';
import { TAORLoop } from '../../src/query/TAORLoop';
import type { QueryEngine } from '../../src/query/QueryEngine';

/** 测试可访问的私有字段（避免使用 any） */
interface TestableLoop {
  turnCount: number;
  taorConfig: { maxTurns: number };
  isTurnLimitReached(): boolean;
}

describe('L3: TAORLoop.isTurnLimitReached 使用 >= 语义', () => {
  it('turnCount === maxTurns 判定为达上限（含边界）', () => {
    const loop = new TAORLoop(
      {} as unknown as QueryEngine
    ) as unknown as TestableLoop;
    loop.turnCount = 3;
    loop.taorConfig = { maxTurns: 3 };
    expect(loop.isTurnLimitReached()).toBe(true);
  });

  it('turnCount < maxTurns 判定为未达上限', () => {
    const loop = new TAORLoop(
      {} as unknown as QueryEngine
    ) as unknown as TestableLoop;
    loop.turnCount = 2;
    loop.taorConfig = { maxTurns: 3 };
    expect(loop.isTurnLimitReached()).toBe(false);
  });
});

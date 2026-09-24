/**
 * 二期 O2-3（2026-09-24「会话暴露问题分析与优化方案」§五）：
 * 提示缓存断点**预算 / 校验 / 死分支 / 语义角色 / 不变量**五处修正。
 *
 * 「修复前必失败」：
 *  - 断点数：默认配置 + 大量消息原实现产出 5 个（tools 断点游离于预算之外）
 *  - 校验：非法配置原实现静默返回，不抛错
 *  - `system_and_6`：原实现与 `system_and_3` 行为完全等价（死逻辑）
 *  - 末尾锚定（2026-09-24 晚接线）：断点须覆盖**缓存前缀末尾** ⇒ 自末尾往前按步长阶梯
 *  - 纯函数性：原实现同参连续两次调用返回 true→false（判断内写状态）
 *  - 语义角色：原实现签名只有下标，无法表达"role=system 即前缀起点"
 */

import { describe, it, expect } from 'bun:test';
import {
  calculateBreakpoints,
  assertBreakpointInvariants,
  DEFAULT_CACHE_CONFIG,
  MAX_BREAKPOINTS_HARD_LIMIT,
  type PromptCacheConfig,
} from '../../src/ai/clients/PromptCacheConfig.js';
import { PromptCacheManager } from '../../src/ai/prompts/PromptCacheManager.js';

describe('提示缓存断点预算与校验（二期 O2-3）', () => {
  it('断点数恒 ≤ maxBreakpoints（修复前 tools 锚点游离于预算外 ⇒ 产出 5 个）', () => {
    const bps = calculateBreakpoints(100, DEFAULT_CACHE_CONFIG);
    expect(bps.length).toBeLessThanOrEqual(DEFAULT_CACHE_CONFIG.maxBreakpoints);
    // 修复前：1(system) + 3(message) + 1(tools) = 5 ⇒ 失败
    expect(bps.length).toBe(4);
    expect(bps.filter((b) => b.type === 'tools').length).toBe(1);
    expect(bps.filter((b) => b.type === 'system').length).toBe(1);
    expect(bps.filter((b) => b.type === 'message').length).toBe(2);
  });

  it('maxBreakpoints=5 超过 Anthropic 硬上限 ⇒ 抛错（修复前静默产出 6 个断点）', () => {
    const cfg: PromptCacheConfig = {
      strategy: 'system_and_3',
      breakpointInterval: 3,
      maxBreakpoints: MAX_BREAKPOINTS_HARD_LIMIT + 1,
    };
    expect(() => calculateBreakpoints(100, cfg)).toThrow();
  });

  it('maxBreakpoints=1 / breakpointInterval=0 ⇒ 抛错（修复前静默返回）', () => {
    expect(() =>
      calculateBreakpoints(100, {
        strategy: 'system_and_3',
        breakpointInterval: 3,
        maxBreakpoints: 1,
      })
    ).toThrow();
    expect(() =>
      calculateBreakpoints(100, {
        strategy: 'system_and_3',
        breakpointInterval: 0,
        maxBreakpoints: 4,
      })
    ).toThrow();
  });

  it('`system_and_6` 是真正的 6 间隔（修复前与 system_and_3 完全等价 ⇒ 死逻辑）', () => {
    const and3 = calculateBreakpoints(20, {
      strategy: 'system_and_3',
      breakpointInterval: 3,
      maxBreakpoints: 4,
    });
    const and6 = calculateBreakpoints(20, {
      strategy: 'system_and_6',
      breakpointInterval: 3,
      maxBreakpoints: 4,
    });
    const idx = (bps: typeof and3): number[] =>
      bps.filter((b) => b.type === 'message').map((b) => b.index);
    // 修复前：两者 identical（前者 %3、后者 %3∪%6 恒等价）⇒ 失败
    // O2-3 接线后（末尾锚定）：自 messageCount-1 起往前每步长一条，至额度用尽 ⇒
    //   system_and_3（步长 3）⇒ [16, 19]；system_and_6（步长 6）⇒ [13, 19]
    //   两者**末尾均为 19**（末尾必被覆盖），但阶梯不同 ⇒ 仍可区分
    expect(idx(and3)).toEqual([16, 19]);
    expect(idx(and6)).toEqual([13, 19]);
    expect(idx(and6)).not.toEqual(idx(and3));
  });

  it('不变量断言：超预算 / 重复固定断点 / 下标乱序 均抛错', () => {
    expect(() =>
      assertBreakpointInvariants(
        [
          { type: 'system', index: 0 },
          { type: 'tools', index: 0 },
          { type: 'message', index: 2 },
        ],
        2
      )
    ).toThrow();
    expect(() =>
      assertBreakpointInvariants(
        [
          { type: 'system', index: 0 },
          { type: 'system', index: 1 },
        ],
        4
      )
    ).toThrow();
    expect(() =>
      assertBreakpointInvariants(
        [
          { type: 'message', index: 5 },
          { type: 'message', index: 2 },
        ],
        4
      )
    ).toThrow();
  });

  it('`shouldInsertBreakpoint` 为纯函数：同参连续两次调用结果一致（修复前 true→false）', () => {
    const mgr = new PromptCacheManager();
    const params = {
      sessionId: 'sess-o3',
      role: 'assistant' as const,
      isPrefixEnd: false,
      totalMessages: 10,
    };
    const first = mgr.shouldInsertBreakpoint(params);
    const second = mgr.shouldInsertBreakpoint(params);
    // 修复前：判断内写 lastCacheTime ⇒ 第二次因 TTL 变"未过期"而翻转为 false ⇒ 失败
    expect(first).toBe(second);
  });

  it('语义角色契约：role=system 即前缀起点；已记录插入后 TTL 内的普通消息不插断点', () => {
    const mgr = new PromptCacheManager();
    expect(
      mgr.shouldInsertBreakpoint({
        sessionId: 'sess-o3b',
        role: 'system',
        isPrefixEnd: false,
        totalMessages: 10,
      })
    ).toBe(true);
    // 显式副作用：记录"已插入" ⇒ TTL 内不再对普通消息插断点
    mgr.noteBreakpointInserted('sess-o3b');
    expect(
      mgr.shouldInsertBreakpoint({
        sessionId: 'sess-o3b',
        role: 'assistant',
        isPrefixEnd: false,
        totalMessages: 10,
      })
    ).toBe(false);
    expect(mgr.isTtlExpired('sess-o3b')).toBe(false);
  });
});

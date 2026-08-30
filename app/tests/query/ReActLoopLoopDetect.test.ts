// MIT License
// Copyright (c) 2026 190615273@qq.com
// ReActLoop 无进展熔断判定（D 项）纯函数回归测试（2026-08-30）
// 直接测试 loopGuard 纯函数，规避 TAORLoop↔ReActLoop 深层循环依赖 TDZ。
// 覆盖：buildRoundSignature 排序拼接；isRepeatedLoop 连续相同判定/不同签名/阈值边界。

import { describe, expect, it } from 'bun:test';
import {
  buildRoundSignature,
  isRepeatedLoop,
} from '../../src/query/loopGuard';
import type { ActResult } from '../../src/query/ReActLoop';

function actResult(names: string[]): ActResult {
  return {
    results: names.map((name) => ({
      toolCallId: `id-${name}`,
      name,
      status: 'success' as const,
    })),
    allSucceeded: true,
    anyAborted: false,
  };
}

describe('buildRoundSignature（D 项）', () => {
  it('工具名排序拼接，与调用顺序无关', () => {
    const a = buildRoundSignature(actResult(['tool_search', 'config']));
    const b = buildRoundSignature(actResult(['config', 'tool_search']));
    expect(a).toBe(b);
    expect(a).toBe('config:success|tool_search:success');
  });

  it('状态差异改变签名', () => {
    const ok = buildRoundSignature(actResult(['sessions']));
    const fail: ActResult = {
      results: [
        {
          toolCallId: 'id-sessions',
          name: 'sessions',
          status: 'error',
          error: 'sessionId is required',
        },
      ],
      allSucceeded: false,
      anyAborted: false,
    };
    expect(buildRoundSignature(fail)).not.toBe(ok);
  });
});

describe('isRepeatedLoop（D 项）', () => {
  it('窗口尾部连续 threshold 轮相同 → true', () => {
    const sigs = ['a', 'b', 'b', 'b'];
    expect(isRepeatedLoop(sigs, 3)).toBe(true);
  });

  it('不足 threshold 轮 → false', () => {
    expect(isRepeatedLoop(['a', 'b'], 3)).toBe(false);
    expect(isRepeatedLoop([], 3)).toBe(false);
  });

  it('有不同签名 → false', () => {
    expect(isRepeatedLoop(['a', 'b', 'a'], 3)).toBe(false);
  });

  it('threshold <= 0 禁用 → false', () => {
    expect(isRepeatedLoop(['x', 'x', 'x'], 0)).toBe(false);
  });
});

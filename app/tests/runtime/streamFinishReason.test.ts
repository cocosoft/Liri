// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// `resolveStreamFinishReason` 单测（2026-10-17 真机缺陷修复）。
//
// 背景（真机证据 09:53，QQ）：预算挂起已成立（`reActLoop:daily_budget_exhausted` +
// `budgetSuspend:suspended`），但 `CoreAPIImpl.chatStream` 出口报 `finishReason:"stop"`
// —— 因为骨架把终止原因落在消息 `metadata.finishReason`，而出口只读**顶层**字段。
// 后果：通道侧 `finishReason === 'budget_exhausted'` 永不成立 ⇒ **不发预算挂起卡片**
//（`CHANNEL-BUDGET-INLINE-RELIEF` 的通道放行入口在真机上不可达）。
//
// 本组钉住优先级：失败 ⇒ error > 顶层值 > metadata.finishReason > stop。

import { describe, it, expect } from 'bun:test';

import { resolveStreamFinishReason } from '../../src/runtime/api/CoreAPIImpl';

describe('resolveStreamFinishReason：终止原因不得被降级成 stop', () => {
  it('★ 顶层无值 + metadata.finishReason=budget_exhausted ⇒ 原样透出（本片修复的正是这条）', () => {
    expect(
      resolveStreamFinishReason({
        streamFailed: false,
        metadata: { finishReason: 'budget_exhausted' },
      })
    ).toBe('budget_exhausted');
  });

  it('其它骨架终止原因（max_turns）同样透出（不再一律变 stop）', () => {
    expect(
      resolveStreamFinishReason({
        streamFailed: false,
        metadata: { finishReason: 'max_turns' },
      })
    ).toBe('max_turns');
  });

  it('顶层有值 ⇒ 优先顶层（provider 末次响应语义不被 metadata 覆盖）', () => {
    expect(
      resolveStreamFinishReason({
        streamFailed: false,
        topLevelFinishReason: 'max_tokens',
        metadata: { finishReason: 'max_turns' },
      })
    ).toBe('max_tokens');
  });

  it('两者都无（或 metadata 形状非法）⇒ stop 兜底', () => {
    expect(resolveStreamFinishReason({ streamFailed: false })).toBe('stop');
    expect(
      resolveStreamFinishReason({
        streamFailed: false,
        metadata: { finishReason: 123 },
      })
    ).toBe('stop');
  });

  it('失败优先（AB-3：禁止用 stop 掩盖失败，也不被 metadata 顶掉）', () => {
    expect(
      resolveStreamFinishReason({
        streamFailed: true,
        topLevelFinishReason: 'stop',
        metadata: { finishReason: 'budget_exhausted' },
      })
    ).toBe('error');
  });
});

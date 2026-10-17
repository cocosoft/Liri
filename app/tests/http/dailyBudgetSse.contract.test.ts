// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// D-l（2026-10-11，Spec `daily-budget-over-limit-ux.md` §5-A / §10-9）：
// ① SSE `error` 块必须携带**真实业务错误码**（否则传输层回落 `UNKNOWN`，前端无法按码分流）；
// ② 撞限属**本机环境状态**而非对话内容 ⇒ **不得**落盘为会话消息（现有 fallback 落的是
//    **真实 assistant 消息**，会被后续模型读到并破坏重放一致性）。
//
// 断言口径（决策规则层）：两个纯函数即 chatStream 内的**唯一**决策点；接线由既有
// `chat-handlers`（`chunk.errorCode || 'UNKNOWN'`）与 `test:guarded` 回归兜底。

import { describe, it, expect } from 'bun:test';
import {
  resolveStreamErrorCode,
  shouldPersistStreamFallback,
} from '../../src/runtime/api/CoreAPIImpl';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

describe('D-l：流式错误码保真 + 限额提示不落盘', () => {
  it('AppError ⇒ 透出真实业务码（不再回落 UNKNOWN）', () => {
    const err = new AppError(
      '今日 Token 预算已用完',
      ErrorCategory.RESOURCE,
      ErrorSeverity.MEDIUM,
      'DAILY_BUDGET_EXCEEDED'
    );
    expect(resolveStreamErrorCode(err)).toBe('DAILY_BUDGET_EXCEEDED');
  });

  it('非 AppError ⇒ 无业务码（由传输层回落 UNKNOWN）', () => {
    expect(resolveStreamErrorCode(new Error('boom'))).toBeUndefined();
    expect(resolveStreamErrorCode({ message: 'plain object' })).toBeUndefined();
  });

  it('撞限 + 零产出 ⇒ 不落 fallback（D-l）', () => {
    expect(
      shouldPersistStreamFallback({
        fullContent: '',
        sessionId: 's1',
        errorCode: 'DAILY_BUDGET_EXCEEDED',
      })
    ).toBe(false);
  });

  it('普通错误 + 零产出 ⇒ 仍落 fallback（既有 Write-Ahead 行为不回归）', () => {
    expect(
      shouldPersistStreamFallback({
        fullContent: '',
        sessionId: 's1',
        errorCode: undefined,
      })
    ).toBe(true);
  });

  it('P8：任意已分类业务码 + 零产出 ⇒ 不落通用 fallback（避免与 error chunk 重复）', () => {
    expect(
      shouldPersistStreamFallback({
        fullContent: '',
        sessionId: 's1',
        errorCode: 'PERMISSION_DENIED',
      })
    ).toBe(false);
  });

  it('撞限但已有部分产出 ⇒ 不落盘、不吞已产出内容（Review Focus #1）', () => {
    expect(
      shouldPersistStreamFallback({
        fullContent: '已产出的部分内容',
        sessionId: 's1',
        errorCode: 'DAILY_BUDGET_EXCEEDED',
      })
    ).toBe(false);
  });

  it('无 sessionId ⇒ 不落盘（既有前置条件）', () => {
    expect(
      shouldPersistStreamFallback({
        fullContent: '',
        sessionId: '',
        errorCode: undefined,
      })
    ).toBe(false);
  });
});

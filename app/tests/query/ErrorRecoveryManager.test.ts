// MIT License
// Copyright (c) 2026 190615273@qq.com

// ErrorRecoveryManager — 恢复状态机：本地确定性 bug 不重试 vs API 瞬态重试
import { describe, it, expect } from 'bun:test';
import { createErrorRecoveryManager } from '../../src/query/ErrorRecoveryManager';
import {
  SYSTEM_ABORT_REASON,
  markAsExpectedAbort,
} from '@modules/core/abortReason';

const ctx = { turnCount: 1, tokenUsage: 0 };

describe('ErrorRecoveryManager — 恢复策略分类', () => {
  it('本地确定性错误（TypeError）直接 abort 不重试', () => {
    const m = createErrorRecoveryManager();
    const r = m.assess(
      new TypeError('Cannot read properties of undefined'),
      ctx
    );
    expect(r.recovered).toBe(false);
    expect(r.action).toBe('abort');
  });

  it('本地确定性错误（ReferenceError/模块加载失败）不重试', () => {
    const m = createErrorRecoveryManager();
    expect(m.assess(new ReferenceError('foo is not defined'), ctx).action).toBe(
      'abort'
    );
    expect(m.assess(new Error('Cannot find module "./x"'), ctx).action).toBe(
      'abort'
    );
    expect(m.assess(new SyntaxError('Unexpected token'), ctx).action).toBe(
      'abort'
    );
  });

  it('API 瞬态错误（429/5xx/网络）走重试', () => {
    const m = createErrorRecoveryManager();
    expect(m.assess(new Error('429 rate limit exceeded'), ctx).action).toBe(
      'retry'
    );
    expect(m.assess(new Error('500 Internal Server Error'), ctx).action).toBe(
      'retry'
    );
    expect(m.assess(new Error('fetch failed: ECONNREFUSED'), ctx).action).toBe(
      'retry'
    );
  });

  it('非确定性的未知错误仍走重试（有最大次数保护）', () => {
    const m = createErrorRecoveryManager();
    const r = m.assess(new Error('weird unknown error'), ctx);
    expect(r.recovered).toBe(true);
    expect(r.action).toBe('retry');
  });

  it('上下文溢出走 compact_and_retry，且压缩仅一次', () => {
    const m = createErrorRecoveryManager();
    const first = m.assess(new Error('context length exceeded 400'), ctx);
    expect(first.action).toBe('compact_and_retry');
    const second = m.assess(new Error('context length exceeded 400'), ctx);
    expect(second.action).toBe('abort'); // 压缩已尝试过，防死循环
  });

  it('预期中断（AbortError / 系统中止标记 / 品牌包装）⇒ 直接 abort，不重试', () => {
    const m = createErrorRecoveryManager();
    const abort = new Error('This operation was aborted');
    abort.name = 'AbortError';
    expect(m.assess(abort, ctx)).toMatchObject({
      recovered: false,
      action: 'abort',
    });
    expect(m.assess(SYSTEM_ABORT_REASON as unknown as Error, ctx).action).toBe(
      'abort'
    );
    // provider 包装后的 AppError 仍带品牌 ⇒ 同样不重试
    const wrapped = markAsExpectedAbort(
      new Error(
        'OpenAI stream failed: liri:system-abort（Provider: db:3682dad9-a392-4d90-9e0a-0523c163a8c4 / api.deepseek.com）'
      )
    );
    expect(m.assess(wrapped, ctx).action).toBe('abort');
  });

  it('provider UUID 片段不再被误判为 400/5xx/429', () => {
    const m = createErrorRecoveryManager();
    // 旧实现：`/400/` 命中 `-400-` ⇒ compact_and_retry（误判上下文溢出）
    const contextLike = m.assess(
      new Error(
        'provider failure（Provider: db:1234-400-abcd / api.deepseek.com）'
      ),
      ctx
    );
    expect(contextLike.action).toBe('retry');
    // 旧实现：`/5\d\d/` 命中 `0523` ⇒ server_error；现应落 unknown（仍重试，但分类不再误报）
    const serverLike = m.assess(
      new Error('provider failure（Provider: db:0523c163 / api.deepseek.com）'),
      ctx
    );
    expect(serverLike.action).toBe('retry');
  });
});

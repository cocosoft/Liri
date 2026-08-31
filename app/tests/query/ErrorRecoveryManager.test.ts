// MIT License
// Copyright (c) 2026 190615273@qq.com

// ErrorRecoveryManager — 恢复状态机：本地确定性 bug 不重试 vs API 瞬态重试
import { describe, it, expect } from 'bun:test';
import { createErrorRecoveryManager } from '../../src/query/ErrorRecoveryManager';

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
});

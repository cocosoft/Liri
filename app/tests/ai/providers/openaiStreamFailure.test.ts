// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 单元测试：`openaiStreamFailure` 的失败分类与首块前重试判据（P3-2 外移后补齐，2026-11-17）
 *
 * 端到端行为已由 `openaiStreamAccumulation.test.ts` 在**外移前**锁定；本文件只针对外移后
 * 新增的两个纯函数逐条钉住判据（正则口径 / 重试前提 / SSL 诊断位），防止后续改动走样。
 */

import { describe, expect, it } from 'bun:test';

import {
  classifyStreamFailure,
  describeFetchError,
  shouldRetryStreamFailure,
} from '../../../src/ai/providers/openaiStreamFailure.js';

const OPTS = {
  fetchCause: null,
  endpointUrl: 'https://api.openai.com/v1/chat/completions',
  streamStartMs: Date.now(),
};

describe('classifyStreamFailure', () => {
  it('socket 被对端关闭 ⇒ isSocketClosed（诊断沿用原始 message）', () => {
    const f = classifyStreamFailure(
      new Error('The socket connection was closed unexpectedly'),
      OPTS
    );
    expect(f.isSocketClosed).toBe(true);
    expect(f.isTimeout).toBe(false);
    expect(f.isSSLError).toBe(false);
    expect(f.diagnostic).toBe('The socket connection was closed unexpectedly');
    expect(f.sslDetail).toBeUndefined();
  });

  it('DOMException TimeoutError ⇒ isTimeout', () => {
    const f = classifyStreamFailure(
      new DOMException('The operation timed out.', 'TimeoutError'),
      OPTS
    );
    expect(f.isTimeout).toBe(true);
  });

  it('SSL/证书类 ⇒ isSSLError 且携带 sslDetail（含 runtime / elapsedMs）', () => {
    const start = Date.now() - 12;
    const f = classifyStreamFailure(
      new Error('unable to verify the first certificate'),
      { ...OPTS, streamStartMs: start }
    );
    expect(f.isSSLError).toBe(true);
    expect(f.sslDetail).toBeDefined();
    expect(f.sslDetail!.elapsedMs).toBeGreaterThanOrEqual(12);
    expect(['node', 'bun']).toContain(f.sslDetail!.runtime);
    expect(typeof f.sslDetail!.errorName).toBe('string');
  });

  it('底层 fetch cause 优先于原始 message 生成诊断文案', () => {
    const f = classifyStreamFailure(new TypeError('Failed to fetch'), {
      ...OPTS,
      fetchCause: { code: 'ENOTFOUND', hostname: 'api.openai.com', port: 443 },
    });
    expect(f.diagnostic).toContain('DNS 解析失败');
    expect(f.diagnostic).toContain('api.openai.com:443');
  });

  it('非连接类错误 ⇒ 三类判据全 false', () => {
    const f = classifyStreamFailure(new Error('invalid request'), OPTS);
    expect([f.isSocketClosed, f.isTimeout, f.isSSLError]).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe('shouldRetryStreamFailure', () => {
  const failure = {
    isSocketClosed: true,
    isTimeout: false,
    isSSLError: false,
  };

  it('首块前连接中断且仍有额度 ⇒ 重试', () => {
    expect(shouldRetryStreamFailure(failure, 0, 2, 0)).toBe(true);
  });

  it('已产出内容 ⇒ 不重试（避免重复输出）', () => {
    expect(shouldRetryStreamFailure(failure, 0, 2, 3)).toBe(false);
  });

  it('额度用尽 ⇒ 不重试', () => {
    expect(shouldRetryStreamFailure(failure, 1, 2, 0)).toBe(false);
  });

  it('非瞬态故障（三类判据全 false）⇒ 不重试', () => {
    expect(
      shouldRetryStreamFailure(
        { isSocketClosed: false, isTimeout: false, isSSLError: false },
        0,
        2,
        0
      )
    ).toBe(false);
  });
});

describe('describeFetchError', () => {
  it('Bun 的 ConnectionRefused（无 hostname/port）⇒ 从 URL 取 host', () => {
    const text = describeFetchError(
      { code: 'ConnectionRefused', hostname: '', port: 0 },
      'https://api.deepseek.com/v1/chat/completions'
    );
    expect(text).toContain('api.deepseek.com');
    expect(text).toContain('连接失败');
  });

  it('未知 code ⇒ 保留 code 便于排查', () => {
    const text = describeFetchError(
      { code: 'EUNKNOWN', hostname: 'h', port: 1 },
      'https://h/'
    );
    expect(text).toContain('EUNKNOWN');
  });
});

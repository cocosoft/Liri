/**
 * 渠道链路错误分类单测（N9 / N10，2026-10-19）
 *
 * 重点锁定「不确定态禁止自动重试」的判据，以及入站异常分类只用于观测的纯函数语义。
 */
import { describe, expect, it } from 'bun:test';
import {
  classifyOutboundError,
  classifyRouterError,
} from '../../src/channels/routing/channelErrorClass';

function withCode(code: string): Error & { code: string } {
  const err = new Error(code) as Error & { code: string };
  err.code = code;
  return err;
}

describe('classifyOutboundError（重试安全性）', () => {
  it('连接未建立类错误 ⇒ pre_send 且可重试', () => {
    for (const code of [
      'ECONNREFUSED',
      'ENOTFOUND',
      'EAI_AGAIN',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'ERR_INVALID_URL',
    ]) {
      const cls = classifyOutboundError(withCode(code));
      expect(cls.kind).toBe('pre_send');
      expect(cls.retryable).toBe(true);
    }
  });

  it('超时 / 重置 / 管道断开 ⇒ ambiguous 且禁止重试', () => {
    for (const code of [
      'ETIMEDOUT',
      'ECONNRESET',
      'ECONNABORTED',
      'EPIPE',
      'UND_ERR_SOCKET',
      'UND_ERR_HEADERS_TIMEOUT',
    ]) {
      const cls = classifyOutboundError(withCode(code));
      expect(cls.kind).toBe('ambiguous');
      expect(cls.retryable).toBe(false);
    }
  });

  it('TimeoutError / AbortError（无 code）⇒ ambiguous', () => {
    const timeout = new Error('timed out');
    timeout.name = 'TimeoutError';
    expect(classifyOutboundError(timeout)).toMatchObject({
      kind: 'ambiguous',
      retryable: false,
    });

    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(classifyOutboundError(abort)).toMatchObject({
      kind: 'ambiguous',
      retryable: false,
    });
  });

  it('未知错误 ⇒ unknown 且保留可重试（不误伤通道自定义临时错误）', () => {
    expect(classifyOutboundError(new Error('boom'))).toMatchObject({
      kind: 'unknown',
      retryable: true,
    });
    expect(classifyOutboundError(undefined)).toMatchObject({
      kind: 'unknown',
      retryable: true,
    });
  });
});

describe('classifyRouterError（入站观测分类）', () => {
  it('取消 / 超时 / 网络 / 协议 分别归类', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(classifyRouterError(abort).kind).toBe('aborted');

    expect(classifyRouterError(withCode('ETIMEDOUT')).kind).toBe('timeout');
    expect(classifyRouterError(withCode('ECONNREFUSED')).kind).toBe('network');
    expect(classifyRouterError(withCode('ERR_INVALID_ARG_TYPE')).kind).toBe(
      'protocol'
    );
    expect(classifyRouterError(new Error('anything')).kind).toBe('unknown');
  });

  it('分类结果带出原始 code（便于日志检索）', () => {
    expect(classifyRouterError(withCode('ECONNRESET'))).toEqual({
      kind: 'network',
      code: 'ECONNRESET',
    });
  });
});

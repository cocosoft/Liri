/**
 * P1-6（2026-11-05）——模型请求「出口网络不可用」的用户可见文案。
 *
 * 真机依据：2026-11-05 13:29:29Z 起 `getaddrinfo ENOTFOUND api.deepseek.com` 共 27 次，
 * 同刻钉钉/QQ 长连接一并掉线（出口网络中断）。修复前前端只看到
 * `流式响应中断: fetch failed` —— 既没说"是网络断了"，也没有可执行动作。
 *
 * 锁定：
 *   · 网络类（ENOTFOUND / EAI_AGAIN / ECONNREFUSED / ETIMEDOUT / fetch failed）⇒ 专门文案；
 *   · 非网络类（认证/限流/上下文溢出）⇒ `null`（调用方保留原「流式响应中断」口径）；
 *   · 工具执行面文案不因判据收敛而改变（回归）。
 */
import { describe, expect, it } from 'bun:test';

import {
  getLlmNetworkErrorMessage,
  getStreamInterruptContent,
  getToolExecErrorMessage,
  isNetworkUnavailableError,
} from '../../../src/chat/orchestrator/toolErrorMessages.js';

// P1-6：`streamMessageFlow` 的**生产入口**（一行调用）——网络失败走专门文案，其余保留原口径
describe('P1-6 流式中断正文（生产入口）', () => {
  it('网络不可用 ⇒ 网络文案（不再是无动作的裸错误）', () => {
    const text = getStreamInterruptContent(
      new Error('fetch failed'),
      'fetch failed'
    );
    expect(text).toContain('网络不可用');
    expect(text).not.toContain('流式响应中断');
  });

  it('业务错误 ⇒ 保留原「流式响应中断」口径', () => {
    expect(getStreamInterruptContent(new Error('401'), '401')).toBe(
      '流式响应中断: 401'
    );
  });
});

describe('P1-6 网络不可用判据', () => {
  it('DNS 解析失败 / 拒绝连接 / 超时 / fetch 失败 ⇒ 命中', () => {
    for (const message of [
      'getaddrinfo ENOTFOUND api.deepseek.com',
      'EAI_AGAIN api.openai.com',
      'connect ECONNREFUSED 127.0.0.1:11434',
      'ETIMEDOUT',
      'fetch failed',
      'network is unreachable',
    ]) {
      expect(isNetworkUnavailableError(new Error(message))).toBe(true);
    }
  });

  it('业务错误（认证/限流/上下文）⇒ 不命中', () => {
    for (const message of [
      '401 Unauthorized',
      '429 Too Many Requests',
      'maximum context length exceeded',
    ]) {
      expect(isNetworkUnavailableError(new Error(message))).toBe(false);
    }
  });

  it('非 Error 入参也能判定（不抛）', () => {
    expect(isNetworkUnavailableError('fetch failed')).toBe(true);
    expect(isNetworkUnavailableError(undefined)).toBe(false);
  });
});

describe('P1-6 模型请求网络失败文案', () => {
  it('ENOTFOUND ⇒ 明确「网络不可用」+ 保留原始原因 + 给出可执行动作', () => {
    const text = getLlmNetworkErrorMessage(
      new Error('getaddrinfo ENOTFOUND api.deepseek.com')
    );
    expect(text).not.toBeNull();
    expect(text).toContain('网络不可用');
    expect(text).toContain('ENOTFOUND api.deepseek.com');
    expect(text).toContain('代理');
    expect(text).toContain('网络恢复后');
    // 不再是无法行动的裸技术错误
    expect(text).not.toBe('流式响应中断: fetch failed');
  });

  it('非网络错误 ⇒ null（调用方保留原口径，不误报为网络问题）', () => {
    expect(getLlmNetworkErrorMessage(new Error('401 Unauthorized'))).toBeNull();
    expect(getLlmNetworkErrorMessage(new Error('429 rate limit'))).toBeNull();
    expect(
      getLlmNetworkErrorMessage(new Error('maximum context length exceeded'))
    ).toBeNull();
  });

  it('原始信息过长时截断到 120 字符（不把整段技术栈灌给用户）', () => {
    const text = getLlmNetworkErrorMessage(
      new Error(`fetch failed ${'x'.repeat(500)}`)
    );
    expect(text).not.toBeNull();
    expect(text!.length).toBeLessThan(260);
  });
});

describe('回归：工具执行面文案不变', () => {
  it('ENOTFOUND 仍映射为「连接 AI 服务失败」', () => {
    expect(
      getToolExecErrorMessage(
        new Error('getaddrinfo ENOTFOUND api.deepseek.com')
      )
    ).toBe('连接 AI 服务失败，请检查网络后重试');
  });

  it('非网络错误仍走原分支（认证 / 限流）', () => {
    expect(getToolExecErrorMessage(new Error('401 Unauthorized'))).toBe(
      'AI 服务认证失败，请检查模型配置中的 API Key'
    );
    expect(getToolExecErrorMessage(new Error('429 Too Many Requests'))).toBe(
      '请求过于频繁，请稍后重试'
    );
  });
});

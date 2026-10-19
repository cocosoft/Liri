/**
 * AI API URL 匹配（X-07，2026-10-19）
 *
 * 回归点：通用 `/v1/messages` 模式曾把飞书 IM、钉钉等出站 API 误判为 AI 调用，
 * 产生 `trace:ai_call` + `model="unknown"`。非 AI 业务路径必须先排除。
 */
import { describe, expect, it } from 'bun:test';
import { isAIApiUrl } from '../../src/trace-recording/interceptor/URLMatcher';

describe('isAIApiUrl', () => {
  it('识别真实 AI 端点', () => {
    for (const url of [
      'https://api.anthropic.com/v1/messages',
      'https://api.openai.com/v1/chat/completions',
      'https://api.deepseek.com/v1/chat/completions',
      'https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent',
      'https://my-proxy.example.com/v1/messages',
      'https://my-proxy.example.com/v1/embeddings',
      'http://127.0.0.1:11434/api/chat',
    ]) {
      expect(isAIApiUrl(url)).toBe(true);
    }
  });

  it('排除非 AI 业务 API（出站不应被录成 ai_call）', () => {
    for (const url of [
      'https://open.feishu.cn/open-apis/im/v1/messages',
      'https://open.larksuite.com/open-apis/im/v1/messages',
      'https://oapi.dingtalk.com/robot/sendBySession?session=x',
      'https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2',
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send',
      'https://discord.com/api/v10/channels/123/messages',
    ]) {
      expect(isAIApiUrl(url)).toBe(false);
    }
  });

  it('非 HTTP / 未知端点不误判', () => {
    expect(isAIApiUrl('https://example.com/health')).toBe(false);
    expect(isAIApiUrl('not-a-url')).toBe(false);
  });
});

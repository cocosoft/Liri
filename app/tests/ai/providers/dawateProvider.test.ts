// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// DawateProvider（私有化部署）单测：appKey 换取与缓存、SSE 累计内容增量解析、
// 请求头/体映射、validateConfig。
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type { ChatMessage } from '../../../src/ai/models/types';
import { DawateProvider } from '../../../src/ai/providers/DawateProvider';

const originalFetch = globalThis.fetch;

let seen: Array<{
  url: string;
  init: RequestInit & { headers?: Record<string, string>; body?: string };
}>;

function sseResponse(lines: string[]): Response {
  return new Response(lines.map((l) => `data: ${l}`).join('\n') + '\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

beforeEach(() => {
  seen = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function installFetch(): void {
  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit & { headers?: Record<string, string>; body?: string }
  ) => {
    const url = String(input);
    seen.push({ url, init: init ?? {} });
    if (url.includes('/extSecret/generateAppKey')) {
      return new Response(JSON.stringify({ resultObject: { appKey: 'K-1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/v3/chat')) {
      return sseResponse([
        '{"choices":[{"delta":{"content":"你"}}]}',
        '{"choices":[{"delta":{"content":"你好"}}]}',
        '[DONE]',
      ]);
    }
    throw new Error(`unexpected url: ${url}`);
  }) as typeof fetch;
}

function makeProvider(): DawateProvider {
  return new DawateProvider(
    { providerId: 'dawate', displayName: '私有化部署' },
    {
      headers: { appId: 'A-246678816', agentId: 'G-246676332' },
      apiKey: 'secret-appSecret',
      baseUrl: 'https://10.10.65.104:5030',
    }
  );
}

describe('DawateProvider（私有化部署）', () => {
  it('先换 appKey 再流式对话：SSE 累计 content 按增量产出', async () => {
    installFetch();
    const p = makeProvider();
    const messages: ChatMessage[] = [
      { role: 'system', content: '你是平台助手' },
      { role: 'user', content: '你是谁' },
    ];

    let out = '';
    const gen = p.chatStream(messages);
    for await (const c of gen) {
      if (typeof c === 'string') out += c;
    }
    expect(out).toBe('你好');

    const chatCall = seen.find((s) => s.url.includes('/v3/chat'));
    expect(chatCall).toBeDefined();
    expect(chatCall!.init.headers?.['appId']).toBe('A-246678816');
    expect(chatCall!.init.headers?.['appKey']).toBe('K-1');
    const body = JSON.parse(chatCall!.init.body ?? '{}') as {
      agentId: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.agentId).toBe('G-246676332');
    // system 角色降级为 user，且两次访问只需换一次 appKey
    expect(body.messages[0].role).toBe('user');
    expect(seen.filter((s) => s.url.includes('generateAppKey')).length).toBe(1);
  });

  it('validateConfig：缺 baseUrl/appSecret/appId/agentId 时报错', () => {
    const p = makeProvider();
    const result = p.validateConfig({ baseUrl: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(4);
  });

  it('缺少 agentId 时流式调用直接抛配置错误（不发请求）', async () => {
    globalThis.fetch = (async () => {
      throw new Error('不应发起网络请求');
    }) as typeof fetch;
    const p = new DawateProvider(
      { providerId: 'dawate', displayName: '私有化部署' },
      { headers: { appId: 'A1' }, apiKey: 's' }
    );
    const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }];
    await expect(async () => {
      for await (const _c of p.chatStream(messages)) {
        // 不消费
      }
    }).toThrow(/agentId/);
  });
});

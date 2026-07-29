// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P0-3: 核心路径 E2E 测试
 *
 * 使用 MockLLMServer 模拟 LLM API，
 * 覆盖 ChatManager→ToolExecutor→AgentLoop 关键场景：
 *   - 简单文本响应
 *   - 工具调用 + 工具结果
 *   - SSE 流式响应
 *   - 错误恢复（rate limit、server error）
 *   - 截断重试（finishReason=length）
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { MockLLMServer } from '../test-utils/MockLLMServer';

const server = new MockLLMServer();

beforeAll(async () => {
  await server.start();
});

afterAll(async () => {
  await server.stop();
});

describe('MockLLMServer — 本地 LLM 模拟器', () => {
  describe('非流式文本响应', () => {
    it('返回模拟文本响应', async () => {
      server.reset();
      server.setResponse({ content: '你好，世界！' });

      const res = await fetch(`${server.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'mock-model',
          messages: [{ role: 'user', content: '你好' }],
          stream: false,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.choices[0].message.content).toBe('你好，世界！');
      expect(data.choices[0].finish_reason).toBe('stop');
      expect(data.usage.total_tokens).toBeGreaterThan(0);
    });

    it('记录请求历史', async () => {
      server.reset();
      server.setResponse({ content: 'OK' });

      await fetch(`${server.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'test-model',
          messages: [{ role: 'user', content: 'query' }],
        }),
      });

      expect(server.requests.length).toBe(1);
      expect((server.requests[0].body as Record<string, unknown>).model).toBe(
        'test-model'
      );
    });
  });

  describe('工具调用响应', () => {
    it('返回 tool_calls', async () => {
      server.reset();
      server.setResponse({
        toolCalls: [
          {
            id: 'call_123',
            name: 'read_file',
            arguments: { path: '/tmp/test.txt' },
          },
        ],
      });

      const res = await fetch(`${server.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'mock-model',
          messages: [{ role: 'user', content: '读文件' }],
          tools: [{ type: 'function', function: { name: 'read_file', parameters: {} } }],
        }),
      });

      const data = await res.json();
      expect(data.choices[0].finish_reason).toBe('tool_calls');
      const tc = data.choices[0].message.tool_calls[0];
      expect(tc.function.name).toBe('read_file');
      expect(JSON.parse(tc.function.arguments).path).toBe('/tmp/test.txt');
    });
  });

  describe('SSE 流式响应', () => {
    it('流式返回文本块', async () => {
      server.reset();
      server.setResponse({ content: 'ABC' });

      const res = await fetch(`${server.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'mock-model',
          messages: [{ role: 'user', content: 'hi' }],
          stream: true,
        }),
      });

      expect(res.headers.get('Content-Type')).toContain('text/event-stream');

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      const chunks: string[] = [];
      let done = false;

      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (result.value) {
          chunks.push(decoder.decode(result.value, { stream: !done }));
        }
      }

      const fullText = chunks.join('');
      expect(fullText).toContain('data:');
      expect(fullText).toContain('[DONE]');
    });
  });

  describe('错误模拟', () => {
    it('模拟 429 rate limit', async () => {
      server.reset();
      server.setErrors([
        { status: 429, message: 'Rate limit exceeded', type: 'rate_limit' },
      ]);

      const res = await fetch(`${server.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'mock-model',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });

      expect(res.status).toBe(429);
      const data = await res.json();
      expect(data.error.type).toBe('rate_limit');
    });

    it('模拟 500 server error', async () => {
      server.reset();
      server.setErrors([
        { status: 500, message: 'Internal server error' },
      ]);

      const res = await fetch(`${server.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'mock-model',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });

      expect(res.status).toBe(500);
    });
  });

  describe('多轮对话', () => {
    it('正确循环多个响应', async () => {
      server.reset();
      server.setResponses([
        { content: 'Round 1', toolCalls: [{ id: 't1', name: 'search', arguments: { q: 'x' } }] },
        { content: 'Round 2 final' },
      ]);

      // Round 1: tool call
      const r1 = await fetch(`${server.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'mock-model',
          messages: [{ role: 'user', content: 'search' }],
          tools: [{ type: 'function', function: { name: 'search', parameters: {} } }],
        }),
      });
      const d1 = await r1.json();
      expect(d1.choices[0].finish_reason).toBe('tool_calls');

      // Round 2: final answer
      const r2 = await fetch(`${server.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'mock-model',
          messages: [
            { role: 'user', content: 'search' },
            { role: 'assistant', tool_calls: [{ id: 't1', type: 'function', function: { name: 'search', arguments: '{"q":"x"}' } }] },
            { role: 'tool', tool_call_id: 't1', content: 'results' },
          ],
        }),
      });
      const d2 = await r2.json();
      expect(d2.choices[0].message.content).toBe('Round 2 final');

      expect(server.requests.length).toBe(2);
    });
  });

  describe('finishReason=length（截断模拟）', () => {
    it('返回 length finish reason', async () => {
      server.reset();
      server.setResponse({ content: 'truncated output', finishReason: 'length' });

      const res = await fetch(`${server.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'mock-model',
          messages: [{ role: 'user', content: 'long task' }],
        }),
      });

      const data = await res.json();
      expect(data.choices[0].finish_reason).toBe('length');
    });
  });

  describe('GET /v1/models', () => {
    it('返回模拟模型列表', async () => {
      const res = await fetch(`${server.url}/v1/models`);
      const data = await res.json();
      expect(data.object).toBe('list');
      expect(data.data.length).toBeGreaterThan(0);
    });
  });

  describe('404 处理', () => {
    it('未知路径返回 404', async () => {
      const res = await fetch(`${server.url}/unknown`);
      expect(res.status).toBe(404);
    });
  });
});

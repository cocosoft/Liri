// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * MockLLMServer — 本地 LLM 模拟器
 *
 * P0-3: 对标 Playwright + local LLM simulator
 *
 * 模拟 OpenAI-compatible /v1/chat/completions 端点，
 * 支持文本响应、工具调用、SSE 流式输出和错误模拟。
 * 用于 ChatManager→ToolExecutor→AgentLoop 核心路径的 E2E 测试。
 *
 * 用法：
 *   const server = new MockLLMServer();
 *   server.setResponse({ content: '你好！' });
 *   await server.start();
 *   // ... run test with process.env.OPENAI_BASE_URL = server.url
 *   server.requests  // 获取请求历史
 *   await server.stop();
 */

import type { Server } from 'bun';

// ============================================================
// Types
// ============================================================

/** 单个模拟响应 */
export interface MockResponse {
  /** 文本内容 */
  content?: string;
  /** 工具调用列表 */
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  /** 模拟延迟（ms） */
  delayMs?: number;
  /** finish_reason */
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'error';
}

/** 模拟错误 */
export interface MockError {
  status: number;
  message: string;
  type?: string;
}

/** 记录的请求 */
export interface RecordedRequest {
  timestamp: number;
  body: unknown;
  headers: Record<string, string>;
}

// ============================================================
// MockLLMServer
// ============================================================

export class MockLLMServer {
  private server: Server | null = null;
  private port: number = 0;
  private responses: MockResponse[] = [];
  private errors: MockError[] = [];
  private responseIndex = 0;
  private errorIndex = 0;

  /** 请求历史记录 */
  requests: RecordedRequest[] = [];

  /** 服务地址 */
  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** 设置响应队列 */
  setResponses(responses: MockResponse[]): void {
    this.responses = responses;
    this.responseIndex = 0;
  }

  /** 设置单个响应（循环使用） */
  setResponse(response: MockResponse): void {
    this.responses = [response];
    this.responseIndex = 0;
  }

  /** 设置错误队列 */
  setErrors(errors: MockError[]): void {
    this.errors = errors;
    this.errorIndex = 0;
  }

  /** 添加后续响应 */
  pushResponse(response: MockResponse): void {
    this.responses.push(response);
  }

  /** 清除所有配置 */
  reset(): void {
    this.responses = [];
    this.errors = [];
    this.responseIndex = 0;
    this.errorIndex = 0;
    this.requests = [];
  }

  /** 启动服务 */
  async start(port: number = 0): Promise<void> {
    this.port = port;
    this.server = Bun.serve({
      port: this.port,
      hostname: '127.0.0.1',
      fetch: (req: Request) => this.handleRequest(req),
    });

    // 获取实际分配的端口
    this.port = this.server.port;
  }

  /** 停止服务 */
  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop();
      this.server = null;
    }
  }

  /** 处理 HTTP 请求 */
  private async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // POST /v1/chat/completions
    if (
      req.method === 'POST' &&
      url.pathname === '/v1/chat/completions'
    ) {
      return this.handleChatCompletions(req);
    }

    // GET /v1/models (optional, for provider validation)
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      return Response.json({
        object: 'list',
        data: [{ id: 'mock-model', object: 'model' }],
      });
    }

    return new Response('Not Found', { status: 404 });
  }

  /** 处理 /v1/chat/completions */
  private async handleChatCompletions(req: Request): Promise<Response> {
    const body = await req.json();
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => (headers[k] = v));

    // 记录请求
    this.requests.push({
      timestamp: Date.now(),
      body,
      headers,
    });

    // 错误优先
    const error = this.getNextError();
    if (error) {
      return Response.json(
        { error: { message: error.message, type: error.type || 'server_error' } },
        { status: error.status }
      );
    }

    // 获取响应
    const response = this.getNextResponse();
    const isStream = body.stream === true;

    if (isStream) {
      return this.buildStreamResponse(response);
    }

    return this.buildJsonResponse(response);
  }

  /** 获取下一个模拟错误 */
  private getNextError(): MockError | undefined {
    if (this.errors.length === 0) return undefined;
    if (this.errorIndex >= this.errors.length) {
      // 循环：重复最后一个错误
      return this.errors[this.errors.length - 1];
    }
    return this.errors[this.errorIndex++];
  }

  /** 获取下一个模拟响应 */
  private getNextResponse(): MockResponse {
    if (this.responses.length === 0) {
      return { content: 'Mock response' };
    }
    if (this.responseIndex >= this.responses.length) {
      // 循环：重复最后一个
      this.responseIndex = this.responses.length - 1;
    }
    return this.responses[this.responseIndex++];
  }

  /** 构建 JSON（非流式）响应 */
  private buildJsonResponse(mr: MockResponse): Response {
    const content = mr.content || '';
    const toolCalls = mr.toolCalls || [];

    const choice: Record<string, unknown> = {
      index: 0,
      message: {
        role: 'assistant',
        content: toolCalls.length > 0 ? null : content,
      },
      finish_reason: mr.finishReason || (toolCalls.length > 0 ? 'tool_calls' : 'stop'),
    };

    if (toolCalls.length > 0) {
      choice.message.tool_calls = toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      }));
    }

    return Response.json({
      id: 'mock-' + Date.now(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'mock-model',
      choices: [choice],
      usage: {
        prompt_tokens: 50,
        completion_tokens: content.length || 10,
        total_tokens: 60,
      },
    });
  }

  /** 构建 SSE 流式响应 */
  private buildStreamResponse(mr: MockResponse): Response {
    const content = mr.content || '';
    const toolCalls = mr.toolCalls || [];
    const delayMs = mr.delayMs ?? 0;

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (data: string) =>
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));

        // 初始 role 事件
        send(
          JSON.stringify({
            id: 'mock-stream',
            object: 'chat.completion.chunk',
            choices: [
              {
                index: 0,
                delta: { role: 'assistant', content: '' },
                finish_reason: null,
              },
            ],
          })
        );

        if (delayMs > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
        }

        // 文本内容
        if (content) {
          const chars = content.split('');
          for (const char of chars) {
            send(
              JSON.stringify({
                id: 'mock-stream',
                object: 'chat.completion.chunk',
                choices: [
                  {
                    index: 0,
                    delta: { content: char },
                    finish_reason: null,
                  },
                ],
              })
            );
            if (delayMs > 0) {
              await new Promise((r) => setTimeout(r, delayMs / chars.length));
            }
          }
        }

        // 工具调用
        if (toolCalls.length > 0) {
          for (const tc of toolCalls) {
            send(
              JSON.stringify({
                id: 'mock-stream',
                object: 'chat.completion.chunk',
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: tc.id,
                          type: 'function',
                          function: {
                            name: tc.name,
                            arguments: JSON.stringify(tc.arguments),
                          },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              })
            );
          }
        }

        // 结束
        const finish = mr.finishReason || (toolCalls.length > 0 ? 'tool_calls' : 'stop');
        send(
          JSON.stringify({
            id: 'mock-stream',
            object: 'chat.completion.chunk',
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: finish,
              },
            ],
            usage: {
              prompt_tokens: 50,
              completion_tokens: content.length || 10,
              total_tokens: 60,
            },
          })
        );

        send('[DONE]');
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Transfer-Encoding': 'chunked',
      },
    });
  }
}

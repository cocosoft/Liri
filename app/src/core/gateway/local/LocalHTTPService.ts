/**
 * LocalHTTPService 本地 HTTP API 服务
 * 提供 OpenAI 兼容的 API 接口，允许 Tauri 客户端通过 HTTP 调用 CoreAPI
 */

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import type {
  ChatRequest,
  ChatStreamChunk,
} from '@modules/runtime/api/CoreAPI';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * LocalHTTPService 配置
 */
export interface LocalHTTPConfig {
  host: string;
  port: number;
}

/**
 * OpenAI 兼容聊天完成请求
 */
interface ChatCompletionRequest {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  user?: string;
}

/**
 * OpenAI 兼容消息格式
 */
interface Message {
  role: string;
  content: string;
}

/**
 * OpenAI 兼容聊天完成响应
 */
interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: Message;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * OpenAI 兼容流式数据块
 */
interface StreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: Partial<Message>;
    finish_reason: string | null;
  }>;
}

/**
 * 模型列表项
 */
interface Model {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

/**
 * LocalHTTPService 类
 * 提供本地 HTTP API 服务，对接 CoreAPI
 */
export class LocalHTTPService {
  private server: http.Server | null = null;
  private config: LocalHTTPConfig;
  private _isRunning = false;

  constructor(config: LocalHTTPConfig) {
    this.config = config;
  }

  /**
   * 检查服务是否正在运行
   */
  isStarted(): boolean {
    return this._isRunning;
  }

  /**
   * 获取服务端口号
   */
  getPort(): number | undefined {
    const addr = this.server?.address();
    if (addr && typeof addr === 'object') {
      return addr.port;
    }
    return undefined;
  }

  /**
   * 启动 HTTP 服务
   */
  async start(): Promise<void> {
    if (this.server) {
      logger.warning('LocalHTTPService 已经启动，无需重复启动');
      return;
    }

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        logger.error('处理请求失败', {
          error: err instanceof Error ? err.message : String(err),
        });
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ error: { message: 'Internal server error' } })
          );
        }
      });
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        this._isRunning = true;
        logger.info(
          `LocalHTTPService 已启动: http://${this.config.host}:${this.config.port}`
        );
        resolve();
      });

      this.server!.on('error', (err) => {
        logger.error('LocalHTTPService 启动失败', { error: err.message });
        this._isRunning = false;
        reject(err);
      });
    });
  }

  /**
   * 停止 HTTP 服务
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        logger.info('LocalHTTPService 未启动，无需停止');
        resolve();
        return;
      }

      this.server.close((err) => {
        if (err) {
          logger.error('LocalHTTPService 停止失败', { error: err.message });
          reject(err);
        } else {
          this.server = null;
          this._isRunning = false;
          logger.info('LocalHTTPService 已停止');
          resolve();
        }
      });
    });
  }

  /**
   * 处理 HTTP 请求
   */
  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization'
    );

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url?.split('?')[0] || '';

    if (req.method === 'GET' && url === '/v1/models') {
      return this.handleListModels(req, res);
    }

    if (req.method === 'POST' && url === '/v1/chat/completions') {
      return this.handleChatCompletions(req, res);
    }

    if (req.method === 'GET' && url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'LocalHTTPService' }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: { message: 'Not found', type: 'invalid_request_error' },
      })
    );
  }

  /**
   * 处理模型列表请求
   */
  private handleListModels(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    const models: Model[] = [
      {
        id: 'pyapp-default',
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'pyapp',
      },
    ];

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ object: 'list', data: models }));
  }

  /**
   * 处理聊天完成请求
   */
  private async handleChatCompletions(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const body = await this.readRequestBody(req);

    let request: ChatCompletionRequest;
    try {
      request = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: 'Invalid JSON in request body',
            type: 'invalid_request_error',
          },
        })
      );
      return;
    }

    if (
      !request.messages ||
      !Array.isArray(request.messages) ||
      request.messages.length === 0
    ) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: 'messages field is required and must be a non-empty array',
            type: 'invalid_request_error',
          },
        })
      );
      return;
    }

    const isStream = request.stream === true;

    if (isStream) {
      return this.handleStreamingChat(res, request);
    }

    return this.handleNormalChat(res, request);
  }

  /**
   * 处理普通（非流式）聊天完成请求
   */
  private async handleNormalChat(
    res: http.ServerResponse,
    request: ChatCompletionRequest
  ): Promise<void> {
    const userMessage = request.messages[request.messages.length - 1];
    if (!userMessage || userMessage.role !== 'user') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: 'Last message must be from user',
            type: 'invalid_request_error',
          },
        })
      );
      return;
    }

    try {
      const coreAPI = getCoreAPI();
      const chatRequest: ChatRequest = {
        content: userMessage.content,
        stream: false,
      };

      const response = await coreAPI.chat(chatRequest);

      const completionResponse: ChatCompletionResponse = {
        id: `chatcmpl-${randomUUID().slice(0, 8)}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: request.model || 'pyapp-default',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: response.content,
            },
            finish_reason: response.finishReason || 'stop',
          },
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      };

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(completionResponse));
    } catch (err) {
      logger.error('聊天请求失败', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: 'Chat request failed',
            type: 'internal_error',
          },
        })
      );
    }
  }

  /**
   * 处理流式聊天完成请求
   */
  private async handleStreamingChat(
    res: http.ServerResponse,
    request: ChatCompletionRequest
  ): Promise<void> {
    const userMessage = request.messages[request.messages.length - 1];
    if (!userMessage || userMessage.role !== 'user') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: 'Last message must be from user',
            type: 'invalid_request_error',
          },
        })
      );
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const responseId = `chatcmpl-${randomUUID().slice(0, 8)}`;
    const created = Math.floor(Date.now() / 1000);
    const model = request.model || 'pyapp-default';

    res.write(
      `data: ${JSON.stringify({
        id: responseId,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [
          { index: 0, delta: { role: 'assistant' }, finish_reason: null },
        ],
      })}\n\n`
    );

    try {
      const coreAPI = getCoreAPI();
      const chatRequest: ChatRequest = {
        content: userMessage.content,
        stream: true,
      };

      const generator = coreAPI.chatStream(chatRequest);
      let result = await generator.next();

      while (!result.done) {
        const chunk = result.value as ChatStreamChunk;

        if (chunk.type === 'text' && chunk.content) {
          const streamChunk: StreamChunk = {
            id: responseId,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [
              {
                index: 0,
                delta: { content: chunk.content },
                finish_reason: null,
              },
            ],
          };

          res.write(`data: ${JSON.stringify(streamChunk)}\n\n`);
        }

        result = await generator.next();
      }

      res.write(
        `data: ${JSON.stringify({
          id: responseId,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        })}\n\n`
      );

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err) {
      logger.error('流式聊天请求失败', {
        error: err instanceof Error ? err.message : String(err),
      });

      res.write(
        `data: ${JSON.stringify({
          id: responseId,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [
            {
              index: 0,
              delta: {
                content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
              },
              finish_reason: 'error',
            },
          ],
        })}\n\n`
      );

      res.write('data: [DONE]\n\n');
      res.end();
    }
  }

  /**
   * 读取请求体
   */
  private readRequestBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      req.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      req.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf-8'));
      });

      req.on('error', (err) => {
        reject(err);
      });
    });
  }
}

/**
 * LocalHTTPService 全局单例
 */
let _localHTTPService: LocalHTTPService | null = null;

/**
 * 获取 LocalHTTPService 单例
 */
export function getLocalHTTPService(): LocalHTTPService {
  if (!_localHTTPService) {
    _localHTTPService = new LocalHTTPService({
      host: '127.0.0.1',
      port: 7890,
    });
  }
  return _localHTTPService;
}

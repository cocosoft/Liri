/**
 * OpenAICompatServer OpenAI 兼容 API 服务
 * 提供与 OpenAI API 兼容的接口，允许现有 OpenAI 客户端直接连接
 */
import http from 'node:http';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * OpenAI 兼容服务配置
 */
export interface OpenAICompatConfig {
  enabled: boolean;
  host: string;
  port: number;
  apiKey: string;
  baseModel: string;
  maxTokens: number;
  streamEnabled: boolean;
}

/**
 * 聊天完成请求
 */
interface ChatCompletionRequest {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

/**
 * OpenAI 兼容 API 服务
 */
export class OpenAICompatServer {
  private server: http.Server | null = null;
  private config: OpenAICompatConfig;

  constructor(config: OpenAICompatConfig) {
    this.config = config;
  }

  /**
   * 启动服务
   */
  async start(): Promise<void> {
    this.server = http.createServer((req, res) => this.handleRequest(req, res));

    return new Promise((resolve) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        logger.info(
          `OpenAI Compat API 服务已启动: http://${this.config.host}:${this.config.port}`
        );
        resolve();
      });
    });
  }

  /**
   * 停止服务
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close((err) => {
          if (err) reject(err);
          else {
            logger.info('OpenAI Compat API 服务已停止');
            this.server = null;
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * 处理请求
   */
  private handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
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

    if (req.method === 'GET' && req.url === '/v1/models') {
      this.handleListModels(req, res);
      return;
    }

    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      this.handleChatCompletions(req, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  }

  /**
   * 处理模型列表
   */
  private handleListModels(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    if (!this.verifyAuth(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    const models = {
      object: 'list',
      data: [
        {
          id: this.config.baseModel,
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: 'pyapp',
        },
      ],
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(models));
  }

  /**
   * 处理聊天完成请求
   */
  private handleChatCompletions(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    if (!this.verifyAuth(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    let body = '';

    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const request: ChatCompletionRequest = JSON.parse(body);
        const isStream = request.stream && this.config.streamEnabled;

        if (isStream) {
          this.handleStreamingResponse(request, res, req);
        } else {
          this.handleNormalResponse(request, res);
        }
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              message: `无效请求: ${err instanceof Error ? err.message : String(err)}`,
              type: 'invalid_request_error',
            },
          })
        );
      }
    });
  }

  /**
   * 处理流式响应
   */
  private handleStreamingResponse(
    request: ChatCompletionRequest,
    res: http.ServerResponse,
    clientReq: http.IncomingMessage
  ): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const responseId = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const model = request.model || this.config.baseModel;

    const content = `这是由本地 PY_APP 模型生成的回复。\n\n你的问题是: ${request.messages[request.messages.length - 1]?.content || ''}`;
    const words = content.split(' ');

    res.write(
      `data: ${JSON.stringify({ id: responseId, object: 'chat.completion.chunk', created, model, choices: [{ delta: { role: 'assistant' }, index: 0, finish_reason: null }] })}\n\n`
    );

    let index = 0;
    const interval = setInterval(() => {
      if (index >= words.length) {
        clearInterval(interval);
        res.write(
          `data: ${JSON.stringify({ id: responseId, object: 'chat.completion.chunk', created, model, choices: [{ delta: {}, index: 0, finish_reason: 'stop' }] })}\n\n`
        );
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      res.write(
        `data: ${JSON.stringify({ id: responseId, object: 'chat.completion.chunk', created, model, choices: [{ delta: { content: words[index] + ' ' }, index: 0, finish_reason: null }] })}\n\n`
      );
      index++;
    }, 50);

    clientReq.on('close', () => {
      clearInterval(interval);
    });
  }

  /**
   * 处理普通响应
   */
  private handleNormalResponse(
    request: ChatCompletionRequest,
    res: http.ServerResponse
  ): void {
    const responseId = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const model = request.model || this.config.baseModel;
    const maxTokens = request.max_tokens || this.config.maxTokens;

    const content = `这是由本地 PY_APP 模型 (${model}) 生成的回复。\n\n你的问题是: ${request.messages[request.messages.length - 1]?.content || ''}`;

    const response = {
      id: responseId,
      object: 'chat.completion',
      created,
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: content.substring(0, maxTokens),
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: request.messages.reduce(
          (sum, m) => sum + m.content.length,
          0
        ),
        completion_tokens: content.length,
        total_tokens:
          request.messages.reduce((sum, m) => sum + m.content.length, 0) +
          content.length,
      },
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  }

  /**
   * 验证授权
   */
  private verifyAuth(req: http.IncomingMessage): boolean {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return false;
    }

    const match = authHeader.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      return false;
    }

    return match[1] === this.config.apiKey;
  }
}

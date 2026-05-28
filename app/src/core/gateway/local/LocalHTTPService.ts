/**
 * LocalHTTPService 本地 HTTP API 服务
 * 提供 OpenAI 兼容的 API 接口，允许 Tauri 客户端通过 HTTP 调用 CoreAPI
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import { attachmentManager } from '@modules/components/attachments';
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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
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

    // ---- SSE Event Bus ----
    if (req.method === 'GET' && url === '/v1/events') {
      return this.handleEvents(req, res);
    }

    if (req.method === 'GET' && url === '/v1/models') {
      return this.handleListModels(req, res);
    }

    if (req.method === 'POST' && url === '/v1/chat/completions') {
      return this.handleChatCompletions(req, res);
    }

    // ---- Session ----
    if (req.method === 'GET' && url === '/v1/sessions') {
      return this.handleListSessions(req, res);
    }
    if (req.method === 'POST' && url === '/v1/sessions') {
      return this.handleCreateSession(req, res);
    }
    if (req.method === 'GET' && url === '/v1/sessions/current') {
      return this.handleGetCurrentSession(req, res);
    }
    if (req.method === 'GET' && url.match(/^\/v1\/sessions\/(.+)$/)) {
      return this.handleGetSession(req, res, url.match(/^\/v1\/sessions\/(.+)$/)![1]);
    }
    if (req.method === 'POST' && url.match(/^\/v1\/sessions\/(.+)\/switch$/)) {
      return this.handleSwitchSession(req, res, url.match(/^\/v1\/sessions\/(.+)\/switch$/)![1]);
    }
    if (req.method === 'PUT' && url.match(/^\/v1\/sessions\/(.+)$/)) {
      return this.handleRenameSession(req, res, url.match(/^\/v1\/sessions\/(.+)$/)![1]);
    }
    if (req.method === 'DELETE' && url.match(/^\/v1\/sessions\/(.+)$/)) {
      return this.handleDeleteSession(req, res, url.match(/^\/v1\/sessions\/(.+)$/)![1]);
    }

    // ---- Tools ----
    if (req.method === 'GET' && url === '/v1/tools') {
      return this.handleListTools(req, res);
    }
    if (req.method === 'POST' && url.match(/^\/v1\/tools\/(.+)\/execute$/)) {
      return this.handleExecuteTool(req, res, url.match(/^\/v1\/tools\/(.+)\/execute$/)![1]);
    }

    // ---- Agent ----
    if (req.method === 'GET' && url === '/v1/agents/tasks') {
      return this.handleListAgentTasks(req, res);
    }
    if (req.method === 'POST' && url === '/v1/agents/tasks') {
      return this.handleExecuteAgentTask(req, res);
    }
    if (req.method === 'GET' && url.match(/^\/v1\/agents\/tasks\/(.+)$/)) {
      return this.handleGetAgentProgress(req, res, url.match(/^\/v1\/agents\/tasks\/(.+)$/)![1]);
    }

    // ---- Files ----
    if (req.method === 'POST' && url === '/v1/files/upload') {
      return this.handleFileUpload(req, res);
    }
    if (req.method === 'POST' && url === '/v1/files/convert') {
      return this.handleConvertFile(req, res);
    }
    if (req.method === 'POST' && url === '/v1/files/detect') {
      return this.handleDetectFileType(req, res);
    }

    // ---- Knowledge ----
    if (req.method === 'GET' && url === '/v1/knowledge') {
      return this.handleListKnowledge(req, res);
    }
    if (req.method === 'POST' && url === '/v1/knowledge/search') {
      return this.handleSearchKnowledge(req, res);
    }
    if (req.method === 'POST' && url === '/v1/knowledge') {
      return this.handleCreateKnowledge(req, res);
    }
    if (req.method === 'PUT' && url.match(/^\/v1\/knowledge\/(.+)$/)) {
      return this.handleUpdateKnowledge(req, res, url.match(/^\/v1\/knowledge\/(.+)$/)![1]);
    }
    if (req.method === 'DELETE' && url.match(/^\/v1\/knowledge\/(.+)$/)) {
      return this.handleDeleteKnowledge(req, res, url.match(/^\/v1\/knowledge\/(.+)$/)![1]);
    }

    // ---- Buddy ----
    if (req.method === 'GET' && url === '/v1/buddy/companion') {
      return this.handleGetBuddy(req, res);
    }
    if (req.method === 'POST' && url === '/v1/buddy/interact') {
      return this.handleBuddyInteract(req, res);
    }
    if (req.method === 'GET' && url === '/v1/buddy/stats') {
      return this.handleGetBuddyStats(req, res);
    }
    if (req.method === 'GET' && url === '/v1/buddy/dreams') {
      return this.handleGetDreamLogs(req, res);
    }

    // ---- Cron ----
    if (req.method === 'GET' && url === '/v1/cron') {
      return this.handleListCron(req, res);
    }
    if (req.method === 'POST' && url === '/v1/cron') {
      return this.handleCreateCron(req, res);
    }
    if (req.method === 'GET' && url.match(/^\/v1\/cron\/(.+)$/)) {
      return this.handleGetCron(req, res, url.match(/^\/v1\/cron\/(.+)$/)![1]);
    }
    if (req.method === 'PUT' && url.match(/^\/v1\/cron\/(.+)$/)) {
      return this.handleUpdateCron(req, res, url.match(/^\/v1\/cron\/(.+)$/)![1]);
    }
    if (req.method === 'DELETE' && url.match(/^\/v1\/cron\/(.+)$/)) {
      return this.handleDeleteCron(req, res, url.match(/^\/v1\/cron\/(.+)$/)![1]);
    }
    if (req.method === 'POST' && url.match(/^\/v1\/cron\/(.+)\/run$/)) {
      return this.handleRunCron(req, res, url.match(/^\/v1\/cron\/(.+)\/run$/)![1]);
    }

    // ---- Channels ----
    if (req.method === 'GET' && url === '/v1/channels') {
      return this.handleListChannels(req, res);
    }
    if (req.method === 'GET' && url.match(/^\/v1\/channels\/(.+)$/)) {
      return this.handleGetChannel(req, res, url.match(/^\/v1\/channels\/(.+)$/)![1]);
    }
    if (req.method === 'POST' && url.match(/^\/v1\/channels\/(.+)\/toggle$/)) {
      return this.handleToggleChannel(req, res, url.match(/^\/v1\/channels\/(.+)\/toggle$/)![1]);
    }
    if (req.method === 'DELETE' && url.match(/^\/v1\/channels\/(.+)$/)) {
      return this.handleDeleteChannel(req, res, url.match(/^\/v1\/channels\/(.+)$/)![1]);
    }

    // ---- Config ----
    if (req.method === 'GET' && url === '/v1/config') {
      return this.handleListConfig(req, res);
    }
    if (req.method === 'GET' && url.match(/^\/v1\/config\/(.+)$/)) {
      return this.handleGetConfig(req, res, url.match(/^\/v1\/config\/(.+)$/)![1]);
    }
    if (req.method === 'PUT' && url.match(/^\/v1\/config\/(.+)$/)) {
      return this.handleSetConfig(req, res, url.match(/^\/v1\/config\/(.+)$/)![1]);
    }

    // ---- Health ----
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

  // ========== Session Handlers ==========

  /**
   * 处理列出会话请求
   */
  private async handleListSessions(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const coreAPI = getCoreAPI();
      const sessions = await coreAPI.listSessions();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(sessions));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理创建会话请求
   */
  private async handleCreateSession(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { title } = JSON.parse(body);
      const coreAPI = getCoreAPI();
      const session = await coreAPI.createSession({ title });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(session));
      this.broadcastEvent('session:created', { id: session?.id });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理获取会话详情请求
   */
  private async handleGetSession(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string
  ): Promise<void> {
    try {
      const coreAPI = getCoreAPI();
      const session = await coreAPI.getSession(sessionId);
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Session not found', type: 'not_found' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(session));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理删除会话请求
   */
  private async handleDeleteSession(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string
  ): Promise<void> {
    try {
      const coreAPI = getCoreAPI();
      await coreAPI.deleteSession(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      this.broadcastEvent('session:deleted', { id: sessionId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理获取当前会话请求
   */
  private async handleGetCurrentSession(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const coreAPI = getCoreAPI();
      const session = await coreAPI.getCurrentSession();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(session));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理切换会话请求
   */
  private async handleSwitchSession(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string
  ): Promise<void> {
    try {
      const coreAPI = getCoreAPI();
      await coreAPI.switchSession(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理重命名会话请求
   */
  private async handleRenameSession(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { title } = JSON.parse(body);
      const coreAPI = getCoreAPI();
      await coreAPI.renameSession(sessionId, title);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== Tools Handlers ==========

  /**
   * 处理列出工具请求
   */
  private async handleListTools(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const coreAPI = getCoreAPI();
      const tools = await coreAPI.listTools();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(tools));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理执行工具请求
   */
  private async handleExecuteTool(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    toolName: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { sessionId, arguments: args } = JSON.parse(body);
      const coreAPI = getCoreAPI();
      const result = await coreAPI.executeTool(sessionId, {
        id: `toolcall-${Date.now()}`,
        name: toolName,
        arguments: args || {},
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== Agent Handlers ==========

  /**
   * 处理列出 Agent 任务请求
   */
  private async handleListAgentTasks(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([]));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理执行 Agent 任务请求
   */
  private async handleExecuteAgentTask(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const params = JSON.parse(body);
      const coreAPI = getCoreAPI();
      const result = await coreAPI.executeAgentTask({
        description: params.name || params.description || '',
        prompt: params.prompt,
        subagentType: params.type,
        model: params.model,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      this.broadcastEvent('agent:task', { taskId: result?.agentId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理获取 Agent 进度请求
   */
  private async handleGetAgentProgress(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    agentId: string
  ): Promise<void> {
    try {
      const coreAPI = getCoreAPI();
      const progress = await coreAPI.getAgentProgress(agentId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(progress || { agentId, state: 'unknown', progress: 0, message: '' }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== Files Handlers ==========

  /**
   * 处理文件上传请求
   * 遵循「用户上传文件仅保存到用户目录」规则，使用 AttachmentManager 保存到 ~/.pyapp/attachments/
   */
  private async handleFileUpload(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { filename, data } = JSON.parse(body);
      if (!filename || !data) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'filename and data are required' } }));
        return;
      }
      const buffer = Buffer.from(data, 'base64');
      const safeName = path.basename(filename);
      // 使用 AttachmentManager 保存到用户附件目录（第三层：~/.pyapp/attachments/）
      const attachment = attachmentManager.saveAttachment(
        safeName,
        buffer,
        'file',
        'application/octet-stream'
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ path: attachment.path, size: buffer.length }));
      this.broadcastEvent('file:uploaded', {
        path: attachment.path,
        size: buffer.length,
        filename: safeName,
        attachmentId: attachment.id,
      });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理文件格式转换请求
   */
  private async handleConvertFile(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { filePath, outputFormat, options } = JSON.parse(body);
      const coreAPI = getCoreAPI();
      const result = await coreAPI.convertFile({ filePath, outputFormat, options });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理文件类型检测请求
   */
  private async handleDetectFileType(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { filePath } = JSON.parse(body);
      const coreAPI = getCoreAPI();
      const result = await coreAPI.detectFileType(filePath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== Knowledge Handlers ==========

  /**
   * 处理列出知识条目请求
   * 使用 knowledgeDocsProvider 读取真实知识文档列表
   */
  private async handleListKnowledge(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { knowledgeDocsProvider } = await import('@modules/docs/FileDocsProvider');
      const docs = await knowledgeDocsProvider.buildIndex();
      const result = docs.map((doc: any, idx: number) => ({
        id: `knowledge-${idx}`,
        title: doc.title,
        content: doc.content?.slice(0, 500) || '',
        category: doc.category || '根目录',
        docPath: doc.relativePath,
        created_at: 0,
        updated_at: 0,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理搜索知识请求
   * 使用 HybridKnowledgeRouter 进行混合搜索
   */
  private async handleSearchKnowledge(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { query } = JSON.parse(body);
      if (!query) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
        return;
      }
      const { HybridKnowledgeRouter } = await import('@modules/knowledge/HybridKnowledgeRouter');
      const { knowledgeDocsProvider } = await import('@modules/docs/FileDocsProvider');
      const router = new HybridKnowledgeRouter(knowledgeDocsProvider);
      const routes = await router.search(query, { maxResults: 20 });
      const result = routes.map((route: any) => ({
        id: `knowledge-${route.docPath}`,
        title: route.title,
        content: route.snippet || '',
        category: route.category || '根目录',
        score: route.score,
        matchType: route.matchType,
        docPath: route.docPath,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理创建知识条目请求
   * 将新知识写入用户知识库目录
   */
  private async handleCreateKnowledge(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { title, content, category } = JSON.parse(body);
      if (!title) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'title is required' } }));
        return;
      }
      const { resolveKnowledgeBaseDir } = await import('@modules/config/paths');
      const { writeFile, mkdir } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const targetDir = category
        ? join(resolveKnowledgeBaseDir(), category)
        : resolveKnowledgeBaseDir();
      await mkdir(targetDir, { recursive: true });
      const fileName = `${title.replace(/[\\/:*?"<>|]/g, '_')}.md`;
      const filePath = join(targetDir, fileName);
      const fileContent = content ? `# ${title}\n\n${content}\n` : `# ${title}\n\n`;
      await writeFile(filePath, fileContent, 'utf-8');
      const newId = `knowledge-${Date.now()}`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: newId, title, content: content || '', category: category || '根目录',
        docPath: filePath, created_at: Date.now(), updated_at: Date.now(),
      }));
      this.broadcastEvent('knowledge:created', { id: newId, title });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理更新知识条目请求
   */
  private async handleUpdateKnowledge(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    knowledgeId: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { title, content } = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: knowledgeId, title, content, updated_at: Date.now() }));
      this.broadcastEvent('knowledge:updated', { id: knowledgeId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理删除知识条目请求
   */
  private async handleDeleteKnowledge(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    knowledgeId: string
  ): Promise<void> {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      this.broadcastEvent('knowledge:deleted', { id: knowledgeId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== Buddy Handlers ==========

  /**
   * 处理获取 Buddy 伙伴信息请求
   */
  private async handleGetBuddy(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { getCompanion } = await import('@modules/buddy');
      const companion = getCompanion();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(companion || null));
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(null));
    }
  }

  /**
   * 处理 Buddy 交互请求
   */
  private async handleBuddyInteract(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { action } = JSON.parse(body);
      const { InteractionManager, getCompanion } = await import('@modules/buddy');
      const companion = getCompanion();
      if (!companion) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: '暂无 Buddy', statChanges: {} }));
        return;
      }
      const manager = new InteractionManager();
      const result = await manager.execute(companion, action);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      this.broadcastEvent('buddy:interacted', { action, result: result.response });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理获取 Buddy 统计数据请求
   */
  private async handleGetBuddyStats(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { getDreamStats } = await import('@modules/buddy/dreamLogStore');
      const dreamStats = getDreamStats();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        interactions: 0,
        dreamsCompleted: dreamStats.totalCompleted,
        totalXp: 0,
      }));
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ interactions: 0, dreamsCompleted: 0, totalXp: 0 }));
    }
  }

  /**
   * 处理获取梦境日志请求
   */
  private async handleGetDreamLogs(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const urlObj = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
      const limit = parseInt(urlObj.searchParams.get('limit') || '50', 10);
      const offset = parseInt(urlObj.searchParams.get('offset') || '0', 10);
      const typeFilter = urlObj.searchParams.get('type') || '';

      const { getDreamLogs, getDreamLogsByType, getDreamStats } = await import('@modules/buddy/dreamLogStore');

      const result = typeFilter
        ? getDreamLogsByType(typeFilter as any, limit, offset)
        : getDreamLogs(limit, offset);

      const stats = getDreamStats();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...result, stats }));
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ logs: [], total: 0, stats: { totalCompleted: 0, totalFailed: 0, totalSessions: 0, totalInsights: 0, lastDreamAt: null } }));
    }
  }

  // ========== Cron Handlers ==========

  /**
   * 处理列出定时任务请求
   */
  private async handleListCron(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { listAllCronTasks } = await import('@modules/chronos/CronTasks');
      const tasks = await listAllCronTasks();
      const result = tasks.map((t: any) => ({
        id: t.id,
        cron: t.cron,
        prompt: t.prompt,
        recurring: t.recurring,
        durable: t.durable,
        agentId: t.agentId,
        taskType: t.taskType || 'prompt',
        createdAt: t.createdAt,
        lastFiredAt: t.lastFiredAt,
        metadata: t.metadata || {},
        enabled: t.durable !== false,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理创建定时任务请求
   */
  private async handleCreateCron(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { cron, prompt, recurring, durable, agentId } = JSON.parse(body);
      if (!cron || !prompt) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'cron and prompt are required' } }));
        return;
      }
      const { addCronTask } = await import('@modules/chronos/CronTasks');
      const id = await addCronTask(cron, prompt, recurring !== false, durable !== false, agentId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id, cron, prompt, recurring: recurring !== false, durable: durable !== false, agentId, createdAt: Date.now() }));
      this.broadcastEvent('cron:created', { id });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理获取定时任务详情请求
   */
  private async handleGetCron(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    cronId: string
  ): Promise<void> {
    try {
      const { getCronTask } = await import('@modules/chronos/CronTasks');
      const task = await getCronTask(cronId);
      if (!task) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Cron task not found' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(task));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理更新定时任务请求
   */
  private async handleUpdateCron(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    cronId: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const updates = JSON.parse(body);
      const { updateCronTask, getCronTask } = await import('@modules/chronos/CronTasks');
      const existing = await getCronTask(cronId);
      if (!existing) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Cron task not found' } }));
        return;
      }
      await updateCronTask(cronId, updates);
      const updated = await getCronTask(cronId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(updated));
      this.broadcastEvent('cron:updated', { id: cronId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理删除定时任务请求
   */
  private async handleDeleteCron(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    cronId: string
  ): Promise<void> {
    try {
      const { removeCronTasks } = await import('@modules/chronos/CronTasks');
      await removeCronTasks([cronId]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      this.broadcastEvent('cron:deleted', { id: cronId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理立即执行定时任务请求
   */
  private async handleRunCron(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    cronId: string
  ): Promise<void> {
    try {
      const { getCronTask, updateCronTask } = await import('@modules/chronos/CronTasks');
      const task = await getCronTask(cronId);
      if (!task) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Cron task not found' } }));
        return;
      }
      await updateCronTask(cronId, { lastFiredAt: Date.now() });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: `Task ${cronId} triggered` }));
      this.broadcastEvent('cron:run', { id: cronId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== Channels Handlers ==========

  /**
   * 处理列出通道请求
   */
  private async handleListChannels(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { channelRegistry } = await import('@modules/channels/registry/ChannelRegistry');
      const channels = channelRegistry.getAll();
      const result = channels.map((ch: any) => ({
        id: ch.name,
        name: ch.name,
        type: ch.type,
        enabled: ch.enabled,
        connected: ch.connected,
        config: ch.config || {},
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理获取通道详情请求
   */
  private async handleGetChannel(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    channelId: string
  ): Promise<void> {
    try {
      const { channelRegistry } = await import('@modules/channels/registry/ChannelRegistry');
      const channel = channelRegistry.get(channelId);
      if (!channel) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Channel not found' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: channel.name,
        name: channel.name,
        type: channel.type,
        enabled: channel.enabled,
        connected: channel.connected,
      }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理切换通道启用状态请求
   */
  private async handleToggleChannel(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    channelId: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { enabled } = JSON.parse(body);
      const { channelRegistry } = await import('@modules/channels/registry/ChannelRegistry');
      const channel = channelRegistry.get(channelId);
      if (!channel) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Channel not found' } }));
        return;
      }
      if (enabled) {
        await channelRegistry.connect(channelId);
      } else {
        await channelRegistry.disconnect(channelId);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, id: channelId, enabled }));
      this.broadcastEvent('channel:toggled', { id: channelId, enabled });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理删除通道请求
   */
  private async handleDeleteChannel(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    channelId: string
  ): Promise<void> {
    try {
      const { channelRegistry } = await import('@modules/channels/registry/ChannelRegistry');
      const result = channelRegistry.unregister(channelId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: result }));
      this.broadcastEvent('channel:deleted', { id: channelId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== Config Handlers ==========

  /**
   * 处理列出所有配置请求
   */
  private async handleListConfig(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { configManager } = await import('@modules/config/ConfigManager');
      const globalConfig = configManager.getGlobalConfig();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(globalConfig || {}));
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({}));
    }
  }

  /**
   * 处理获取指定配置项请求
   */
  private async handleGetConfig(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    key: string
  ): Promise<void> {
    try {
      const { configManager } = await import('@modules/config/ConfigManager');
      const value = configManager.getConfigValue(key);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ key, value }));
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ key, value: null }));
    }
  }

  /**
   * 处理设置配置项请求
   */
  private async handleSetConfig(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    key: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { value } = JSON.parse(body);
      const { configManager } = await import('@modules/config/ConfigManager');
      configManager.setConfigValue(key, value);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, key, value }));
      this.broadcastEvent('config:updated', { key, value });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private clients = new Set<http.ServerResponse>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // ========== SSE Event Bus ==========

  /**
   * 处理 SSE 事件订阅
   */
  private async handleEvents(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    this.clients.add(res);

    if (!this.heartbeatTimer) {
      this.heartbeatTimer = setInterval(() => {
        const payload = JSON.stringify({ type: 'heartbeat', ts: Date.now() });
        for (const client of this.clients) {
          client.write(`event: heartbeat\ndata: ${payload}\n\n`);
        }
      }, 15000);
    }

    req.on('close', () => {
      this.clients.delete(res);
      if (this.clients.size === 0 && this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    });
  }

  /**
   * 广播事件到所有 SSE 客户端
   */
  private broadcastEvent(event: string, data: Record<string, unknown>): void {
    const payload = JSON.stringify({ ...data, ts: Date.now() });
    for (const client of this.clients) {
      client.write(`event: ${event}\ndata: ${payload}\n\n`);
    }
  }

  // ========== Error Helper ==========

  /**
   * 发送错误响应
   */
  private sendError(res: http.ServerResponse, err: unknown, status = 500): void {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('API 错误', { error: message });
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message, type: 'api_error' } }));
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

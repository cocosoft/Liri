/**
 * LocalHTTPService 本地 HTTP API 服务
 * 提供 OpenAI 兼容的 API 接口，允许 Tauri 客户端通过 HTTP 调用 CoreAPI
 *
 * 注意：本文件位于 core/gateway/local/（遗留 Gateway 体系目录），
 * 但实际消费 channels/ 目录下的 IChannelPlugin 接口。
 * 此位置具有误导性，后续应考虑迁移至 modules/ 下的合适位置。
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { StructuredLogger } from '@modules/monitoring/logs/StructuredLogger';
import { tryHandleRoute } from '@modules/ai/ModelManagementAPI';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import { createChatManager } from '@modules/chat/ChatManager';
import { attachmentManager, AttachmentSource } from '@modules/components/attachments';
import { costTracker } from '@modules/cost/CostTracker';
import { getCostRecordRepository } from '@modules/cost/CostRecordRepository';
import { getMonitoringService } from '@modules/monitoring/MonitoringService';
import { analyticsService } from '@modules/analytics/AnalyticsService';
import { PerformanceMonitorService } from '@modules/analytics/PerformanceMonitorService';
import { globalWorkspaceManager } from '@modules/sandbox/WorkspaceManager';
import { SandboxPermission } from '@modules/sandbox/SandboxTypes';
import { resolveOutputDir, resolveDownloadsDir, resolveAttachmentsDir, resolvePyappHome } from '@modules/core/paths';
import { configManager } from '@modules/config';
import type {
  ChatRequest,
  ChatStreamChunk,
} from '@modules/runtime/api/CoreAPI';
import type { IChannelPlugin } from '@modules/channels/types';

import { handleMonitorSummary, handleMonitorMetrics, handleMonitorAlerts, handleAcknowledgeAlert, handleMonitorLogs, handleExportLogs, handleMonitorSessions, handleMonitorSessionDetail, handleMonitorCost } from './handlers/monitoring-handlers';
import { handleHealthReport, handleAnalyticsDashboard, handleCostSummary, handleCostRecords, handleCostRange, setAnalyticsDependencies } from './handlers/analytics-handlers';
import { handleListModels, handleSystemSkillFileContent, handleTestModel, handleGetCurrentModel, handleSwitchModel, handleGetTasks, handleSaveTasks, handleSetDefaultModel } from './handlers/model-handlers';
import { handleChatCompletions, handleQuestionAnswer } from './handlers/chat-handlers';
import { handleFileRegistryList, handleFileRegistryDetail, handleFileRegistrySearch, handleFileRegistryStats, handleFileRegistryDelete, handleFileHealth } from './handlers/files-handlers';
import { HandlerCtx, createHandlerCtx } from './handlers/handler-utils';
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
  session_id?: string;
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
 * LocalHTTPService 类
 * 提供本地 HTTP API 服务，对接 CoreAPI
 */
export class LocalHTTPService {
  private server: http.Server | null = null;
  private config: LocalHTTPConfig;
  private _isRunning = false;
  private readonly apiSecret: string;
  private compileScheduler: any = null;
  /** handler 上下文（提供 sendError, readRequestBody, broadcastEvent 等） */
  private readonly _handlerCtx: HandlerCtx = createHandlerCtx();

  constructor(config: LocalHTTPConfig) {
    this.config = config;
    setAnalyticsDependencies(
      analyticsService,
      costTracker,
      getCostRecordRepository(),
      PerformanceMonitorService,
    );
    this.apiSecret = configManager.env('LIRI_API_SECRET') || '';
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
   * 校验请求是否携带有效的共享密钥
   * 仅当环境变量 LIRI_API_SECRET 设置了值时，才启用校验
   * /health 端点为免校验白名单，用于前端健康检查
   */
  private verifyRequestAuth(req: http.IncomingMessage): boolean {
    if (!this.apiSecret) return true;
    const url = req.url?.split('?')[0] || '';
    if (req.method === 'GET' && url === '/health') return true;
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '');
    return token === this.apiSecret;
  }

  /**
   * 种子知识库：若用户知识库目录为空，从源码或内建默认文档初始化
   */
  private async seedKnowledgeBaseIfEmpty(): Promise<void> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const { resolvePyappHome } = await import('@modules/core/paths');

    const userKnowledgeDir = path.join(resolvePyappHome(), 'knowledge');

    // 若用户目录已存在 .md 文件，说明已初始化，跳过
    try {
      const userFiles = await fs.readdir(userKnowledgeDir);
      if (userFiles.some((f: string) => f.endsWith('.md'))) {
        return;
      }
    } catch {
      // 目录不存在，继续初始化
    }

    await fs.mkdir(userKnowledgeDir, { recursive: true });

    // 拷贝源：1) 项目源码路径（开发环境）
    try {
      const { resolveKnowledgeBaseDir } = await import('@modules/core/paths');
      const sourceDir = resolveKnowledgeBaseDir();
      const sourceFiles = await fs.readdir(sourceDir);
      const mdFiles = sourceFiles.filter((f: string) => f.endsWith('.md'));
      if (mdFiles.length > 0) {
        for (const file of mdFiles) {
          const content = await fs.readFile(
            path.join(sourceDir, file),
            'utf-8'
          );
          await fs.writeFile(
            path.join(userKnowledgeDir, file),
            content,
            'utf-8'
          );
        }
        logger.info(
          `知识库种子完成：从 ${sourceDir} 复制了 ${mdFiles.length} 个文件`
        );
        return;
      }
    } catch {
      // 源码目录不可用，继续兜底
    }

    // 拷贝源：2) 内建默认文档（兜底，适用于打包生产环境）
    await this.writeDefaultKnowledgeDocs(userKnowledgeDir, fs, path);
  }

  /**
   * 写入内建默认知识库文档（无任何外部源时的最终兜底）
   */
  private async writeDefaultKnowledgeDocs(
    dir: string,
    fs: typeof import('node:fs/promises'),
    path: typeof import('node:path')
  ): Promise<void> {
    const docs: Array<{ fileName: string; content: string }> = [
      {
        fileName: 'index.md',
        content: [
          '# 用户知识库',
          '',
          '欢迎使用你的个人知识库！你可以在此保存笔记、代码片段和学习资料。',
          '',
          '## 快速开始',
          '',
          '使用右侧表单创建你的第一篇知识文档。',
          '',
          '## 文档管理',
          '',
          '- **创建**：填入标题和内容，点击"创建"',
          '- **编辑**：点击文档标题进入编辑模式',
          '- **搜索**：使用搜索框快速查找内容',
          '- **删除**：移除不再需要的文档',
          '',
          '## 支持格式',
          '',
          '你的知识文档支持完整的 Markdown 语法：',
          '- 标题、列表、表格',
          '- **加粗**、*斜体*、~~删除线~~',
          '- `代码块` 和语法高亮',
          '- [链接](#) 和图片',
          '',
        ].join('\n'),
      },
      {
        fileName: '示例文档.md',
        content: [
          '# 示例文档',
          '',
          '> 创建于 2026-05-22',
          '',
          '这是一个示例知识库文档，用于演示知识库功能。',
          '',
          '## 功能',
          '',
          '- 支持 Markdown 格式',
          '- 支持代码块',
          '- 支持列表',
          '- 支持链接',
          '',
          '## 代码示例',
          '',
          '```typescript',
          '// 示例 TypeScript 代码',
          'function greet(name: string): string {',
          '  return `Hello, ${name}!`;',
          '}',
          '',
          "console.log(greet('World'));",
          '```',
          '',
          '## 列表',
          '',
          '- 第一项',
          '- 第二项',
          '- 第三项',
          '',
          '## 链接',
          '',
          '[查看项目文档](/docs)',
          '',
        ].join('\n'),
      },
    ];

    for (const doc of docs) {
      const filePath = path.join(dir, doc.fileName);
      try {
        await fs.writeFile(filePath, doc.content, 'utf-8');
        logger.info(`已写入默认知识文档：${filePath}`);
      } catch (err) {
        logger.warning(`写入默认知识文档失败：${filePath}`, {
          error: String(err),
        });
      }
    }
  }

  /**
   * 启动编译调度器
   * 仅在 AI 服务已配置默认模型时才启用 runOnStart，避免无模型时大量编译失败
   */
  private async startCompileScheduler(): Promise<void> {
    try {
      const { aiService } = await import('@modules/ai/services/aiService');
      const defaultModel = aiService.getDefaultModel();
      if (!defaultModel) {
        logger.warning(
          '知识库编译调度器跳过首次编译：未配置默认模型，调度器仍按周期运行'
        );
      }

      const { runKnowledgeCompile } =
        await import('@modules/knowledge/KnowledgeCompiler');
      const { KnowledgeCompileScheduler } =
        await import('@modules/knowledge/KnowledgeCompileScheduler');
      this.compileScheduler = new KnowledgeCompileScheduler(
        (force?: boolean) =>
          runKnowledgeCompile(aiService, { force, model: defaultModel || undefined }),
        { runOnStart: !!defaultModel }
      );
      this.compileScheduler.start();
    } catch (err) {
      logger.warning('知识库编译调度器初始化失败（非关键错误）', {
        error: String(err),
      });
    }
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
        // 异步初始化知识库种子，不阻塞启动
        this.seedKnowledgeBaseIfEmpty().catch((err) =>
          logger.warning('知识库种子初始化失败（非关键错误）', {
            error: String(err),
          })
        );
        this.startCompileScheduler().catch((err) =>
          logger.warning('编译调度器启动失败（非关键错误）', {
            error: String(err),
          })
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
    if (this.compileScheduler) {
      this.compileScheduler.stop();
      this.compileScheduler = null;
    }
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
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, DELETE, OPTIONS'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization'
    );

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 共享密钥校验：确保请求来自被授权的 Tauri 客户端
    if (!this.verifyRequestAuth(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Unauthorized' } }));
      return;
    }

    const url = req.url?.split('?')[0] || '';

    logger.debug('收到请求', {
      method: req.method,
      url: req.url,
      parsedUrl: url,
    });

    // ---- SSE Event Bus ----
    if (req.method === 'GET' && url === '/v1/events') {
      return this.handleEvents(req, res);
    }

    if (req.method === 'GET' && url === '/v1/models') {
      return this.handleListModels(req, res);
    }
    if (req.method === 'POST' && url === '/v1/models/test') {
      return this.handleTestModel(req, res);
    }
    if (req.method === 'GET' && url === '/v1/models/current') {
      return this.handleGetCurrentModel(req, res);
    }
    if (req.method === 'POST' && url === '/v1/models/switch') {
      return this.handleSwitchModel(req, res);
    }
    if (req.method === 'GET' && url === '/v1/models/tasks') {
      return this.handleGetTasks(req, res);
    }
    if (req.method === 'PUT' && url === '/v1/models/tasks') {
      return this.handleSaveTasks(req, res);
    }
    if (req.method === 'PUT' && url === '/v1/models/default') {
      return this.handleSetDefaultModel(req, res);
    }

    if (req.method === 'POST' && url === '/v1/chat/completions') {
      return this.handleChatCompletions(req, res);
    }
    if (req.method === 'POST' && url === '/v1/chat/question-answer') {
      return this.handleQuestionAnswer(req, res);
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
    if (req.method === 'GET' && url.match(/^\/v1\/sessions\/(.+)\/messages$/)) {
      return this.handleGetSessionMessages(
        req,
        res,
        url.match(/^\/v1\/sessions\/(.+)\/messages$/)![1]
      );
    }
    if (
      req.method === 'PUT' &&
      url.match(/^\/api\/session\/(.+)\/message\/(.+)\/blocks$/)
    ) {
      const match = url.match(/^\/api\/session\/(.+)\/message\/(.+)\/blocks$/);
      return this.handleUpdateMessageBlocks(req, res, match![1], match![2]);
    }
    if (req.method === 'GET' && url.match(/^\/v1\/sessions\/(.+)$/)) {
      return this.handleGetSession(
        req,
        res,
        url.match(/^\/v1\/sessions\/(.+)$/)![1]
      );
    }
    if (req.method === 'POST' && url.match(/^\/v1\/sessions\/(.+)\/switch$/)) {
      return this.handleSwitchSession(
        req,
        res,
        url.match(/^\/v1\/sessions\/(.+)\/switch$/)![1]
      );
    }
    if (req.method === 'PUT' && url.match(/^\/v1\/sessions\/(.+)$/)) {
      return this.handleRenameSession(
        req,
        res,
        url.match(/^\/v1\/sessions\/(.+)$/)![1]
      );
    }
    if (req.method === 'POST' && url.match(/^\/v1\/sessions\/(.+)\/title$/)) {
      return this.handleGenerateTitle(
        req,
        res,
        url.match(/^\/v1\/sessions\/(.+)\/title$/)![1]
      );
    }
    if (req.method === 'DELETE' && url.match(/^\/v1\/sessions\/(.+)$/)) {
      return this.handleDeleteSession(
        req,
        res,
        url.match(/^\/v1\/sessions\/(.+)$/)![1]
      );
    }
    if (req.method === 'DELETE' && url === '/v1/sessions') {
      return this.handleClearAllSessions(req, res);
    }

    // ---- Plans & Flows (编排) ----
    if (req.method === 'GET' && url === '/v1/plans') {
      return this.handleListPlans(req, res);
    }
    if (req.method === 'POST' && url === '/v1/plans') {
      return this.handleCreatePlan(req, res);
    }
    if (req.method === 'GET' && url.match(/^\/v1\/plans\/([^/]+)$/)) {
      return this.handleGetPlan(
        req,
        res,
        url.match(/^\/v1\/plans\/([^/]+)$/)![1]
      );
    }
    if (
      req.method === 'POST' &&
      url.match(/^\/v1\/plans\/(.+)\/execute$/)
    ) {
      return this.handleExecutePlan(
        req,
        res,
        url.match(/^\/v1\/plans\/(.+)\/execute$/)![1]
      );
    }
    if (
      req.method === 'POST' &&
      url.match(/^\/v1\/plans\/(.+)\/abort$/)
    ) {
      return this.handleAbortPlan(
        req,
        res,
        url.match(/^\/v1\/plans\/(.+)\/abort$/)![1]
      );
    }
    if (req.method === 'GET' && url === '/v1/flows') {
      return this.handleListFlows(req, res);
    }
    if (req.method === 'GET' && url.match(/^\/v1\/flows\/([^/]+)$/)) {
      return this.handleGetFlow(
        req,
        res,
        url.match(/^\/v1\/flows\/([^/]+)$/)![1]
      );
    }

    // ---- PDCA (长程任务编排) ----
    if (req.method === 'POST' && url === '/v1/pdca/start') {
      return this.handlePdcaStart(req, res);
    }
    if (req.method === 'GET' && url.match(/^\/v1\/pdca\/([^/]+)$/)) {
      return this.handlePdcaStatus(
        req,
        res,
        url.match(/^\/v1\/pdca\/([^/]+)$/)![1]
      );
    }
    if (req.method === 'GET' && url.match(/^\/v1\/pdca\/(.+)\/audit$/)) {
      return this.handlePdcaAudit(
        req,
        res,
        url.match(/^\/v1\/pdca\/(.+)\/audit$/)![1]
      );
    }
    if (
      req.method === 'POST' &&
      url.match(/^\/v1\/pdca\/(.+)\/confirm$/)
    ) {
      return this.handlePdcaConfirm(
        req,
        res,
        url.match(/^\/v1\/pdca\/(.+)\/confirm$/)![1]
      );
    }
    if (
      req.method === 'POST' &&
      url.match(/^\/v1\/pdca\/(.+)\/step\/(.+)\/review$/)
    ) {
      const m = url.match(/^\/v1\/pdca\/(.+)\/step\/(.+)\/review$/)!;
      return this.handlePdcaReviewStep(req, res, m[1], m[2]);
    }
    if (
      req.method === 'POST' &&
      url.match(/^\/v1\/pdca\/(.+)\/step\/(.+)\/decide$/)
    ) {
      const m = url.match(/^\/v1\/pdca\/(.+)\/step\/(.+)\/decide$/)!;
      return this.handlePdcaDecideStep(req, res, m[1], m[2]);
    }
    if (req.method === 'POST' && url === '/v1/pdca/list') {
      return this.handlePdcaList(req, res);
    }

    // ---- Kanban ----
    if (req.method === 'GET' && url === '/v1/kanban') {
      return this.handleKanbanList(req, res);
    }
    if (req.method === 'POST' && url === '/v1/kanban') {
      return this.handleKanbanCreate(req, res);
    }
    if (req.method === 'PUT' && url.match(/^\/v1\/kanban\/(.+)$/)) {
      return this.handleKanbanUpdate(
        req,
        res,
        url.match(/^\/v1\/kanban\/(.+)$/)![1],
      );
    }
    if (req.method === 'DELETE' && url.match(/^\/v1\/kanban\/(.+)$/)) {
      return this.handleKanbanDelete(
        req,
        res,
        url.match(/^\/v1\/kanban\/(.+)$/)![1],
      );
    }
    if (
      req.method === 'PUT' &&
      url.match(/^\/v1\/kanban\/(.+)\/move$/)
    ) {
      return this.handleKanbanMove(
        req,
        res,
        url.match(/^\/v1\/kanban\/(.+)\/move$/)![1],
      );
    }

    // ---- Tools ----
    if (req.method === 'GET' && url === '/v1/tools') {
      return this.handleListTools(req, res);
    }
    if (req.method === 'POST' && url.match(/^\/v1\/tools\/(.+)\/execute$/)) {
      return this.handleExecuteTool(
        req,
        res,
        url.match(/^\/v1\/tools\/(.+)\/execute$/)![1]
      );
    }

    // ---- Agent ----
    if (req.method === 'GET' && url === '/v1/agents/tasks') {
      return this.handleListAgentTasks(req, res);
    }
    if (req.method === 'POST' && url === '/v1/agents/tasks') {
      return this.handleExecuteAgentTask(req, res);
    }
    if (req.method === 'GET' && url.match(/^\/v1\/agents\/tasks\/([^/]+)$/)) {
      return this.handleGetAgentProgress(
        req,
        res,
        url.match(/^\/v1\/agents\/tasks\/([^/]+)$/)![1]
      );
    }
    if (
      req.method === 'GET' &&
      url.match(/^\/v1\/agents\/tasks\/(.+)\/state$/)
    ) {
      return this.handleGetAgentTaskState(
        req,
        res,
        url.match(/^\/v1\/agents\/tasks\/(.+)\/state$/)![1]
      );
    }
    if (
      req.method === 'GET' &&
      url.match(/^\/v1\/agents\/tasks\/(.+)\/audit$/)
    ) {
      return this.handleGetAgentTaskAudit(
        req,
        res,
        url.match(/^\/v1\/agents\/tasks\/(.+)\/audit$/)![1]
      );
    }
    if (
      req.method === 'GET' &&
      url.match(/^\/v1\/agents\/tasks\/(.+)\/logs$/)
    ) {
      return this.handleGetAgentTaskLogs(
        req,
        res,
        url.match(/^\/v1\/agents\/tasks\/(.+)\/logs$/)![1]
      );
    }
    if (
      req.method === 'GET' &&
      url.match(/^\/v1\/agents\/tasks\/(.+)\/output$/)
    ) {
      return this.handleGetAgentTaskOutput(
        req,
        res,
        url.match(/^\/v1\/agents\/tasks\/(.+)\/output$/)![1]
      );
    }
    if (
      req.method === 'POST' &&
      url.match(/^\/v1\/agents\/tasks\/(.+)\/recover$/)
    ) {
      return this.handleRecoverAgentTask(
        req,
        res,
        url.match(/^\/v1\/agents\/tasks\/(.+)\/recover$/)![1]
      );
    }
    if (
      req.method === 'POST' &&
      url.match(/^\/v1\/agents\/tasks\/(.+)\/chat$/)
    ) {
      return this.handleAgentTaskChat(
        req,
        res,
        url.match(/^\/v1\/agents\/tasks\/(.+)\/chat$/)![1]
      );
    }
    if (
      req.method === 'POST' &&
      url.match(/^\/v1\/agents\/tasks\/(.+)\/cancel$/)
    ) {
      return this.handleCancelAgentTask(
        req,
        res,
        url.match(/^\/v1\/agents\/tasks\/(.+)\/cancel$/)![1]
      );
    }

    // ---- Voice ----
    if (req.method === 'POST' && url === '/v1/voice/transcribe') {
      return this.handleSTTTranscribe(req, res);
    }
    if (req.method === 'GET' && url === '/v1/voice/settings') {
      return this.handleGetVoiceSettings(req, res);
    }
    if (req.method === 'PUT' && url === '/v1/voice/settings') {
      return this.handleUpdateVoiceSettings(req, res);
    }
    if (req.method === 'POST' && url === '/v1/voice/session/start') {
      return this.handleStartVoiceSession(req, res);
    }
    if (
      req.method === 'POST' &&
      url.match(/^\/v1\/voice\/session\/(.+)\/end$/)
    ) {
      return this.handleEndVoiceSession(
        req,
        res,
        url.match(/^\/v1\/voice\/session\/(.+)\/end$/)![1]
      );
    }
    if (req.method === 'GET' && url === '/v1/voice/sessions') {
      return this.handleListVoiceSessions(req, res);
    }
    if (req.method === 'GET' && url.match(/^\/v1\/voice\/session\/(.+)$/)) {
      return this.handleGetVoiceSession(
        req,
        res,
        url.match(/^\/v1\/voice\/session\/(.+)$/)![1]
      );
    }
    if (req.method === 'POST' && url === '/v1/voice/upload') {
      return this.handleVoiceUpload(req, res);
    }
    if (req.method === 'GET' && url.match(/^\/v1\/voice\/stream\/(.+)$/)) {
      return this.handleVoiceStream(
        req,
        res,
        url.match(/^\/v1\/voice\/stream\/(.+)$/)![1]
      );
    }
    if (req.method === 'POST' && url === '/v1/voice/tts') {
      return this.handleTTSSynthesize(req, res);
    }
    if (req.method === 'GET' && url === '/v1/voice/providers') {
      return this.handleListVoiceProviders(req, res);
    }
    if (req.method === 'GET' && url === '/v1/voice/voices') {
      return this.handleListVoices(req, res);
    }
    if (
      req.method === 'POST' &&
      url.match(/^\/v1\/voice\/wakeword\/(.+)\/test$/)
    ) {
      return this.handleTestWakeWord(
        req,
        res,
        url.match(/^\/v1\/voice\/wakeword\/(.+)\/test$/)![1]
      );
    }

    // ---- Checkpoints ----
    if (req.method === 'POST' && url === '/v1/checkpoints') {
      return this.handleCreateCheckpoint(req, res);
    }
    if (req.method === 'GET' && url === '/v1/checkpoints') {
      return this.handleListCheckpoints(req, res);
    }
    if (req.method === 'GET' && url.match(/^\/v1\/checkpoints\/(.+)$/)) {
      return this.handleGetCheckpoint(
        req,
        res,
        url.match(/^\/v1\/checkpoints\/(.+)$/)![1]
      );
    }
    if (req.method === 'POST' && url.match(/^\/v1\/checkpoints\/(.+)\/rollback$/)) {
      return this.handleRollbackCheckpoint(
        req,
        res,
        url.match(/^\/v1\/checkpoints\/(.+)\/rollback$/)![1]
      );
    }
    if (req.method === 'DELETE' && url.match(/^\/v1\/checkpoints\/(.+)$/)) {
      return this.handleDeleteCheckpoint(
        req,
        res,
        url.match(/^\/v1\/checkpoints\/(.+)$/)![1]
      );
    }

    // ---- Memory ----
    if (req.method === 'POST' && url === '/v1/memory') {
      return this.handleCreateMemory(req, res);
    }
    if (req.method === 'GET' && url === '/v1/memory') {
      return this.handleListMemories(req, res);
    }
    if (req.method === 'GET' && url.match(/^\/v1\/memory\/(.+)$/)) {
      return this.handleGetMemory(
        req,
        res,
        url.match(/^\/v1\/memory\/(.+)$/)![1]
      );
    }
    if (req.method === 'PUT' && url.match(/^\/v1\/memory\/(.+)$/)) {
      return this.handleUpdateMemory(
        req,
        res,
        url.match(/^\/v1\/memory\/(.+)$/)![1]
      );
    }
    if (req.method === 'DELETE' && url.match(/^\/v1\/memory\/(.+)$/)) {
      return this.handleDeleteMemory(
        req,
        res,
        url.match(/^\/v1\/memory\/(.+)$/)![1]
      );
    }
    if (req.method === 'POST' && url === '/v1/memory/search') {
      return this.handleSearchMemories(req, res);
    }
    if (req.method === 'POST' && url === '/v1/memory/create-from-file') {
      return this.handleCreateMemoryFromFile(req, res);
    }

    // ---- Semantic Index ----
    if (req.method === 'POST' && url === '/v1/semantic/index') {
      return this.handleBuildSemanticIndex(req, res);
    }
    if (req.method === 'GET' && url === '/v1/semantic/search') {
      return this.handleSearchSemantic(req, res);
    }
    if (req.method === 'GET' && url === '/v1/semantic/index/status') {
      return this.handleGetSemanticIndexStatus(req, res);
    }
    if (req.method === 'DELETE' && url === '/v1/semantic/index') {
      return this.handleClearSemanticIndex(req, res);
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
    if (req.method === 'POST' && url === '/v1/files/send-to-ai') {
      return this.handleSendFileToAI(req, res);
    }

    // ---- Files: Registry API ----
    if (req.method === 'GET' && url === '/v1/files/health') {
      return this.handleFileHealth(req, res);
    }
    if (req.method === 'GET' && url === '/v1/files/registry/list') {
      return this.handleFileRegistryList(req, res);
    }
    if (req.method === 'GET' && url === '/v1/files/registry/detail') {
      return this.handleFileRegistryDetail(req, res);
    }
    if (req.method === 'GET' && url === '/v1/files/registry/search') {
      return this.handleFileRegistrySearch(req, res);
    }
    if (req.method === 'GET' && url === '/v1/files/registry/stats') {
      return this.handleFileRegistryStats(req, res);
    }
    if (req.method === 'DELETE' && url === '/v1/files/registry/delete') {
      return this.handleFileRegistryDelete(req, res);
    }

    // ---- Workspaces ----
    if (req.method === 'GET' && url === '/v1/workspaces') {
      return this.handleListWorkspaces(req, res);
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
    if (req.method === 'GET' && url === '/v1/knowledge/bases') {
      return this.handleListKnowledgeBases(req, res);
    }
    if (req.method === 'POST' && url === '/v1/knowledge/bases') {
      return this.handleCreateKnowledgeBase(req, res);
    }
    if (req.method === 'PUT' && url.match(/^\/v1\/knowledge\/bases\/(.+)$/)) {
      return this.handleUpdateKnowledgeBase(
        req,
        res,
        url.match(/^\/v1\/knowledge\/bases\/(.+)$/)![1]
      );
    }
    if (
      req.method === 'DELETE' &&
      url.match(/^\/v1\/knowledge\/bases\/(.+)$/)
    ) {
      return this.handleDeleteKnowledgeBase(
        req,
        res,
        url.match(/^\/v1\/knowledge\/bases\/(.+)$/)![1]
      );
    }
    if (req.method === 'POST' && url === '/v1/knowledge/save-from-chat') {
      return this.handleSaveFromChat(req, res);
    }
    if (req.method === 'POST' && url === '/v1/knowledge/upload') {
      return this.handleKnowledgeUpload(req, res);
    }
    if (req.method === 'POST' && url === '/v1/knowledge/compile') {
      return this.handleKnowledgeCompile(req, res);
    }
    if (req.method === 'GET' && url === '/v1/knowledge/raw-files') {
      return this.handleGetRawFiles(req, res);
    }
    if (req.method === 'PUT' && url === '/v1/knowledge/docs') {
      return this.handleUpdateKnowledgeDoc(req, res);
    }
    if (req.method === 'POST' && url === '/v1/knowledge/export-to-notebook') {
      return this.handleExportToNotebook(req, res);
    }
    if (req.method === 'POST' && url === '/v1/knowledge/import-from-file') {
      return this.handleImportFromFile(req, res);
    }
    if (req.method === 'POST' && url === '/v1/knowledge/ingest') {
      return this.handleImportFromFile(req, res);
    }
    if (req.method === 'POST' && url === '/v1/knowledge/batch-delete') {
      return this.handleBatchDeleteKnowledge(req, res);
    }
    if (req.method === 'POST' && url === '/v1/knowledge/batch-tag') {
      return this.handleBatchTagKnowledge(req, res);
    }
    if (
      req.method === 'PUT' &&
      url.match(/^\/v1\/knowledge\/(?!bases|docs)(.+)$/)
    ) {
      return this.handleUpdateKnowledge(
        req,
        res,
        url.match(/^\/v1\/knowledge\/(?!bases|docs)(.+)$/)![1]
      );
    }
    if (
      req.method === 'DELETE' &&
      url.match(/^\/v1\/knowledge\/(?!bases)(.+)$/)
    ) {
      return this.handleDeleteKnowledge(
        req,
        res,
        url.match(/^\/v1\/knowledge\/(?!bases)(.+)$/)![1]
      );
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
    // 精确路由必须在正则捕获之前，避免 /status 被 /:id 拦截
    if (req.method === 'GET' && url === '/v1/cron/status') {
      return this.handleCronStatus(req, res);
    }
    if (req.method === 'GET' && url.startsWith('/v1/cron/runs')) {
      return this.handleCronRuns(req, res, url);
    }
    if (req.method === 'GET' && url.match(/^\/v1\/cron\/(.+)$/)) {
      return this.handleGetCron(req, res, url.match(/^\/v1\/cron\/(.+)$/)![1]);
    }
    if (req.method === 'PUT' && url.match(/^\/v1\/cron\/(.+)$/)) {
      return this.handleUpdateCron(
        req,
        res,
        url.match(/^\/v1\/cron\/(.+)$/)![1]
      );
    }
    if (req.method === 'DELETE' && url.match(/^\/v1\/cron\/(.+)$/)) {
      return this.handleDeleteCron(
        req,
        res,
        url.match(/^\/v1\/cron\/(.+)$/)![1]
      );
    }
    if (req.method === 'POST' && url.match(/^\/v1\/cron\/(.+)\/run$/)) {
      return this.handleRunCron(
        req,
        res,
        url.match(/^\/v1\/cron\/(.+)\/run$/)![1]
      );
    }

    // ---- Channels ----
    if (req.method === 'GET' && url === '/v1/channels') {
      return this.handleListChannels(req, res);
    }
    if (req.method === 'GET' && url.match(/^\/v1\/channels\/(.+)$/)) {
      return this.handleGetChannel(
        req,
        res,
        url.match(/^\/v1\/channels\/(.+)$/)![1]
      );
    }
    if (req.method === 'POST' && url.match(/^\/v1\/channels\/(.+)\/toggle$/)) {
      return this.handleToggleChannel(
        req,
        res,
        url.match(/^\/v1\/channels\/(.+)\/toggle$/)![1]
      );
    }
    if (req.method === 'DELETE' && url.match(/^\/v1\/channels\/(.+)$/)) {
      return this.handleDeleteChannel(
        req,
        res,
        url.match(/^\/v1\/channels\/(.+)$/)![1]
      );
    }
    if (req.method === 'PUT' && url.match(/^\/v1\/channels\/(.+)$/)) {
      return this.handleUpdateChannel(
        req,
        res,
        url.match(/^\/v1\/channels\/(.+)$/)![1]
      );
    }
    if (req.method === 'POST' && url === '/v1/channels/config/apply') {
      return this.handleApplyChannelConfig(req, res);
    }

    // ---- Channel Plugins ----
    if (req.method === 'GET' && url === '/v1/channels/plugins') {
      return this.handleListChannelPlugins(req, res);
    }
    if (req.method === 'POST' && url === '/v1/channels/plugins/install') {
      return this.handleInstallChannelPlugin(req, res);
    }

    // ---- Config ----
    if (req.method === 'GET' && url === '/favicon.ico') {
      return this.handleFavicon(req, res);
    }
    if (req.method === 'GET' && url === '/v1/config') {
      return this.handleListConfig(req, res);
    }
    if (req.method === 'GET' && url.match(/^\/v1\/config\/(.+)$/)) {
      return this.handleGetConfig(
        req,
        res,
        url.match(/^\/v1\/config\/(.+)$/)![1]
      );
    }
    if (req.method === 'PUT' && url.match(/^\/v1\/config\/(.+)$/)) {
      return this.handleSetConfig(
        req,
        res,
        url.match(/^\/v1\/config\/(.+)$/)![1]
      );
    }
    if (req.method === 'DELETE' && url.match(/^\/v1\/config\/(.+)$/)) {
      return this.handleDeleteConfig(
        req,
        res,
        url.match(/^\/v1\/config\/(.+)$/)![1]
      );
    }

    // ---- Router（智能路由）----
    if (req.method === 'GET' && url === '/v1/router/config') {
      return this.handleRouterGetConfig(req, res);
    }
    if (req.method === 'PUT' && url === '/v1/router/config') {
      return this.handleRouterUpdateConfig(req, res);
    }

    // ---- Settings ----
    if (req.method === 'GET' && url === '/v1/settings/data-directory') {
      return this.handleGetDataDirectory(req, res);
    }
    if (req.method === 'PUT' && url === '/v1/settings/data-directory') {
      return this.handleSetDataDirectory(req, res);
    }

    // ---- Skills (ClawHub 生态对接) ----
    if (req.method === 'GET' && url === '/v1/skills') {
      return this.handleListSkills(req, res);
    }
    if (req.method === 'GET' && url === '/v1/skills/system') {
      return this.handleListSystemSkills(req, res);
    }
    if (
      req.method === 'GET' &&
      url.match(/^\/v1\/skills\/system\/(.+)\/content$/)
    ) {
      return this.handleSystemSkillContent(
        req,
        res,
        url.match(/^\/v1\/skills\/system\/(.+)\/content$/)![1]
      );
    }
    if (
      req.method === 'GET' &&
      url.match(/^\/v1\/skills\/system\/(.+)\/files\/content/)
    ) {
      return this.handleSystemSkillFileContent(
        req,
        res,
        url.match(/^\/v1\/skills\/system\/(.+)\/files\/content/)![1]
      );
    }
    if (req.method === 'GET' && url === '/v1/skills/search') {
      return this.handleSearchSkills(req, res);
    }
    if (req.method === 'GET' && url === '/v1/skills/recommended') {
      return this.handleRecommendedSkills(req, res);
    }
    if (req.method === 'GET' && url === '/v1/skills/categories') {
      return this.handleSkillCategories(req, res);
    }
    if (req.method === 'GET' && url === '/v1/skills/sources') {
      return this.handleSkillSources(req, res);
    }
    if (req.method === 'POST' && url === '/v1/skills/sources') {
      return this.handleAddSkillSource(req, res);
    }
    if (req.method === 'DELETE' && url.match(/^\/v1\/skills\/sources\/(.+)$/)) {
      return this.handleRemoveSkillSource(
        req,
        res,
        url.match(/^\/v1\/skills\/sources\/(.+)$/)![1]
      );
    }
    if (req.method === 'GET' && url.match(/^\/v1\/skills\/(.+)$/)) {
      return this.handleGetSkillDetail(
        req,
        res,
        url.match(/^\/v1\/skills\/(.+)$/)![1]
      );
    }
    if (req.method === 'POST' && url === '/v1/skills/install') {
      return this.handleInstallSkill(req, res);
    }
    if (req.method === 'POST' && url.match(/^\/v1\/skills\/(.+)\/uninstall$/)) {
      return this.handleUninstallSkill(
        req,
        res,
        url.match(/^\/v1\/skills\/(.+)\/uninstall$/)![1]
      );
    }
    if (req.method === 'POST' && url.match(/^\/v1\/skills\/(.+)\/update$/)) {
      return this.handleUpdateSkill(
        req,
        res,
        url.match(/^\/v1\/skills\/(.+)\/update$/)![1]
      );
    }
    if (req.method === 'POST' && url.match(/^\/v1\/skills\/(.+)\/toggle$/)) {
      return this.handleToggleSkill(
        req,
        res,
        url.match(/^\/v1\/skills\/(.+)\/toggle$/)![1]
      );
    }
    if (req.method === 'POST' && url === '/v1/skills') {
      return this.handleCreateSkill(req, res);
    }
    if (req.method === 'PUT' && url.match(/^\/v1\/skills\/(.+)$/)) {
      return this.handleUpdateSkillById(
        req,
        res,
        url.match(/^\/v1\/skills\/(.+)$/)![1]
      );
    }
    if (req.method === 'DELETE' && url.match(/^\/v1\/skills\/(.+)$/)) {
      return this.handleDeleteSkill(
        req,
        res,
        url.match(/^\/v1\/skills\/(.+)$/)![1]
      );
    }
    if (req.method === 'POST' && url.match(/^\/v1\/skills\/(.+)\/enable$/)) {
      return this.handleEnableSkill(
        req,
        res,
        url.match(/^\/v1\/skills\/(.+)\/enable$/)![1]
      );
    }
    if (req.method === 'POST' && url.match(/^\/v1\/skills\/(.+)\/disable$/)) {
      return this.handleDisableSkill(
        req,
        res,
        url.match(/^\/v1\/skills\/(.+)\/disable$/)![1]
      );
    }

    // ---- Monitor ----
    if (req.method === 'GET' && url === '/v1/monitor/summary') {
      return this.handleMonitorSummary(req, res);
    }
    if (req.method === 'GET' && url.startsWith('/v1/monitor/metrics')) {
      return this.handleMonitorMetrics(req, res);
    }
    if (req.method === 'GET' && url.startsWith('/v1/monitor/alerts')) {
      return this.handleMonitorAlerts(req, res);
    }
    if (
      req.method === 'POST' &&
      url.match(/^\/v1\/monitor\/alerts\/(.+)\/acknowledge$/)
    ) {
      return this.handleAcknowledgeAlert(
        req,
        res,
        url.match(/^\/v1\/monitor\/alerts\/(.+)\/acknowledge$/)![1]
      );
    }
    if (req.method === 'GET' && url.startsWith('/v1/monitor/logs')) {
      return this.handleMonitorLogs(req, res);
    }
    if (req.method === 'POST' && url === '/v1/monitor/logs/export') {
      return this.handleExportLogs(req, res);
    }
    if (req.method === 'GET' && url === '/v1/monitor/sessions') {
      return this.handleMonitorSessions(req, res);
    }
    if (req.method === 'GET' && url.match(/^\/v1\/monitor\/sessions\/(.+)$/)) {
      return this.handleMonitorSessionDetail(
        req,
        res,
        url.match(/^\/v1\/monitor\/sessions\/(.+)$/)![1]
      );
    }
    if (req.method === 'GET' && url === '/v1/monitor/cost') {
      return this.handleMonitorCost(req, res);
    }
    if (req.method === 'GET' && url === '/v1/health/report') {
      return this.handleHealthReport(req, res);
    }

    // ---- Analytics ----
    if (req.method === 'GET' && url === '/v1/analytics/dashboard') {
      return this.handleAnalyticsDashboard(req, res);
    }

    // ---- Cost ----
    if (req.method === 'GET' && url === '/api/cost/summary') {
      return this.handleCostSummary(req, res);
    }
    if (req.method === 'GET' && url === '/api/cost/records') {
      return this.handleCostRecords(req, res);
    }
    if (req.method === 'GET' && url === '/api/cost/range') {
      return this.handleCostRange(req, res);
    }

    // ---- Commands ----
    if (req.method === 'GET' && url === '/v1/commands') {
      return this.handleListCommands(req, res);
    }
    if (req.method === 'POST' && url === '/v1/commands/execute') {
      return this.handleExecuteCommand(req, res);
    }

    // ---- MCP Marketplace ----
    if (req.method === 'GET' && url === '/v1/mcp/marketplace/search') {
      return this.handleMCPMarketplaceSearch(req, res);
    }
    if (req.method === 'GET' && url === '/v1/mcp/marketplace/registries') {
      return this.handleMCPMarketplaceRegistries(req, res);
    }
    if (req.method === 'GET' && url === '/v1/mcp/marketplace/categories') {
      return this.handleMCPMarketplaceCategories(req, res);
    }
    if (
      req.method === 'GET' &&
      url.match(/^\/v1\/mcp\/marketplace\/servers\/(.+)$/)
    ) {
      return this.handleMCPMarketplaceServerDetail(
        req,
        res,
        url.match(/^\/v1\/mcp\/marketplace\/servers\/(.+)$/)![1]
      );
    }
    if (req.method === 'GET' && url === '/v1/mcp/marketplace/installed') {
      return this.handleMCPInstalledServers(req, res);
    }
    if (
      req.method === 'POST' &&
      url.match(/^\/v1\/mcp\/marketplace\/servers\/(.+)\/install$/)
    ) {
      return this.handleMCPInstallServer(
        req,
        res,
        url.match(/^\/v1\/mcp\/marketplace\/servers\/(.+)\/install$/)![1]
      );
    }
    if (
      req.method === 'POST' &&
      url.match(/^\/v1\/mcp\/marketplace\/servers\/(.+)\/uninstall$/)
    ) {
      return this.handleMCPUninstallServer(
        req,
        res,
        url.match(/^\/v1\/mcp\/marketplace\/servers\/(.+)\/uninstall$/)![1]
      );
    }
    if (
      req.method === 'POST' &&
      url.match(/^\/v1\/mcp\/marketplace\/servers\/(.+)\/toggle$/)
    ) {
      return this.handleMCPToggleServer(
        req,
        res,
        url.match(/^\/v1\/mcp\/marketplace\/servers\/(.+)\/toggle$/)![1]
      );
    }

    // ---- MCP Server Verify ----
    if (
      req.method === 'POST' &&
      url.match(/^\/v1\/mcp\/servers\/(.+)\/verify$/)
    ) {
      return this.handleMCPVerifyServer(
        req,
        res,
        url.match(/^\/v1\/mcp\/servers\/(.+)\/verify$/)![1]
      );
    }

    // ---- MCP Tools ----
    if (req.method === 'GET' && url === '/v1/mcp/tools') {
      return this.handleMCPListTools(req, res);
    }
    if (
      req.method === 'PATCH' &&
      url.match(/^\/v1\/mcp\/tools\/(.+)\/toggle$/)
    ) {
      return this.handleMCPToggleTool(
        req,
        res,
        url.match(/^\/v1\/mcp\/tools\/(.+)\/toggle$/)![1]
      );
    }

    // ---- Auth ----
    if (req.method === 'POST' && url === '/v1/auth/login') {
      return this.handleAuthLogin(req, res);
    }
    if (req.method === 'POST' && url === '/v1/auth/register') {
      return this.handleAuthRegister(req, res);
    }
    if (req.method === 'POST' && url === '/v1/auth/logout') {
      return this.handleAuthLogout(req, res);
    }
    if (req.method === 'GET' && url === '/v1/auth/me') {
      return this.handleAuthMe(req, res);
    }
    if (req.method === 'GET' && url === '/v1/auth/permissions') {
      return this.handleAuthPermissions(req, res);
    }

    // ---- API Keys ----
    if (req.method === 'GET' && url === '/v1/apikeys') {
      return this.handleListApiKeys(req, res);
    }
    if (req.method === 'POST' && url === '/v1/apikeys') {
      return this.handleCreateApiKey(req, res);
    }
    if (req.method === 'DELETE' && url.match(/^\/v1\/apikeys\/(.+)$/)) {
      return this.handleDeleteApiKey(
        req,
        res,
        url.match(/^\/v1\/apikeys\/(.+)$/)![1]
      );
    }

    // ---- Memory ----
    if (req.method === 'GET' && url === '/v1/memory') {
      return this.handleListMemories(req, res);
    }
    if (req.method === 'GET' && url === '/v1/memory/search') {
      return this.handleSearchMemories(req, res);
    }
    if (req.method === 'GET' && url === '/v1/memory/weights') {
      return this.handleGetMemoryWeights(req, res);
    }
    if (req.method === 'GET' && url === '/v1/memory/sync-status') {
      return this.handleGetSyncStatus(req, res);
    }
    if (req.method === 'GET' && url.match(/^\/v1\/memory\/(.+)\/summary$/)) {
      return this.handleGetMemorySummary(
        req,
        res,
        url.match(/^\/v1\/memory\/(.+)\/summary$/)![1]
      );
    }
    if (req.method === 'GET' && url.match(/^\/v1\/memory\/(.+)$/)) {
      return this.handleGetMemory(
        req,
        res,
        url.match(/^\/v1\/memory\/(.+)$/)![1]
      );
    }
    if (req.method === 'POST' && url === '/v1/memory') {
      return this.handleCreateMemory(req, res);
    }
    if (req.method === 'POST' && url === '/v1/memory/sync') {
      return this.handleSyncMemories(req, res);
    }
    if (req.method === 'POST' && url === '/v1/memory/consolidate') {
      return this.handleConsolidateMemories(req, res);
    }
    if (req.method === 'PUT' && url.match(/^\/v1\/memory\/(.+)$/)) {
      return this.handleUpdateMemory(
        req,
        res,
        url.match(/^\/v1\/memory\/(.+)$/)![1]
      );
    }
    if (req.method === 'DELETE' && url === '/v1/memory') {
      return this.handleDeleteAllMemories(req, res);
    }
    if (req.method === 'DELETE' && url.match(/^\/v1\/memory\/(.+)$/)) {
      return this.handleDeleteMemory(
        req,
        res,
        url.match(/^\/v1\/memory\/(.+)$/)![1]
      );
    }

    // ---- File Open ----
    if (req.method === 'GET' && url === '/api/file/open') {
      return this.handleFileOpen(req, res);
    }

    // ---- File Read ----
    if (req.method === 'GET' && url.startsWith('/api/file/read')) {
      return this.handleFileRead(req, res);
    }

    // ---- File Paths ----
    if (req.method === 'GET' && url === '/api/file/paths') {
      return this.handleFilePaths(req, res);
    }

    // ---- File Resolve Path ----
    if (req.method === 'GET' && url.startsWith('/api/file/resolve-path')) {
      return this.handleFileResolvePath(req, res);
    }

    // ---- File Preview ----
    if (req.method === 'GET' && url === '/api/file/preview') {
      return this.handleFilePreview(req, res);
    }

    // ---- Health ----
    if (req.method === 'GET' && url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'LocalHTTPService' }));
      return;
    }

    // ---- Model Management API (Providers / Usage / Balance / Pricing) ----
    const handled = await tryHandleRoute(req, res);
    if (handled) return;

    logger.warning('未匹配的路由', {
      method: req.method,
      url: req.url,
      parsedUrl: url,
    });
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: { message: 'Not found', type: 'invalid_request_error' },
      })
    );
  }

  // CPU 使用率跟踪状态（已移至 monitoring-handlers.ts）

  /**
   * 计算当前 CPU 使用率（基于 process.cpuUsage 差值）
   * 返回值为 0~100 的百分比（占系统总 CPU 容量的比例）
   */
  // ========== Monitoring Handlers (extracted to handlers/monitoring-handlers.ts) ==========

  private async handleMonitorSummary(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    return handleMonitorSummary(this._handlerCtx, req, res);
  }

  private async handleMonitorMetrics(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    return handleMonitorMetrics(this._handlerCtx, req, res);
  }

  private async handleMonitorAlerts(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    return handleMonitorAlerts(this._handlerCtx, req, res);
  }

  private async handleAcknowledgeAlert(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    alertId: string,
  ): Promise<void> {
    return handleAcknowledgeAlert(this._handlerCtx, req, res, { "$1": alertId });
  }

  private async handleMonitorLogs(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    return handleMonitorLogs(this._handlerCtx, req, res);
  }

  private async handleExportLogs(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    return handleExportLogs(this._handlerCtx, req, res);
  }

  private async handleMonitorSessions(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    return handleMonitorSessions(this._handlerCtx, req, res);
  }

  private async handleMonitorSessionDetail(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string,
  ): Promise<void> {
    return handleMonitorSessionDetail(this._handlerCtx, req, res, { "$1": sessionId });
  }

  private async handleMonitorCost(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    return handleMonitorCost(this._handlerCtx, req, res);
  }

  // ========== Health / Analytics / Cost Handlers (extracted to handlers/analytics-handlers.ts) ==========

  private async handleHealthReport(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    return handleHealthReport(this._handlerCtx, req, res);
  }

  private async handleAnalyticsDashboard(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    return handleAnalyticsDashboard(this._handlerCtx, req, res);
  }

  private async handleCostSummary(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    return handleCostSummary(this._handlerCtx, req, res);
  }

  private async handleCostRecords(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    return handleCostRecords(this._handlerCtx, req, res);
  }

  private async handleCostRange(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    return handleCostRange(this._handlerCtx, req, res);
  }

  // ========== Model Handlers (extracted to handlers/model-handlers.ts) ==========

  private async handleListModels(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    return handleListModels(this._handlerCtx, req, res);
  }

  private async handleSystemSkillFileContent(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string,
  ): Promise<void> {
    return handleSystemSkillFileContent(this._handlerCtx, req, res, { "$1": skillId });
  }

  private async handleTestModel(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    return handleTestModel(this._handlerCtx, req, res);
  }

  private async handleGetCurrentModel(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    return handleGetCurrentModel(this._handlerCtx, req, res);
  }

  private async handleSwitchModel(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    return handleSwitchModel(this._handlerCtx, req, res);
  }

  private async handleGetTasks(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    return handleGetTasks(this._handlerCtx, req, res);
  }

  private async handleSaveTasks(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    return handleSaveTasks(this._handlerCtx, req, res);
  }

  private async handleSetDefaultModel(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    return handleSetDefaultModel(this._handlerCtx, req, res);
  }

  // ========== Chat Handlers (extracted to handlers/chat-handlers.ts) ==========

  private async handleChatCompletions(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    return handleChatCompletions(this._handlerCtx, req, res);
  }

  private async handleQuestionAnswer(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    return handleQuestionAnswer(this._handlerCtx, req, res);
  }

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
        res.end(
          JSON.stringify({
            error: { message: 'Session not found', type: 'not_found' },
          })
        );
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(session));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理获取会话消息列表请求
   */
  private async handleGetSessionMessages(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string
  ): Promise<void> {
    try {
      const coreAPI = getCoreAPI();
      const messages = await coreAPI.getSessionMessages(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(messages));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理更新消息 blocks 请求
   */
  private async handleUpdateMessageBlocks(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string,
    messageId: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const data = JSON.parse(body);
      const blocks = data.blocks || [];

      const coreAPI = getCoreAPI();
      await coreAPI.updateMessageBlocks(sessionId, messageId, blocks);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
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
   * 处理清除所有会话请求
   */
  private async handleClearAllSessions(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const coreAPI = getCoreAPI();
      await coreAPI.clearAllSessions();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      this.broadcastEvent('session:cleared', {});
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
      const session = await coreAPI.getSession(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(session ?? { success: true }));
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
      this.broadcastEvent('session:renamed', { id: sessionId, title });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理生成会话标题请求
   */
  private async handleGenerateTitle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { userMessage, assistantResponse } = JSON.parse(body);
      const coreAPI = getCoreAPI();
      const title = await coreAPI.generateSessionTitle(
        sessionId,
        userMessage,
        assistantResponse
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, title }));
      if (title) {
        await coreAPI.renameSession(sessionId, title);
        this.broadcastEvent('session:renamed', { id: sessionId, title });
      }
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
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { SqliteTaskStore } =
        await import('@modules/tasks/db/SqliteTaskStore');
      const store = new SqliteTaskStore();
      await store.init();
      const taskStates = await store.loadTaskStates();

      const tasks = taskStates.map((state) => ({
        id: state.id,
        name: state.description || state.id,
        status: state.status,
        priority: (state.metadata?.priority as string) || 'medium',
        progress:
          state.status === 'completed'
            ? 100
            : state.status === 'running'
              ? 50
              : 0,
        result:
          state.status === 'completed'
            ? state.outputFile || undefined
            : undefined,
        error: state.error,
        created_at: state.startTime,
        type: state.type,
        tokenUsed: state.tokenCount,
        description: state.description,
        metadata: state.metadata,
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(tasks));
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
      res.end(
        JSON.stringify(
          progress || { agentId, state: 'unknown', progress: 0, message: '' }
        )
      );
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
        res.end(
          JSON.stringify({
            error: { message: 'filename and data are required' },
          })
        );
        return;
      }
      const buffer = Buffer.from(data, 'base64');
      const safeName = path.basename(filename);
      // 使用 AttachmentManager 保存到用户附件目录（第三层：~/.pyapp/attachments/）
      const attachment = attachmentManager.saveAttachment(
        safeName,
        buffer,
        'file',
        'application/octet-stream',
        AttachmentSource.SESSION
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
      const result = await coreAPI.convertFile({
        filePath,
        outputFormat,
        options,
      });
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

  /**
   * 处理发送文件给AI分析请求
   * POST /v1/files/send-to-ai
   * 读取文件内容，将其作为用户消息发送给AI
   */
  private async handleSendFileToAI(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { filePath } = JSON.parse(body);

      if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'filePath is required' } }));
        return;
      }

      // 沙箱权限检查
      if (!this.checkFilePathPermission(filePath, SandboxPermission.READ_FILE)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Access denied: file path not in whitelist' } }));
        return;
      }

      const { readFile } = await import('node:fs/promises');
      const { existsSync } = await import('node:fs');
      const { basename } = await import('node:path');

      if (!existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'File not found' } }));
        return;
      }

      const content = await readFile(filePath, 'utf-8');
      const fileName = basename(filePath);

      // 将文件内容作为消息发送给AI
      const chatManager = createChatManager();

      const message = `请分析以下文件内容（文件名: ${fileName}）:\n\n${content}`;
      await chatManager.sendMessage(message);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, fileName, size: content.length }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== File Registry Handlers ==========

  /**
   * 处理文件列表查询请求 — 委托到 files-handlers.ts
   */
  private async handleFileRegistryList(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleFileRegistryList(this._handlerCtx, req, res);
  }

  /**
   * 处理文件详情查询请求 — 委托到 files-handlers.ts
   */
  private async handleFileRegistryDetail(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleFileRegistryDetail(this._handlerCtx, req, res);
  }

  /**
   * 处理文件全文搜索请求 — 委托到 files-handlers.ts
   */
  private async handleFileRegistrySearch(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleFileRegistrySearch(this._handlerCtx, req, res);
  }

  /**
   * 处理文件统计请求 — 委托到 files-handlers.ts
   */
  private async handleFileRegistryStats(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleFileRegistryStats(this._handlerCtx, req, res);
  }

  /**
   * 处理文件软删除请求 — 委托到 files-handlers.ts
   */
  private async handleFileRegistryDelete(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleFileRegistryDelete(this._handlerCtx, req, res);
  }

  /**
   * 处理文件健康检查请求 — 委托到 files-handlers.ts
   */
  private async handleFileHealth(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    return handleFileHealth(this._handlerCtx, req, res);
  }

  // ========== Workspaces Handlers ==========

  /**
   * 处理列出工作空间请求
   * GET /v1/workspaces
   */
  private async handleListWorkspaces(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { buildEntries } = await import(
        '@modules/commands/builtin/workspace/WorkspaceStorage'
      );
      const entries = await buildEntries();

      const workspaces = entries.map((entry) => ({
        id: entry.meta.id,
        name: entry.name,
        description: entry.meta.description,
        createdAt: new Date(entry.meta.createdAt).getTime(),
        updatedAt: new Date(entry.meta.updatedAt).getTime(),
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(workspaces));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== Voice Handlers ==========

  /**
   * 处理 STT 语音转录请求 POST /v1/voice/transcribe
   * 接收 base64 编码的音频数据，通过 STTRegistry 选择可用提供者执行转录
   */
  private async handleSTTTranscribe(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { audioData, providerId, language, keyterms } = JSON.parse(body);

      if (!audioData) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'audioData 是必需的（base64 编码的音频数据）' },
          })
        );
        return;
      }

      const audioBuffer = Buffer.from(audioData, 'base64');

      if (audioBuffer.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: '音频数据为空' } }));
        return;
      }

      const { STTRegistry } =
        await import('../../services/voice/services/sttRegistry');

      // 自动注册 STT 提供者（如尚未注册）
      if (STTRegistry.getAllProviders().length === 0) {
        const { LocalSTTProvider } =
          await import('../../services/voice/services/localSTTProvider');
        STTRegistry.register(new LocalSTTProvider());

        const openAIApiKey = configManager.env('OPENAI_API_KEY');
        if (openAIApiKey) {
          const { CloudSTTProvider } =
            await import('../../services/voice/services/cloudSTTProvider');
          STTRegistry.register(
            new CloudSTTProvider({ apiKey: openAIApiKey })
          );
        }
      }

      const startTime = Date.now();

      // providerId 是 STTRegistry.transcribe 的第三个独立参数
      const result = await STTRegistry.transcribe(
        audioBuffer,
        {
          language: language,
          keyterms: keyterms
            ? Array.isArray(keyterms)
              ? keyterms
              : [keyterms]
            : undefined,
        },
        providerId || undefined
      );

      const elapsed = Date.now() - startTime;

      const providers = STTRegistry.getAllProviders();
      const activeProvider = providerId
        ? providers.find((p: any) => p.id === providerId)
        : STTRegistry.getDefaultProvider();

      // 构建详细状态信息
      const status: string[] = [];
      if (!result.text) {
        status.push('识别文本为空');
        if (activeProvider) {
          status.push(
            `提供者 "${activeProvider.name} (${activeProvider.id})" 不可用`
          );
          if (activeProvider.id === 'local') {
            status.push(
              '本地 STT 需要 Python 3.8+ 和 faster-whisper: pip install faster-whisper'
            );
          } else if (activeProvider.id === 'cloud') {
            status.push('云端 STT 需要配置 OpenAI API 密钥');
          } else if (activeProvider.id === 'stream') {
            status.push('流式 STT 需要配置 WebSocket 端点');
          }
        } else {
          status.push('没有已注册且可用的 STT 提供者');
          status.push(
            '请安装 faster-whisper（pip install faster-whisper）或配置云端/流式 STT 提供者'
          );
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          text: result.text,
          confidence: result.confidence,
          isFinal: result.isFinal,
          duration: result.duration,
          language: result.language,
          timing: {
            elapsed,
            unit: 'ms',
          },
          provider: activeProvider
            ? {
                id: activeProvider.id,
                name: activeProvider.name,
                type: activeProvider.type,
                available: activeProvider.isAvailable(),
              }
            : null,
          status: status.length > 0 ? status.join('；') : undefined,
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理获取语音设置请求 GET /v1/voice/settings
   */
  private async handleGetVoiceSettings(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { createVoiceService } = await import('@modules/services/voice');
      const voiceService = createVoiceService();
      const config = voiceService.getConfig();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          config: {
            provider: 'default',
            inputDeviceId: undefined,
            outputDeviceId: undefined,
            wakeWordEnabled: false,
            wakeWord: '你好',
            autoPlayTTS: true,
            voiceId: 'zh-CN-XiaoxiaoNeural',
            inputLanguage: config.language || 'zh-CN',
            outputLanguage: config.language || 'zh-CN',
          },
          wakeWords: [],
          hotkeys: {},
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理更新语音设置请求 PUT /v1/voice/settings
   */
  private async handleUpdateVoiceSettings(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const settings = JSON.parse(body);

      const { createVoiceService } = await import('@modules/services/voice');
      const voiceService = createVoiceService();
      voiceService.updateConfig({
        language:
          settings.config?.inputLanguage || settings.config?.outputLanguage,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, config: settings.config }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理开始语音会话请求 POST /v1/voice/session/start
   */
  private async handleStartVoiceSession(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const sessionId = `voice-${Date.now()}-${randomUUID()}`;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: sessionId,
          startedAt: Date.now(),
          endedAt: null,
          duration: null,
          transcript: '',
          responseAudioUrl: null,
          status: 'active',
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理结束语音会话请求 POST /v1/voice/session/:id/end
   */
  private async handleEndVoiceSession(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string
  ): Promise<void> {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: sessionId,
          startedAt: Date.now() - 60000,
          endedAt: Date.now(),
          duration: 60000,
          transcript: '',
          responseAudioUrl: null,
          status: 'completed',
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理列出语音会话请求 GET /v1/voice/sessions
   */
  private async handleListVoiceSessions(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          sessions: [],
          total: 0,
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理获取语音会话详情请求 GET /v1/voice/session/:id
   */
  private async handleGetVoiceSession(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string
  ): Promise<void> {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: sessionId,
          startedAt: Date.now() - 60000,
          endedAt: null,
          duration: null,
          transcript: '',
          responseAudioUrl: null,
          status: 'active',
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理上传音频请求 POST /v1/voice/upload
   */
  private async handleVoiceUpload(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          transcript: '',
          audioUrl: null,
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理获取音频流请求 GET /v1/voice/stream/:id
   */
  private async handleVoiceStream(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sessionId: string
  ): Promise<void> {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Audio streaming not implemented' }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理TTS语音合成请求 POST /v1/voice/tts
   */
  private async handleTTSSynthesize(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { text, voiceId } = JSON.parse(body);

      const { TTSRegistry, EdgeTTSProvider } =
        await import('@modules/services/voice/services/ttsProvider');

      if (TTSRegistry.getProviderNames().length === 0) {
        TTSRegistry.register(new EdgeTTSProvider(), true);
      }

      const result = await TTSRegistry.speak({
        text,
        voice: voiceId || 'zh-CN-XiaoxiaoNeural',
      });

      if (result.success && result.audioData) {
        const audioBase64 = result.audioData.toString('base64');
        const audioUrl = `data:audio/mp3;base64,${audioBase64}`;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ audioUrl }));
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: result.error || 'TTS synthesis failed',
          })
        );
      }
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理列出语音提供商请求 GET /v1/voice/providers
   */
  private async handleListVoiceProviders(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(['gemini', 'openai', 'webapi']));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理列出语音列表请求 GET /v1/voice/voices
   */
  private async handleListVoices(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const urlObj = new URL(req.url || '', `http://localhost`);
      const provider = urlObj.searchParams.get('provider') || 'edge';

      const { TTSRegistry, EdgeTTSProvider } =
        await import('@modules/services/voice/services/ttsProvider');

      if (TTSRegistry.getProviderNames().length === 0) {
        TTSRegistry.register(new EdgeTTSProvider(), true);
      }

      const ttsProvider = TTSRegistry.getProvider();
      const voices = ttsProvider ? ttsProvider.getVoices() : [];

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(voices));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理测试唤醒词请求 POST /v1/voice/wakeword/:id/test
   */
  private async handleTestWakeWord(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    wakeWordId: string
  ): Promise<void> {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ detected: false }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== Knowledge Handlers ==========

  /**
   * 处理列出知识条目请求
   * 支持 ?base=<name> 过滤，返回真实文件元数据
   */
  private async handleListKnowledge(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { knowledgeDocsProvider } =
        await import('@modules/docs/FileDocsProvider');
      const { getDefaultKnowledgeBaseRegistry } =
        await import('@modules/knowledge/KnowledgeBaseRegistry');
      const { stat } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const { resolvePyappHome } = await import('@modules/core/paths');

      const parsedUrl = new URL(req.url || '', 'http://localhost');
      const baseFilter = parsedUrl.searchParams.get('base');

      const registry = getDefaultKnowledgeBaseRegistry();
      const knowledgeRoot = registry.getKnowledgeRoot();

      const docs = await knowledgeDocsProvider.buildIndex();
      const result = [];

      for (let i = 0; i < docs.length; i++) {
        const doc: any = docs[i];
        const docPath = doc.relativePath || '';
        const baseName = docPath.split(/[/\\]/)[0];

        if (baseFilter && baseName !== baseFilter) continue;

        let size = 0;
        let updatedAt = 0;
        let source = 'manual';

        const fullPath = join(knowledgeRoot, docPath);
        try {
          const fileStat = await stat(fullPath);
          size = fileStat.size;
          updatedAt = fileStat.mtimeMs;
        } catch {
          // 文件可能已被移动，使用默认值
        }

        const content = doc.content || '';
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (fmMatch) {
          const fmLines = fmMatch[1].split('\n');
          for (const line of fmLines) {
            if (line.startsWith('source:')) {
              const val = line.split(':')[1]?.trim().replace(/"/g, '') || '';
              if (val) source = val;
            }
          }
        }

        result.push({
          id: docPath,
          title: doc.title || '',
          content: content.slice(0, 500) || '',
          category: doc.category || '根目录',
          tags: [],
          docPath,
          size,
          updated_at: updatedAt,
          created_at: 0,
          source,
          base: baseName,
        });
      }

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
      const { HybridKnowledgeRouter } =
        await import('@modules/knowledge/HybridKnowledgeRouter');
      const { knowledgeDocsProvider } =
        await import('@modules/docs/FileDocsProvider');
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
   * 将新知识写入用户知识库目录（~/.pyapp/knowledge/）
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
      const { resolvePyappHome } = await import('@modules/core/paths');
      const { writeFile, mkdir } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const userKnowledgeDir = join(resolvePyappHome(), 'knowledge');
      const targetDir = category
        ? join(userKnowledgeDir, category)
        : userKnowledgeDir;
      await mkdir(targetDir, { recursive: true });
      const fileName = `${title.replace(/[\\/:*?"<>|]/g, '_')}.md`;
      const filePath = join(targetDir, fileName);
      const fileContent = content
        ? `# ${title}\n\n${content}\n`
        : `# ${title}\n\n`;
      await writeFile(filePath, fileContent, 'utf-8');
      const newId = `knowledge-${Date.now()}`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: newId,
          title,
          content: content || '',
          category: category || '根目录',
          docPath: filePath,
          created_at: Date.now(),
          updated_at: Date.now(),
        })
      );
      this.broadcastEvent('knowledge:created', { id: newId, title });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理更新知识条目请求
   * knowledgeId 为 docPath（相对路径），从知识库根目录查找文件
   */
  private async handleUpdateKnowledge(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    knowledgeId: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { title, content } = JSON.parse(body);
      const { getDefaultKnowledgeBaseRegistry } =
        await import('@modules/knowledge/KnowledgeBaseRegistry');
      const { writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const { knowledgeDocsProvider } =
        await import('@modules/docs/FileDocsProvider');

      const registry = getDefaultKnowledgeBaseRegistry();
      const filePath = join(registry.getKnowledgeRoot(), knowledgeId);

      let fileContent: string;
      if (title && content) {
        fileContent = `---\ntitle: "${title}"\nupdated_at: ${Date.now()}\n---\n\n${content}\n`;
      } else if (content) {
        fileContent = content;
      } else {
        fileContent = `# ${title}\n\n`;
      }

      await writeFile(filePath, fileContent, 'utf-8');
      knowledgeDocsProvider.clearCache();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: knowledgeId,
          title: title || '',
          content: content || '',
          updated_at: Date.now(),
        })
      );
      this.broadcastEvent('knowledge:updated', { id: knowledgeId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理删除知识条目请求
   * knowledgeId 为 docPath（相对路径），从知识库根目录删除文件
   */
  private async handleDeleteKnowledge(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    knowledgeId: string
  ): Promise<void> {
    try {
      const { getDefaultKnowledgeBaseRegistry } =
        await import('@modules/knowledge/KnowledgeBaseRegistry');
      const { unlink } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const { existsSync } = await import('node:fs');
      const { knowledgeDocsProvider } =
        await import('@modules/docs/FileDocsProvider');

      const registry = getDefaultKnowledgeBaseRegistry();
      const filePath = join(registry.getKnowledgeRoot(), knowledgeId);

      if (existsSync(filePath)) {
        await unlink(filePath);
        knowledgeDocsProvider.clearCache();
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      this.broadcastEvent('knowledge:deleted', { id: knowledgeId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理列出知识库请求 GET /v1/knowledge/bases
   */
  private async handleListKnowledgeBases(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { getDefaultKnowledgeBaseRegistry } =
        await import('@modules/knowledge/KnowledgeBaseRegistry');
      const registry = getDefaultKnowledgeBaseRegistry();
      const bases = await registry.listBases();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(bases));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理创建知识库请求 POST /v1/knowledge/bases
   */
  private async handleCreateKnowledgeBase(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { name, label, icon } = JSON.parse(body);

      if (!name || !label) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'name and label are required' } })
        );
        return;
      }

      const { getDefaultKnowledgeBaseRegistry } =
        await import('@modules/knowledge/KnowledgeBaseRegistry');
      const registry = getDefaultKnowledgeBaseRegistry();
      const base = await registry.createBase(name, label, icon);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(base));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('已存在')) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message } }));
        return;
      }
      this.sendError(res, err);
    }
  }

  /**
   * 处理更新知识库请求 PUT /v1/knowledge/bases/:name
   */
  private async handleUpdateKnowledgeBase(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    baseName: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { label, enabled, icon } = JSON.parse(body);

      const { getDefaultKnowledgeBaseRegistry } =
        await import('@modules/knowledge/KnowledgeBaseRegistry');
      const registry = getDefaultKnowledgeBaseRegistry();
      const base = await registry.updateBase(baseName, {
        label,
        enabled,
        icon,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(base));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('不存在')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message } }));
        return;
      }
      this.sendError(res, err);
    }
  }

  /**
   * 处理删除知识库请求 DELETE /v1/knowledge/bases/:name
   */
  private async handleDeleteKnowledgeBase(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    baseName: string
  ): Promise<void> {
    try {
      const { getDefaultKnowledgeBaseRegistry } =
        await import('@modules/knowledge/KnowledgeBaseRegistry');
      const registry = getDefaultKnowledgeBaseRegistry();
      await registry.deleteBase(baseName);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('不存在')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message } }));
        return;
      }
      this.sendError(res, err);
    }
  }

  /**
   * 处理聊天保存到知识库请求 POST /v1/knowledge/save-from-chat
   */
  private async handleSaveFromChat(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { base, title, content, sessionId } = JSON.parse(body);

      if (!title || !content) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'title and content are required' },
          })
        );
        return;
      }

      const { getDefaultKnowledgeBaseRegistry } =
        await import('@modules/knowledge/KnowledgeBaseRegistry');
      const { writeFile, mkdir } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const { knowledgeDocsProvider } =
        await import('@modules/docs/FileDocsProvider');

      const registry = getDefaultKnowledgeBaseRegistry();
      const baseName = base || 'default';
      const baseDir = join(registry.getKnowledgeRoot(), baseName);

      await mkdir(baseDir, { recursive: true });

      const fileName = `${title.replace(/[\\/:*?"<>|]/g, '_')}.md`;
      const filePath = join(baseDir, fileName);

      const now = new Date().toISOString();
      const frontmatter = [
        '---',
        `title: "${title.replace(/"/g, '\\"')}"`,
        `source: "chat-save"`,
        sessionId ? `savedFrom: "${sessionId}"` : '',
        `savedAt: "${now}"`,
        '---',
        '',
      ]
        .filter(Boolean)
        .join('\n');

      const fileContent = `${frontmatter}${content}\n`;
      await writeFile(filePath, fileContent, 'utf-8');
      knowledgeDocsProvider.clearCache();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          docPath: join(baseName, fileName),
          title,
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== Knowledge Upload & Compile Handlers ==========

  /**
   * 处理知识库文件上传请求 POST /v1/knowledge/upload
   *
   * 请求体: { baseName, filename, data (base64), tags?, category? }
   * 处理逻辑:
   *   - .md 文件直接写入目标知识库目录，补充 YAML frontmatter
   *   - 可转换的二进制文件（.docx/.xlsx/.pdf 等）使用 ConverterEngine 提取文本，
   *     保存原始文件 + 提取的 Markdown，并写入 knowledge/raw/ 供编译器消费
   *   - 其他文本类非 .md 文件写入 raw/ 子目录，以触发后续 LLM 编译
   */
  private async handleKnowledgeUpload(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { baseName, filename, data, tags, category } = JSON.parse(body);

      if (!baseName || !filename || !data) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'baseName, filename and data are required' },
          })
        );
        return;
      }

      const { getDefaultKnowledgeBaseRegistry } =
        await import('@modules/knowledge/KnowledgeBaseRegistry');
      const { writeFile, mkdir } = await import('node:fs/promises');
      const { join, extname, basename } = await import('node:path');
      const { knowledgeDocsProvider } =
        await import('@modules/docs/FileDocsProvider');

      const registry = getDefaultKnowledgeBaseRegistry();
      const knowledgeRoot = registry.getKnowledgeRoot();

      const safeName = filename.replace(/[\\/:*?"<>|]/g, '_');
      const ext = extname(filename).toLowerCase();

      const baseDir = join(knowledgeRoot, baseName);
      const now = new Date().toISOString();
      const tagList = Array.isArray(tags) ? tags : [];

      /**
       * 需要 ConverterEngine 转换的二进制文件扩展名
       */
      const BINARY_EXTENSIONS = new Set([
        '.docx',
        '.xlsx',
        '.xls',
        '.pptx',
        '.pdf',
        '.epub',
        '.ipynb',
        '.zip',
        '.msg',
        '.rss',
        '.atom',
      ]);

      let docRelativePath: string;
      const rawBuffer = Buffer.from(data, 'base64');

      if (ext === '.md') {
        docRelativePath = join(baseName, safeName);
        const fullPath = join(knowledgeRoot, docRelativePath);

        await mkdir(baseDir, { recursive: true });

        const rawContent = rawBuffer.toString('utf-8');
        const frontmatter = [
          '---',
          `title: "${safeName.replace(/\.md$/i, '')}"`,
          `source: "upload"`,
          `uploadedAt: "${now}"`,
          category ? `category: "${category}"` : '',
          tagList.length > 0
            ? `tags: [${tagList.map((t: string) => `"${t}"`).join(', ')}]`
            : '',
          '---',
          '',
        ]
          .filter(Boolean)
          .join('\n');

        const fileContent = rawContent.startsWith('---')
          ? rawContent
          : `${frontmatter}${rawContent}\n`;

        await writeFile(fullPath, fileContent, 'utf-8');
      } else if (BINARY_EXTENSIONS.has(ext)) {
        const nameStem = basename(safeName, ext);
        const rawDir = join(baseDir, 'raw');
        await mkdir(rawDir, { recursive: true });

        // 1. 保存原始二进制文件到 {baseDir}/raw/original_*
        const originalRawName = `original_${safeName}`;
        await writeFile(join(rawDir, originalRawName), rawBuffer);

        // 2. 使用 ConverterEngine 提取文本
        const { getConverterEngine } =
          await import('@modules/tools/converter/engine/ConverterEngine');
        const engine = getConverterEngine();
        const fileInfo = engine
          .getDetector()
          .detect(filename, rawBuffer.length);
        const result = await engine.convertContent(fileInfo, rawBuffer);
        const extractedContent = result.markdown;

        // 3. 保存提取的 Markdown 到 {baseDir}/raw/{stem}.md（伴侣文件）
        const companionName = `${nameStem}.md`;
        await writeFile(join(rawDir, companionName), extractedContent, 'utf-8');

        // 4. 同时写入 knowledge/raw/ 顶层目录供编译器消费
        const topRawDir = join(knowledgeRoot, 'raw');
        await mkdir(topRawDir, { recursive: true });
        const compilerFileName = `${baseName}_${nameStem}.txt`;
        await writeFile(
          join(topRawDir, compilerFileName),
          extractedContent,
          'utf-8'
        );

        // 5. 写 companion meta.json，记录原始文件路径
        const metaPath = join(topRawDir, `${compilerFileName}.meta.json`);
        await writeFile(
          metaPath,
          JSON.stringify({
            originalFile: `${baseName}/raw/${originalRawName}`,
            originalFormat: ext,
            source: 'upload-extracted',
            uploadedAt: now,
            category: category || null,
          }),
          'utf-8'
        );

        // 6. 创建知识文档，frontmatter 包含 originalFile 追溯信息
        docRelativePath = join(baseName, `${nameStem}.md`);
        const fullPath = join(knowledgeRoot, docRelativePath);
        const docContent = [
          '---',
          `title: "${nameStem}"`,
          `source: "upload-extracted"`,
          `uploadedAt: "${now}"`,
          category ? `category: "${category}"` : '',
          tagList.length > 0
            ? `tags: [${tagList.map((t: string) => `"${t}"`).join(', ')}]`
            : '',
          `originalFile: "${baseName}/raw/${originalRawName}"`,
          `originalFormat: "${ext}"`,
          '---',
          '',
          extractedContent,
        ]
          .filter(Boolean)
          .join('\n');
        await writeFile(fullPath, docContent, 'utf-8');
      } else {
        // 其他文本类非 .md 文件（.txt/.json/.csv/.yaml 等）
        const rawContent = rawBuffer.toString('utf-8');
        const rawDir = join(baseDir, 'raw');
        await mkdir(rawDir, { recursive: true });

        const rawRelativePath = join(baseName, 'raw', safeName);
        const fullRawPath = join(knowledgeRoot, rawRelativePath);
        await writeFile(fullRawPath, rawContent, 'utf-8');

        // 也写入 knowledge/raw/ 顶层，供编译器消费
        const topRawDir = join(knowledgeRoot, 'raw');
        await mkdir(topRawDir, { recursive: true });
        const compilerFileName = `${baseName}_${safeName}.txt`;
        await writeFile(join(topRawDir, compilerFileName), rawContent, 'utf-8');

        docRelativePath = join(baseName, `${safeName}.md`);
        const fullPath = join(knowledgeRoot, docRelativePath);

        const frontmatter = [
          '---',
          `title: "${safeName}"`,
          `source: "upload"`,
          `uploadedAt: "${now}"`,
          category ? `category: "${category}"` : '',
          tagList.length > 0
            ? `tags: [${tagList.map((t: string) => `"${t}"`).join(', ')}]`
            : '',
          `originalFormat: "${ext}"`,
          `needsCompile: true`,
          '---',
          '',
          `> 此文件来自 ${ext} 格式上传，尚未经过 LLM 编译。请触发「编译 raw」操作以生成结构化文档。`,
          '',
          '```',
          rawContent.slice(0, 1000),
          rawContent.length > 1000 ? '\n...（内容已截断）' : '',
          '```',
          '',
        ].join('\n');

        await writeFile(fullPath, frontmatter, 'utf-8');
      }

      knowledgeDocsProvider.clearCache();

      if (ext !== '.md' && this.compileScheduler) {
        this.compileScheduler.notifyFileChanged();
      }

      const size = rawBuffer.length;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          docPath: docRelativePath,
          title: safeName.replace(/\.\w+$/, ''),
          size,
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理知识库编译请求 POST /v1/knowledge/compile
   *
   * 触发 KnowledgeCompiler 对 raw/ 目录中的原始文件进行 LLM 编译
   */
  private async handleKnowledgeCompile(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { force } = JSON.parse(body);

      const { aiService } = await import('@modules/ai/services/aiService');
      const { runKnowledgeCompile } =
        await import('@modules/knowledge/KnowledgeCompiler');

      const result = await runKnowledgeCompile(aiService, { force: !!force });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 获取待编译的 raw 文件列表 GET /v1/knowledge/raw-files
   *
   * 返回 raw/ 目录中所有未编译文件的详细信息（文件名、大小、修改时间、元数据）
   */
  private async handleGetRawFiles(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { readdir, stat } = await import('node:fs/promises');
      const { join, extname } = await import('node:path');
      const { readFileSync, existsSync } = await import('node:fs');
      const { getDefaultKnowledgeBaseRegistry } =
        await import('@modules/knowledge/KnowledgeBaseRegistry');

      const registry = getDefaultKnowledgeBaseRegistry();
      const rawDir = join(registry.getKnowledgeRoot(), 'raw');

      if (!existsSync(rawDir)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ files: [], totalCount: 0 }));
        return;
      }

      const entries = await readdir(rawDir);
      const metaFiles = entries.filter((f) => f.endsWith('.meta.json'));
      const dataFiles = entries.filter((f) => !f.endsWith('.meta.json'));

      const files = [];
      for (const file of dataFiles) {
        const filePath = join(rawDir, file);
        const fileStat = await stat(filePath);
        const metaFile = `${file}.meta.json`;
        let meta = null;

        if (metaFiles.includes(metaFile)) {
          try {
            const metaContent = readFileSync(join(rawDir, metaFile), 'utf-8');
            meta = JSON.parse(metaContent);
          } catch {
            // 元数据文件损坏，忽略
          }
        }

        files.push({
          fileName: file,
          ext: extname(file).toLowerCase(),
          size: fileStat.size,
          modifiedAt: fileStat.mtimeMs,
          createdAt: fileStat.birthtimeMs || fileStat.ctimeMs,
          category: meta?.category || null,
          source: meta?.source || null,
        });
      }

      files.sort((a, b) => b.modifiedAt - a.modifiedAt);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          files,
          totalCount: files.length,
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 导出知识文档到 Notebook 兼容格式
   * POST /v1/knowledge/export-to-notebook
   *
   * 将知识文档内容导出为 .md 文件，存放在 ~/.pyapp/output/notebooks/ 目录
   */
  private async handleExportToNotebook(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { docPath, title } = JSON.parse(body);

      if (!docPath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'docPath is required' } }));
        return;
      }

      const { getDefaultKnowledgeBaseRegistry } =
        await import('@modules/knowledge/KnowledgeBaseRegistry');
      const { readFile, writeFile, mkdir } = await import('node:fs/promises');
      const { join, extname } = await import('node:path');
      const { resolveOutputDir } = await import('@modules/core/paths');

      const registry = getDefaultKnowledgeBaseRegistry();
      const sourcePath = join(registry.getKnowledgeRoot(), docPath);

      const content = await readFile(sourcePath, 'utf-8');

      const notebooksDir = join(resolveOutputDir(), 'notebooks');
      await mkdir(notebooksDir, { recursive: true });

      const safeName = (title || docPath.replace(/\.md$/i, '')).replace(
        /[\\/:*?"<>|]/g,
        '_'
      );
      const exportPath = join(notebooksDir, `${safeName}_${Date.now()}.md`);

      await writeFile(exportPath, content, 'utf-8');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          exportPath,
          fileName: `${safeName}_${Date.now()}.md`,
          size: content.length,
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 从外部文件导入知识文档
   * POST /v1/knowledge/import-from-file
   *
   * 读取指定路径的 .md 文件，将其内容导入到知识库
   */
  private async handleImportFromFile(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { filePath, baseName, tags } = JSON.parse(body);

      if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'filePath is required' } }));
        return;
      }

      // 沙箱权限检查
      if (!this.checkFilePathPermission(filePath, SandboxPermission.READ_FILE)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Access denied: file path not in whitelist' } }));
        return;
      }

      const { getDefaultKnowledgeBaseRegistry } =
        await import('@modules/knowledge/KnowledgeBaseRegistry');
      const { readFile, writeFile, mkdir } = await import('node:fs/promises');
      const { join, basename, extname } = await import('node:path');
      const { existsSync } = await import('node:fs');
      const { knowledgeDocsProvider } =
        await import('@modules/docs/FileDocsProvider');

      if (!existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: `File not found: ${filePath}` } })
        );
        return;
      }

      const originalName = basename(filePath);
      const ext = extname(originalName).toLowerCase();

      /**
       * 需要 ConverterEngine 转换的二进制文件扩展名
       */
      const BINARY_EXTENSIONS = new Set([
        '.docx',
        '.xlsx',
        '.xls',
        '.pptx',
        '.pdf',
        '.epub',
        '.ipynb',
        '.zip',
        '.msg',
        '.rss',
        '.atom',
      ]);

      let rawContent: string;

      if (BINARY_EXTENSIONS.has(ext)) {
        const { getConverterEngine } =
          await import('@modules/tools/converter/engine/ConverterEngine');
        const engine = getConverterEngine();
        const result = await engine.convertFile(filePath);
        rawContent = result.markdown;
      } else {
        rawContent = await readFile(filePath, 'utf-8');
      }

      const targetBase = baseName || 'default';
      const registry = getDefaultKnowledgeBaseRegistry();
      const knowledgeRoot = registry.getKnowledgeRoot();
      const baseDir = join(knowledgeRoot, targetBase);

      await mkdir(baseDir, { recursive: true });

      const docPath = join(targetBase, originalName);
      const fullPath = join(knowledgeRoot, docPath);

      const tagList = Array.isArray(tags) ? tags : [];
      const now = new Date().toISOString();

      if (!rawContent.startsWith('---')) {
        const frontmatter = [
          '---',
          `title: "${originalName.replace(/\.md$/i, '')}"`,
          `source: "import"`,
          `importedAt: "${now}"`,
          tagList.length > 0
            ? `tags: [${tagList.map((t: string) => `"${t}"`).join(', ')}]`
            : '',
          BINARY_EXTENSIONS.has(ext) ? `originalFormat: "${ext}"` : '',
          BINARY_EXTENSIONS.has(ext) ? `originalFile: "${filePath}"` : '',
          '---',
          '',
        ]
          .filter(Boolean)
          .join('\n');
        await writeFile(fullPath, `${frontmatter}${rawContent}\n`, 'utf-8');
      } else {
        await writeFile(fullPath, rawContent, 'utf-8');
      }

      knowledgeDocsProvider.clearCache();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          docPath,
          title: originalName.replace(/\.\w+$/, ''),
          size: rawContent.length,
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理知识库文档内容更新请求 PUT /v1/knowledge/docs
   *
   * 请求体: { docPath, content, title? }
   * 处理逻辑:
   *   1. 读取原文件，解析 frontmatter
   *   2. 保留或更新 frontmatter
   *   3. 将新内容写入文件
   *   4. 重建 DigestService 缓存
   */
  private async handleUpdateKnowledgeDoc(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { docPath, content, title, tags, category } = JSON.parse(body);

      if (!docPath || !content) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'docPath and content are required' },
          })
        );
        return;
      }

      const { getDefaultKnowledgeBaseRegistry } =
        await import('@modules/knowledge/KnowledgeBaseRegistry');
      const { getDefaultDigestService } =
        await import('@modules/knowledge/KnowledgeDigestService');
      const { readFile, writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const { existsSync } = await import('node:fs');
      const { knowledgeDocsProvider } =
        await import('@modules/docs/FileDocsProvider');

      const registry = getDefaultKnowledgeBaseRegistry();
      const filePath = join(registry.getKnowledgeRoot(), docPath);

      let frontmatterLines: string[] = [];

      if (existsSync(filePath)) {
        const existingContent = await readFile(filePath, 'utf-8');
        const lines = existingContent.split('\n');

        if (lines[0]?.trim() === '---') {
          const endIdx = lines.indexOf('---', 1);
          if (endIdx !== -1) {
            const fmLines = lines.slice(1, endIdx);

            const hasTags = Array.isArray(tags);
            const hasCategory = category !== undefined;

            for (const line of fmLines) {
              if (title && line.startsWith('title:')) {
                const escapedTitle = title.replace(/"/g, '\\"');
                frontmatterLines.push(`title: "${escapedTitle}"`);
              } else if (hasTags && line.startsWith('tags:')) {
                continue;
              } else if (hasCategory && line.startsWith('category:')) {
                continue;
              } else {
                frontmatterLines.push(line);
              }
            }

            if (hasTags) {
              const tagStr = tags.map((t: string) => `"${t}"`).join(', ');
              frontmatterLines.push(`tags: [${tagStr}]`);
            }
            if (hasCategory) {
              frontmatterLines.push(`category: "${category}"`);
            }

            const restLines = lines.slice(endIdx + 1);
            const bodyContent = content || restLines.join('\n').trim();
            const newContent = [
              '---',
              ...frontmatterLines,
              '---',
              '',
              bodyContent,
              '',
            ].join('\n');

            await writeFile(filePath, newContent, 'utf-8');
            knowledgeDocsProvider.clearCache();

            try {
              const digestService = getDefaultDigestService();
              await digestService.buildDigest();
            } catch {
              // 摘要重建失败不影响主流程
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                docPath,
                updatedAt: new Date().toISOString(),
              })
            );
            this.broadcastEvent('knowledge:updated', { id: docPath });
            return;
          }
        }
      }

      const newContent = [
        '---',
        title
          ? `title: "${title.replace(/"/g, '\\"')}"`
          : 'title: "未命名文档"',
        `updatedAt: "${new Date().toISOString()}"`,
        '---',
        '',
        content,
        '',
      ].join('\n');

      await writeFile(filePath, newContent, 'utf-8');
      knowledgeDocsProvider.clearCache();

      try {
        const digestService = getDefaultDigestService();
        await digestService.buildDigest();
      } catch {
        // 摘要重建失败不影响主流程
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          docPath,
          updatedAt: new Date().toISOString(),
        })
      );
      this.broadcastEvent('knowledge:updated', { id: docPath });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理批量删除知识文档请求 POST /v1/knowledge/batch-delete
   *
   * 请求体: { ids: string[] }
   * 批量删除指定的知识库文档文件
   */
  private async handleBatchDeleteKnowledge(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { ids } = JSON.parse(body);

      if (!Array.isArray(ids) || ids.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'ids array is required' } })
        );
        return;
      }

      const { getDefaultKnowledgeBaseRegistry } =
        await import('@modules/knowledge/KnowledgeBaseRegistry');
      const { unlink } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const { existsSync } = await import('node:fs');
      const { knowledgeDocsProvider } =
        await import('@modules/docs/FileDocsProvider');

      const registry = getDefaultKnowledgeBaseRegistry();
      const knowledgeRoot = registry.getKnowledgeRoot();

      let deleted = 0;
      for (const id of ids) {
        const filePath = join(knowledgeRoot, id);
        if (existsSync(filePath)) {
          await unlink(filePath);
          deleted++;
        }
      }

      knowledgeDocsProvider.clearCache();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ deleted }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理批量添加标签请求 POST /v1/knowledge/batch-tag
   *
   * 请求体: { ids: string[], tags: string[] }
   * 为多个知识文档批量添加标签
   */
  private async handleBatchTagKnowledge(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { ids, tags } = JSON.parse(body);

      if (!Array.isArray(ids) || ids.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'ids array is required' } })
        );
        return;
      }

      if (!Array.isArray(tags) || tags.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'tags array is required' } })
        );
        return;
      }

      const { getDefaultKnowledgeBaseRegistry } =
        await import('@modules/knowledge/KnowledgeBaseRegistry');
      const { readFile, writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const { existsSync } = await import('node:fs');
      const { knowledgeDocsProvider } =
        await import('@modules/docs/FileDocsProvider');

      const registry = getDefaultKnowledgeBaseRegistry();
      const knowledgeRoot = registry.getKnowledgeRoot();

      let updated = 0;
      for (const id of ids) {
        const filePath = join(knowledgeRoot, id);
        if (!existsSync(filePath)) continue;

        const content = await readFile(filePath, 'utf-8');
        const lines = content.split('\n');

        if (lines[0]?.trim() !== '---') continue;

        const endIdx = lines.indexOf('---', 1);
        if (endIdx === -1) continue;

        const fmLines = lines.slice(1, endIdx);

        const existingTagLine = fmLines.find((l) => l.startsWith('tags:'));
        const existingTags: string[] = [];

        if (existingTagLine) {
          const tagMatch = existingTagLine.match(/\[([^\]]*)\]/);
          if (tagMatch) {
            const rawTags = tagMatch[1]
              .split(',')
              .map((t) => t.trim().replace(/"/g, ''));
            existingTags.push(...rawTags.filter(Boolean));
          }
        }

        const mergedTags = [...new Set([...existingTags, ...tags])];
        const tagStr = mergedTags.map((t) => `"${t}"`).join(', ');

        const newFmLines = existingTagLine
          ? fmLines.map((l) =>
              l.startsWith('tags:') ? `tags: [${tagStr}]` : l
            )
          : [...fmLines, `tags: [${tagStr}]`];

        const newContent = [
          '---',
          ...newFmLines,
          '---',
          ...lines.slice(endIdx + 1),
        ].join('\n');

        await writeFile(filePath, newContent, 'utf-8');
        updated++;
      }

      knowledgeDocsProvider.clearCache();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ updated }));
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
      const { InteractionManager, getCompanion } =
        await import('@modules/buddy');
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
      this.broadcastEvent('buddy:interacted', {
        action,
        result: result.response,
      });
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
      res.end(
        JSON.stringify({
          interactions: 0,
          dreamsCompleted: dreamStats.totalCompleted,
          totalXp: 0,
        })
      );
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ interactions: 0, dreamsCompleted: 0, totalXp: 0 })
      );
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
      const urlObj = new URL(
        req.url || '',
        `http://${req.headers.host || 'localhost'}`
      );
      const limit = parseInt(urlObj.searchParams.get('limit') || '50', 10);
      const offset = parseInt(urlObj.searchParams.get('offset') || '0', 10);
      const typeFilter = urlObj.searchParams.get('type') || '';

      const { getDreamLogs, getDreamLogsByType, getDreamStats } =
        await import('@modules/buddy/dreamLogStore');

      const result = typeFilter
        ? getDreamLogsByType(typeFilter as any, limit, offset)
        : getDreamLogs(limit, offset);

      const stats = getDreamStats();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...result, stats }));
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          logs: [],
          total: 0,
          stats: {
            totalCompleted: 0,
            totalFailed: 0,
            totalSessions: 0,
            totalInsights: 0,
            lastDreamAt: null,
          },
        })
      );
    }
  }

  // ========== Cron Handlers ==========

  /** 将 CronJob 转为前端 CronTask 格式 */
  private jobToCronTask(job: any): any {
    const ms = (iso: string | undefined) => (iso ? new Date(iso).getTime() : undefined);
    return {
      id: job.id,
      name: job.name,
      expression: job.schedule?.expr ?? '',
      description: job.prompt ?? job.name,
      prompt: job.prompt || '',
      enabled: job.enabled ?? true,
      scheduleMode: job.schedule?.kind ?? 'cron',
      scheduleDisplay: job.schedule?.display ?? job.scheduleDisplay,
      silent: job.silent ?? false,
      lastRun: ms(job.lastRunAt),
      nextRun: ms(job.nextRunAt),
      lastDurationMs: undefined,
      lastStatus: job.lastStatus ?? undefined,
      lastError: job.lastError ?? undefined,
      consecutiveErrors: job.consecutiveErrors ?? 0,
      model: job.model,
      provider: job.provider,
      status: job.state === 'running' ? 'running' as const
        : job.state === 'failed' ? 'error' as const
        : job.enabled !== false ? 'idle' as const
        : 'idle' as const,
    };
  }

  /**
   * 处理列出定时任务请求
   */
  private async handleListCron(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { CronJobStore } = await import('@modules/tasks/cron/CronJobStore');
      const { resolveDbPath } = await import('@modules/core/paths');
      const store = new CronJobStore(resolveDbPath());
      await store.init();
      const jobs = await store.loadJobs();
      const result = jobs.map((j) => this.jobToCronTask(j));
      await store.close();
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
      const rawBody: Record<string, any> = JSON.parse(body);
      const { name, expression, description, prompt: bodyPrompt, enabled, scheduleMode, silent,
              deliver, deliverTo, model, provider, agentId } = rawBody;
      const cronExpr = (expression || rawBody.cron || '').trim();
      const jobName = (name || rawBody.prompt || cronExpr || 'Untitled').trim();
      const jobPrompt = (bodyPrompt || description || jobName).trim();

      if (!cronExpr && !jobName) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'name or expression is required' } }));
        return;
      }

      const { parseSchedule } = await import('@modules/chronos/cron');
      const { computeNextCronRun } = await import('@modules/tasks/cron/CronParser');
      const { CronJobStore } = await import('@modules/tasks/cron/CronJobStore');
      const { resolveDbPath } = await import('@modules/core/paths');

      const parsed: any = parseSchedule(cronExpr) || { kind: 'cron', expr: cronExpr, display: cronExpr };

      // 根据 scheduleMode 覆盖调度解析
      if (scheduleMode === 'every') {
        parsed.kind = 'interval';
        parsed.minutes = parseInt(rawBody.everyValue, 10) || 30;
        parsed.expr = undefined;
      } else if (scheduleMode === 'at') {
        parsed.kind = 'cron';
        parsed.expr = `${rawBody.atMinute || '00'} ${rawBody.atHour || '14'} * * *`;
      }

      const job: any = {
        id: `cron-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: jobName,
        prompt: jobPrompt,
        schedule: parsed,
        repeat: { times: null, completed: 0 },
        enabled: enabled !== false,
        state: 'scheduled',
        createdAt: new Date().toISOString(),
        silent: silent ?? false,
        deliver: deliver ?? 'local',
        model: model ?? undefined,
        provider: provider ?? undefined,
        scheduleDisplay: parsed.display || cronExpr,
      };

      // 计算首次运行时间
      const nowMs = Date.now();
      if (parsed.kind === 'interval') {
        const mins = parsed.minutes || 30;
        job.nextRunAt = new Date(nowMs + mins * 60 * 1000).toISOString();
      } else if (parsed.kind === 'cron' && parsed.expr) {
        const next = computeNextCronRun(parsed.expr, nowMs);
        if (next) job.nextRunAt = next;
      }

      const store = new CronJobStore(resolveDbPath());
      await store.init();
      await store.upsertJob(job);
      await store.close();

      // 唤醒全局调度器，使新作业立即被检查
      try {
        const { wakeGlobalCronScheduler } =
          await import('@modules/tasks/cron/GlobalCronScheduler');
        wakeGlobalCronScheduler();
      } catch {
        // 调度器未启动，忽略
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.jobToCronTask(job)));
      this.broadcastEvent('cron:created', { id: job.id });
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
      const { CronJobStore } = await import('@modules/tasks/cron/CronJobStore');
      const { resolveDbPath } = await import('@modules/core/paths');
      const store = new CronJobStore(resolveDbPath());
      await store.init();
      const job = await store.getJob(cronId);
      await store.close();
      if (!job) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Cron task not found' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.jobToCronTask(job)));
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
      const { CronJobStore } = await import('@modules/tasks/cron/CronJobStore');
      const { resolveDbPath } = await import('@modules/core/paths');
      const store = new CronJobStore(resolveDbPath());
      await store.init();

      const existing = await store.getJob(cronId);
      if (!existing) {
        await store.close();
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Cron task not found' } }));
        return;
      }

      // Apply allowed updates
      if (updates.name !== undefined) existing.name = updates.name;
      if (updates.description !== undefined) existing.prompt = updates.description;
      if (updates.enabled !== undefined) existing.enabled = updates.enabled;
      if (updates.silent !== undefined) existing.silent = updates.silent;
      if (updates.expression !== undefined && existing.schedule) {
        existing.schedule.expr = updates.expression;
      }
      if (updates.lastFiredAt !== undefined) {
        existing.lastRunAt = new Date(updates.lastFiredAt).toISOString();
      }

      await store.upsertJob(existing);
      await store.close();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.jobToCronTask(existing)));
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
      const { CronJobStore } = await import('@modules/tasks/cron/CronJobStore');
      const { resolveDbPath } = await import('@modules/core/paths');
      const store = new CronJobStore(resolveDbPath());
      await store.init();
      await store.deleteJob(cronId);
      await store.close();
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
      const { CronJobStore } = await import('@modules/tasks/cron/CronJobStore');
      const { resolveDbPath } = await import('@modules/core/paths');
      const store = new CronJobStore(resolveDbPath());
      await store.init();

      const job = await store.getJob(cronId);
      if (!job) {
        await store.close();
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Cron task not found' } }));
        return;
      }

      // 将 nextRunAt 设为 now 并保存，下次 tick 会执行
      job.nextRunAt = new Date().toISOString();
      job.state = 'scheduled';
      await store.upsertJob(job);
      await store.close();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: `Task ${cronId} triggered` }));
      this.broadcastEvent('cron:run', { id: cronId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理 cron 调度器状态查询
   * GET /v1/cron/status
   */
  private async handleCronStatus(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { isGlobalCronSchedulerStarted, getGlobalCronScheduler } =
        await import('@modules/tasks/cron/GlobalCronScheduler');
      const started = isGlobalCronSchedulerStarted();
      const scheduler = getGlobalCronScheduler();

      if (started && scheduler) {
        const status = scheduler.getStatus();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status));
      } else {
        // 调度器未启动，回退到静态查询
        const { CronJobStore } = await import('@modules/tasks/cron/CronJobStore');
        const { resolveDbPath } = await import('@modules/core/paths');
        const store = new CronJobStore(resolveDbPath());
        await store.init();
        const stats = await store.getStats();
        const enabledJobs = await store.listEnabledJobs();
        let activeJobs = 0;
        for (const job of enabledJobs) {
          if (job.state === 'running') activeJobs++;
        }
        await store.close();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          running: false,
          lastTickAt: undefined,
          activeJobs,
          totalJobs: stats.total,
          uptimeMs: process.uptime() * 1000,
        }));
      }
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理 cron 运行日志查询
   * GET /v1/cron/runs?jobId=&limit=&offset=&status=
   */
  private async handleCronRuns(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: string
  ): Promise<void> {
    try {
      const urlObj = new URL(url, `http://${req.headers.host || 'localhost'}`);
      const jobId = urlObj.searchParams.get('jobId') || undefined;
      const limit = parseInt(urlObj.searchParams.get('limit') || '50', 10);
      const offset = parseInt(urlObj.searchParams.get('offset') || '0', 10);
      const status = (urlObj.searchParams.get('status') || undefined) as
        | 'ok'
        | 'failed'
        | undefined;

      const { CronRunLog } = await import('@modules/tasks/cron/CronRunLog');
      const { resolveDbPath } = await import('@modules/core/paths');
      const runLog = new CronRunLog(resolveDbPath());
      await runLog.init();

      const page = await runLog.queryPage({ jobId, limit, offset, status });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(page));

      await runLog.close();
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
      const { channelRegistry } =
        await import('@modules/channels/registry/ChannelRegistry');
      const { ALL_CHANNEL_DEFS } =
        await import('@modules/channels/setupChannels');

      // 已注册通道 → map
      const registeredMap = new Map<string, any>();
      for (const ch of channelRegistry.getAll()) {
        const cfg = channelRegistry.getConfig(ch.name);
        registeredMap.set(ch.name, {
          id: ch.name,
          name: ch.name,
          type: ch.type,
          enabled: ch.enabled,
          connected: (ch as any).connected ?? false,
          config: cfg?.options || {},
        });
      }

      // 合并：全部候选 + 已注册数据
      const result = ALL_CHANNEL_DEFS.map((def) => {
        const registered = registeredMap.get(def.type);
        if (registered) {
          // 已注册的保留实际数据，但名使用定义中的显示名
          return { ...registered, name: def.name, registered: true };
        }
        // 未注册的显示为已知但未配置
        return {
          id: def.type,
          name: def.name,
          type: def.type,
          enabled: false,
          connected: false,
          registered: false,
          config: {},
        };
      });

      // 追加注册了但不在候选表中的通道（如有）
      for (const [name, reg] of registeredMap) {
        if (!ALL_CHANNEL_DEFS.some((d) => d.type === name)) {
          result.push(reg);
        }
      }

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
      const { channelRegistry } =
        await import('@modules/channels/registry/ChannelRegistry');
      const channel = channelRegistry.get(channelId);
      if (!channel) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Channel not found' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: channel.name,
          name: channel.name,
          type: channel.type,
          enabled: channel.enabled,
          connected: channel.connected,
        })
      );
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
      const { channelRegistry } =
        await import('@modules/channels/registry/ChannelRegistry');
      const channel = channelRegistry.get(channelId);
      if (!channel) {
        // 尝试动态注册（可能 registry 状态已丢失）
        const dynRegistered = await this.tryDynamicRegister(channelId);
        if (!dynRegistered) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Channel not found' } }));
          return;
        }
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
      const { channelRegistry } =
        await import('@modules/channels/registry/ChannelRegistry');
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
   * 处理 favicon 请求 — 返回 204 避免 404 控制台噪声
   */
  private handleFavicon(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    res.writeHead(204);
    res.end();
  }

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

  private async handleDeleteConfig(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    key: string
  ): Promise<void> {
    try {
      const { configManager } = await import('@modules/config/ConfigManager');
      // ConfigManager 没有 deleteConfigValue，通过 saveGlobalConfig 移除 key
      const { getConfig } = await import('@modules/config');
      const current = { ...(getConfig() as Record<string, unknown>) };
      delete current[key];
      configManager.setConfigValue(key, undefined as unknown);
      // 广播变更
      this.broadcastEvent('config:deleted', { key });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, key }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== Router（智能路由）==========

  /**
   * 获取 SmartRouter 当前配置与最近一次路由决策
   */
  private async handleRouterGetConfig(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl');
      const core = getCoreAPI();
      const router = core.getSmartRouter();

      const config = router?.getConfig() || null;
      const lastDecision = core.getLastRouteDecision();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        data: {
          enabled: config?.enabled ?? false,
          config,
          lastDecision,
          active: router !== null,
        },
      }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 更新 SmartRouter 配置（运行时动态切换）
   */
  private async handleRouterUpdateConfig(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { config } = JSON.parse(body);
      const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl');
      const core = getCoreAPI();
      const router = core.getSmartRouter();

      if (!router) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'SmartRouter 未初始化' }));
        return;
      }

      router.updateConfig(config);
      this.broadcastEvent('router:updated', { config });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
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
  private sendError(
    res: http.ServerResponse,
    err: unknown,
    status = 500
  ): void {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('API 错误', { error: message });
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message, type: 'api_error' } }));
  }

  /**
   * 检查文件路径是否在允许的白名单范围内
   * 验证文件操作是否符合沙箱安全规则
   * @param filePath 要检查的文件路径
   * @param permission 需要的权限类型
   * @returns 是否允许操作
   */
  private checkFilePathPermission(
    filePath: string,
    permission: SandboxPermission
  ): boolean {
    // 定义允许的目录白名单
    const allowedDirs = [
      resolveOutputDir(),
      resolveDownloadsDir(),
      resolveAttachmentsDir(),
      resolvePyappHome(),
    ];

    // 检查路径是否在白名单范围内
    const normalizedPath = path.resolve(filePath);
    const isAllowed = allowedDirs.some((dir) => {
      const normalizedDir = path.resolve(dir);
      return normalizedPath.startsWith(normalizedDir);
    });

    if (!isAllowed) {
      logger.warn(`文件路径不在白名单范围内: ${filePath}`, {
        module: 'LocalHTTPService',
        context: { permission, allowedDirs },
      });
      return false;
    }

    // 检查工作空间权限（如果存在活动工作空间）
    const activeWorkspace = globalWorkspaceManager.get('default');
    if (activeWorkspace && !activeWorkspace.hasPermission(permission)) {
      logger.warn(`工作空间缺少必要权限: ${permission}`, {
        module: 'LocalHTTPService',
        context: { workspaceId: 'default' },
      });
      return false;
    }

    return true;
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

  /**
   * 获取当前用户数据目录 GET /v1/settings/data-directory
   */
  private async handleGetDataDirectory(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const {
        resolvePyappHome,
        getUserDataDirOverride,
        setUserDataDirOverride,
      } = await import('@modules/core/paths');

      const currentDir = resolvePyappHome();
      const configuredDir = getUserDataDirOverride();
      // 获取原始默认值（临时清除覆盖，计算后恢复）
      const savedOverride = getUserDataDirOverride();
      if (savedOverride) setUserDataDirOverride(null);
      const defaultDir = resolvePyappHome();
      if (savedOverride) setUserDataDirOverride(savedOverride);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          currentDirectory: currentDir,
          configuredDirectory: configuredDir || null,
          defaultDirectory: defaultDir,
        })
      );
    } catch (error) {
      this.sendError(res, error);
    }
  }

  // ========== Commands Handlers ==========

  /**
   * 处理列出所有命令请求 GET /v1/commands
   */
  private async handleListCommands(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { getCommandManager } =
        await import('@modules/commands/manager/CommandManager.js');
      const commandManager = getCommandManager();
      const commands = await commandManager.getAllCommands();
      const result = commands.map((cmd: any) => ({
        name: cmd.name,
        description: cmd.description,
        aliases: cmd.aliases || [],
        argumentHint: cmd.argumentHint || '',
        userInvocable: cmd.userInvocable !== false,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理执行命令请求 POST /v1/commands/execute
   */
  private async handleExecuteCommand(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      if (!body) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'request body is required' } })
        );
        return;
      }

      let parsedBody;
      try {
        parsedBody = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'invalid JSON in request body' } })
        );
        return;
      }

      const { command } = parsedBody;

      if (!command) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'command is required' } }));
        return;
      }

      const { commandExecutor } =
        await import('@modules/commands/executor/CommandExecutor.js');
      const result = await commandExecutor.execute(command);

      const output =
        result.value?.toString() || result.message?.toString() || '';
      const error = result.type === 'error' ? output : '';

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          success: result.success !== false,
          output,
          error,
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 递归复制目录（带回滚令牌）
   * @param src 源目录
   * @param dest 目标目录
   * @param fs fs 模块
   * @param path path 模块
   * @returns 复制结果统计
   */
  private copyDirectory(
    src: string,
    dest: string,
    fs: any,
    path: any
  ): { copied: number; skipped: number; errors: string[] } {
    let copied = 0;
    let skipped = 0;
    const errors: string[] = [];

    if (!fs.existsSync(src)) {
      return { copied, skipped, errors };
    }

    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      // 跳过迁移标记文件本身，避免误复制
      if (
        entry.name === '.migrating' ||
        entry.name === '.migration_committed'
      ) {
        continue;
      }
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      try {
        if (entry.isDirectory()) {
          const result = this.copyDirectory(srcPath, destPath, fs, path);
          copied += result.copied;
          skipped += result.skipped;
          errors.push(...result.errors);
        } else {
          if (!fs.existsSync(destPath)) {
            fs.copyFileSync(srcPath, destPath);
            copied++;
          } else {
            skipped++;
          }
        }
      } catch (err) {
        errors.push(`复制 ${srcPath} 失败: ${(err as Error).message}`);
      }
    }

    return { copied, skipped, errors };
  }

  /**
   * 设置用户数据目录 PUT /v1/settings/data-directory
   * 使用两阶段迁移：全部复制成功后才切换目录，复制失败则回滚清理
   * @param req
   * @param res
   * @param options.migrate 是否迁移现有数据（默认 true）
   */
  private async handleSetDataDirectory(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const payload = JSON.parse(body);
      const { directory, migrate = true } = payload;

      if (!directory || typeof directory !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              message: '目录路径不能为空',
              type: 'invalid_request_error',
            },
          })
        );
        return;
      }

      const fs = await import('fs');
      const path = await import('path');
      const resolvedDir = path.resolve(directory);

      // 验证目录可写
      try {
        if (!fs.existsSync(resolvedDir)) {
          fs.mkdirSync(resolvedDir, { recursive: true });
        }
        const testFile = path.join(resolvedDir, '.write_test');
        fs.writeFileSync(testFile, '');
        fs.unlinkSync(testFile);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              message: `无法创建或写入目录: ${(err as Error).message}`,
              type: 'invalid_request_error',
            },
          })
        );
        return;
      }

      // 获取当前数据目录
      const { resolvePyappHome, setUserDataDirOverride } =
        await import('@modules/core/paths');
      const currentDir = resolvePyappHome();

      // 执行数据迁移（两阶段：先复制，成功后再切换）
      let migrationResult: {
        copied: number;
        skipped: number;
        errors: string[];
      } | null = null;
      if (migrate && currentDir !== resolvedDir && fs.existsSync(currentDir)) {
        // 阶段一：写迁移令牌，标记迁移进行中
        try {
          fs.writeFileSync(
            path.join(resolvedDir, '.migrating'),
            Date.now().toString(),
            'utf-8'
          );
        } catch {
          // 非致命：令牌写入失败不影响迁移
        }

        migrationResult = this.copyDirectory(currentDir, resolvedDir, fs, path);

        // 检查迁移是否出错，出错则执行回滚
        if (migrationResult.errors.length > 0) {
          this.rollbackMigration(resolvedDir, fs, path, currentDir);

          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: false,
              message: `数据迁移失败，已回滚，保留了 ${migrationResult.copied} 个已复制的文件作为备份参考`,
              directory: resolvedDir,
              migration: migrationResult,
              rolledBack: true,
              error: {
                message: `迁移过程中出现 ${migrationResult.errors.length} 个错误，目录已回滚`,
                type: 'migration_error',
              },
            })
          );
          return;
        }

        // 阶段二：写迁移完成标记
        try {
          fs.writeFileSync(
            path.join(resolvedDir, '.migration_committed'),
            Date.now().toString(),
            'utf-8'
          );
        } catch {
          // 非致命：标记写入失败不影响目录切换
        }
      }

      // 设置全局覆盖
      setUserDataDirOverride(resolvedDir);

      // 持久化到用户设置
      const { updateUserSettings } =
        await import('@modules/config/settings/userSettings');
      await updateUserSettings({ dataDirectory: resolvedDir });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          message: migrationResult
            ? `数据目录已更新，已迁移 ${migrationResult.copied} 个文件，跳过 ${migrationResult.skipped} 个文件`
            : '数据目录已更新',
          directory: resolvedDir,
          migration: migrationResult,
        })
      );
    } catch (error) {
      this.sendError(res, error);
    }
  }

  /**
   * 回滚数据迁移：删除目标目录中的已复制内容
   * @param destDir 目标目录（将被清理）
   * @param fs fs 模块
   * @param path path 模块
   * @param oldDir 原数据目录（保留不动）
   */
  private rollbackMigration(
    destDir: string,
    fs: any,
    path: any,
    oldDir: string
  ): void {
    try {
      // 清理目标目录中除 .migrating 令牌外的所有文件和子目录
      if (fs.existsSync(destDir)) {
        const entries = fs.readdirSync(destDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === '.migrating') continue;
          const entryPath = path.join(destDir, entry.name);
          try {
            if (entry.isDirectory()) {
              fs.rmSync(entryPath, { recursive: true, force: true });
            } else {
              fs.unlinkSync(entryPath);
            }
          } catch {
            // 静默忽略清理中的个别错误
          }
        }
      }
    } catch {
      // 回滚清理失败不影响主流程，数据保留在原目录
    }
  }

  // ──────────────────────────────────────────────
  // Skills（ClawHub 生态对接）处理器
  // ──────────────────────────────────────────────

  /**
   * 获取 ClawHubAdapter 实例
   * 优先从 ThirdPartyAdapterRegistry 获取，fallback 到直接 import
   */
  private async getClawHubAdapter(): Promise<any> {
    // 优先从注册表获取
    try {
      const { thirdPartyAdapterRegistry } =
        await import('@modules/skills/loaders/adapter/ThirdPartyAdapterRegistry');
      const registered = thirdPartyAdapterRegistry.get('clawhub');
      if (registered) {
        return registered;
      }
    } catch {
      // 注册表不可用时 fallback
    }

    // Fallback: 直接 import
    const { ClawHubAdapter } =
      await import('@modules/skills/loaders/adapter/clawhub/ClawHubAdapter');

    const adapter = ClawHubAdapter.getInstance();

    if (!adapter['initialized']) {
      await adapter.initialize();
    }

    return adapter;
  }

  /**
   * 处理列出已安装技能请求 GET /v1/skills
   */
  private async handleListSkills(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const adapter = await this.getClawHubAdapter();
      const skills = await adapter.getInstalledSkills();

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ skills }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理列出系统内置技能请求 GET /v1/skills/system
   * 扫描 builtin/skills 和用户技能目录中的 SKILL.md 文件，
   * 返回与前端 SkillPage 兼容的技能列表
   */
  private async handleListSystemSkills(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { resolveProjectRoot, resolvePyappHome } =
        await import('@modules/core/paths');
      const { parseSkillFrontmatter } =
        await import('@modules/skills/utils/skillParser');
      const { readdir, readFile, stat } = await import('fs/promises');
      const { existsSync } = await import('fs');
      const { join } = await import('node:path');

      const skills: Record<string, any>[] = [];
      const seen = new Set<string>();

      const scanDir = async (dir: string, source: string) => {
        if (!existsSync(dir)) return;
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
          const filePath = join(dir, entry.name);
          try {
            const content = await readFile(filePath, 'utf-8');
            const parsed = parseSkillFrontmatter(content);
            const name = entry.name.replace(/\.md$/, '');
            const description = (parsed.frontmatter as any)?.description || '';
            const fm = parsed.frontmatter as Record<string, any>;
            const version = fm?.version || '1.0.0';
            const author = fm?.author || '';
            const category = fm?.category || 'general';

            if (seen.has(name)) continue;
            seen.add(name);

            let createdAt = 0;
            let updatedAt = 0;
            try {
              const st = await stat(filePath);
              createdAt = st.birthtimeMs;
              updatedAt = st.mtimeMs;
            } catch {
              /* use defaults */
            }

            skills.push({
              id: name,
              name,
              description,
              status: 'enabled',
              category,
              parameters: [],
              createdAt,
              updatedAt,
              usageCount: 0,
              lastUsedAt: null,
              source,
              version,
              filePath,
              frontmatter: { author, version, category },
            });
          } catch {
            /* skip malformed files */
          }
        }
      };

      // 扫描内置技能
      const projectRoot = resolveProjectRoot();
      const builtinDir = join(projectRoot, 'app', 'src', 'builtin', 'skills');
      await scanDir(builtinDir, 'builtin');

      // 扫描用户技能
      const userSkillsDir = join(resolvePyappHome(), 'skills');
      await scanDir(userSkillsDir, 'user');

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ skills, total: skills.length }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理获取系统技能内容 GET /v1/skills/system/:id/content
   * 读取 SKILL.md 文件返回原始内容及 frontmatter
   */
  private async handleSystemSkillContent(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      const { readFile, stat } = await import('fs/promises');
      const { existsSync } = await import('fs');
      const { resolveProjectRoot, resolvePyappHome } =
        await import('@modules/core/paths');
      const pathMod = await import('node:path');

      const candidateDirs = [
        pathMod.join(
          resolveProjectRoot(),
          'app',
          'src',
          'builtin',
          'skills',
          decodeURIComponent(skillId)
        ),
        pathMod.join(resolvePyappHome(), 'skills', decodeURIComponent(skillId)),
      ];

      let skillFile = '';
      for (const dir of candidateDirs) {
        const candidate = pathMod.join(dir, 'SKILL.md');
        if (existsSync(candidate)) {
          skillFile = candidate;
          break;
        }
      }

      if (!skillFile) {
        res.writeHead(404, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify({ error: { message: '技能未找到' } }));
        return;
      }

      const rawContent = await readFile(skillFile, 'utf-8');
      let content = rawContent;
      const frontmatter: Record<string, unknown> = {};
      const linkedFiles: string[] = [];

      const fmMatch = rawContent.match(/^---\n([\s\S]*?)\n---\n/);
      if (fmMatch) {
        content = rawContent.slice(fmMatch[0].length);
        const lines = fmMatch[1].split('\n');
        for (const line of lines) {
          const m = line.match(/^(\w[\w-]*):\s*(.+)$/);
          if (m) frontmatter[m[1]] = m[2].trim();
        }
      }

      // 收集关联文件
      const skillDir = pathMod.dirname(skillFile);
      try {
        const entries = await (
          await import('fs/promises')
        ).readdir(skillDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name !== 'SKILL.md') {
            linkedFiles.push(entry.name);
          }
        }
      } catch {
        /* ignore */
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          content,
          rawContent,
          frontmatter,
          linkedFiles,
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理搜索技能请求 GET /v1/skills/search?q=...&category=...&tags=...&source=...
   * source: 限定搜索源（clawhub / github），不传则搜索全部
   */
  private async handleSearchSkills(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const urlObj = new URL(req.url!, `http://${req.headers.host}`);
      const query = urlObj.searchParams.get('q') || '';
      const category = urlObj.searchParams.get('category') || undefined;
      const tagsStr = urlObj.searchParams.get('tags') || undefined;
      const tags = tagsStr
        ? tagsStr.split(',').map((t) => t.trim())
        : undefined;
      const source = urlObj.searchParams.get('source') || undefined;

      const adapter = await this.getClawHubAdapter();
      const results = await adapter.searchSkills(query, {
        category,
        tags,
        source,
      });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ results }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理推荐技能列表请求 GET /v1/skills/recommended
   * 返回 ClawHub 市场推荐的技能列表
   */
  private async handleRecommendedSkills(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const urlObj = new URL(req.url!, `http://${req.headers.host}`);
      const limit = parseInt(urlObj.searchParams.get('limit') || '10', 10);

      const adapter = await this.getClawHubAdapter();
      const installed = await adapter.getInstalledSkills();
      const installedIds = new Set(installed.map((s: any) => s.meta.id));

      const searchEngine = adapter.getSearchEngine();
      const allResults = await searchEngine.searchRemote('', {});

      const recommended = allResults
        .filter((r: any) => !installedIds.has(r.skill.id))
        .slice(0, limit)
        .map((r: any) => ({ ...r, installed: false }));

      const categories = this.getSkillCategoryMap(installed);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ recommended, categories }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理技能分类列表请求 GET /v1/skills/categories
   * 按能力分类统计已安装插件数量，技能统一归入 skill 分类
   */
  private async handleSkillCategories(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { PLUGIN_CATEGORIES } =
        await import('@modules/plugins/categories/PluginCategories');

      const adapter = await this.getClawHubAdapter();
      const installed = await adapter.getInstalledSkills();

      const categoryMap = this.getSkillCategoryMap(installed);

      const categories = Object.entries(PLUGIN_CATEGORIES).map(
        ([key, cat]) => ({
          id: key,
          capability: cat.capability,
          description: cat.description,
          count: categoryMap[key] || 0,
        })
      );

      const sourceMap = this.getSkillSourceMap(installed);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ categories, sourceDistribution: sourceMap }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理技能来源列表请求 GET /v1/skills/sources
   * 返回 SearchEngine 中注册的所有搜索源名称
   */
  private async handleSkillSources(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const adapter = await this.getClawHubAdapter();
      const searchEngine = adapter.getSearchEngine();
      const sources = searchEngine.getSourceNames() as string[];

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ sources }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 添加自定义技能搜索源 POST /v1/skills/sources
   * Body: { name: string, apiBaseUrl: string }
   */
  private async handleAddSkillSource(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { name, apiBaseUrl } = JSON.parse(body || '{}');

      if (
        !name ||
        !apiBaseUrl ||
        typeof name !== 'string' ||
        typeof apiBaseUrl !== 'string'
      ) {
        res.writeHead(400, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(
          JSON.stringify({ error: { message: '需要 name 和 apiBaseUrl 字段' } })
        );
        return;
      }

      const adapter = await this.getClawHubAdapter();
      const searchEngine = adapter.getSearchEngine();
      searchEngine.addCustomSource(name.trim(), apiBaseUrl.trim());

      const sources = searchEngine.getSourceNames() as string[];
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, sources }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 移除自定义技能搜索源 DELETE /v1/skills/sources/:name
   */
  private async handleRemoveSkillSource(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    name: string
  ): Promise<void> {
    try {
      const adapter = await this.getClawHubAdapter();
      const searchEngine = adapter.getSearchEngine();
      searchEngine.removeCustomSource(decodeURIComponent(name));

      const sources = searchEngine.getSourceNames() as string[];
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, sources }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 构建插件分类统计映射
   * 所有技能统一归入 skill 分类，不再按来源分裂
   */
  private getSkillCategoryMap(installed: any[]): Record<string, number> {
    const map: Record<string, number> = {};

    for (const skill of installed) {
      const source = skill.meta.source || 'third_party';

      if (source === 'builtin') {
        map['builtin'] = (map['builtin'] || 0) + 1;
      } else {
        map['skill'] = (map['skill'] || 0) + 1;
      }
    }

    return map;
  }

  /**
   * 构建技能来源分布统计
   * 按 source 字段统计各来源的技能数量
   */
  private getSkillSourceMap(installed: any[]): Record<string, number> {
    const map: Record<string, number> = {};

    for (const skill of installed) {
      const source = skill.meta.source || 'unknown';
      map[source] = (map[source] || 0) + 1;
    }

    return map;
  }

  /**
   * 处理获取技能详情请求 GET /v1/skills/:id
   */
  private async handleGetSkillDetail(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      const adapter = await this.getClawHubAdapter();
      const skill = await adapter.getSkillDetail(skillId);

      if (!skill) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: `技能未找到: ${skillId}` } })
        );
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ skill }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理安装技能请求 POST /v1/skills/install
   */
  private async handleInstallSkill(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      if (!body) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'request body is required' } })
        );
        return;
      }

      const parsedBody = JSON.parse(body);
      const { skillId, sourceUrl } = parsedBody;

      if (!skillId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'skillId is required' } }));
        return;
      }

      const adapter = await this.getClawHubAdapter();
      const installed = await adapter.installSkill(skillId, sourceUrl);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, skill: installed }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理卸载技能请求 POST /v1/skills/:id/uninstall
   */
  private async handleUninstallSkill(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      const adapter = await this.getClawHubAdapter();
      await adapter.uninstallSkill(skillId);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理更新技能请求 POST /v1/skills/:id/update
   */
  private async handleUpdateSkill(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      const adapter = await this.getClawHubAdapter();
      const updated = await adapter.updateSkill(skillId);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, skill: updated }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理切换技能启用状态请求 POST /v1/skills/:id/toggle
   */
  private async handleToggleSkill(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const parsedBody = body ? JSON.parse(body) : {};
      const enabled = parsedBody.enabled;

      const adapter = await this.getClawHubAdapter();

      if (enabled === true) {
        await adapter.enableSkill(skillId);
      } else if (enabled === false) {
        await adapter.disableSkill(skillId);
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'enabled field is required (true/false)' },
          })
        );
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, enabled }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== MCP Marketplace Handlers ==========

  /**
   * 处理 MCP 市场搜索请求 GET /v1/mcp/marketplace/search?query=xx&category=xx
   */
  private async handleMCPMarketplaceSearch(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const parsedUrl = new URL(
        req.url!,
        `http://${req.headers.host || 'localhost'}`
      );
      const query = parsedUrl.searchParams.get('query') || '';
      const category = parsedUrl.searchParams.get('category') || undefined;
      const registry =
        (parsedUrl.searchParams.get('registry') as any) || undefined;
      const sourceRegistry =
        (parsedUrl.searchParams.get('sourceRegistry') as any) || undefined;

      const { mcpSystem } = await import('@modules/services/mcp');
      
      if (!mcpSystem || !mcpSystem.marketplace) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { message: 'MCP 市场服务未初始化' } }));
        return;
      }

      const results = await mcpSystem.marketplace.search({
        query,
        category,
        registry,
        sourceRegistry,
      });

      if (!results || !Array.isArray(results)) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify([]));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(results));
    } catch (err) {
      logger.error('MCP 市场搜索失败', err as Error);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ 
        error: { 
          message: '搜索失败',
          detail: err instanceof Error ? err.message : String(err)
        } 
      }));
    }
  }

  /**
   * 处理获取 MCP 市场注册表列表 GET /v1/mcp/marketplace/registries
   * 返回可用第三方注册表源（GitHub/NPM/Smithery 等）
   */
  private async handleMCPMarketplaceRegistries(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { mcpSystem } = await import('@modules/services/mcp');
      
      if (!mcpSystem || !mcpSystem.marketplace) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { message: 'MCP 市场服务未初始化' } }));
        return;
      }

      const marketplace = mcpSystem.marketplace;
      if (!marketplace.registryHub) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { message: '注册表中心未初始化' } }));
        return;
      }

      const adapters = marketplace.registryHub.getAdapters();
      if (!adapters || !Array.isArray(adapters)) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ registries: [] }));
        return;
      }

      const registries = adapters
        .filter((a) => a && a.registryType === 'third_party')
        .map((a) => ({
          id: (a.sourceRegistry as string) || a.id,
          name: a.displayName || 'Unknown',
          sourceRegistry: a.sourceRegistry,
        }));

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ registries }));
    } catch (err) {
      logger.error('获取 MCP 注册表列表失败', err as Error);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ 
        error: { 
          message: '获取注册表列表失败',
          detail: err instanceof Error ? err.message : String(err)
        } 
      }));
    }
  }

  /**
   * 处理获取 MCP 市场分类请求 GET /v1/mcp/marketplace/categories
   */
  private async handleMCPMarketplaceCategories(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { mcpSystem } = await import('@modules/services/mcp');
      
      if (!mcpSystem || !mcpSystem.marketplace) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { message: 'MCP 市场服务未初始化' } }));
        return;
      }

      const categories = await mcpSystem.marketplace.getCategories();

      if (!categories || !Array.isArray(categories)) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify([]));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(categories));
    } catch (err) {
      logger.error('获取 MCP 分类列表失败', err as Error);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ 
        error: { 
          message: '获取分类列表失败',
          detail: err instanceof Error ? err.message : String(err)
        } 
      }));
    }
  }

  /**
   * 处理获取 MCP 服务器详情请求 GET /v1/mcp/marketplace/servers/:serverId
   */
  private async handleMCPMarketplaceServerDetail(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    serverId: string
  ): Promise<void> {
    try {
      const { mcpSystem } = await import('@modules/services/mcp');
      
      if (!mcpSystem || !mcpSystem.marketplace) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { message: 'MCP 市场服务未初始化' } }));
        return;
      }

      const detail = await mcpSystem.marketplace.getServerDetail(serverId);

      if (!detail) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Server not found' } }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(detail));
    } catch (err) {
      logger.error('获取 MCP 服务器详情失败', err as Error);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ 
        error: { 
          message: '获取服务器详情失败',
          detail: err instanceof Error ? err.message : String(err)
        } 
      }));
    }
  }

  /**
   * 处理获取已安装 MCP 服务器列表 GET /v1/mcp/marketplace/installed
   */
  private async handleMCPInstalledServers(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { mcpSystem } = await import('@modules/services/mcp');
      
      if (!mcpSystem || !mcpSystem.marketplace) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { message: 'MCP 市场服务未初始化' } }));
        return;
      }

      const servers = mcpSystem.marketplace.getInstalledServers();
      if (!servers || !Array.isArray(servers)) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify([]));
        return;
      }

      const detailed = servers.map((s) => {
        const detail = mcpSystem.marketplace.getInstalledServerDetail(s.name);
        return {
          ...s,
          connected: detail.connected,
          configInFile: detail.config ? true : false,
        };
      });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(detailed));
    } catch (err) {
      logger.error('获取已安装 MCP 服务器列表失败', err as Error);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ 
        error: { 
          message: '获取已安装服务器列表失败',
          detail: err instanceof Error ? err.message : String(err)
        } 
      }));
    }
  }

  /**
   * 处理安装 MCP 服务器请求 POST /v1/mcp/marketplace/servers/:serverId/install
   */
  private async handleMCPInstallServer(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    serverId: string
  ): Promise<void> {
    try {
      const { mcpSystem } = await import('@modules/services/mcp');
      
      if (!mcpSystem || !mcpSystem.marketplace) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { message: 'MCP 市场服务未初始化' } }));
        return;
      }

      await mcpSystem.marketplace.install(serverId);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, serverId }));
    } catch (err) {
      logger.error(`安装 MCP 服务器失败: ${serverId}`, err as Error);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ 
        error: { 
          message: `安装服务器失败: ${serverId}`,
          detail: err instanceof Error ? err.message : String(err)
        } 
      }));
    }
  }

  /**
   * 处理卸载 MCP 服务器请求 POST /v1/mcp/marketplace/servers/:serverId/uninstall
   */
  private async handleMCPUninstallServer(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    serverId: string
  ): Promise<void> {
    try {
      const { mcpSystem } = await import('@modules/services/mcp');
      
      if (!mcpSystem || !mcpSystem.marketplace) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { message: 'MCP 市场服务未初始化' } }));
        return;
      }

      await mcpSystem.marketplace.uninstall(serverId);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, serverId }));
    } catch (err) {
      logger.error(`卸载 MCP 服务器失败: ${serverId}`, err as Error);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ 
        error: { 
          message: `卸载服务器失败: ${serverId}`,
          detail: err instanceof Error ? err.message : String(err)
        } 
      }));
    }
  }

  /**
   * 处理切换 MCP 服务器启用状态 POST /v1/mcp/marketplace/servers/:serverId/toggle
   */
  private async handleMCPToggleServer(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    serverId: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const parsedBody = body ? JSON.parse(body) : {};
      const enabled = parsedBody.enabled;

      if (enabled === undefined) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'enabled field is required (true/false)' },
          })
        );
        return;
      }

      const { mcpSystem } = await import('@modules/services/mcp');
      
      if (!mcpSystem || !mcpSystem.marketplace) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { message: 'MCP 市场服务未初始化' } }));
        return;
      }

      await mcpSystem.marketplace.toggleServer(serverId, enabled);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, serverId, enabled }));
    } catch (err) {
      logger.error(`切换 MCP 服务器状态失败: ${serverId}`, err as Error);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ 
        error: { 
          message: `切换服务器状态失败: ${serverId}`,
          detail: err instanceof Error ? err.message : String(err)
        } 
      }));
    }
  }

  /**
   * 处理验证 MCP 服务器连接 POST /v1/mcp/servers/:serverId/verify
   */
  private async handleMCPVerifyServer(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    serverId: string
  ): Promise<void> {
    try {
      const { getMCPServerManager } =
        await import('@modules/services/mcp/MCPServerManager');
      const { mcpSystem } = await import('@modules/services/mcp');

      const manager = getMCPServerManager();
      const detail = mcpSystem.marketplace.getInstalledServerDetail(serverId);

      if (!detail.metadata) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            error: `服务器 "${serverId}" 未安装`,
          })
        );
        return;
      }

      const server = manager.getServer(serverId);
      if (!server) {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(
          JSON.stringify({
            success: false,
            connected: false,
            status: 'not_found',
          })
        );
        return;
      }

      // 尝试连接
      const wasConnected = detail.connected;
      const success = await server.connect();

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          success,
          connected: success,
          status: success ? 'connected' : 'failed',
          wasConnected,
        })
      );
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          success: false,
          connected: false,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }

  /**
   * 处理列出所有 MCP 工具 GET /v1/mcp/tools
   */
  private async handleMCPListTools(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { getMCPServerManager } =
        await import('@modules/services/mcp/MCPServerManager');
      const { mcpSystem } = await import('@modules/services/mcp');
      const manager = getMCPServerManager();
      const serverInfos = manager.getServerInfos();

      const tools: Array<{
        name: string;
        description: string;
        server: string;
        inputSchema: Record<string, unknown>;
        enabled: boolean;
      }> = [];

      for (const info of serverInfos) {
        for (const tool of info.tools || []) {
          const enabled = !mcpSystem.marketplace.isToolDisabled(
            info.name,
            tool.name
          );
          tools.push({
            name: tool.name,
            description: tool.description || '',
            server: info.name,
            inputSchema: (tool.inputSchema as Record<string, unknown>) || {},
            enabled,
          });
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ tools, total: tools.length }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理切换 MCP 工具启用状态 PATCH /v1/mcp/tools/:toolName/toggle
   * body: { enabled: boolean, server?: string }
   */
  private async handleMCPToggleTool(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    toolName: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const parsedBody = body ? JSON.parse(body) : {};
      const enabled = parsedBody.enabled;
      const serverName = parsedBody.server as string | undefined;

      if (enabled === undefined) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'enabled field is required (true/false)' },
          })
        );
        return;
      }

      // 工具级启用/禁用通过 marketplace 的 tool toggle 实现
      const { mcpSystem } = await import('@modules/services/mcp');
      await mcpSystem.marketplace.toggleTool(
        serverName || toolName,
        toolName,
        enabled
      );

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, tool: toolName, enabled }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== Agent Handlers ==========

  private async handleCancelAgentTask(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string
  ): Promise<void> {
    try {
      const { coordinator } = await import('@modules/core/Coordinator');
      const success = coordinator.stopTask(taskId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success, taskId }));
      this.broadcastEvent('agent:task-cancelled', { taskId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleGetAgentTaskState(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string
  ): Promise<void> {
    try {
      const { SqliteTaskStore } = await import('@modules/tasks/db/SqliteTaskStore');
      const store = new SqliteTaskStore();
      await store.init();
      const state = await store.getTaskState(taskId);
      if (!state) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Task not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleGetAgentTaskAudit(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string
  ): Promise<void> {
    try {
      const { SqliteTaskStore } = await import('@modules/tasks/db/SqliteTaskStore');
      const store = new SqliteTaskStore();
      await store.init();
      const logs = await store.queryAuditLogs(taskId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(logs));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleGetAgentTaskLogs(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string
  ): Promise<void> {
    try {
      const logs: string[] = [];

      // 从 SQLite 加载日志
      try {
        const { SqliteTaskStore } = await import('@modules/tasks/db/SqliteTaskStore');
        const store = new SqliteTaskStore();
        await store.init();
        const state = await store.getTaskState(taskId);
        if (state) {
          logs.push(`Task: ${state.description || taskId} | Status: ${state.status} | Type: ${state.type}`);
          if (state.outputFile) {
            const fs = await import('fs');
            if (fs.existsSync(state.outputFile)) {
              const content = fs.readFileSync(state.outputFile, 'utf-8');
              logs.push(...content.split('\n').filter(Boolean).slice(-100));
            }
          }
          if (state.error) {
            logs.push(`Error: ${state.error}`);
          }
        } else {
          logs.push(`Task ${taskId} not found in store`);
        }
      } catch (e) {
        logs.push(`Failed to load task state: ${String(e)}`);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(logs));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleGetAgentTaskOutput(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string
  ): Promise<void> {
    try {
      const fs = await import('fs');
      const { SqliteTaskStore } = await import('@modules/tasks/db/SqliteTaskStore');
      const store = new SqliteTaskStore();
      await store.init();
      const state = await store.getTaskState(taskId);

      let output = '';
      if (state?.outputFile && fs.existsSync(state.outputFile)) {
        output = fs.readFileSync(state.outputFile, 'utf-8');
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(output));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleRecoverAgentTask(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string
  ): Promise<void> {
    try {
      const { taskRegistry } = await import('@modules/tasks');
      const recovered = await taskRegistry.recoverLostTask(taskId);
      if (!recovered) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Task not found or not in LOST state' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, taskId }));
      this.broadcastEvent('agent:task-recovered', { taskId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleAgentTaskChat(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { message } = JSON.parse(body);
      let reply = '';
      try {
        const coreAPI = getCoreAPI();
        reply = (await (coreAPI as any).sendTaskMessage?.(taskId, message)) || '';
      } catch {
        // 降级：通过 executor 直接执行
        const { coordinator } = await import('@modules/core/Coordinator');
        const task = (coordinator as any).getTask(taskId);
        if (task && typeof (task as any).sendMessage === 'function') {
          reply = await (task as any).sendMessage(message);
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply || '(Agent未响应)'));
      this.broadcastEvent('agent:task-chat', { taskId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== PDCA Handlers ==========

  private async handlePdcaStart(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { description, sessionId } = JSON.parse(body);
      const taskId = `pdca_${Date.now().toString(36)}`;

      const { getOrCreateOrchestrator } = await import('@modules/tasks/LongRunningTaskOrchestrator');
      const orchestrator = getOrCreateOrchestrator(taskId);
      const status = await orchestrator.runFullPdca(description, sessionId || '');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      this.broadcastEvent('pdca:started', { taskId, status });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handlePdcaStatus(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string
  ): Promise<void> {
    try {
      let orchestrator: any = null;
      try {
        const mod = await import('@modules/tasks/LongRunningTaskOrchestrator');
        orchestrator = mod.getOrchestrator(taskId);
      } catch {
        // 模块加载失败或无 orchestrator
      }
      if (!orchestrator) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ taskId, phase: 'none', planId: '', lifecycle: [] }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(orchestrator.getStatus()));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handlePdcaAudit(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string
  ): Promise<void> {
    try {
      let orchestrator: any = null;
      try { const m = await import('@modules/tasks/LongRunningTaskOrchestrator'); orchestrator = m.getOrchestrator(taskId); } catch {}
      if (!orchestrator) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ taskId, error: 'Not available' }));
        return;
      }
      const report = orchestrator.generateReport();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(report));
    } catch (err) { this.sendError(res, err); }
  }

  private async handlePdcaReviewStep(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string,
    stepId: string
  ): Promise<void> {
    try {
      let orchestrator: any = null;
      try { const m = await import('@modules/tasks/LongRunningTaskOrchestrator'); orchestrator = m.getOrchestrator(taskId); } catch {}
      if (!orchestrator) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not available' }));
        return;
      }
      const review = await orchestrator.reviewStep(stepId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(review));
      this.broadcastEvent('pdca:reviewed', { taskId, stepId, review });
    } catch (err) { this.sendError(res, err); }
  }

  private async handlePdcaDecideStep(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string,
    stepId: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { decision } = JSON.parse(body);
      let orchestrator: any = null;
      try { const m = await import('@modules/tasks/LongRunningTaskOrchestrator'); orchestrator = m.getOrchestrator(taskId); } catch {}
      if (!orchestrator) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not available' }));
        return;
      }
      await orchestrator.decideStep(stepId, decision);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      this.broadcastEvent('pdca:decided', { taskId, stepId, decision });
    } catch (err) { this.sendError(res, err); }
  }

  private async handlePdcaList(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      let list: any[] = [];
      try { const m = await import('@modules/tasks/LongRunningTaskOrchestrator'); list = m.getAllOrchestrators().map((o: any) => o.getStatus()); } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(list));
    } catch (err) { this.sendError(res, err); }
  }

  private async handlePdcaConfirm(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    taskId: string
  ): Promise<void> {
    try {
      let orchestrator: any = null;
      try { const m = await import('@modules/tasks/LongRunningTaskOrchestrator'); orchestrator = m.getOrchestrator(taskId); } catch {}
      if (!orchestrator) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(orchestrator.getStatus()));
    } catch (err) { this.sendError(res, err); }
  }

  // ========== Kanban Handlers ==========

  private async handleKanbanList(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { SqliteTaskStore } = await import('@modules/tasks/db/SqliteTaskStore');
      const store = new SqliteTaskStore();
      await store.init();
      const cards = await store.loadKanbanCards();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cards));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleKanbanCreate(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { title, description, columnId, assignee, priority, tags } = JSON.parse(body);
      const { SqliteTaskStore } = await import('@modules/tasks/db/SqliteTaskStore');
      const store = new SqliteTaskStore();
      await store.init();
      const card = {
        id: `kb_${Date.now().toString(36)}`,
        title,
        description,
        columnId: columnId || 'todo',
        assignee,
        priority: priority || 'medium',
        tags: tags || [],
        sortOrder: Date.now(),
      };
      await store.saveKanbanCard(card);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(card));
      this.broadcastEvent('kanban:created', { card });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleKanbanUpdate(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    cardId: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { title, description, assignee, priority, tags } = JSON.parse(body);
      const { SqliteTaskStore } = await import('@modules/tasks/db/SqliteTaskStore');
      const store = new SqliteTaskStore();
      await store.init();
      await store.saveKanbanCard({ id: cardId, title: title || '', description, assignee, priority, tags });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      this.broadcastEvent('kanban:updated', { cardId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleKanbanDelete(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    cardId: string
  ): Promise<void> {
    try {
      const { SqliteTaskStore } = await import('@modules/tasks/db/SqliteTaskStore');
      const store = new SqliteTaskStore();
      await store.init();
      await store.deleteKanbanCard(cardId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      this.broadcastEvent('kanban:deleted', { cardId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleKanbanMove(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    cardId: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { columnId, sortOrder } = JSON.parse(body);
      const { SqliteTaskStore } = await import('@modules/tasks/db/SqliteTaskStore');
      const store = new SqliteTaskStore();
      await store.init();
      await store.updateKanbanCardColumn(cardId, columnId, sortOrder ?? Date.now());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      this.broadcastEvent('kanban:moved', { cardId, columnId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== Plan & Flow Handlers ==========

  private async handleListPlans(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { taskOrchestrator } = await import('@modules/tasks/TaskOrchestrator');
      await taskOrchestrator['initialize']();
      const plans = taskOrchestrator.getAllPlans();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(plans));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleCreatePlan(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { taskOrchestrator } = await import('@modules/tasks/TaskOrchestrator');
      const body = await this.readRequestBody(req);
      const { description, steps, sessionId } = JSON.parse(body);
      const plan = taskOrchestrator.createPlan(
        description || '',
        steps || [],
        sessionId || '',
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(plan));
      this.broadcastEvent('plan:created', { planId: plan.id });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleGetPlan(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    planId: string
  ): Promise<void> {
    try {
      const { taskOrchestrator } = await import('@modules/tasks/TaskOrchestrator');
      const plan = taskOrchestrator.getPlan(planId);
      if (!plan) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Plan not found' }));
        return;
      }
      const progress = taskOrchestrator.getPlanProgress(planId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ plan, progress }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleExecutePlan(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    planId: string
  ): Promise<void> {
    try {
      const { taskOrchestrator } = await import('@modules/tasks/TaskOrchestrator');
      const plan = taskOrchestrator.getPlan(planId);
      if (!plan) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Plan not found' }));
        return;
      }
      // 标记所有 pending 步骤为 running
      for (const step of plan.steps) {
        if (step.status === 'pending') {
          taskOrchestrator.markStepRunning(step.id);
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, planId }));
      this.broadcastEvent('plan:executed', { planId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleAbortPlan(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    planId: string
  ): Promise<void> {
    try {
      const { taskOrchestrator } = await import('@modules/tasks/TaskOrchestrator');
      const plan = taskOrchestrator.getPlan(planId);
      if (!plan) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Plan not found' }));
        return;
      }
      // 标记所有 running/pending 步骤为 cancelled
      for (const step of plan.steps) {
        if (step.status === 'running' || step.status === 'pending') {
          taskOrchestrator.markStepFailed(step.id, '已终止');
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, planId }));
      this.broadcastEvent('plan:aborted', { planId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleListFlows(
    _req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { taskFlowRegistry } = await import('@modules/tasks/TaskFlowRegistry');
      const flows = taskFlowRegistry.getAllFlows();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(flows));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleGetFlow(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    flowId: string
  ): Promise<void> {
    try {
      const { taskFlowRegistry } = await import('@modules/tasks/TaskFlowRegistry');
      const flow = taskFlowRegistry.getFlow(flowId);
      if (!flow) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Flow not found' }));
        return;
      }
      const stats = taskFlowRegistry.getStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ flow, stats }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== Skill CRUD Handlers ==========

  private async handleCreateSkill(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { skillId, sourceUrl } = JSON.parse(body);

      if (!skillId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'skillId is required' } }));
        return;
      }

      const adapter = await this.getClawHubAdapter();
      const skill = await adapter.installSkill(skillId, sourceUrl);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(skill));
      this.broadcastEvent('skill:created', { skill });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleUpdateSkillById(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      const adapter = await this.getClawHubAdapter();
      const skill = await adapter.updateSkill(skillId);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(skill));
      this.broadcastEvent('skill:updated', { skill });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleDeleteSkill(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      const adapter = await this.getClawHubAdapter();
      await adapter.uninstallSkill(skillId);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({}));
      this.broadcastEvent('skill:deleted', { skillId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleEnableSkill(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      const adapter = await this.getClawHubAdapter();
      await adapter.enableSkill(skillId);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ id: skillId, status: 'enabled' }));
      this.broadcastEvent('skill:enabled', { skillId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleDisableSkill(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    skillId: string
  ): Promise<void> {
    try {
      const adapter = await this.getClawHubAdapter();
      await adapter.disableSkill(skillId);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ id: skillId, status: 'disabled' }));
      this.broadcastEvent('skill:disabled', { skillId });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== Channel Handlers ==========

  private async handleUpdateChannel(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    channelId: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const parsedBody = body ? JSON.parse(body) : {};
      const { enabled, name, config } = parsedBody;

      // 仅切换启用/禁用
      if (enabled === undefined && name === undefined && config === undefined) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              message: 'At least one of enabled/name/config is required',
            },
          })
        );
        return;
      }

      const { channelRegistry } =
        await import('@modules/channels/registry/ChannelRegistry');
      const channel = channelRegistry.get(channelId);
      if (!channel) {
        // 尝试动态注册：前端凭据足够时自动创建并注册通道插件
        const dynRegistered = await this.tryDynamicRegister(
          channelId,
          config as Record<string, unknown> | undefined
        );
        if (!dynRegistered) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Channel not found' } }));
          return;
        }
      }

      // 更新配置
      const channelAfterDyn = channelRegistry.get(channelId)!;
      const updated = channelRegistry.updateConfig(channelId, {
        name: name,
        enabled: enabled,
        options: config as Record<string, unknown> | undefined,
      });

      // 如果 enabled 有变化，执行连接/断开
      if (enabled !== undefined) {
        if (enabled) {
          await channelRegistry.connect(channelId);
        } else {
          await channelRegistry.disconnect(channelId);
        }
      }

      // 读取最新状态
      const latestConfig = channelRegistry.getConfig(channelId);
      const latestChannel = channelRegistry.get(channelId);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: channelId,
          name: name || channelAfterDyn.name,
          type: channelAfterDyn.type,
          enabled: enabled !== undefined ? enabled : channelAfterDyn.enabled,
          connected: latestChannel?.connected ?? channelAfterDyn.connected,
          registered: true,
          config: latestConfig?.options || {},
        })
      );

      this.broadcastEvent('channel:updated', { id: channelId, enabled, name });
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理通道配置应用请求 POST /v1/channels/config/apply
   * 从 DB 中读取已保存的通道配置，重新注册并连接通道
   */
  private async handleApplyChannelConfig(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { channelRegistry } =
        await import('@modules/channels/registry/ChannelRegistry');

      // 获取所有已持久化的配置
      const savedConfigs = channelRegistry.getAllConfigs();

      // 对每个已保存但未注册的通道，尝试动态注册
      let registeredCount = 0;
      for (const config of savedConfigs) {
        const existing = channelRegistry.get(config.type);
        if (!existing) {
          const dynRegistered = await this.tryDynamicRegister(
            config.type,
            config.options
          );
          if (dynRegistered) {
            registeredCount++;
            // 恢复持久化的配置（含 enabled 状态）
            channelRegistry.updateConfig(config.type, {
              name: config.name,
              enabled: config.enabled,
              options: config.options,
            });
          }
        }
      }

      // 连接所有已启用的通道
      const enabledChannels = channelRegistry.getEnabled();
      let connectedCount = 0;
      const errors: string[] = [];

      for (const channel of enabledChannels) {
        try {
          await channel.connect();
          connectedCount++;
        } catch (e) {
          const msg = `连接通道失败: ${channel.name} — ${e instanceof Error ? e.message : String(e)}`;
          logger.warning(msg);
          errors.push(msg);
        }
      }

      logger.info('通道配置应用完成', {
        registered: registeredCount,
        connected: connectedCount,
        errors: errors.length,
      });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          success: true,
          registered: registeredCount,
          connected: connectedCount,
          errors: errors.length > 0 ? errors : undefined,
        })
      );
    } catch (err) {
      logger.error('通道配置应用失败', err as Error);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          error: {
            message: '配置应用失败',
            detail: err instanceof Error ? err.message : String(err),
          },
        })
      );
    }
  }

  /**
   * 通道动态注册元信息表（26 通道全覆盖）
   * 与 setupChannels.ts 中的 channelCandidates 保持同步
   */
  private static readonly CHANNEL_TABLE: Array<{
    type: string;
    name: string;
    importPath: string;
    exportKey: string;
  }> = [
    { type: 'telegram', name: 'Telegram', importPath: '../../../channels/telegram/TelegramChannel', exportKey: 'telegramChannel' },
    { type: 'discord', name: 'Discord', importPath: '../../../channels/discord/DiscordChannel', exportKey: 'discordChannel' },
    { type: 'qq', name: 'QQ', importPath: '../../../channels/qq/QQChannel', exportKey: 'qqChannel' },
    { type: 'dingtalk', name: '钉钉', importPath: '../../../channels/dingtalk/DingTalkChannel', exportKey: 'dingtalkChannel' },
    { type: 'feishu', name: '飞书', importPath: '../../../channels/feishu/FeishuChannel', exportKey: 'feishuChannel' },
    { type: 'wechat', name: '微信', importPath: '../../../channels/wechat/WechatChannel', exportKey: 'wechatChannel' },
    { type: 'slack', name: 'Slack', importPath: '../../../channels/slack/index', exportKey: 'slackChannelPlugin' },
    { type: 'line', name: 'Line', importPath: '../../../channels/line/index', exportKey: 'lineChannelPlugin' },
    { type: 'irc', name: 'IRC', importPath: '../../../channels/irc/index', exportKey: 'ircChannelPlugin' },
    { type: 'nostr', name: 'Nostr', importPath: '../../../channels/nostr/index', exportKey: 'nostrChannelPlugin' },
    { type: 'email', name: '邮件', importPath: '../../../channels/email/EmailChannel', exportKey: 'emailChannelPlugin' },
    { type: 'sms', name: '短信', importPath: '../../../channels/sms/SmsChannel', exportKey: 'smsChannelPlugin' },
    { type: 'webhook', name: 'Webhook', importPath: '../../../channels/webhook/WebhookChannel', exportKey: 'webhookChannelPlugin' },
    { type: 'wecom', name: '企业微信', importPath: '../../../channels/wecom/WeComChannel', exportKey: 'wecomChannel' },
    { type: 'googlechat', name: 'Google Chat', importPath: '../../../channels/googlechat/index', exportKey: 'googleChatChannelPlugin' },
    { type: 'msteams', name: 'MS Teams', importPath: '../../../channels/msteams/index', exportKey: 'msteamsChannelPlugin' },
    { type: 'zalo', name: 'Zalo', importPath: '../../../channels/zalo/index', exportKey: 'zaloChannelPlugin' },
    { type: 'yuanbao', name: '元宝', importPath: '../../../channels/yuanbao/index', exportKey: 'yuanbaoChannelPlugin' },
    { type: 'whatsapp', name: 'WhatsApp', importPath: '../../../channels/whatsapp/index', exportKey: 'whatsAppChannelPlugin' },
    { type: 'signal', name: 'Signal', importPath: '../../../channels/signal/index', exportKey: 'signalChannelPlugin' },
    { type: 'matrix', name: 'Matrix', importPath: '../../../channels/matrix/index', exportKey: 'matrixChannelPlugin' },
    { type: 'facebook', name: 'Facebook Messenger', importPath: '../../../channels/facebookmessenger/index', exportKey: 'facebookMessengerChannelPlugin' },
    { type: 'twitter', name: 'Twitter/X', importPath: '../../../channels/twitter/index', exportKey: 'twitterChannelPlugin' },
    { type: 'claude', name: 'Claude', importPath: '../../../channels/claude/index', exportKey: 'claudeChannelPlugin' },
    { type: 'mattermost', name: 'Mattermost', importPath: '../../../channels/mattermost/MattermostChannel', exportKey: 'mattermostChannel' },
    { type: 'bluebubbles', name: 'iMessage', importPath: '../../../channels/bluebubbles/BlueBubblesChannel', exportKey: 'bluebubblesChannelPlugin' },
  ];

  /** CHANNEL_TABLE 的快速索引 */
  private static getChannelEntry(type: string) {
    return LocalHTTPService.CHANNEL_TABLE.find((e) => e.type === type);
  }

  /**
   * 尝试动态注册未注册的通道（前端提供凭据时自动注册）
   * 覆盖全部 26 个通道，通过 CHANNEL_TABLE 表驱动
   */
  private async tryDynamicRegister(
    channelType: string,
    config?: Record<string, unknown>
  ): Promise<boolean> {
    const entry = LocalHTTPService.getChannelEntry(channelType);
    if (!entry) return false;

    try {
      // 动态导入插件模块
      const mod = await import(entry.importPath);
      const plugin = (mod as Record<string, unknown>)[entry.exportKey] as IChannelPlugin | undefined;
      if (!plugin) {
        logger.warning(`tryDynamicRegister: 未找到插件导出 — ${channelType}/${entry.exportKey}`);
        return false;
      }

      // 1. 注册到 ChannelRegistry
      const { channelRegistry } = await import(
        '@modules/channels/registry/ChannelRegistry'
      );
      const { adaptPluginToInterface } = await import(
        '@modules/channels/registry/ChannelRegistry'
      );
      channelRegistry.register(adaptPluginToInterface(plugin));

      // 2. 注册到 ChannelBootstrapper
      const { channelBootstrapper } = await import(
        '../../channels/bootstrap/ChannelBootstrapper'
      );
      channelBootstrapper.registerPluginChannel(channelType, () => plugin);

      // 3. 写入配置（合并前端传入的凭据）
      channelRegistry.updateConfig(channelType, {
        name: entry.name,
        enabled: false,
        options: {
          ...(channelRegistry.getConfig(channelType)?.options || {}),
          ...(config || {}),
        },
      });

      // 4. 绑定入站消息处理器
      this.bindChannelMessageHandler(channelType, plugin);

      return true;
    } catch (err) {
      logger.error(`tryDynamicRegister(${channelType}) 失败`, {
        error: String(err),
      });
      return false;
    }
  }

  /** 绑定入站消息 → AI → 出站 回路 */
  private bindChannelMessageHandler(
    channelType: string,
    plugin: IChannelPlugin
  ): void {
    if (!plugin.inbound) return;

    const _processingMessages = new Set<string>();

    plugin.inbound.setMessageHandler(
      async (message: import('@modules/channels/types').MessageContext) => {
        if (_processingMessages.has(message.messageId)) return;
        _processingMessages.add(message.messageId);

        try {
          const sender =
            message.senderName || message.senderId || 'unknown';
          const label = channelType.toUpperCase();
          console.log(`\n── [${label}] ${sender} ──`);
          console.log(message.content);

          const coreAPI = getCoreAPI();
          const response = await coreAPI.chat({
            content: message.content,
            sessionId: message.conversationId ?? message.senderId,
            metadata: {
              channel: message.channelId,
              sender: message.senderId,
              messageType: message.messageType,
              isDirectMessage: message.isDirectMessage,
              rawPayload: message.rawPayload,
            },
          });

          if (response.content && plugin.outbound) {
            console.log(`\n── [${label}] Liri ──`);
            console.log(response.content);
            console.log('');

            await plugin.outbound.sendText(
              message.conversationId ?? message.senderId,
              response.content
            );
          }
        } catch (error) {
          logger.error(`[${channelType}] 入站消息处理失败`, {
            messageId: message.messageId,
            error: String(error),
          });
        } finally {
          setTimeout(() => {
            _processingMessages.delete(message.messageId);
          }, 3000);
        }
      }
    );
    logger.info(`[${channelType}] 入站消息处理器已绑定`);
  }

  // ========== Channel Plugin Handlers ==========

  /**
   * 列出已安装的渠道插件
   */
  private async handleListChannelPlugins(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { NpmDistributor } =
        await import('@modules/plugins/distribution/NpmDistributor');
      const distributor = new NpmDistributor();
      const installed = await distributor.listInstalled();

      const result = installed.map((p) => ({
        name: p.name,
        version: p.version,
        installed: true,
        installedAt: p.installedAt,
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 安装渠道插件（通过 npm）
   */
  private async handleInstallChannelPlugin(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const packageName = parsed.package as string | undefined;

      if (!packageName || typeof packageName !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: '"package" field is required' } })
        );
        return;
      }

      const { NpmDistributor } =
        await import('@modules/plugins/distribution/NpmDistributor');
      const distributor = new NpmDistributor();
      const result = await distributor.install(packageName);

      if (result.success) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            name: result.name,
            version: result.version,
            path: result.path,
          })
        );
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            error: result.error || 'Install failed',
          })
        );
      }
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== Auth Handlers ==========

  private users: Map<string, { username: string; password: string }> =
    new Map();
  private tokens: Map<string, { username: string; permissions: string[] }> =
    new Map();

  private async handleAuthLogin(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { username, password } = JSON.parse(body);

      if (!username || !password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'username and password are required' },
          })
        );
        return;
      }

      const user = this.users.get(username);
      if (!user || user.password !== password) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'Invalid username or password' },
          })
        );
        return;
      }

      const token = `token_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      this.tokens.set(token, {
        username,
        permissions: ['read', 'write'],
      });

      const now = Date.now();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          token,
          user: {
            id: `user_${now}`,
            username,
            email: '',
            role: 'user',
            trustLevel: 2,
            created_at: now,
          },
          expires_at: now + 86400000,
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleAuthRegister(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { username, password } = JSON.parse(body);

      if (!username || !password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'username and password are required' },
          })
        );
        return;
      }

      if (this.users.has(username)) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'Username already exists' },
          })
        );
        return;
      }

      this.users.set(username, { username, password });
      const token = `token_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      this.tokens.set(token, {
        username,
        permissions: ['read', 'write'],
      });

      const now = Date.now();
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          token,
          user: {
            id: `user_${now}`,
            username,
            email: '',
            role: 'user',
            trustLevel: 2,
            created_at: now,
          },
          expires_at: now + 86400000,
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleAuthLogout(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const authHeader = req.headers['authorization'] || '';
      const token = authHeader.replace('Bearer ', '');

      if (token) {
        this.tokens.delete(token);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({}));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleAuthMe(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const authHeader = req.headers['authorization'] || '';
      const token = authHeader.replace('Bearer ', '');

      const session = this.tokens.get(token);
      if (!session) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Not authenticated' } }));
        return;
      }

      const now = Date.now();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: `user_${now}`,
          username: session.username,
          email: '',
          role: 'user',
          trustLevel: 2,
          created_at: now,
          permissions: session.permissions,
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleAuthPermissions(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const authHeader = req.headers['authorization'] || '';
      const token = authHeader.replace('Bearer ', '');

      const session = this.tokens.get(token);
      if (!session) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Not authenticated' } }));
        return;
      }

      const permissionList = session.permissions.map((p: string) => ({
        scope: p === 'read' ? 'read' : p === 'write' ? 'write' : 'admin',
        description:
          p === 'read' ? '读取权限' : p === 'write' ? '写入权限' : '管理权限',
        level: p as 'none' | 'read' | 'write' | 'admin',
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(permissionList));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== API Key Handlers ==========

  private apiKeys: Map<
    string,
    { name: string; key: string; createdAt: number }
  > = new Map();

  private async handleListApiKeys(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const apiKeyList = Array.from(this.apiKeys.entries()).map(
        ([id, data]) => ({
          id,
          name: data.name,
          key_prefix: data.key.substring(0, 8),
          created_at: data.createdAt,
          permissions: ['read'],
        })
      );

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(apiKeyList));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleCreateApiKey(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { name } = JSON.parse(body);

      if (!name) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'name is required' } }));
        return;
      }

      const id = `key_${Date.now()}`;
      const key = `sk-${Math.random().toString(36).substr(2, 32)}`;

      this.apiKeys.set(id, { name, key, createdAt: Date.now() });

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id,
          name,
          key,
          key_prefix: key.substring(0, 8),
          created_at: Date.now(),
          permissions: ['read'],
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleDeleteApiKey(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    keyId: string
  ): Promise<void> {
    try {
      if (!this.apiKeys.has(keyId)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'API key not found' } }));
        return;
      }

      this.apiKeys.delete(keyId);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({}));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== Memory Handlers ==========

  private memoryManagerInstance:
    | import('@modules/memory/MemoryManager').MemoryManagerImpl
    | null = null;

  private async getMemoryManager(): Promise<
    import('@modules/memory/MemoryManager').MemoryManagerImpl
  > {
    if (!this.memoryManagerInstance) {
      const { MemoryManagerImpl } =
        await import('@modules/memory/MemoryManager');
      this.memoryManagerInstance = new MemoryManagerImpl();
    }
    return this.memoryManagerInstance;
  }

  private async handleListMemories(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const mm = await this.getMemoryManager();
      const memories = await mm.getAllMemories();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, memories }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleSearchMemories(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const parsedUrl = new URL(
        req.url!,
        `http://${req.headers.host || 'localhost'}`
      );
      const query = parsedUrl.searchParams.get('query') || '';
      if (!query) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'query is required' } }));
        return;
      }

      const mm = await this.getMemoryManager();
      const memories = await mm.getRelevantMemories(query);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, memories }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleGetMemory(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    memoryId: string
  ): Promise<void> {
    try {
      const mm = await this.getMemoryManager();
      const memory = await mm.getMemory(memoryId);

      if (!memory) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Memory not found' } }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, memory }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleCreateMemory(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const params = JSON.parse(body);

      if (!params.content) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'content is required' } }));
        return;
      }

      const mm = await this.getMemoryManager();
      const memory = await mm.createMemory({
        content: params.content,
        metadata: {
          name: params.name || '',
          description: params.description || '',
          type: params.type || 'note',
          tags: params.tags || [],
          ...(params.metadata || {}),
        },
      });

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, memory }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理从文件创建记忆请求
   * POST /v1/memory/create-from-file
   * 读取文件内容，将其存入记忆系统
   */
  private async handleCreateMemoryFromFile(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { filePath, name, tags } = JSON.parse(body);

      if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'filePath is required' } }));
        return;
      }

      // 沙箱权限检查
      if (!this.checkFilePathPermission(filePath, SandboxPermission.READ_FILE)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Access denied: file path not in whitelist' } }));
        return;
      }

      const { readFile } = await import('node:fs/promises');
      const { existsSync } = await import('node:fs');
      const { basename } = await import('node:path');

      if (!existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'File not found' } }));
        return;
      }

      const content = await readFile(filePath, 'utf-8');
      const fileName = basename(filePath);

      const mm = await this.getMemoryManager();
      const now = new Date();
      const memory = await mm.createMemory({
        content,
        metadata: {
          name: name || fileName,
          description: `从文件 ${fileName} 导入`,
          type: 'knowledge',
          createdAt: now,
          updatedAt: now,
          tags: tags || ['file-import'],
          source: filePath,
        },
      });

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, memory, fileName }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleUpdateMemory(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    memoryId: string
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const updates = JSON.parse(body);

      const mm = await this.getMemoryManager();
      const memory = await mm.updateMemory(memoryId, updates);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, memory }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleDeleteMemory(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    memoryId: string
  ): Promise<void> {
    try {
      const mm = await this.getMemoryManager();
      await mm.deleteMemory(memoryId);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleDeleteAllMemories(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const mm = await this.getMemoryManager();
      const count = await mm.deleteAllMemories();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, deletedCount: count }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleGetMemorySummary(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    memoryId: string
  ): Promise<void> {
    try {
      const mm = await this.getMemoryManager();
      const memory = await mm.getMemory(memoryId);

      if (!memory) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Memory not found' } }));
        return;
      }

      const summary = {
        id: memory.id,
        contentPreview:
          memory.content.length > 200
            ? memory.content.slice(0, 200) + '...'
            : memory.content,
        type: memory.metadata.type || 'unknown',
        tags: memory.metadata.tags || [],
        createdAt: memory.createdAt,
        updatedAt: memory.updatedAt,
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, summary }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleGetMemoryWeights(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          weights: { semantic: 0.4, recency: 0.3, frequency: 0.3 },
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleGetSyncStatus(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          status: {
            lastSync: null,
            pendingSync: [],
            failedSync: [],
            syncCount: 0,
          },
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleSyncMemories(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          message: 'Sync not yet implemented',
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  private async handleConsolidateMemories(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          message: 'Consolidation not yet implemented',
        })
      );
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 处理文件打开请求
   * GET /api/file/open?path=<encoded_path>
   * 在 Tauri WebView 中点击文件链接时调用，通过 child_process 在系统默认程序中打开文件
   */
  private async handleFileOpen(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const parsedUrl = new URL(
        req.url!,
        `http://${req.headers.host || 'localhost'}`
      );
      const filePath = parsedUrl.searchParams.get('path');

      if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Missing path parameter' } })
        );
        return;
      }

      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execAsync = promisify(exec);

      if (process.platform === 'win32') {
        await execAsync(`start "" "${filePath}"`);
      } else if (process.platform === 'darwin') {
        await execAsync(`open "${filePath}"`);
      } else {
        await execAsync(`xdg-open "${filePath}"`);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('打开文件失败', { path: req.url, error: message });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: `Failed to open file: ${message}` },
        })
      );
    }
  }

  /**
   * 处理文件读取请求
   * GET /api/file/read?path=<encoded_path>
   * 读取文件内容并返回，支持代码/Markdown/JSON/图片等类型
   */
  private async handleFileRead(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const parsedUrl = new URL(
        req.url!,
        `http://${req.headers.host || 'localhost'}`
      );
      const filePath = parsedUrl.searchParams.get('path');

      if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Missing path parameter' } })
        );
        return;
      }

      // 检查文件是否存在
      if (!fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: `File not found: ${filePath}` } })
        );
        return;
      }

      const stats = fs.statSync(filePath);
      const size = stats.size;

      // 判断文件 MIME 类型
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.webp': 'image/webp',
        '.ico': 'image/x-icon',
        '.bmp': 'image/bmp',
      };

      // 图片文件：返回 base64
      if (mimeTypes[ext]) {
        const imageBuffer = fs.readFileSync(filePath);
        const base64 = imageBuffer.toString('base64');
        const dataUri = `data:${mimeTypes[ext]};base64,${base64}`;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            content: dataUri,
            type: 'image',
            size,
            language: undefined,
          })
        );
        return;
      }

      // 不支持预览的二进制文件
      const binaryExts = [
        '.exe',
        '.zip',
        '.rar',
        '.7z',
        '.gz',
        '.tar',
        '.dll',
        '.so',
        '.dylib',
        '.bin',
        '.dat',
        '.wasm',
        '.pdf',
      ];
      if (binaryExts.includes(ext)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            content: `不支持预览该文件类型 (${ext})`,
            type: 'text',
            size,
            language: undefined,
          })
        );
        return;
      }

      // 文本文件：读取内容
      const maxPreviewSize = 1 * 1024 * 1024; // 1MB
      let content: string;
      if (size > maxPreviewSize) {
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(maxPreviewSize);
        fs.readSync(fd, buffer, 0, maxPreviewSize, 0);
        fs.closeSync(fd);
        content =
          buffer.toString('utf-8') + '\n\n... 文件过大，仅显示前 1MB 内容';
      } else {
        content = fs.readFileSync(filePath, 'utf-8');
      }

      // 根据扩展名判断类型和语言
      const typeMap: Record<string, { type: string; language?: string }> = {
        '.ts': { type: 'code', language: 'typescript' },
        '.tsx': { type: 'code', language: 'tsx' },
        '.js': { type: 'code', language: 'javascript' },
        '.jsx': { type: 'code', language: 'jsx' },
        '.py': { type: 'code', language: 'python' },
        '.rs': { type: 'code', language: 'rust' },
        '.go': { type: 'code', language: 'go' },
        '.java': { type: 'code', language: 'java' },
        '.c': { type: 'code', language: 'c' },
        '.cpp': { type: 'code', language: 'cpp' },
        '.h': { type: 'code', language: 'c' },
        '.hpp': { type: 'code', language: 'cpp' },
        '.css': { type: 'code', language: 'css' },
        '.scss': { type: 'code', language: 'scss' },
        '.html': { type: 'code', language: 'html' },
        '.xml': { type: 'code', language: 'xml' },
        '.yaml': { type: 'yaml', language: 'yaml' },
        '.yml': { type: 'yaml', language: 'yaml' },
        '.toml': { type: 'yaml', language: 'toml' },
        '.json': { type: 'json', language: 'json' },
        '.md': { type: 'markdown', language: 'markdown' },
        '.mdx': { type: 'markdown', language: 'mdx' },
        '.txt': { type: 'text', language: undefined },
        '.log': { type: 'text', language: undefined },
        '.csv': { type: 'text', language: undefined },
        '.env': { type: 'text', language: undefined },
        '.sql': { type: 'code', language: 'sql' },
        '.sh': { type: 'code', language: 'bash' },
        '.bash': { type: 'code', language: 'bash' },
        '.zsh': { type: 'code', language: 'bash' },
        '.ps1': { type: 'code', language: 'powershell' },
        '.bat': { type: 'code', language: 'batch' },
        '.cmd': { type: 'code', language: 'batch' },
        '.rb': { type: 'code', language: 'ruby' },
        '.php': { type: 'code', language: 'php' },
        '.swift': { type: 'code', language: 'swift' },
        '.kt': { type: 'code', language: 'kotlin' },
        '.scala': { type: 'code', language: 'scala' },
        '.r': { type: 'code', language: 'r' },
        '.lua': { type: 'code', language: 'lua' },
        '.dart': { type: 'code', language: 'dart' },
        '.vue': { type: 'code', language: 'vue' },
        '.svelte': { type: 'code', language: 'svelte' },
        '.astro': { type: 'code', language: 'astro' },
        '.graphql': { type: 'code', language: 'graphql' },
        '.prisma': { type: 'code', language: 'prisma' },
        '.tf': { type: 'code', language: 'hcl' },
        '.dockerfile': { type: 'code', language: 'dockerfile' },
        '.makefile': { type: 'code', language: 'makefile' },
      };

      const fileInfo = typeMap[ext] || { type: 'text', language: undefined };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          content,
          type: fileInfo.type,
          size,
          language: fileInfo.language,
        })
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('读取文件失败', { path: req.url, error: message });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: `Failed to read file: ${message}` },
        })
      );
    }
  }

  /**
   * 处理获取基础路径请求
   * GET /api/file/paths
   * 返回所有已知的基础目录路径，供前端解析不完整的文件路径使用
   */
  private async handleFilePaths(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const {
      resolveProjectRoot,
      resolvePyappHome,
      resolveOutputDir,
      resolveDownloadsDir,
      resolveDataDir,
      resolveDocsDir,
    } = await import('@modules/core/paths');
    const projectRoot = resolveProjectRoot();
    const basePaths = {
      projectRoot,
      pyappHome: resolvePyappHome(),
      outputDir: resolveOutputDir(),
      downloadsDir: resolveDownloadsDir(),
      dataDir: resolveDataDir(),
      docsDir: resolveDocsDir(),
      appDir: path.join(projectRoot, 'app'),
      clientDir: path.join(projectRoot, 'client'),
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(basePaths));
  }

  /**
   * 处理文件路径解析请求
   * GET /api/file/resolve-path?path=<encoded_path>
   * 将可能不完整的文件路径解析为完整的绝对路径
   * 如果路径已存在，直接返回；否则依次在各基础目录下尝试查找
   */
  private async handleFileResolvePath(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const parsedUrl = new URL(
        req.url!,
        `http://${req.headers.host || 'localhost'}`
      );
      const rawPath = parsedUrl.searchParams.get('path');

      if (!rawPath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Missing path parameter' } })
        );
        return;
      }

      const {
        resolveProjectRoot,
        resolvePyappHome,
        resolveOutputDir,
        resolveDownloadsDir,
        resolveDataDir,
        resolveDocsDir,
      } = await import('@modules/core/paths');

      if (path.isAbsolute(rawPath)) {
        if (fs.existsSync(rawPath)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ resolvedPath: rawPath, exists: true }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ resolvedPath: rawPath, exists: false }));
        return;
      }

      if (rawPath.startsWith('~')) {
        const pyappHome = resolvePyappHome();
        const withoutTilde = rawPath.replace(/^~[/\\]?/, '');
        const fullPath = path.join(pyappHome, withoutTilde);
        if (fs.existsSync(fullPath)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ resolvedPath: fullPath, exists: true }));
          return;
        }
      }

      const projectRoot = resolveProjectRoot();
      const baseDirs = [
        projectRoot,
        resolvePyappHome(),
        resolveOutputDir(),
        resolveDownloadsDir(),
        resolveDataDir(),
        resolveDocsDir(),
        path.join(projectRoot, 'app'),
        path.join(projectRoot, 'client'),
      ];

      for (const baseDir of baseDirs) {
        const candidate = path.join(baseDir, rawPath);
        if (fs.existsSync(candidate)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ resolvedPath: candidate, exists: true }));
          return;
        }
      }

      const guessedPath = path.join(projectRoot, rawPath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ resolvedPath: guessedPath, exists: false }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('解析文件路径失败', { path: req.url, error: message });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: `Failed to resolve path: ${message}` },
        })
      );
    }
  }

  /**
   * 处理文件预览转换请求
   * GET /api/file/preview?path=<encoded_path>
   * 对 Office 文件（pdf/docx/pptx）自动转换为 Markdown 后返回，
   * 非 Office 文件降级为纯文本预览（用于前端在转换失败时的兜底展示）
   */
  private async handleFilePreview(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const parsedUrl = new URL(
        req.url!,
        `http://${req.headers.host || 'localhost'}`
      );
      const filePath = parsedUrl.searchParams.get('path');

      if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Missing path parameter' } })
        );
        return;
      }

      if (!fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: `File not found: ${filePath}` } })
        );
        return;
      }

      const stats = fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase();

      // Office 文件扩展名：使用 ConverterEngine 转为 Markdown
      const officeExts = ['.pdf', '.docx', '.pptx'];

      if (officeExts.includes(ext)) {
        const coreAPI = getCoreAPI();
        const result = await coreAPI.convertFile({ filePath });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            content: result.markdown,
            type: 'markdown',
            size: stats.size,
            language: 'markdown',
            title: result.title,
          })
        );
        return;
      }

      // 非 Office 文件：读取纯文本内容降级预览
      const content = fs.readFileSync(filePath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          content,
          type: 'text',
          size: stats.size,
        })
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('文件预览转换失败', { path: req.url, error: message });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: `Failed to preview file: ${message}` },
        })
      );
    }
  }

  // ========== Checkpoint Handlers ==========

  /**
   * 创建检查点 POST /v1/checkpoints
   * { sessionId, label }
   */
  private async handleCreateCheckpoint(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { sessionId, label } = JSON.parse(body);
      const chatManager = createChatManager();
      const cpId = await chatManager.createCheckpoint(sessionId, label);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: cpId, sessionId, label }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 列出检查点 GET /v1/checkpoints?sessionId=...
   */
  private async handleListCheckpoints(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const urlObj = new URL(req.url!, `http://${req.headers.host}`);
      const sessionId = urlObj.searchParams.get('sessionId') || '';
      const chatManager = createChatManager();
      const checkpoints = await chatManager.listCheckpoints(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(checkpoints));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 获取检查点详情 GET /v1/checkpoints/:id
   */
  private async handleGetCheckpoint(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    cpId: string
  ): Promise<void> {
    try {
      const chatManager = createChatManager();
      const allCheckpoints = await chatManager.listCheckpoints('');
      let checkpoint = allCheckpoints.find((cp) => cp.id === cpId);
      if (!checkpoint) {
        const cp = await (chatManager as any).getCheckpoint?.(cpId);
        if (cp) checkpoint = cp;
      }
      if (!checkpoint) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Checkpoint not found' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(checkpoint));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 回滚到检查点 POST /v1/checkpoints/:id/rollback
   */
  private async handleRollbackCheckpoint(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    cpId: string
  ): Promise<void> {
    try {
      const chatManager = createChatManager();
      await chatManager.rollbackToCheckpoint(cpId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, checkpointId: cpId }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 删除检查点 DELETE /v1/checkpoints/:id
   */
  private async handleDeleteCheckpoint(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    cpId: string
  ): Promise<void> {
    try {
      const chatManager = createChatManager();
      await chatManager.deleteCheckpoint(cpId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, checkpointId: cpId }));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // ========== Semantic Index Handlers ==========

  /**
   * 构建语义索引 POST /v1/semantic/index
   */
  private async handleBuildSemanticIndex(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readRequestBody(req);
      const { rootDir, incremental = true } = JSON.parse(body);
      const { IndexBuilder } = await import('@modules/knowledge/semantic/builder');
      const builder = new IndexBuilder();
      const result = await builder.build({
        rootDir,
        incremental,
        embedOptions: { provider: 'ollama' },
        onProgress: (phase, done, total) => {
          logger.info(`Semantic index building: ${phase} ${done}/${total}`);
        },
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 语义搜索 GET /v1/semantic/search?q=...&topK=10
   */
  private async handleSearchSemantic(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const urlObj = new URL(req.url!, `http://${req.headers.host}`);
      const query = urlObj.searchParams.get('q');
      const topK = parseInt(urlObj.searchParams.get('topK') || '10', 10);
      const minScore = parseFloat(urlObj.searchParams.get('minScore') || '0.3');

      if (!query) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'q parameter is required' } }));
        return;
      }

      const { SemanticStore } = await import('@modules/knowledge/semantic/store');
      const { embed } = await import('@modules/knowledge/semantic/embedding');
      const { resolveDataSubDir } = await import('@modules/core/paths');
      const store = new SemanticStore(
        resolveDataSubDir('semantic-index'),
        { provider: 'ollama', model: 'all-minilm' }
      );
      await store.load();

      const embedding = await embed(query, { provider: 'ollama' });
      const hits = store.search(embedding, topK, minScore);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(hits));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 获取索引状态 GET /v1/semantic/index/status
   */
  private async handleGetSemanticIndexStatus(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { SemanticStore, readIndexMeta } = await import('@modules/knowledge/semantic/store');
      const { resolveDataSubDir } = await import('@modules/core/paths');
      const store = new SemanticStore(
        resolveDataSubDir('semantic-index'),
        { provider: 'ollama', model: 'all-minilm' }
      );
      await store.load();

      const meta = await readIndexMeta(resolveDataSubDir('semantic-index'));
      const status = {
        entryCount: store.size,
        indexExists: meta !== null,
        meta,
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
    } catch (err) {
      this.sendError(res, err);
    }
  }

  /**
   * 清除语义索引 DELETE /v1/semantic/index
   */
  private async handleClearSemanticIndex(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const { wipeStoreFiles } = await import('@modules/knowledge/semantic/store');
      const { resolveDataSubDir } = await import('@modules/core/paths');
      await wipeStoreFiles(resolveDataSubDir('semantic-index'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      this.sendError(res, err);
    }
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

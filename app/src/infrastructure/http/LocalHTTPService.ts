/**
 * LocalHTTPService 本地 HTTP API 服务
 * 提供 OpenAI 兼容的 API 接口，允许 Tauri 客户端通过 HTTP 调用 CoreAPI
 *
 * 注意：本文件位于 core/gateway/local/（遗留 Gateway 体系目录），
 * 但实际消费 channels/ 目录下的 IChannelPlugin 接口。
 * 此位置具有误导性，后续应考虑迁移至 modules/ 下的合适位置。
 */
import http from 'http';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type { ServerResponse } from 'http';
import { costTracker } from '@modules/cost/CostTracker';
import { getCostRecordRepository } from '@modules/cost/CostRecordRepository';
import { analyticsService } from '@modules/analytics/AnalyticsService';
import { PerformanceMonitorService } from '@modules/analytics/PerformanceMonitorService';
import { configManager } from '@modules/config';
// 3.4/P1-1：流式 STT WebSocket 端点（前端按住说话实时字幕 + 统一转录链路）
import { upgradeSTTStreamConnection } from '../../voice/STTStreamServer';
import { setAnalyticsDependencies } from './handlers/analytics-handlers';
import { setupInfrastructureDiagnostics } from '@modules/diagnostics/infrastructure-diagnostics';
import { HandlerCtx, createHandlerCtx } from './handlers/handler-utils';
import { SandboxPermission } from '@modules/sandbox/SandboxTypes';
import { dispatchRoute } from './handlers/route-table';
import {
  verifyRequestAuth,
  seedKnowledgeBaseIfEmpty,
  startCompileScheduler,
} from './LocalHTTPServiceHelpers';
import { broadcastEvent, stopSSE } from './LocalHTTPServiceSSE';

const logger = getLogger('http:local');

/**
 * LocalHTTPService 配置
 */
export interface LocalHTTPConfig {
  host: string;
  port: number;
}

/**
 * LocalHTTPService 类
 * 提供本地 HTTP API 服务，对接 CoreAPI
 */
export class LocalHTTPService {
  private server: http.Server | null = null;
  private config: LocalHTTPConfig;
  private _isRunning = false;
  /** 应用是否已完全就绪（launch 完成前前端请求返回 503） */
  static _appReady = false;
  private readonly apiSecret: string;
  private compileScheduler: unknown = null;
  /** handler 上下文（提供 sendError, readRequestBody, broadcastEvent 等） */
  private readonly _handlerCtx: HandlerCtx = createHandlerCtx();

  constructor(config: LocalHTTPConfig) {
    this.config = config;
    setAnalyticsDependencies(
      analyticsService,
      costTracker,
      getCostRecordRepository(),
      PerformanceMonitorService
    );
    setupInfrastructureDiagnostics();
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
   * 委托给 LocalHTTPServiceHelpers.verifyRequestAuth
   */
  private verifyRequestAuth(req: http.IncomingMessage): boolean {
    return verifyRequestAuth(req, this.apiSecret);
  }

  /**
   * 种子知识库：委托给 LocalHTTPServiceHelpers.seedKnowledgeBaseIfEmpty
   */
  private async seedKnowledgeBaseIfEmpty(): Promise<void> {
    return seedKnowledgeBaseIfEmpty();
  }

  /**
   * 启动编译调度器
   * 委托给 LocalHTTPServiceHelpers.startCompileScheduler
   */
  private async startCompileScheduler(): Promise<void> {
    this.compileScheduler = await startCompileScheduler();
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
        void handleError(err, {
          module: 'infra:http',
          action: 'handle_request',
        });
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ error: { message: 'Internal server error' } })
          );
        }
      });
    });

    // 配置长连接超时，支持 SSE 流式请求
    // server.timeout: 0 表示禁用请求超时（SSE 流式请求可能持续很长时间）
    // keepAliveTimeout: 服务器在发送最后一个响应后等待更多数据的时间
    // headersTimeout: 服务器等待客户端发送完整请求头的时间
    this.server.timeout = 0; // 禁用请求超时，支持长时间 SSE 流
    this.server.keepAliveTimeout = 60000 * 5; // 5分钟
    this.server.headersTimeout = 60000 * 6; // 6分钟（必须大于 keepAliveTimeout）

    // 3.4/P1-1：流式 STT WebSocket 升级分发（/v1/voice/stt）
    this.server.on('upgrade', (req, socket, head) => {
      try {
        const url = (req.url ?? '').split('?')[0];
        if (url !== '/v1/voice/stt') {
          socket.destroy();
          return;
        }

        // 将 upgrade 首包放回 socket 缓冲，保证首个 WS 帧不丢失
        if (head && head.length > 0) {
          socket.unshift(head);
        }

        // upgradeToVoiceConnection 需要 ServerResponse 形态对象（res.writeHead/res.socket）
        const fakeRes = {
          writeHead: () => socket,
          end: () => socket,
          socket,
        } as unknown as ServerResponse;

        upgradeSTTStreamConnection(req, fakeRes);
      } catch (err) {
        void handleError(err, {
          module: 'infra:http',
          action: 'upgrade_stt_stream',
        });
        socket.destroy();
      }
    });

    // P3-2: 超时事件监听 — 审计用。虽 server.timeout=0，但 socket 层仍可能触发
    this.server.on('timeout', (socket) => {
      logger.warn('HTTP socket 超时事件触发', {
        remoteAddress: socket.remoteAddress,
        remotePort: socket.remotePort,
        localPort: (socket as unknown as { localPort?: number }).localPort,
      });
      // 不销毁 socket — timeout=0 时不应用，但监听可防止默认销毁行为
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        this._isRunning = true;
        logger.info(
          `LocalHTTPService 已启动: http://${this.config.host}:${this.config.port}`
        );
        // 异步初始化知识库种子，不阻塞启动
        this.seedKnowledgeBaseIfEmpty().catch(
          (err) =>
            void handleError(err, {
              module: 'infrastructure:http:local',
              action: 'seedKnowledge',
            })
        );
        this.startCompileScheduler().catch(
          (err) =>
            void handleError(err, {
              module: 'infrastructure:http:local',
              action: 'startCompileScheduler',
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
      (this.compileScheduler as { stop(): void }).stop();
      this.compileScheduler = null;
    }
    stopSSE();
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
    // S2-5：CORS 收紧 —— 仅放行 localhost / 127.0.0.1 任意端口（含 Tauri dev 5173/1420）；
    // 无 Origin（Tauri 原生/非浏览器）保持 * 兼容
    const origin = req.headers.origin;
    if (origin) {
      try {
        const { hostname } = new URL(origin);
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
          res.setHeader('Access-Control-Allow-Origin', origin);
        }
      } catch {
        // 非法 Origin：不设置 CORS 头（浏览器将拦截跨域）
      }
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, PATCH, DELETE, OPTIONS'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, x-api-key, traceparent, tracestate'
    );

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // M1 修复（2026-08-13）：SSE 端点加入鉴权白名单——EventSource 无法携带
    // 自定义 header（X-API-Key/Bearer 都带不上），配置 LIRI_API_SECRET 时
    // /v1/events 恒 401 → SSE 无限重连、实时推送与心跳保活全失效。
    // SSE 仅推送只读会话事件（无敏感写操作），单机桌面场景白名单风险可接受。
    const isSseEndpoint = (req.url?.split('?')[0] || '') === '/v1/events';

    // 共享密钥校验：确保请求来自被授权的 Tauri 客户端；
    // 兼容登录会话：携带有效 Bearer 登录 token 的请求同样放行（M0d）
    if (!isSseEndpoint && !this.verifyRequestAuth(req)) {
      const authHeader = req.headers['authorization'] || '';
      const sessionToken = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : '';
      let validSession = false;
      if (sessionToken) {
        const { authTokens } = await import('./handlers/auth-handlers');
        validSession = authTokens.has(sessionToken);
      }
      if (!validSession) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Unauthorized' } }));
        return;
      }
    }

    const url = req.url?.split('?')[0] || '';

    // 应用尚未完全就绪时，对业务请求返回 503
    if (!LocalHTTPService._appReady && url !== '/v1/health/report') {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Service starting, please retry' } })
      );
      return;
    }

    logger.debug('收到请求', {
      method: req.method,
      url: req.url,
      parsedUrl: url,
    });

    // ---- 所有路由逻辑已提取至 route-table.ts 的 dispatchRoute ----
    // ---- 路由调度（匹配 method + URL 到对应 handler）----
    const matched = await dispatchRoute(
      req,
      res,
      url,
      (event: string, data: unknown) =>
        this.broadcastEvent(event, data as Record<string, unknown>),
      this._handlerCtx
    );
    if (matched) return;

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

  // ---- FAQ Handlers ----

  // ========== Router（智能路由）==========

  /**
   * 广播事件到所有 SSE 客户端 — 委托给 LocalHTTPServiceSSE.broadcastEvent
   * （J-1.6 修复：统一走 LocalHTTPServiceSSE 的 clients 集合，与前端 EventSource 同集合）
   */
  private broadcastEvent(event: string, data: Record<string, unknown>): void {
    // 排查 SSE 送达：记录业务事件广播（inbox:new/inbox:update 等），确认与前端订阅同集合
    logger.info('broadcastEvent: 广播 SSE 事件', {
      event,
      sessionId: (data as { sessionId?: string }).sessionId,
      hasData: !!data && Object.keys(data).length > 0,
    });
    return broadcastEvent(event, data);
  }

  /**
   * 发送错误响应 — 委托给 handler-utils
   */
  private sendError(
    res: http.ServerResponse,
    err: unknown,
    status = 500
  ): void {
    return this._handlerCtx.sendError(res, err, status);
  }

  /**
   * 检查文件路径是否在允许的白名单范围内 — 委托给 handler-utils
   */
  private checkFilePathPermission(
    filePath: string,
    permission: SandboxPermission
  ): boolean {
    return this._handlerCtx.checkFilePathPermission(filePath, permission);
  }

  /**
   * 读取请求体 — 委托给 handler-utils
   */
  private readRequestBody(req: http.IncomingMessage): Promise<string> {
    return this._handlerCtx.readRequestBody(req);
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

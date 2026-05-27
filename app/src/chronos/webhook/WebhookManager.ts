/**
 * WebhookManager Webhook 触发器
 * 对标 OpenClaw chronos/webhook/，通过 HTTP 调用触发任务
 * 使用系统自带的 http/https 模块
 */
import http from 'node:http';
import https from 'node:https';
import url from 'node:url';
import { EventEmitter } from 'node:events';

/**
 * Webhook 配置
 */
export interface WebhookConfig {
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  retryCount: number;
  retryDelayMs: number;
}

/**
 * Webhook 执行结果
 */
export interface WebhookResult {
  success: boolean;
  statusCode?: number;
  responseBody?: string;
  durationMs: number;
  error?: string;
  attempts: number;
}

/**
 * Webhook 事件
 */
export interface WebhookEvent {
  type: 'webhook:before' | 'webhook:after' | 'webhook:error' | 'webhook:retry';
  timestamp: number;
  config: WebhookConfig;
  result?: WebhookResult;
}

/**
 * Webhook 管理器
 */
export class WebhookManager extends EventEmitter {
  /**
   * 执行 Webhook 调用
   */
  async execute(config: WebhookConfig): Promise<WebhookResult> {
    const beforeEvent: WebhookEvent = {
      type: 'webhook:before',
      timestamp: Date.now(),
      config,
    };

    this.emit('webhook:before', beforeEvent);

    let lastError: string | undefined;
    let lastStatusCode: number | undefined;
    let lastResponseBody: string | undefined;

    const maxAttempts = Math.max(1, config.retryCount + 1);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const startTime = Date.now();

      try {
        const result = await this.sendRequest(config);

        lastStatusCode = result.statusCode;
        lastResponseBody = result.body;

        if (result.statusCode >= 200 && result.statusCode < 300) {
          const webhookResult: WebhookResult = {
            success: true,
            statusCode: result.statusCode,
            responseBody: result.body,
            durationMs: Date.now() - startTime,
            attempts: attempt,
          };

          const afterEvent: WebhookEvent = {
            type: 'webhook:after',
            timestamp: Date.now(),
            config,
            result: webhookResult,
          };

          this.emit('webhook:after', afterEvent);

          return webhookResult;
        }

        lastError = `HTTP ${result.statusCode}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);

        const errorEvent: WebhookEvent = {
          type: 'webhook:error',
          timestamp: Date.now(),
          config,
          result: {
            success: false,
            durationMs: Date.now() - startTime,
            error: lastError,
            attempts: attempt,
          },
        };

        this.emit('webhook:error', errorEvent);
      }

      if (attempt < maxAttempts) {
        const retryEvent: WebhookEvent = {
          type: 'webhook:retry',
          timestamp: Date.now(),
          config,
        };

        this.emit('webhook:retry', retryEvent);

        await this.delay(config.retryDelayMs);
      }
    }

    return {
      success: false,
      statusCode: lastStatusCode,
      responseBody: lastResponseBody,
      durationMs: 0,
      error: lastError,
      attempts: maxAttempts,
    };
  }

  /**
   * 发送 HTTP 请求
   */
  private sendRequest(
    config: WebhookConfig
  ): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
      const parsedUrl = url.parse(config.url);
      const isHttps = parsedUrl.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const postData = config.body ? JSON.stringify(config.body) : undefined;

      const options: http.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port
          ? parseInt(parsedUrl.port, 10)
          : isHttps
            ? 443
            : 80,
        path: parsedUrl.path || '/',
        method: config.method,
        timeout: config.timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          ...config.headers,
        },
      };

      if (postData) {
        options.headers = {
          ...options.headers,
          'Content-Length': Buffer.byteLength(postData).toString(),
        };
      }

      const req = httpModule.request(options, (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            body: Buffer.concat(chunks).toString('utf-8'),
          });
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`请求超时 (${config.timeoutMs}ms)`));
      });

      if (postData) {
        req.write(postData);
      }

      req.end();
    });
  }

  /**
   * 延迟工具
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const webhookManager = new WebhookManager();

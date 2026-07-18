// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * OAuth 授权码回调监听器
 * 启动本地 HTTP 服务器，捕获 OAuth 提供商的授权码重定向。
 *
 * Phase 4 增强（对标 cline-main AuthHandler）:
 *   - 端口范围扫描（避免冲突）
 *   - 端口保持（重启时复用上次端口）
 *   - 10 分钟空闲超时自动关闭
 */

import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'system:auth:auth-code-listener', level: LogLevel.INFO });

/** 默认端口范围（对标 cline-main 48801-48811） */
const DEFAULT_PORT_RANGE = { start: 48801, end: 48811 };

/** 空闲超时（对标 cline-main 10 分钟） */
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

export class AuthCodeListener {
  private localServer: Server;
  private port: number = 0;
  private promiseResolver: ((authorizationCode: string) => void) | null = null;
  private promiseRejecter: ((error: Error) => void) | null = null;
  private expectedState: string | null = null;
  private pendingResponse: import('http').ServerResponse | null = null;
  private callbackPath: string;
  private preferredPort?: number;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(callbackPath: string = '/callback', preferredPort?: number) {
    this.localServer = createServer();
    this.callbackPath = callbackPath;
    this.preferredPort = preferredPort;
  }

  /**
   * 启动回调服务器。
   * 优先使用 preferredPort，被占用则扫描 DEFAULT_PORT_RANGE。
   */
  async start(port?: number): Promise<number> {
    // 先尝试 preferredPort
    if (this.preferredPort && !port) {
      try {
        const bound = await this.tryBind(this.preferredPort);
        this.startIdleTimer();
        return bound;
      } catch (err) {

        // 端口被占用，回退到范围扫描

        logger.debug("Operation skipped", { context: "端口被占用，回退到范围扫描", error: err instanceof Error ? err.message : String(err) });

      }
    }

    // 指定了固定端口，直接绑定
    if (port) {
      return this.tryBind(port);
    }

    // 端口范围扫描
    for (let p = DEFAULT_PORT_RANGE.start; p <= DEFAULT_PORT_RANGE.end; p++) {
      try {
        const bound = await this.tryBind(p);
        this.preferredPort = p;
        this.startIdleTimer();
        return bound;
      } catch {
        continue;
      }
    }

    throw new Error(
      `OAuth 回调服务器无法绑定端口，范围 ${DEFAULT_PORT_RANGE.start}-${DEFAULT_PORT_RANGE.end}`
    );
  }

  private tryBind(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      this.localServer.once('error', (err) => reject(err));
      this.localServer.listen(port, '127.0.0.1', () => {
        const address = this.localServer.address() as AddressInfo;
        this.port = address.port;
        resolve(this.port);
      });
    });
  }

  /** 每次请求重置空闲计时器 */
  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.close();
    }, IDLE_TIMEOUT_MS);
  }

  private startIdleTimer(): void {
    this.idleTimer = setTimeout(() => {
      this.close();
    }, IDLE_TIMEOUT_MS);
  }

  getPort(): number {
    return this.port;
  }

  hasPendingResponse(): boolean {
    return this.pendingResponse !== null;
  }

  async waitForAuthorization(
    state: string,
    onReady: () => Promise<void>
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.promiseResolver = resolve;
      this.promiseRejecter = reject;
      this.expectedState = state;
      this.startLocalListener(onReady);
    });
  }

  handleSuccessRedirect(successUrl: string): void {
    if (!this.pendingResponse) return;
    this.pendingResponse.writeHead(302, { Location: successUrl });
    this.pendingResponse.end();
    this.pendingResponse = null;
  }

  handleErrorRedirect(errorUrl: string): void {
    if (!this.pendingResponse) return;
    this.pendingResponse.writeHead(302, { Location: errorUrl });
    this.pendingResponse.end();
    this.pendingResponse = null;
  }

  private startLocalListener(onReady: () => Promise<void>): void {
    this.localServer.on('request', this.handleRedirect.bind(this));
    this.localServer.on('error', this.handleError.bind(this));
    void onReady();
  }

  private handleRedirect(
    req: import('http').IncomingMessage,
    res: import('http').ServerResponse
  ): void {
    this.resetIdleTimer();

    const parsedUrl = new URL(
      req.url || '',
      `http://${req.headers.host || 'localhost'}`
    );

    if (parsedUrl.pathname !== this.callbackPath) {
      res.writeHead(404);
      res.end();
      return;
    }

    const authCode = parsedUrl.searchParams.get('code') ?? undefined;
    const state = parsedUrl.searchParams.get('state') ?? undefined;
    this.validateAndRespond(authCode, state, res);
  }

  private validateAndRespond(
    authCode: string | undefined,
    state: string | undefined,
    res: import('http').ServerResponse
  ): void {
    if (!authCode) {
      res.writeHead(400);
      res.end('Authorization code not found');
      this.reject(new Error('No authorization code received'));
      return;
    }

    if (state !== this.expectedState) {
      res.writeHead(400);
      res.end('Invalid state parameter');
      this.reject(new Error('Invalid state parameter'));
      return;
    }

    this.pendingResponse = res;
    this.resolve(authCode);
  }

  private handleError(err: Error): void {
    this.close();
    this.reject(err);
  }

  private resolve(authorizationCode: string): void {
    if (this.promiseResolver) {
      this.promiseResolver(authorizationCode);
      this.promiseResolver = null;
      this.promiseRejecter = null;
    }
  }

  private reject(error: Error): void {
    if (this.promiseRejecter) {
      this.promiseRejecter(error);
      this.promiseResolver = null;
      this.promiseRejecter = null;
    }
  }

  close(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (!this.localServer.listening) return;
    this.reject(new Error('Auth code listener closed'));
    if (this.localServer) {
      this.localServer.removeAllListeners();
      this.localServer.close();
    }
  }
}

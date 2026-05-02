/**
 * OAuth授权码回调监听器
 * 启动本地HTTP服务器，捕获OAuth提供商的授权码重定向
 * 基于CC源码 cc_code/backend/services/oauth/auth-code-listener.ts 实现
 */

import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';

export class AuthCodeListener {
  private localServer: Server;
  private port: number = 0;
  private promiseResolver: ((authorizationCode: string) => void) | null = null;
  private promiseRejecter: ((error: Error) => void) | null = null;
  private expectedState: string | null = null;
  private pendingResponse: import('http').ServerResponse | null = null;
  private callbackPath: string;

  constructor(callbackPath: string = '/callback') {
    this.localServer = createServer();
    this.callbackPath = callbackPath;
  }

  async start(port?: number): Promise<number> {
    return new Promise((resolve, reject) => {
      this.localServer.once('error', err => {
        reject(new Error(`Failed to start OAuth callback server: ${err.message}`));
      });

      this.localServer.listen(port ?? 0, 'localhost', () => {
        const address = this.localServer.address() as AddressInfo;
        this.port = address.port;
        resolve(this.port);
      });
    });
  }

  getPort(): number {
    return this.port;
  }

  hasPendingResponse(): boolean {
    return this.pendingResponse !== null;
  }

  async waitForAuthorization(state: string, onReady: () => Promise<void>): Promise<string> {
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

  private handleRedirect(req: import('http').IncomingMessage, res: import('http').ServerResponse): void {
    const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);

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
    res: import('http').ServerResponse,
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
    this.reject(new Error('Auth code listener closed'));
    if (this.localServer) {
      this.localServer.removeAllListeners();
      this.localServer.close();
    }
  }
}

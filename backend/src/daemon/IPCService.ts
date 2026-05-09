import http from 'http';
import { Logger } from '../monitoring/logs/Logger';

const logger = new Logger({ level: 'info' as any });

export interface IPCMessage {
  type: string;
  payload: unknown;
  id?: string;
}

export interface IPCHandler {
  (message: IPCMessage): Promise<unknown>;
}

export interface IPCServiceConfig {
  host: string;
  port: number;
}

export class IPCService {
  private server: http.Server | null;
  private handlers: Map<string, IPCHandler>;
  private config: IPCServiceConfig;

  constructor(config: IPCServiceConfig) {
    this.server = null;
    this.handlers = new Map();
    this.config = config;
  }

  on(type: string, handler: IPCHandler): void {
    this.handlers.set(type, handler);
  }

  off(type: string): void {
    this.handlers.delete(type);
  }

  async start(): Promise<void> {
    if (this.server) {
      logger.warning('IPC 服务已在运行');
      return;
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405);
          res.end('Method Not Allowed');
          return;
        }

        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const message: IPCMessage = JSON.parse(body);
            const handler = this.handlers.get(message.type);
            if (handler) {
              const result = await handler(message);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, data: result }));
            } else {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  success: false,
                  error: `未知消息类型: ${message.type}`,
                })
              );
            }
          } catch (error) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : '解析失败',
              })
            );
          }
        });
      });

      this.server.listen(this.config.port, this.config.host, () => {
        logger.info(`IPC 服务已启动: ${this.config.host}:${this.config.port}`);
        resolve();
      });

      this.server.on('error', (error) => {
        logger.error('IPC 服务启动失败', error);
        reject(error);
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve, reject) => {
      this.server!.close((err) => {
        if (err) {
          logger.error('IPC 服务关闭失败', err);
          reject(err);
        } else {
          logger.info('IPC 服务已关闭');
          this.server = null;
          resolve();
        }
      });
    });
  }

  isRunning(): boolean {
    return this.server !== null && this.server.listening;
  }

  getAddress(): string {
    return `${this.config.host}:${this.config.port}`;
  }
}

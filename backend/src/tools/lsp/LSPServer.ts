/**
 * LSP服务器管理
 */

import { spawn } from 'child_process';
import { ServerStatus } from './types/index.js';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * LSP服务器配置
 */
export interface LSPServerConfig {
  /**
   * 服务器路径
   */
  serverPath: string;

  /**
   * 服务器参数
   */
  serverArgs?: string[];

  /**
   * 工作目录
   */
  cwd?: string;

  /**
   * 环境变量
   */
  env?: Record<string, string>;
}

/**
 * LSP服务器管理
 */
export class LSPServer {
  private config: LSPServerConfig;
  private process: any = null;
  private status: ServerStatus = ServerStatus.STOPPED;
  private inputBuffer: string = '';
  private outputBuffer: string = '';
  private messageHandlers: ((message: string) => void)[] = [];
  private errorHandlers: ((error: string) => void)[] = [];
  private exitHandlers: ((code: number | null) => void)[] = [];

  /**
   * 构造函数
   */
  constructor(config: LSPServerConfig) {
    this.config = config;
  }

  /**
   * 启动服务器
   */
  async start(): Promise<void> {
    if (this.status === ServerStatus.RUNNING) {
      return;
    }

    this.status = ServerStatus.STARTING;

    try {
      this.process = spawn(
        this.config.serverPath,
        this.config.serverArgs || [],
        {
          cwd: this.config.cwd || process.cwd(),
          env: {
            ...process.env,
            ...this.config.env,
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );

      this.process.stdin.setEncoding('utf8');
      this.process.stdout.setEncoding('utf8');
      this.process.stderr.setEncoding('utf8');

      this.process.stdout.on('data', (data: string) => {
        this.outputBuffer += data;
        this.handleOutput();
      });

      this.process.stderr.on('data', (data: string) => {
        this.errorHandlers.forEach((handler) => handler(data));
      });

      this.process.on('exit', (code: number | null) => {
        this.status = ServerStatus.STOPPED;
        this.exitHandlers.forEach((handler) => handler(code));
      });

      this.status = ServerStatus.RUNNING;
    } catch (error) {
      this.status = ServerStatus.ERROR;
      throw error;
    }
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    if (this.status !== ServerStatus.RUNNING) {
      return;
    }

    if (this.process) {
      this.process.kill();
      this.process = null;
    }

    this.status = ServerStatus.STOPPED;
  }

  /**
   * 发送消息
   */
  send(message: string): void {
    if (this.status !== ServerStatus.RUNNING || !this.process) {
      throw new AppError('Server not running', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }

    const length = Buffer.byteLength(message, 'utf8');
    const header = `Content-Length: ${length}\r\n\r\n`;
    this.process.stdin.write(header + message);
  }

  /**
   * 处理输出
   */
  private handleOutput(): void {
    while (true) {
      const headerEnd = this.outputBuffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        break;
      }

      const header = this.outputBuffer.substring(0, headerEnd);
      const contentLengthMatch = header.match(/Content-Length: (\d+)/);
      if (!contentLengthMatch) {
        this.outputBuffer = this.outputBuffer.substring(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;

      if (this.outputBuffer.length < messageEnd) {
        break;
      }

      const message = this.outputBuffer.substring(messageStart, messageEnd);
      this.outputBuffer = this.outputBuffer.substring(messageEnd);

      this.messageHandlers.forEach((handler) => handler(message));
    }
  }

  /**
   * 注册消息处理
   */
  onMessage(handler: (message: string) => void): void {
    this.messageHandlers.push(handler);
  }

  /**
   * 注册错误处理
   */
  onError(handler: (error: string) => void): void {
    this.errorHandlers.push(handler);
  }

  /**
   * 注册退出处理
   */
  onExit(handler: (code: number | null) => void): void {
    this.exitHandlers.push(handler);
  }

  /**
   * 获取状态
   */
  getStatus(): ServerStatus {
    return this.status;
  }

  /**
   * 重启服务器
   */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }
}

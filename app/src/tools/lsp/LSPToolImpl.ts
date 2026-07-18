/**
 * LSP工具实现
 */

import {
  LSPTool,
  Position,
  Location,
  CompletionItem,
  Diagnostic,
  ServerStatus,
} from './types';
import { LSPClient } from './LSPClient';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'tools\lsp\LSPToolImpl', level: LogLevel.INFO });

/**
 * LSP工具实现
 */
export class LSPToolImpl implements LSPTool {
  private client: LSPClient | null = null;
  private language: string;

  /**
   * 构造函数
   */
  constructor(language: string = 'typescript') {
    this.language = language;
  }

  /**
   * 启动LSP服务器
   */
  async startServer(): Promise<void> {
    if (this.client) {
      return;
    }

    const config = this.getServerConfig();
    this.client = new LSPClient(config);
    await this.client.start();
  }

  /**
   * 停止LSP服务器
   */
  async stopServer(): Promise<void> {
    if (this.client) {
      await this.client.stop();
      this.client = null;
    }
  }

  /**
   * 发送LSP请求
   */
  async sendRequest(method: string, params: any): Promise<unknown> {
    if (!this.client) {
      throw new AppError(
        'LSP server not started',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    return await this.client.sendRequest(method, params);
  }

  /**
   * 获取代码补全
   */
  async getCompletions(
    document: string,
    position: Position
  ): Promise<CompletionItem[]> {
    if (!this.client) {
      throw new AppError(
        'LSP server not started',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    return await this.client.getCompletions(document, position);
  }

  /**
   * 获取代码定义
   */
  async getDefinition(
    document: string,
    position: Position
  ): Promise<Location[]> {
    if (!this.client) {
      throw new AppError(
        'LSP server not started',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    return await this.client.getDefinition(document, position);
  }

  /**
   * 获取代码引用
   */
  async getReferences(
    document: string,
    position: Position
  ): Promise<Location[]> {
    if (!this.client) {
      throw new AppError(
        'LSP server not started',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    return await this.client.getReferences(document, position);
  }

  /**
   * 获取代码诊断
   */
  async getDiagnostics(document: string): Promise<Diagnostic[]> {
    if (!this.client) {
      throw new AppError(
        'LSP server not started',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    return await this.client.getDiagnostics(document);
  }

  /**
   * 格式化代码
   */
  async formatDocument(document: string): Promise<string> {
    if (!this.client) {
      throw new AppError(
        'LSP server not started',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    return await this.client.formatDocument(document);
  }

  /**
   * 获取悬停信息
   */
  async getHover(document: string, position: Position): Promise<string | null> {
    if (!this.client) {
      throw new AppError(
        'LSP server not started',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    return await this.client.getHover(document, position);
  }

  /**
   * 重命名符号
   */
  async renameSymbol(
    document: string,
    position: Position,
    newName: string
  ): Promise<Location[]> {
    if (!this.client) {
      throw new AppError(
        'LSP server not started',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    return await this.client.renameSymbol(document, position, newName);
  }

  /**
   * 获取代码操作
   */
  async getCodeActions(document: string, position: Position): Promise<any[]> {
    if (!this.client) {
      throw new AppError(
        'LSP server not started',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    return await this.client.getCodeActions(document, position);
  }

  /**
   * 获取实现位置
   */
  async getImplementation(
    document: string,
    position: Position
  ): Promise<Location[]> {
    if (!this.client) {
      throw new AppError(
        'LSP server not started',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    return await this.client.getImplementation(document, position);
  }

  /**
   * 获取类型定义
   */
  async getTypeDefinition(
    document: string,
    position: Position
  ): Promise<Location[]> {
    if (!this.client) {
      throw new AppError(
        'LSP server not started',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    return await this.client.getTypeDefinition(document, position);
  }

  /**
   * 获取服务器状态
   */
  getServerStatus(): ServerStatus {
    if (!this.client) {
      return ServerStatus.STOPPED;
    }

    return this.client.getServerStatus();
  }

  /**
   * 重启服务器
   */
  async restartServer(): Promise<void> {
    if (this.client) {
      await this.client.restartServer();
    }
  }

  /**
   * 获取服务器配置
   */
  private getServerConfig() {
    switch (this.language.toLowerCase()) {
      case 'typescript':
      case 'javascript':
        return {
          serverPath: 'npx',
          serverArgs: ['typescript-language-server', '--stdio'],
        };
      case 'python':
      case 'python3':
        return {
          serverPath: 'python',
          serverArgs: ['-m', 'pylsp'],
        };
      case 'java':
        return {
          serverPath: 'jdtls',
          serverArgs: [],
        };
      case 'csharp':
      case 'csharp-net':
        return {
          serverPath: 'omnisharp',
          serverArgs: ['--stdio'],
        };
      case 'cpp':
      case 'c':
      case 'c++':
        return {
          serverPath: 'clangd',
          serverArgs: ['--background-index'],
        };
      case 'go':
      case 'golang':
        return {
          serverPath: 'gopls',
          serverArgs: [],
        };
      case 'rust':
      case 'rs':
        return {
          serverPath: 'rust-analyzer',
          serverArgs: [],
        };
      case 'ruby':
      case 'rb':
        return {
          serverPath: 'solargraph',
          serverArgs: ['stdio'],
        };
      case 'php':
        return {
          serverPath: 'php-language-server',
          serverArgs: [],
        };
      default:
        throw new AppError(
          `Unsupported language: ${this.language}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
    }
  }
}

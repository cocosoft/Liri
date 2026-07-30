/**
 * LSP客户端
 */

import { LSPServer, LSPServerConfig } from './LSPServer.js';
import {
  ServerStatus,
  Position,
  Location,
  CompletionItem,
  TextEdit,
  Diagnostic,
} from './types/index.js';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({ module: 'tools:lspClient', level: LogLevel.INFO });

/**
 * LSP客户端
 */
export class LSPClient {
  private server: LSPServer;
  private requestId: number = 0;
  private pendingRequests: Map<
    number,
    { resolve: (value: any) => void; reject: (error: any) => void }
  > = new Map();
  private initialized: boolean = false;

  /**
   * 构造函数
   */
  constructor(config: LSPServerConfig) {
    this.server = new LSPServer(config);
    this.setupMessageHandler();
  }

  /**
   * 启动客户端
   */
  async start(): Promise<void> {
    await this.server.start();
    await this.initialize();
  }

  /**
   * 停止客户端
   */
  async stop(): Promise<void> {
    await this.shutdown();
    await this.exit();
    await this.server.stop();
  }

  /**
   * 初始化
   */
  private async initialize(): Promise<void> {
    const result = await this.sendRequest('initialize', {
      processId: process.pid,
      rootUri: null,
      capabilities: {
        textDocument: {
          completion: {
            dynamicRegistration: true,
          },
          definition: {
            dynamicRegistration: true,
          },
          references: {
            dynamicRegistration: true,
          },
          documentSymbol: {
            dynamicRegistration: true,
          },
          formatting: {
            dynamicRegistration: true,
          },
        },
      },
    });

    await this.sendNotification('initialized', {});
    this.initialized = true;
  }

  /**
   * 关闭
   */
  private async shutdown(): Promise<void> {
    if (this.initialized) {
      await this.sendRequest('shutdown', {});
    }
  }

  /**
   * 退出
   */
  private async exit(): Promise<void> {
    if (this.initialized) {
      await this.sendNotification('exit', {});
    }
  }

  /**
   * 发送请求
   */
  async sendRequest(method: string, params: any): Promise<unknown> {
    const id = ++this.requestId;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      const message = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params,
      });

      this.server.send(message);
    });
  }

  /**
   * 发送通知
   */
  sendNotification(method: string, params: any): void {
    const message = JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
    });

    this.server.send(message);
  }

  /**
   * 设置消息处理器
   */
  private setupMessageHandler(): void {
    this.server.onMessage((message: string) => {
      try {
        const data = JSON.parse(message);

        if (data.id) {
          // 响应
          const request = this.pendingRequests.get(data.id);
          if (request) {
            if (data.error) {
              request.reject(new Error(data.error.message || 'Request failed'));
            } else {
              request.resolve(data.result);
            }
            this.pendingRequests.delete(data.id);
          }
        } else if (data.method) {
          // 通知
          this.handleNotification(data.method, data.params);
        }
      } catch (error) {
        void handleError(error, {
          module: 'tools:lsp',
          action: 'parseMessage',
        });
      }
    });
  }

  /**
   * 处理通知
   */
  private handleNotification(method: string, params: any): void {
    // 处理各种通知
    switch (method) {
      case 'textDocument/publishDiagnostics':
        // 处理诊断信息
        break;
      case 'window/showMessage':
        // 处理显示消息
        break;
      case 'window/showMessageRequest':
        // 处理消息请求
        break;
      case 'workspace/applyEdit':
        // 处理应用编辑
        break;
      default:
        // 其他通知
        break;
    }
  }

  /**
   * 获取代码补全
   */
  async getCompletions(
    document: string,
    position: Position
  ): Promise<CompletionItem[]> {
    const result = await this.sendRequest('textDocument/completion', {
      textDocument: {
        uri: 'file:///tmp/temp.ts',
      },
      position,
    });

    return (
      ((result as Record<string, unknown>)?.items as CompletionItem[]) || []
    );
  }

  /**
   * 获取代码定义
   */
  async getDefinition(
    document: string,
    position: Position
  ): Promise<Location[]> {
    const result = await this.sendRequest('textDocument/definition', {
      textDocument: {
        uri: 'file:///tmp/temp.ts',
      },
      position,
    });

    const r = result as Location | Location[];
    return Array.isArray(r) ? r : r ? [r] : [];
  }

  /**
   * 获取代码引用
   */
  async getReferences(
    document: string,
    position: Position
  ): Promise<Location[]> {
    const result = await this.sendRequest('textDocument/references', {
      textDocument: {
        uri: 'file:///tmp/temp.ts',
      },
      position,
      context: {
        includeDeclaration: true,
      },
    });

    return (result as Location[]) || [];
  }

  /**
   * 获取代码诊断
   */
  async getDiagnostics(document: string): Promise<Diagnostic[]> {
    // 这里需要先发送文本变更通知
    await this.sendNotification('textDocument/didChange', {
      textDocument: {
        uri: 'file:///tmp/temp.ts',
        version: 1,
      },
      contentChanges: [
        {
          text: document,
        },
      ],
    });

    // 诊断会通过通知返回，这里返回空数组作为示例
    return [];
  }

  /**
   * 格式化代码
   */
  async formatDocument(document: string): Promise<string> {
    const result = await this.sendRequest('textDocument/formatting', {
      textDocument: {
        uri: 'file:///tmp/temp.ts',
      },
      options: {
        tabSize: 2,
        insertSpaces: true,
      },
    });

    const edits = result as TextEdit[];
    if (!edits || edits.length === 0) {
      return document;
    }

    // 应用格式化
    let formatted = document;
    for (const edit of edits.reverse()) {
      const start = this.getOffset(formatted, edit.range.start);
      const end = this.getOffset(formatted, edit.range.end);
      formatted =
        formatted.substring(0, start) + edit.newText + formatted.substring(end);
    }

    return formatted;
  }

  /**
   * 获取字符偏移量
   */
  private getOffset(text: string, position: Position): number {
    const lines = text.split('\n');
    let offset = 0;

    for (let i = 0; i < position.line; i++) {
      offset += lines[i].length + 1; // +1 for newline
    }

    return offset + position.character;
  }

  /**
   * 获取服务器状态
   */
  getServerStatus(): ServerStatus {
    return this.server.getStatus();
  }

  /**
   * 获取悬停信息
   */
  async getHover(document: string, position: Position): Promise<string | null> {
    const result = await this.sendRequest('textDocument/hover', {
      textDocument: {
        uri: 'file:///tmp/temp.ts',
      },
      position,
    });

    const r = result as Record<string, unknown> | undefined;
    return (r?.contents as string) || null;
  }

  /**
   * 重命名符号
   */
  async renameSymbol(
    document: string,
    position: Position,
    newName: string
  ): Promise<Location[]> {
    const result = await this.sendRequest('textDocument/rename', {
      textDocument: {
        uri: 'file:///tmp/temp.ts',
      },
      position,
      newName,
    });

    const r = result as Record<string, unknown> | undefined;
    if (r?.changes) {
      const changes = r.changes as Record<string, unknown>;
      const locations: Location[] = [];
      for (const [uri, edits] of Object.entries(changes)) {
        for (const edit of edits as any) {
          locations.push({
            uri,
            range: edit.range,
          });
        }
      }
      return locations;
    }

    return [];
  }

  /**
   * 获取代码操作
   */
  async getCodeActions(document: string, position: Position): Promise<any[]> {
    const result = await this.sendRequest('textDocument/codeAction', {
      textDocument: {
        uri: 'file:///tmp/temp.ts',
      },
      range: {
        start: position,
        end: position,
      },
      context: {
        diagnostics: [],
      },
    });

    return (result as any[]) || [];
  }

  /**
   * 获取实现位置
   */
  async getImplementation(
    document: string,
    position: Position
  ): Promise<Location[]> {
    const result = await this.sendRequest('textDocument/implementation', {
      textDocument: {
        uri: 'file:///tmp/temp.ts',
      },
      position,
    });

    const impl = result as Location | Location[];
    return Array.isArray(impl) ? impl : impl ? [impl] : [];
  }

  /**
   * 获取类型定义
   */
  async getTypeDefinition(
    document: string,
    position: Position
  ): Promise<Location[]> {
    const result = await this.sendRequest('textDocument/typeDefinition', {
      textDocument: {
        uri: 'file:///tmp/temp.ts',
      },
      position,
    });

    const typeDef = result as Location | Location[];
    return Array.isArray(typeDef) ? typeDef : typeDef ? [typeDef] : [];
  }

  /**
   * 重启服务器
   */
  async restartServer(): Promise<void> {
    await this.server.restart();
    await this.initialize();
  }
}

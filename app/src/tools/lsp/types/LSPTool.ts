/**
 * LSP工具接口
 */

import { CompletionItem } from './Completion.js';
import { Diagnostic } from './Diagnostic.js';
import { Position, Range, Location, ServerStatus } from './LSPTypes.js';

export type { Position, Range, Location } from './LSPTypes.js';
export { ServerStatus } from './LSPTypes.js';

export interface LSPTool {
  /**
   * 启动LSP服务器
   */
  startServer(): Promise<void>;

  /**
   * 停止LSP服务器
   */
  stopServer(): Promise<void>;

  /**
   * 发送LSP请求
   */
  sendRequest(method: string, params: any): Promise<unknown>;

  /**
   * 获取代码补全
   */
  getCompletions(
    document: string,
    position: Position
  ): Promise<CompletionItem[]>;

  /**
   * 获取代码定义
   */
  getDefinition(document: string, position: Position): Promise<Location[]>;

  /**
   * 获取代码引用
   */
  getReferences(document: string, position: Position): Promise<Location[]>;

  /**
   * 获取代码诊断
   */
  getDiagnostics(document: string): Promise<Diagnostic[]>;

  /**
   * 格式化代码
   */
  formatDocument(document: string): Promise<string>;

  /**
   * 获取服务器状态
   */
  getServerStatus(): ServerStatus;

  /**
   * 重启服务器
   */
  restartServer(): Promise<void>;
}

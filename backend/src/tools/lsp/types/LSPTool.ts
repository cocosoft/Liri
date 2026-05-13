/**
 * LSP工具接口
 */

import { CompletionItem } from './Completion.js';
import { Diagnostic } from './Diagnostic.js';

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

/**
 * 位置信息
 */
export interface Position {
  line: number;
  character: number;
}

/**
 * 范围信息
 */
export interface Range {
  start: Position;
  end: Position;
}

/**
 * 位置信息
 */
export interface Location {
  uri: string;
  range: Range;
}

/**
 * 服务器状态
 */
export enum ServerStatus {
  STOPPED = 'stopped',
  STARTING = 'starting',
  RUNNING = 'running',
  ERROR = 'error',
}

/**
 * LSP 基础类型定义
 *
 * 从 LSPTool.ts 中提取，解决 Completion / Diagnostic / LSPTool 间的循环依赖。
 * LSPTool.ts 会 re-export 这些类型以保持向后兼容。
 */

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

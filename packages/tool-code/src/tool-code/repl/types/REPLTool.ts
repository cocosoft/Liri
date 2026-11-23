/**
 * REPL工具类型定义
 */

import type { ChildProcess } from 'child_process';
import type { Writable, Readable } from 'stream';

/**
 * REPL选项
 */
export interface REPLOptions {
  /**
   * 工作目录
   */
  cwd?: string;

  /**
   * 环境变量
   */
  env?: Record<string, string>;

  /**
   * 超时（毫秒）
   */
  timeout?: number;

  /**
   * 内存限制（MB）
   */
  memoryLimit?: number;

  /**
   * 额外参数
   */
  extraArgs?: string[];
}

/**
 * REPL会话状态
 */
export enum REPLSessionStatus {
  STARTING = 'starting',
  RUNNING = 'running',
  ERROR = 'error',
  STOPPED = 'stopped',
}

/**
 * REPL执行结果
 */
export interface REPLResult {
  /**
   * 是否成功
   */
  success: boolean;

  /**
   * 结果输出
   */
  output: string;

  /**
   * 错误信息
   */
  error?: string;

  /**
   * 执行时间（毫秒）
   */
  executionTime: number;

  /**
   * 退出代码
   */
  exitCode?: number;
}

/**
 * REPL执行记录
 */
export interface REPLExecution {
  /**
   * 执行ID
   */
  id: string;

  /**
   * 代码
   */
  code: string | number | null;

  /**
   * 结果
   */
  result: REPLResult;

  /**
   * 时间戳
   */
  timestamp: Date;
}

/**
 * REPL会话
 */
export interface REPLSession {
  /**
   * 会话ID
   */
  id: string;

  /**
   * 语言
   */
  language: string;

  /**
   * 状态
   */
  status: REPLSessionStatus;

  /**
   * 启动时间
   */
  startTime: Date;

  /**
   * 最后活动时间
   */
  lastActivity: Date;

  /**
   * 执行历史
   */
  history: REPLExecution[];

  /**
   * 选项
   */
  options: REPLOptions;

  /**
   * 设置状态
   */
  setStatus(status: REPLSessionStatus): void;

  /**
   * 添加执行记录
   */
  addExecution(execution: REPLExecution): void;

  /**
   * 子进程
   */
  process?: ChildProcess;

  /**
   * 标准输入
   */
  stdin?: Writable;

  /**
   * 标准输出
   */
  stdout?: Readable;

  /**
   * 标准错误
   */
  stderr?: Readable;
}

/**
 * REPL工具接口
 */
export interface REPLTool {
  /**
   * 启动REPL
   */
  startREPL(language: string, options?: REPLOptions): Promise<REPLSession>;

  /**
   * 执行代码
   */
  executeCode(session: REPLSession, code: string): Promise<REPLResult>;

  /**
   * 停止REPL
   */
  stopREPL(session: REPLSession): Promise<void>;

  /**
   * 获取支持的语言
   */
  getSupportedLanguages(): string[];

  /**
   * 获取所有会话
   */
  getSessions(): REPLSession[];

  /**
   * 清理所有会话
   */
  clearSessions(): Promise<void>;
}

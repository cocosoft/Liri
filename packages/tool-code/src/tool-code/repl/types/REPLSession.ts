/**
 * REPL会话类型定义
 */

import { REPLSessionStatus } from './REPLTool.js';
import type { REPLOptions, REPLExecution } from './REPLTool.js';

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
}

/**
 * REPL会话实现
 */
export class REPLSessionImpl implements REPLSession {
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
   * 进程信息
   */
  process?: any;

  /**
   * 输入流
   */
  stdin?: any;

  /**
   * 输出流
   */
  stdout?: any;

  /**
   * 错误流
   */
  stderr?: any;

  /**
   * 构造函数
   */
  constructor(id: string, language: string, options: REPLOptions = {}) {
    this.id = id;
    this.language = language;
    this.status = REPLSessionStatus.STARTING;
    this.startTime = new Date();
    this.lastActivity = new Date();
    this.history = [];
    this.options = options;
  }

  /**
   * 更新最后活动时间
   */
  updateActivity(): void {
    this.lastActivity = new Date();
  }

  /**
   * 添加执行记录
   */
  addExecution(execution: REPLExecution): void {
    this.history.push(execution);
    this.updateActivity();
  }

  /**
   * 设置状态
   */
  setStatus(status: REPLSessionStatus): void {
    this.status = status;
  }
}

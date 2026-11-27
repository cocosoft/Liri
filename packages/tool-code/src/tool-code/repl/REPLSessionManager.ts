/**
 * REPL会话管理
 */

import { REPLSessionStatus } from './types/REPLTool.js';
import type { REPLSession, REPLOptions } from './types/REPLTool.js';
import { REPLSessionImpl } from './types/REPLSession.js';

/**
 * REPL会话管理器
 */
export class REPLSessionManager {
  private sessions: Map<string, REPLSession> = new Map();
  private sessionCounter: number = 0;

  /**
   * 创建会话
   */
  createSession(language: string, options: REPLOptions = {}): REPLSession {
    const id = `repl-${++this.sessionCounter}-${Date.now()}`;
    const session = new REPLSessionImpl(id, language, options);
    this.sessions.set(id, session);
    return session;
  }

  /**
   * 获取会话
   */
  getSession(id: string): REPLSession | undefined {
    return this.sessions.get(id);
  }

  /**
   * 获取所有会话
   */
  getSessions(): REPLSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * 获取指定语言的会话
   */
  getSessionsByLanguage(language: string): REPLSession[] {
    return Array.from(this.sessions.values()).filter(
      (session) => session.language === language
    );
  }

  /**
   * 移除会话
   */
  removeSession(id: string): boolean {
    return this.sessions.delete(id);
  }

  /**
   * 清理会话
   */
  clearSessions(): void {
    this.sessions.clear();
  }

  /**
   * 2026-11-27：返回**闲置超时**的会话（**纯查询，不删、不杀**）。
   *
   * 旧实现 `cleanupExpiredSessions` 直接把会话从表里删掉 —— 子进程仍在跑、
   * `ProcessRegistry` 条目停在 `running`、Windows Low IL 的会话级授权也不释放
   * （全仓零调用，属未接线的危险实现，已删除）。回收请用
   * `REPLToolImpl.reclaimIdleSessions()`：查询 → `stopREPL`（kill + 收敛终态 + 释放授权）。
   */
  collectExpiredSessions(timeoutMs: number = 3600000): REPLSession[] {
    const now = Date.now();
    return Array.from(this.sessions.values()).filter(
      (session) => now - session.lastActivity.getTime() > timeoutMs
    );
  }

  /**
   * 获取会话数量
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * 获取运行中的会话数量
   */
  getRunningSessionCount(): number {
    return Array.from(this.sessions.values()).filter(
      (session) => session.status === REPLSessionStatus.RUNNING
    ).length;
  }
}

/**
 * 全局REPL会话管理器实例
 */
export const replSessionManager = new REPLSessionManager();

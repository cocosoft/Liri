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
   * 清理过期会话
   */
  cleanupExpiredSessions(timeoutMs: number = 3600000): void {
    const now = Date.now();
    const expiredSessions: string[] = [];

    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity.getTime() > timeoutMs) {
        expiredSessions.push(id);
      }
    }

    for (const id of expiredSessions) {
      this.sessions.delete(id);
    }
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

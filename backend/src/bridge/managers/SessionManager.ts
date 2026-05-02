/**
 * 会话管理器
 * 负责创建、管理和销毁会话
 */

import {
  SessionHandle,
  SessionSpawner,
  SessionDoneStatus,
  SessionActivity,
} from '../types';

/**
 * 会话信息
 */
interface SessionInfo {
  /** 会话句柄 */
  handle: SessionHandle;
  /** 会话开始时间 */
  startTime: number;
  /** 工作ID */
  workId: string;
  /** 会话令牌 */
  ingressToken: string;
  /** 是否超时 */
  timedOut: boolean;
}

/**
 * 会话管理器选项
 */
interface SessionManagerOptions {
  /** 会话生成器 */
  spawner: SessionSpawner;
  /** 最大会话数 */
  maxSessions: number;
  /** 会话超时时间（毫秒） */
  sessionTimeoutMs: number;
  /** 会话完成回调 */
  onSessionDone: (sessionId: string, status: SessionDoneStatus) => void;
}

/**
 * 会话管理器
 */
export class SessionManager {
  private readonly spawner: SessionSpawner;
  private readonly maxSessions: number;
  private readonly sessionTimeoutMs: number;
  private readonly onSessionDone: (
    sessionId: string,
    status: SessionDoneStatus
  ) => void;
  private sessions: Map<string, SessionInfo> = new Map();
  private sessionTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(options: SessionManagerOptions) {
    this.spawner = options.spawner;
    this.maxSessions = options.maxSessions;
    this.sessionTimeoutMs = options.sessionTimeoutMs;
    this.onSessionDone = options.onSessionDone;
  }

  /**
   * 创建会话
   */
  createSession(
    sessionId: string,
    sdkUrl: string,
    accessToken: string,
    workId: string,
    dir: string
  ): SessionHandle {
    // 检查是否达到最大会话数
    if (this.sessions.size >= this.maxSessions) {
      throw new Error(
        `Maximum number of sessions (${this.maxSessions}) reached`
      );
    }

    // 生成会话
    const handle = this.spawner.spawn(
      {
        sdkUrl,
        accessToken,
      },
      dir
    );

    // 记录会话信息
    const sessionInfo: SessionInfo = {
      handle,
      startTime: Date.now(),
      workId,
      ingressToken: accessToken,
      timedOut: false,
    };

    this.sessions.set(sessionId, sessionInfo);

    // 设置会话超时定时器
    this.setSessionTimeout(sessionId);

    return handle;
  }

  /**
   * 获取会话
   */
  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 检查会话是否存在
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * 获取所有会话
   */
  getAllSessions(): Map<string, SessionInfo> {
    return new Map(this.sessions);
  }

  /**
   * 获取活跃会话数量
   */
  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * 停止会话
   */
  async stopSession(sessionId: string): Promise<void> {
    const sessionInfo = this.sessions.get(sessionId);
    if (!sessionInfo) {
      return;
    }

    // 清除会话超时定时器
    this.clearSessionTimeout(sessionId);

    // 停止会话
    await sessionInfo.handle.stop();

    // 移除会话
    this.sessions.delete(sessionId);
  }

  /**
   * 标记会话完成
   */
  markSessionDone(sessionId: string, status: SessionDoneStatus): void {
    // 清除会话超时定时器
    this.clearSessionTimeout(sessionId);

    // 移除会话
    this.sessions.delete(sessionId);

    // 调用会话完成回调
    this.onSessionDone(sessionId, status);
  }

  /**
   * 设置会话超时
   */
  private setSessionTimeout(sessionId: string): void {
    // 清除现有的定时器
    this.clearSessionTimeout(sessionId);

    // 设置新的定时器
    const timer = setTimeout(() => {
      this.handleSessionTimeout(sessionId);
    }, this.sessionTimeoutMs);

    this.sessionTimers.set(sessionId, timer);
  }

  /**
   * 清除会话超时
   */
  private clearSessionTimeout(sessionId: string): void {
    const timer = this.sessionTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.sessionTimers.delete(sessionId);
    }
  }

  /**
   * 处理会话超时
   */
  private async handleSessionTimeout(sessionId: string): Promise<void> {
    const sessionInfo = this.sessions.get(sessionId);
    if (!sessionInfo) {
      return;
    }

    // 标记会话为超时
    sessionInfo.timedOut = true;

    // 停止会话
    await this.stopSession(sessionId);

    // 调用会话完成回调
    this.onSessionDone(sessionId, 'failed');
  }

  /**
   * 清除所有会话
   */
  async clearAllSessions(): Promise<void> {
    // 停止所有会话
    for (const sessionId of this.sessions.keys()) {
      await this.stopSession(sessionId);
    }

    // 清除所有定时器
    for (const timer of this.sessionTimers.values()) {
      clearTimeout(timer);
    }
    this.sessionTimers.clear();
  }
}

/**
 * 创建会话管理器
 */
export function createSessionManager(
  options: SessionManagerOptions
): SessionManager {
  return new SessionManager(options);
}

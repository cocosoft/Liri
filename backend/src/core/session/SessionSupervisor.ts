/**
 * SessionSupervisor 会话监管器
 * 负责会话生命周期管理：健康检查、空闲检测、自动回收
 */

/** 会话摘要信息（供监管器评估用） */
export interface SessionSummary {
  id: string;
  lastActivityAt: number;
  status: string;
  createdAt: number;
}

/** 会话存储适配接口 */
export interface SessionStore {
  listSessions(): Promise<SessionSummary[]>;
  markIdle(sessionId: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
}

/** 监管器配置 */
export interface SessionSupervisorConfig {
  /** 空闲阈值（毫秒），超过此时间无活动则标记为 stale */
  staleThreshold: number;
  /** 强制回收阈值（毫秒），超过此时间未回收则强制删除 */
  forceRecycleThreshold: number;
  /** 检查周期（毫秒） */
  checkInterval: number;
}

/** 默认配置 */
const DEFAULT_CONFIG: SessionSupervisorConfig = {
  staleThreshold: 30 * 60 * 1000,
  forceRecycleThreshold: 2 * 60 * 60 * 1000,
  checkInterval: 5 * 60 * 1000,
};

/**
 * 会话监管器
 * 定时检查所有会话的活动状态，自动标记和回收空闲会话
 */
export class SessionSupervisor {
  private store: SessionStore;
  private config: SessionSupervisorConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  /**
   * @param store - 会话存储适配器
   * @param config - 可选配置，不传则使用默认值
   */
  constructor(store: SessionStore, config?: Partial<SessionSupervisorConfig>) {
    this.store = store;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 启动定期检查
   */
  start(): void {
    if (this.timer !== null) {
      return;
    }

    this.timer = setInterval(() => {
      this.check().catch((err) => {
        console.error('[SessionSupervisor] 检查异常:', err);
      });
    }, this.config.checkInterval);

    this.timer.unref();
  }

  /**
   * 停止定期检查
   */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this.disposed = true;
    this.stop();
  }

  /**
   * 执行一次会话健康检查
   */
  async check(): Promise<void> {
    if (this.disposed) {
      return;
    }

    const now = Date.now();
    const sessions = await this.store.listSessions();

    for (const session of sessions) {
      const idleTime = now - session.lastActivityAt;

      if (session.status === 'idle' || session.status === 'ended') {
        if (idleTime >= this.config.forceRecycleThreshold) {
          await this.store.deleteSession(session.id);
        }
        continue;
      }

      if (idleTime >= this.config.staleThreshold) {
        await this.store.markIdle(session.id);
      }
    }
  }

  /**
   * 获取当前配置（只读副本）
   */
  getConfig(): SessionSupervisorConfig {
    return { ...this.config };
  }
}

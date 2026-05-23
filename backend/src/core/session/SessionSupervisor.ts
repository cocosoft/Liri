/**
 * SessionSupervisor 会话监管器
 * 负责会话生命周期管理：健康检查、空闲检测、自动回收
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { ResetPolicyDecider } from '@modules/session/policy/ResetPolicyDecider';
import type { ResetPolicy } from '@modules/session/policy/ResetPolicy';

const logger = new Logger({ level: LogLevel.INFO });

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
  /** 重置策略（可选），不设置则回退到 staleThreshold 逻辑 */
  resetPolicy?: ResetPolicy;
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
  private policyDecider: ResetPolicyDecider | null = null;

  /**
   * @param store - 会话存储适配器
   * @param config - 可选配置，不传则使用默认值
   */
  constructor(store: SessionStore, config?: Partial<SessionSupervisorConfig>) {
    this.store = store;
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (this.config.resetPolicy) {
      this.policyDecider = new ResetPolicyDecider();
    }
  }

  /**
   * 设置或更新重置策略
   */
  setResetPolicy(policy: ResetPolicy): void {
    this.config.resetPolicy = policy;
    if (!this.policyDecider) {
      this.policyDecider = new ResetPolicyDecider();
    }
  }

  /**
   * 获取当前重置策略
   */
  getResetPolicy(): ResetPolicy | undefined {
    return this.config.resetPolicy;
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
        logger.error('[SessionSupervisor] 检查异常:', err);
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

      if (this.policyDecider && this.config.resetPolicy) {
        const action = this.policyDecider.evaluate(
          {
            id: session.id,
            lastActivityAt: session.lastActivityAt,
            createdAt: session.createdAt,
            status: session.status,
          },
          this.config.resetPolicy
        );

        if (action.action === 'mark_idle') {
          await this.store.markIdle(session.id);
        } else if (action.action === 'reset') {
          await this.store.markIdle(session.id);
          if (!this.config.resetPolicy.preserveMetadata) {
            logger.warn(`[SessionSupervisor] 会话 ${session.id} 每日重置触发`);
          }
        }
      } else {
        if (idleTime >= this.config.staleThreshold) {
          await this.store.markIdle(session.id);
        }
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

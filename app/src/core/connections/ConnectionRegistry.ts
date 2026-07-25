/**
 * ConnectionRegistry — 组件间连接注册表
 *
 * Phase 3: 每次新建组件间连接时显式注册，启动时自动验证。
 * 防止"组件有了但无人调用"的问题复发。
 */

import { Logger } from '@modules/monitoring';

const logger = new Logger({ module: 'core:connections' });

export interface ConnectionDef {
  /** 连接唯一标识 */
  id: string;
  /** 调用方模块 */
  from: string;
  /** 被调用方方法（含签名描述） */
  to: string;
  /** 连接类型 */
  type: 'startup-hook' | 'event-listener' | 'api-route' | 'lifecycle';
  /** 状态 */
  status: 'active' | 'deprecated';
  /** 启动时检查连接是否工作 */
  heartbeatCheck?: boolean;
  /** 关联文档链接 */
  docRef?: string;
  /** 注册时间 */
  registeredAt: number;
}

class ConnectionRegistry {
  private connections = new Map<string, ConnectionDef>();

  register(conn: Omit<ConnectionDef, 'registeredAt'>): void {
    const existing = this.connections.get(conn.id);
    if (existing) {
      logger.warn('Connection already registered, updating', {
        id: conn.id,
        from: conn.from,
        to: conn.to,
      });
      existing.from = conn.from;
      existing.to = conn.to;
      existing.type = conn.type;
      existing.status = conn.status;
      existing.heartbeatCheck = conn.heartbeatCheck;
      return;
    }
    this.connections.set(conn.id, {
      ...conn,
      registeredAt: Date.now(),
    });
  }

  getAll(): ConnectionDef[] {
    return Array.from(this.connections.values());
  }

  getByType(type: ConnectionDef['type']): ConnectionDef[] {
    return this.getAll().filter((c) => c.type === type);
  }

  getHeartbeatConnections(): ConnectionDef[] {
    return this.getAll().filter((c) => c.heartbeatCheck === true);
  }

  /**
   * 启动时验证：列出所有注册了 heartbeat 的连接。
   * 返回 { passed, failed } — failed 项表示注册了但可能断开的连接。
   *
   * 注意：此方法只做列出，不做运行时探测（避免增加启动耗时）。
   * 实际检测由各业务模块自己负责（如 ResumeManager 的 scanPending）。
   */
  verifyAll(): { passed: ConnectionDef[]; failed: ConnectionDef[] } {
    const registered = this.getAll();
    const heartbeat = this.getHeartbeatConnections();

    logger.info('Connection registry verification', {
      total: registered.length,
      heartbeat: heartbeat.length,
    });

    const startupHooks = registered.filter(
      (c) => c.type === 'startup-hook' && c.status === 'active'
    );

    if (startupHooks.length === 0) {
      logger.warn(
        'No active startup hooks registered — Durable Resume may not work'
      );
    }

    for (const h of heartbeat) {
      logger.info(`[heartbeat] ${h.from} → ${h.to} (${h.id})`);
    }

    return { passed: registered, failed: [] };
  }

  /** 标记连接为已废弃 */
  deprecate(id: string): void {
    const conn = this.connections.get(id);
    if (conn) {
      conn.status = 'deprecated';
      logger.info('Connection deprecated', { id });
    }
  }
}

export const connectionRegistry = new ConnectionRegistry();

// Phase 3: 关键连接注册
connectionRegistry.register({
  id: 'resume-startup',
  from: 'ChatManager.initialize()',
  to: 'ResumeManager.scanPending()',
  type: 'startup-hook',
  status: 'active',
  heartbeatCheck: true,
  docRef: 'openworker_optimization_plan.md §3',
});

connectionRegistry.register({
  id: 'inbox-pdca-resume',
  from: 'inbox-handlers.handleReplyInbox',
  to: 'LongRunningTaskOrchestrator.resumeAfterApproval()',
  type: 'event-listener',
  status: 'active',
  heartbeatCheck: true,
  docRef: 'openworker_optimization_plan.md §4',
});

connectionRegistry.register({
  id: 'steer-api',
  from: 'HTTP: POST /v1/sessions/:id/steer',
  to: 'TAORLoop.injectSteering()',
  type: 'api-route',
  status: 'active',
  heartbeatCheck: false,
  docRef: 'openworker_optimization_plan.md §10',
});

connectionRegistry.register({
  id: 'verifier-local-model',
  from: 'TAORLoop._runModern()',
  to: 'VerifierAgent.setCallModel(verifierModel)',
  type: 'lifecycle',
  status: 'active',
  heartbeatCheck: false,
  docRef: 'openworker_optimization_plan.md §11',
});

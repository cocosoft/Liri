import { randomUUID } from 'crypto';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
// 多租户 P3（2026-10-21）：内存累计按身份分桶，读侧只回当前身份
import { getRequestPrincipalKey } from '@modules/core/identity/requestScope.js';

const logger = getLogger('analytics');

interface AnalyticsSession {
  id: string;
  startTime: number;
  lastActivity: number;
  user_id: string;
  interactionCount: number;
  totalDuration: number;
  operations: Array<{ type: string; count: number; totalDuration: number }>;
  endTime?: number;
}

/** 单个身份的工具调用累计（本地身份恒 `local:local` 一桶） */
interface ToolCallBucket {
  toolCallCounts: Map<string, number>;
  totalToolCalls: number;
}

/**
 * 分析服务 - 负责事件追踪、会话管理等
 */
export class AnalyticsService {
  private events: Record<string, unknown>[] = [];
  private sessions: Map<string, AnalyticsSession> = new Map();
  private eventSequence: number = 0;
  private maxEvents: number = 50000;
  private maxSessions: number = 1000;
  private sessionTimeout: number = 1800000; // 30分钟
  /**
   * 工具调用计数**按身份分桶**（多租户 P3）：此前是进程级单值 ⇒ 任一身份读到的
   * 都是所有人合计。本地身份恒 `local:local` 一个桶 ⇒ 桌面/CLI 数值逐字不变。
   */
  private toolCallBuckets: Map<string, ToolCallBucket> = new Map();
  private listeners: Map<string, Array<(...args: unknown[]) => void>> =
    new Map();
  static instance: AnalyticsService;

  /**
   * 追踪事件
   * @param type 事件类型
   * @param name 事件名称
   * @param metadata 事件元数据
   * @returns 事件ID
   */
  trackEvent(
    type: string,
    name: string,
    metadata: Record<string, unknown> = {}
  ) {
    const eventId = randomUUID();
    const timestamp = Date.now();
    const ownerKey = getRequestPrincipalKey();
    const event = {
      id: eventId,
      type,
      name,
      metadata: {
        timestamp,
        ...metadata,
      },
      timestamp,
      sequence: this.eventSequence++,
      /** 归属身份键（读侧按它过滤；本地身份恒 `local:local`） */
      ownerKey,
    };

    this.events.push(event);

    // 触发事件跟踪回调
    this.emit('eventTracked', event);

    // 限制事件队列大小
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    // 独立累计工具调用计数（不受队列清空影响），按身份分桶
    if (['tool_call', 'tool_execute', 'tool_result'].includes(type)) {
      const toolName = String(metadata?.tool_name || name || 'unknown');
      const bucket = this.bucketOf(ownerKey);
      bucket.toolCallCounts.set(
        toolName,
        (bucket.toolCallCounts.get(toolName) || 0) + 1
      );
      bucket.totalToolCalls++;
    }

    return eventId;
  }

  /** 取（必要时创建）指定身份的工具调用桶 */
  private bucketOf(ownerKey: string): ToolCallBucket {
    let bucket = this.toolCallBuckets.get(ownerKey);
    if (!bucket) {
      bucket = { toolCallCounts: new Map(), totalToolCalls: 0 };
      this.toolCallBuckets.set(ownerKey, bucket);
    }
    return bucket;
  }

  /**
   * 记录事件（简化的接口）
   * @param eventName 事件名称
   * @param metadata 事件元数据
   * @returns 事件ID
   */
  logEvent(eventName: string, metadata: Record<string, unknown> = {}) {
    return this.trackEvent(eventName, eventName, metadata);
  }

  /**
   * 开始会话
   * @param userId 用户ID
   * @returns 会话ID
   */
  startSession(userId: string) {
    const sessionId = randomUUID();
    const session = {
      id: sessionId,
      startTime: Date.now(),
      lastActivity: Date.now(),
      user_id: userId,
      interactionCount: 0,
      totalDuration: 0,
      operations: [],
    };

    this.sessions.set(sessionId, session);
    return sessionId;
  }

  /**
   * 获取会话信息
   * @param sessionId 会话ID
   * @returns 会话信息
   */
  getSession(sessionId: string) {
    return this.sessions.get(sessionId);
  }

  /**
   * 获取所有会话
   * @returns 会话列表
   */
  getAllSessions() {
    return Array.from(this.sessions.values());
  }

  /**
   * 获取事件
   * @param options 查询选项
   * @returns 事件列表
   */
  getEvents(options: Record<string, unknown> = {}) {
    // 只回当前身份的埋点（本地身份 ⇒ 读 `local:local` 桶，桌面/CLI 与改造前一致）
    const ownerKey = getRequestPrincipalKey();
    let result = this.events.filter((event) => event.ownerKey === ownerKey);

    if (options.type) {
      result = result.filter((event) => event.type === options.type);
    }

    if (options.name) {
      result = result.filter((event) => event.name === options.name);
    }

    if (options.startTime) {
      result = result.filter(
        (event) => (event.timestamp as number) >= (options.startTime as number)
      );
    }

    if (options.endTime) {
      result = result.filter(
        (event) => (event.timestamp as number) <= (options.endTime as number)
      );
    }

    if (options.limit) {
      result = result.slice(0, options.limit as number);
    }

    return result;
  }

  /**
   * 结束会话
   * @param sessionId 会话ID
   */
  endSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.endTime = Date.now();
    session.totalDuration = session.endTime - session.startTime;
    this.emit('sessionEnded', session);
  }

  /**
   * 更新会话活动
   * @param sessionId 会话ID
   * @param operationType 操作类型
   * @param duration 操作持续时间
   */
  updateSessionActivity(
    sessionId: string,
    operationType: string,
    duration: number
  ) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.lastActivity = Date.now();
    session.interactionCount++;
    session.totalDuration = session.lastActivity - session.startTime;

    let operation = session.operations.find(
      (op: Record<string, unknown>) => op.type === operationType
    );
    if (!operation) {
      operation = { type: operationType, count: 0, totalDuration: 0 };
      session.operations.push(operation);
    }

    operation.count++;
    operation.totalDuration += duration;

    this.emit('sessionUpdated', session);
  }

  /**
   * 清理过期会话
   */
  clearExpiredSessions() {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastActivity > this.sessionTimeout) {
        this.clearSession(sessionId);
      }
    }
  }

  /**
   * 清理会话
   * @param sessionId 会话ID
   */
  clearSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.emit('sessionCleared', session);
      this.sessions.delete(sessionId);
    }
  }

  /**
   * 清除所有会话
   */
  clearAllSessions() {
    this.sessions.clear();
  }

  /**
   * 删除租户后丢弃该租户的**内存累计**（多租户 P5）。
   *
   * 丢两处：① 工具调用桶（`<tenantId>:` 前缀）—— 否则同名新租户一上来就带上旧读数；
   * ② 事件队列里归属该租户的条目 —— 读侧虽按 `ownerKey` 过滤（不跨身份可见），但留下
   * 只会让"删了又建"的同一标识读到上一世的事件。
   *
   * 本地桶键恒 `local:local`、其他租户前缀不同 ⇒ 零影响。会话表（`sessions`）按会话 id
   * 记账、**未带归属键**，不在本方法内（随 `clearExpiredSessions` / 重启收敛）。
   *
   * @returns 丢弃的**工具调用桶**数（事件条目另行过滤，不计入返回数）
   */
  forgetForTenant(tenantId: string): number {
    const prefix = `${tenantId}:`;
    let dropped = 0;
    for (const key of [...this.toolCallBuckets.keys()]) {
      if (!key.startsWith(prefix)) continue;
      this.toolCallBuckets.delete(key);
      dropped += 1;
    }
    this.events = this.events.filter(
      (event) =>
        typeof event.ownerKey !== 'string' || !event.ownerKey.startsWith(prefix)
    );
    return dropped;
  }

  /**
   * 获取统计信息
   * @returns 统计信息
   */
  getStats() {
    const ownerKey = getRequestPrincipalKey();
    const events = this.events.filter((event) => event.ownerKey === ownerKey);
    const eventCounts: Record<string, unknown> = {};
    for (const event of events) {
      eventCounts[event.type as string] =
        ((eventCounts[event.type as string] as number) || 0) + 1;
    }
    const bucket = this.toolCallBuckets.get(ownerKey);

    return {
      totalEvents: events.length,
      totalSessions: this.sessions.size,
      activeSessions: this.getActiveSessions().length,
      totalToolCalls: bucket?.totalToolCalls ?? 0,
      toolCallCounts: Object.fromEntries(bucket?.toolCallCounts ?? []),
      eventCounts,
    };
  }

  /**
   * 获取工具调用统计
   * @returns 工具调用统计
   */
  getToolCallStats(): {
    totalCalls: number;
    uniqueTools: number;
    topTools: Array<{ name: string; count: number }>;
  } {
    // 只统计当前身份（多租户 P3；此前是进程级合计）
    const bucket = this.toolCallBuckets.get(getRequestPrincipalKey());
    const toolCallCounts = bucket?.toolCallCounts ?? new Map<string, number>();
    const sorted = [...toolCallCounts.entries()]
      .sort((a: [string, number], b: [string, number]) => b[1] - a[1])
      .slice(0, 10);

    return {
      totalCalls: bucket?.totalToolCalls ?? 0,
      uniqueTools: toolCallCounts.size,
      topTools: sorted.map(([tool, count]) => ({ name: tool, count })),
    };
  }

  /**
   * 获取活跃会话
   * @param timeout 超时时间（毫秒）
   * @returns 活跃会话列表
   */
  getActiveSessions(timeout: number = 300000) {
    const now = Date.now();
    const activeSessions: AnalyticsSession[] = [];

    for (const session of this.sessions.values()) {
      if (now - session.lastActivity <= timeout) {
        activeSessions.push(session);
      }
    }

    return activeSessions;
  }

  /**
   * 发出事件
   * @param event 事件名称
   * @param data 事件数据
   */
  emit(event: string, data: unknown) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (err) {
          void handleError(
            err instanceof Error ? err : new Error(String(err)),
            { module: 'analytics:service', action: 'emit' }
          );
          logger.error(`事件处理器执行失败 [${event}]`, err as Error);
        }
      }
    }
  }

  /**
   * 注册事件监听器
   * @param event 事件名称
   * @param handler 事件处理函数
   */
  on(event: string, handler: (...args: unknown[]) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
  }

  /**
   * 事件计数
   */
  get eventCounts(): Record<string, unknown> {
    const ownerKey = getRequestPrincipalKey();
    const counts: Record<string, unknown> = {};
    for (const event of this.events) {
      if (event.ownerKey !== ownerKey) continue;
      counts[event.type as string] =
        ((counts[event.type as string] as number) || 0) + 1;
    }
    return counts;
  }
}

// 创建全局单例
AnalyticsService.instance = new AnalyticsService();
export const analyticsService = AnalyticsService.instance;

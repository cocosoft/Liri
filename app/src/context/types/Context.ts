export interface Context {
  type: string;
  createdAt: Date;
}

/**
 * 会话上下文（注入 AsyncContextStorage）
 * 在 SessionGateway 入口处自动注入，深层调用链可通过 getCurrentSessionContext() 获取
 */
export interface SessionContext extends Context {
  type: 'session';
  sessionId: string;
  userId: string;
  agentName?: string;
  channelType?: string;
}

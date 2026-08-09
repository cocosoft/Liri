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

/**
 * 协作者上下文（ContextFactory 创建）
 */
export interface TeammateContext extends Context {
  name: string;
  role: string;
  status: string;
}

/**
 * 用户上下文（ContextFactory 创建）
 */
export interface UserContext extends Context {
  id: string;
  name: string;
  email: string;
  preferences: Record<string, unknown>;
}

/**
 * 工作负载上下文（ContextFactory 创建）
 */
export interface WorkloadContext extends Context {
  workload: string;
}

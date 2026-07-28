import type { WorkloadContext } from './types/WorkloadContext';
import type { TeammateContext } from './types/TeammateContext';
import type { ToolUseContext } from './types/ToolUseContext';
import type { SessionContext } from './types/SessionContext';
import type { UserContext } from './types/UserContext';
import type { Context } from './types/Context';

export interface TeammateContextConfig {
  name: string;
  role: string;
  status: string;
}

export interface ToolUseContextOptions {
  toolName: string;
  toolInput: Record<string, unknown>;
  sessionId: string;
  /** 渠道来源标识（如 'wechat', 'dingtalk'），用于 Cron 任务结果回传 */
  channelId?: string;
  /** 渠道会话标识，用于恢复渠道上下文 */
  channelSessionId?: string;
}

export interface UserInfo {
  id: string;
  name: string;
  email: string;
  preferences: Record<string, unknown>;
}

export class ContextFactory {
  createWorkloadContext(workload: string): WorkloadContext {
    return {
      type: 'workload',
      workload,
      createdAt: new Date(),
    };
  }

  createTeammateContext(config: TeammateContextConfig): TeammateContext {
    return {
      type: 'teammate',
      ...config,
      createdAt: new Date(),
    };
  }

  createToolUseContext(options: ToolUseContextOptions): ToolUseContext {
    return {
      type: 'tool-use',
      toolName: options.toolName,
      toolInput: options.toolInput,
      sessionId: options.sessionId,
      channelId: options.channelId,
      channelSessionId: options.channelSessionId,
      createdAt: new Date(),
    };
  }

  createSessionContext(sessionId: string): SessionContext {
    return {
      type: 'session',
      sessionId,
      createdAt: new Date(),
    };
  }

  createUserContext(user: UserInfo): UserContext {
    return {
      type: 'user',
      ...user,
      createdAt: new Date(),
    };
  }

  createContext<T extends Context>(data: T): T {
    return {
      ...data,
      createdAt: new Date(),
    };
  }
}

export const contextFactory = new ContextFactory();

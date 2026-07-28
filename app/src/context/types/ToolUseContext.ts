import type { Context } from './Context';

export interface ToolUseContext extends Context {
  toolName: string;
  toolInput: Record<string, unknown>;
  sessionId: string;
  /** 渠道来源标识（如 'wechat', 'dingtalk'），用于 Cron 任务结果回传 */
  channelId?: string;
  /** 渠道会话标识，用于恢复渠道上下文 */
  channelSessionId?: string;
}

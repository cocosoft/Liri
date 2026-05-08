//
/**
 * Chat Hook Executor
 * 处理 Chat 相关事件的 Hook 执行器
 */

import {
  IndividualHookConfig,
  HookExecutionResult,
  HookExecutionContext,
} from '../types';
import { HookExecutor } from './HookExecutor';

/**
 * Chat Hook 事件类型
 */
export type ChatHookEvent =
  | 'ChatPreMessage'
  | 'ChatPostMessage'
  | 'ChatPreToolCall'
  | 'ChatPostToolCall'
  | 'ChatPreStream'
  | 'ChatPostStream'
  | 'ChatSessionStart'
  | 'ChatSessionEnd';

/**
 * Chat Hook 数据
 */
export interface ChatHookData {
  sessionId?: string;
  message?: string;
  messages?: any[];
  toolCall?: {
    id: string;
    name: string;
    arguments: Record<string, any>;
  };
  toolResult?: {
    toolCallId: string;
    toolName: string;
    result: any;
    error?: string;
  };
  response?: any;
  error?: string;
}

/**
 * Chat Hook Executor
 * 专门处理 Chat 相关事件的 Hook 执行
 */
export class ChatHookExecutor {
  private hookExecutor: HookExecutor;
  private hookManager: any;

  constructor(hookManager: any) {
    this.hookExecutor = new HookExecutor();
    this.hookManager = hookManager;
  }

  /**
   * 执行 Chat Hook
   * @param event Hook 事件类型
   * @param data Hook 数据
   * @returns 执行结果列表
   */
  public async executeHooks(
    event: ChatHookEvent,
    data: ChatHookData
  ): Promise<HookExecutionResult[]> {
    if (!this.hookManager) {
      return [];
    }

    try {
      return await this.hookManager.executeHooks(event, data, []);
    } catch (error) {
      console.error(`ChatHookExecutor: Failed to execute ${event}:`, error);
      return [
        {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      ];
    }
  }

  /**
   * 在发送消息前触发 Hook
   * @param message 消息内容
   * @param sessionId 会话 ID
   * @returns 修改后的消息内容（如果 Hook 修改了的话）
   */
  public async preMessage(
    message: string,
    sessionId?: string
  ): Promise<{ message: string; modified: boolean }> {
    const results = await this.executeHooks('ChatPreMessage', {
      message,
      sessionId,
    });

    let modifiedMessage = message;
    let modified = false;

    for (const result of results) {
      if (result.success && result.hookSpecificOutput?.modifiedMessage) {
        modifiedMessage = result.hookSpecificOutput.modifiedMessage;
        modified = true;
      }
    }

    return { message: modifiedMessage, modified };
  }

  /**
   * 在发送消息后触发 Hook
   * @param message 发送的消息
   * @param response 响应内容
   * @param sessionId 会话 ID
   */
  public async postMessage(
    message: string,
    response: any,
    sessionId?: string
  ): Promise<void> {
    await this.executeHooks('ChatPostMessage', {
      message,
      response,
      sessionId,
    });
  }

  /**
   * 在工具调用前触发 Hook
   * @param toolCall 工具调用信息
   * @param sessionId 会话 ID
   * @returns 是否允许执行工具
   */
  public async preToolCall(
    toolCall: { id: string; name: string; arguments: Record<string, any> },
    sessionId?: string
  ): Promise<boolean> {
    const results = await this.executeHooks('ChatPreToolCall', {
      toolCall,
      sessionId,
    });

    for (const result of results) {
      if (!result.success) {
        return false;
      }
    }

    return true;
  }

  /**
   * 在工具调用后触发 Hook
   * @param toolResult 工具执行结果
   * @param sessionId 会话 ID
   */
  public async postToolCall(
    toolResult: {
      toolCallId: string;
      toolName: string;
      result: any;
      error?: string;
    },
    sessionId?: string
  ): Promise<void> {
    await this.executeHooks('ChatPostToolCall', { toolResult, sessionId });
  }

  /**
   * 在流式发送前触发 Hook
   * @param message 消息内容
   * @param sessionId 会话 ID
   */
  public async preStream(message: string, sessionId?: string): Promise<void> {
    await this.executeHooks('ChatPreStream', { message, sessionId });
  }

  /**
   * 在流式发送后触发 Hook
   * @param message 消息内容
   * @param response 响应内容
   * @param sessionId 会话 ID
   */
  public async postStream(
    message: string,
    response: any,
    sessionId?: string
  ): Promise<void> {
    await this.executeHooks('ChatPostStream', { message, response, sessionId });
  }

  /**
   * 在会话开始时触发 Hook
   * @param sessionId 会话 ID
   */
  public async sessionStart(sessionId: string): Promise<void> {
    await this.executeHooks('ChatSessionStart', { sessionId });
  }

  /**
   * 在会话结束时触发 Hook
   * @param sessionId 会话 ID
   */
  public async sessionEnd(sessionId: string): Promise<void> {
    await this.executeHooks('ChatSessionEnd', { sessionId });
  }
}

/**
 * 创建 ChatHookExecutor 实例
 * @param hookManager Hook 管理器实例
 * @returns ChatHookExecutor 实例
 */
export function createChatHookExecutor(hookManager: any): ChatHookExecutor {
  return new ChatHookExecutor(hookManager);
}

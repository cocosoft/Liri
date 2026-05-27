/**
 * 采样后置Hook类型定义
 */

import type { Message } from '@modules/chat/types/message';
import type { ToolUseContext } from '@modules/tools/types/ToolUseContext';

/**
 * 系统提示类型
 */
export interface SystemPrompt {
  content: string;
  cacheKey?: string;
}

/**
 * 采样后置Hook上下文
 */
export interface PostSamplingHookContext {
  /** 完整消息历史，包括助手响应 */
  messages: Message[];
  /** 系统提示 */
  systemPrompt: SystemPrompt;
  /** 用户上下文 */
  userContext: Record<string, string>;
  /** 系统上下文 */
  systemContext: Record<string, string>;
  /** 工具使用上下文 */
  toolUseContext: ToolUseContext;
  /** 查询来源 */
  querySource?: string;
}

/**
 * 采样后置Hook函数类型
 */
export type PostSamplingHook = (
  context: PostSamplingHookContext
) => Promise<void> | void;

/**
 * 采样后置Hook执行结果
 */
export interface PostSamplingHookResult {
  /** Hook名称 */
  hookName: string;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
  /** 执行时间（毫秒） */
  duration?: number;
}

/**
 * 采样后置Hook配置
 */
export interface PostSamplingHookConfig {
  /** Hook名称 */
  name: string;
  /** Hook函数 */
  hook: PostSamplingHook;
  /** 是否启用 */
  enabled?: boolean;
  /** 优先级（数字越大优先级越高） */
  priority?: number;
  /** 超时时间（毫秒） */
  timeout?: number;
}

/**
 * 创建采样后置Hook上下文
 * @param options 上下文选项
 * @returns 采样后置Hook上下文
 */
export function createPostSamplingHookContext(
  options: Partial<PostSamplingHookContext>
): PostSamplingHookContext {
  return {
    messages: options.messages || [],
    systemPrompt: options.systemPrompt || { content: '' },
    userContext: options.userContext || {},
    systemContext: options.systemContext || {},
    toolUseContext: options.toolUseContext!,
    querySource: options.querySource,
  };
}

/**
 * AI 查询接口定义
 */

import type { ChatMessage } from '@modules/ai/models/types';
import type { ToolCall } from '@modules/tools/types';

/**
 * 查询参数
 */
export interface QueryParams {
  /**
   * 消息列表
   */
  messages: ChatMessage[];
  /**
   * 系统提示
   */
  systemPrompt?: string;
  /**
   * 模型名称
   */
  model?: string;
  /**
   * 工具定义列表
   */
  tools?: any[];
  /**
   * 最大 token 数
   */
  maxTokens?: number;
  /**
   * 温度参数
   */
  temperature?: number;
  /**
   * 是否启用思考
   */
  thinking?: boolean;
  /**
   * 最大查询轮次
   */
  maxTurns?: number;
  /**
   * 工具执行上下文
   */
  toolContext?: ToolContext;
  /**
   * 停止原因
   */
  stopReason?: string;
}

/**
 * 工具执行上下文
 */
export interface ToolContext {
  /**
   * 工作目录
   */
  cwd?: string;
  /**
   * 环境变量
   */
  env?: Record<string, string>;
  /**
   * 用户 ID
   */
  userId?: string;
  /**
   * 会话 ID
   */
  sessionId?: string;
}

/**
 * 查询结果
 */
export interface QueryResult {
  /**
   * LLM 响应消息
   */
  message: any;
  /**
   * 所有消息（包括工具调用）
   */
  allMessages: ChatMessage[];
  /**
   * 查询轮次
   */
  turns: number;
  /**
   * 完成原因
   */
  finishReason: 'end_turn' | 'stop_sequence' | 'max_tokens' | 'max_turns' | 'tool_use' | 'error';
  /**
   * 工具调用列表
   */
  toolCalls?: ToolCall[];
  /**
   * 错误信息
   */
  error?: string;
}

/**
 * 流式查询事件
 */
export interface StreamEvent {
  /**
   * 事件类型
   */
  type: 'content_block_start' | 'content_block_delta' | 'content_block_stop' | 'message_delta' | 'message_stop' | 'error';
  /**
   * 事件数据
   */
  data?: any;
}

/**
 * 流式查询结果
 */
export interface StreamResult {
  /**
   * 内容块增量
   */
  contentDelta?: string;
  /**
   * 内容块
   */
  contentBlock?: any;
  /**
   * 是否完成
   */
  done: boolean;
  /**
   * 最终结果
   */
  finalResult?: QueryResult;
}
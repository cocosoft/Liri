/**
 * 查询引擎核心接口
 * 定义统一查询契约，可被多种查询引擎实现
 */

import type { ChatMessage, ToolDefinition } from '@modules/ai';
import type { QueryResult, StreamEvent } from './QueryInterfaces';

/**
 * 查询钩子
 */
export interface QueryHooks {
  /** 查询前回调 */
  beforeQuery?: (messages: ChatMessage[]) => Promise<void>;
  /** 响应后回调 */
  afterResponse?: (response: QueryResult) => Promise<void>;
}

/**
 * 查询选项
 */
export interface QueryOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  maxTurns?: number;
  hooks?: QueryHooks;
}

/**
 * 查询引擎核心接口
 * query/QueryEngine、ai/services/AIQueryEngine、ai/services/QueryEngineWrapper 均可实现此接口
 */
export interface IQueryEngineCore {
  /**
   * 执行消息查询
   * @param messages 消息列表
   * @param options 查询选项
   * @returns 查询结果
   */
  query(messages: ChatMessage[], options?: QueryOptions): Promise<QueryResult>;

  /**
   * 执行流式查询
   * @param messages 消息列表
   * @param options 查询选项
   * @returns 流式事件生成器
   */
  streamQuery(
    messages: ChatMessage[],
    options?: QueryOptions
  ): AsyncIterable<StreamEvent>;

  /** 中止当前查询 */
  abort(): void;
}

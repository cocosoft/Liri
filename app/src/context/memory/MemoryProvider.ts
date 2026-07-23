/**
 * MemoryProvider 抽象接口（Phase 5）
 * 对标 hermes-agent MemoryProvider ABC
 *
 * 记忆提供者生命周期：
 *   initialize → prefetch (每轮) → syncTurn (每轮) → onSessionEnd → shutdown
 */
import type { ChatMessage } from '../../ai/models/types';

export interface MemoryRetrieveResult {
  /** 注入到 system prompt 的上下文文本 */
  systemContext: string;
  /** 诊断元数据 */
  metadata?: Record<string, unknown>;
}

export interface MemoryProvider {
  /** 提供者唯一名称 */
  readonly name: string;

  /** 是否可用 */
  isAvailable(): Promise<boolean>;

  /** 初始化（会话开始时调用） */
  initialize(sessionId: string): Promise<void>;

  /** 每轮开始时检索相关记忆 */
  prefetch(query: string, sessionId: string): Promise<MemoryRetrieveResult>;

  /** 每轮结束时同步对话内容到记忆 */
  syncTurn(
    userContent: string,
    assistantContent: string,
    sessionId: string
  ): Promise<void>;

  /** 生成注入到 system prompt 的上下文块 */
  buildSystemPromptBlock(): string;

  /** 会话结束时提取长期记忆 */
  onSessionEnd(messages: ChatMessage[], sessionId: string): Promise<void>;

  /** 关闭提供者，释放资源 */
  shutdown(): Promise<void>;
}

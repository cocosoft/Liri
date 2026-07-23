/**
 * MemoryManager — 记忆编排器（Phase 5）
 * 对标 hermes-agent MemoryManager
 *
 * 协调多个 MemoryProvider 的生命周期：
 *   会话开始 → initialize
 *   每轮开始 → prefetch
 *   每轮结束 → syncTurn
 *   压缩前   → onPreCompress
 *   会话结束 → onSessionEnd
 *
 * 支持最多 1 个外部插件 provider（可替换内置实现）
 */
import type { ChatMessage } from '../../ai/models/types';
import type { MemoryProvider, MemoryRetrieveResult } from './MemoryProvider';
import { BuiltinMemoryTool } from './BuiltinMemoryTool';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({
  module: 'context:memory:manager',
  level: LogLevel.INFO,
});

export class MemoryManager {
  private providers: MemoryProvider[] = [];
  private initialized = false;

  constructor() {
    process.emitWarning(
      'context/memory/MemoryManager 已废弃，请使用 src/memory/MemoryManagerImpl',
      'DeprecationWarning'
    );
    // 默认使用内置文件记忆
    this.providers.push(new BuiltinMemoryTool());
  }

  /** 注册外部记忆提供者（最多 1 个，替换内置） */
  addProvider(provider: MemoryProvider): void {
    this.providers = [provider];
  }

  /** 初始化所有提供者 */
  async initialize(sessionId: string): Promise<void> {
    for (const p of this.providers) {
      if (await p.isAvailable()) {
        await p.initialize(sessionId);
      }
    }
    this.initialized = true;
  }

  /** 每轮开始前检索记忆 */
  async prefetchAll(query: string, sessionId: string): Promise<string> {
    if (!this.initialized) return '';

    const parts: string[] = [];
    for (const p of this.providers) {
      try {
        const result = await p.prefetch(query, sessionId);
        if (result.systemContext) {
          parts.push(result.systemContext);
        }
      } catch (err) {
        handleError(err, {
          module: 'context:memory:manager',
          action: 'prefetch',
        });
      }
    }
    return parts.join('\n');
  }

  /** 每轮结束后同步对话 */
  async syncAll(
    userContent: string,
    assistantContent: string,
    sessionId: string
  ): Promise<void> {
    for (const p of this.providers) {
      try {
        await p.syncTurn(userContent, assistantContent, sessionId);
      } catch (err) {
        handleError(err, {
          module: 'context:memory:manager',
          action: 'sync_turn',
        });
      }
    }
  }

  /** 构建 system prompt 记忆块 */
  buildSystemPrompt(): string {
    return this.providers
      .map((p) => p.buildSystemPromptBlock())
      .filter(Boolean)
      .join('\n');
  }

  /** 压缩前提取记忆上下文 */
  async onPreCompress(messages: ChatMessage[]): Promise<string> {
    const parts: string[] = [];
    for (const p of this.providers) {
      try {
        const result = await p.prefetch('compress', '');
        if (result.systemContext) parts.push(result.systemContext);
      } catch {
        // 压缩前提取失败不阻塞压缩流程
      }
    }
    return parts.join('\n');
  }

  /** 会话结束时提取长期记忆 */
  async onSessionEnd(
    messages: ChatMessage[],
    sessionId: string
  ): Promise<void> {
    for (const p of this.providers) {
      try {
        await p.onSessionEnd(messages, sessionId);
      } catch (err) {
        handleError(err, {
          module: 'context:memory:manager',
          action: 'session_end',
        });
      }
    }
  }

  /** 关闭所有提供者 */
  async shutdown(): Promise<void> {
    for (const p of this.providers) {
      try {
        await p.shutdown();
      } catch {
        // shutdown 失败不阻塞进程退出
      }
    }
    this.initialized = false;
  }
}

/** 默认实例 */
export const memoryManager = new MemoryManager();

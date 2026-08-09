// MIT License
// Copyright (c) 2026 190615273@qq.com

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { getOTelTracing } from '@modules/monitoring/otel';
import type { ToolAwareClient } from '@modules/ai';
import type { ChatSession } from '../types/session.js';
import type { SessionAccessFacade } from './SessionAccessFacade';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'chat:memoryManager',
});

/**
 * Session Memory 管理器
 * 提取自 ChatManager._accumulateSessionMemory（L6954-L7064）
 *
 * 职责：累计每轮对话数据（token、工具调用），达到阈值时触发 LLM 提炼
 * 提炼结果写入 memory.md，供后续对话上下文注入
 */
export class SessionMemoryManager {
  constructor(
    private sessionAccess: SessionAccessFacade,
    private llmClient: ToolAwareClient | undefined,
    private chatSessions: Map<string, ChatSession>
  ) {}

  /**
   * 累计本轮对话数据，达到阈值时触发 LLM 提炼
   */
  accumulate(
    sessionId: string,
    userMessage: string,
    assistantResponse: string,
    tokens: number,
    toolCalls: number
  ): void {
    const otel = getOTelTracing();
    const span = otel.startSpan('chat:sessionMemory:accumulate', {
      'session.id': sessionId,
      'memory.tokens': tokens,
      'memory.toolCalls': toolCalls,
    });
    try {
      const mm = this.sessionAccess.getMemoryManager();
      let memory = mm.loadMemory(sessionId);
      if (memory.items.length === 0) {
        mm.initMemory(sessionId);
      }

      const input = {
        userMessage,
        assistantResponse,
        tokens,
        toolCalls,
      };
      const result = mm.accumulateTurn(memory, input);

      if (result.shouldTrigger) {
        // fire-and-forget: LLM 智能提炼 → memory.md
        const llmClient = this.llmClient;
        const session = this.chatSessions.get(sessionId);
        if (llmClient && session) {
          setImmediate(async () => {
            try {
              // 构建最近对话文本
              const recentMsgs = (session.messages || []).slice(-10);
              const conversationText = recentMsgs
                .map(
                  (m: { role: string; content: unknown }) =>
                    `[${m.role}]: ${typeof m.content === 'string' ? m.content.slice(0, 500) : ''}`
                )
                .join('\n');

              const existingMemory =
                mm.readRawMemory(sessionId) ||
                this.sessionAccess
                  .getMemoryTemplate()
                  .replace('{{lastExtraction}}', new Date().toISOString());

              // LLM 提炼
              const extractor = this.sessionAccess.createMemoryExtractor({
                sendMessage: (msgs) =>
                  llmClient
                    .sendMessage(msgs as any)
                    .then((r: { content: unknown }) => r.content as string),
              });
              const memoryContent = await extractor.extract(
                conversationText,
                existingMemory
              );

              mm.writeRawMemory(sessionId, memoryContent);
              logger.info('Session Memory LLM 提炼完成', { sessionId });
            } catch (err) {
              logger.warn('Session Memory LLM 提炼失败', {
                sessionId,
                error: String(err),
              });
              // 降级：简单追加用户消息摘要
              try {
                mm.appendToMemory(result.memory, [
                  {
                    type: 'discussion' as const,
                    content: userMessage.slice(0, 200),
                  },
                ]);
              } catch (err) {
                // 降级也失败，放弃
                handleError(err, {
                  module: 'chat:manager',
                  action: 'fallback_summarize',
                });
              }
            }
          });
        } else {
          // 无 LLM 可用：简单降级
          setImmediate(() => {
            try {
              mm.appendToMemory(result.memory, [
                {
                  type: 'discussion' as const,
                  content: userMessage.slice(0, 200),
                },
              ]);
            } catch (err) {
              /* 忽略 */
              logger.debug(
                'Memory append skipped (discussion fallback failed)',
                {
                  sessionId,
                  error: err instanceof Error ? err.message : String(err),
                }
              );
            }
          });
        }
      }
    } catch (err) {
      // 记忆系统失败不影响主流程
      logger.debug('Session Memory accumulation skipped', {
        sessionId,
        error: String(err),
      });
    } finally {
      try {
        otel.endSpan(span);
      } catch {
        /* span 可能已结束 */
      }
    }
  }
}

/**
 * RecallMemoryTool — 记忆召回工具
 *
 * 让 AI 在需要时按需查询会话记忆，而非预加载全部记忆到系统提示词。
 * 对应三层对话响应架构优化中的"外脑不用当内脑"原则。
 */

import { Tool } from '../types/Tool';
import { createToolResult } from '../types/ToolResult';
import type { ToolUseContext } from '../types/ToolUseContext';
import { ToolUtils } from '../utils/ToolUtils';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:RecallMemoryTool:RecallMemoryTool');

/** 3-2：全局记忆命中的最小接口（Memory 子集） */
interface GlobalMemoryHit {
  content: string;
  createdAt: Date;
  metadata?: { source?: string; sessionId?: string };
}

/**
 * 3-2（2026-09-03）：全局记忆 manager 惰性单例——复用共享 MemoryManagerImpl
 * （避免每调用 new 实例的多实例检索索引竞态；对齐 memory-handlers.ts 惰性单例模式）。
 */
let _globalMemoryManager: {
  getRelevantMemories(
    query: string,
    limit?: number
  ): Promise<GlobalMemoryHit[]>;
} | null = null;
async function resolveGlobalMemoryManager(): Promise<
  typeof _globalMemoryManager
> {
  if (!_globalMemoryManager) {
    try {
      const { MemoryManagerImpl } = await import('@modules/memory');
      _globalMemoryManager = new MemoryManagerImpl();
    } catch (err) {
      logger.warn('全局记忆 manager 初始化失败，回退会话内召回', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return _globalMemoryManager;
}

export class RecallMemoryTool {
  static create(): Tool {
    return {
      name: 'recall_memory',
      description:
        '查询记忆：有会话上下文时查当前会话相关记忆；无会话上下文时自动检索全局长期记忆（含梦境沉淀、PDCA 复盘等跨会话结论）。需要回顾用户偏好/历史结论/项目沉淀时使用。',
      params: [
        {
          name: 'query',
          type: 'string',
          description: '搜索关键词或问题，用于查找相关记忆',
          required: true,
        },
        {
          name: 'limit',
          type: 'number',
          description: '返回结果数量上限（默认 5）',
          required: false,
          default: 5,
        },
      ],
      aliases: ['memory', 'recall', 'remember'],
      searchHint: 'memory recall remember search memory',
      isEnabled: () => true,
      isReadOnly: () => true,
      isDestructive: () => false,
      isConcurrencySafe: () => true,
      execute: async (
        input: Record<string, unknown>,
        context: ToolUseContext
      ) => {
        const startTime = Date.now();
        const query = (input.query as string) || '';
        const limit = (input.limit as number) || 5;

        try {
          const sessionId =
            (context as { sessionId?: string })?.sessionId || '';
          let results: Array<{
            content: string;
            timestamp: string;
            source?: string;
          }> = [];

          if (query && sessionId) {
            // 会话内召回（既有语义，保持不变）
            const { getSessionMemoryManager } =
              await import('../../session/bootstrap/SessionSystemBootstrap.js');
            const mm = getSessionMemoryManager();
            const items = await mm.searchMemory(sessionId, query, limit);
            results = items.map(
              (item: { content?: string; timestamp?: string }) => ({
                content: item.content || '',
                timestamp: item.timestamp || '',
                source: 'session',
              })
            );
          } else if (query && !sessionId) {
            // 3-2（2026-09-03）：全局长效召回——无会话上下文时检索全局记忆
            // （memory_vectors 向量 + 关键词 hybridSearch，含梦境/PDCA 复盘等跨会话沉淀），
            // 来源标注 metadata.source / sessionId，缺失则标 global。
            const mm = await resolveGlobalMemoryManager();
            if (mm) {
              const memories = await mm.getRelevantMemories(query, limit);
              results = memories.map((m) => {
                const src =
                  (m.metadata?.source as string | undefined) ||
                  (m.metadata?.sessionId
                    ? `session:${m.metadata.sessionId}`
                    : 'global');
                return {
                  content: m.content || '',
                  timestamp: m.createdAt ? m.createdAt.toISOString() : '',
                  source: src,
                };
              });
            }
          } else if (sessionId) {
            // 无查询词时返回全部记忆上下文（既有语义）
            const { getSessionMemoryManager } =
              await import('../../session/bootstrap/SessionSystemBootstrap.js');
            const mm = getSessionMemoryManager();
            const ctx = mm.getMemoryContext(sessionId);
            if (ctx) {
              results = [{ content: ctx, timestamp: '', source: 'session' }];
            }
          }

          if (results.length === 0) {
            return createToolResult(
              sessionId
                ? '未找到相关记忆。'
                : '未找到全局相关记忆（如需按当前会话检索请提供会话上下文）。',
              {
                newMessages: [
                  {
                    role: 'system',
                    content: sessionId
                      ? '当前会话没有相关记忆。'
                      : '全局记忆中没有与查询相关的条目。',
                  },
                ],
              }
            );
          }

          const formatted = results
            .map((r, i) => {
              const meta = [
                r.source ? `来源:${r.source}` : '',
                r.timestamp
                  ? new Date(r.timestamp).toLocaleString('zh-CN')
                  : '',
              ]
                .filter(Boolean)
                .join(' · ');
              return `[${i + 1}]${meta ? ` (${meta})` : ''}\n${r.content}`;
            })
            .join('\n\n---\n\n');

          const executionTime = ToolUtils.calculateExecutionTime(startTime);

          return createToolResult(formatted, {
            newMessages: [
              {
                role: 'system',
                content: `已从${sessionId ? '当前会话' : '全局'}记忆中找到 ${results.length} 条相关记录（耗时 ${executionTime}ms）。`,
              },
            ],
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          return createToolResult(null, {
            newMessages: [
              {
                role: 'system',
                content: `记忆查询失败: ${errorMessage}`,
              },
            ],
          });
        }
      },
      getInfo: function () {
        return {
          name: this.name,
          description: this.description,
          params: this.params,
          aliases: this.aliases,
          enabled: this.isEnabled(),
          readOnly: this.isReadOnly(),
          destructive: this.isDestructive?.() || false,
          concurrencySafe: this.isConcurrencySafe(),
          deferred: false,
          alwaysLoad: true,
          interruptBehavior: 'block' as const,
        };
      },
    };
  }
}

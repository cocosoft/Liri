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

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'tools:RecallMemoryTool:RecallMemoryTool', level: LogLevel.INFO });

export class RecallMemoryTool {
  static create(): Tool {
    return {
      name: 'recall_memory',
      description:
        '查询当前会话中与指定关键词相关的记忆信息。当你需要回顾用户之前说过的话、用户的偏好、或之前讨论过的内容时使用此工具。',
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
          // 动态导入避免循环依赖
          const { getSessionMemoryManager } =
            await import('../../session/bootstrap/SessionSystemBootstrap.js');

          const sessionId = (context as any)?.sessionId || '';
          const mm = getSessionMemoryManager();

          let results: Array<{ content: string; timestamp: string }> = [];

          if (query && sessionId) {
            const items = await mm.searchMemory(sessionId, query, limit);
            results = items.map((item: any) => ({
              content: item.content || '',
              timestamp: item.timestamp || '',
            }));
          } else if (sessionId) {
            // 无查询词时返回全部记忆上下文
            const ctx = mm.getMemoryContext(sessionId);
            if (ctx) {
              results = [{ content: ctx, timestamp: '' }];
            }
          }

          if (results.length === 0) {
            return createToolResult('未找到相关记忆。', {
              newMessages: [
                {
                  role: 'system',
                  content: '当前会话没有相关记忆。',
                },
              ],
            });
          }

          const formatted = results
            .map((r, i) => {
              const ts = r.timestamp
                ? ` (${new Date(r.timestamp).toLocaleString('zh-CN')})`
                : '';
              return `[${i + 1}]${ts}\n${r.content}`;
            })
            .join('\n\n---\n\n');

          const executionTime = ToolUtils.calculateExecutionTime(startTime);

          return createToolResult(formatted, {
            newMessages: [
              {
                role: 'system',
                content: `已从记忆中找到 ${results.length} 条相关记录（耗时 ${executionTime}ms）。`,
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

/**
 * RecallMemoryTool — 记忆召回工具
 *
 * 让 AI 在需要时按需查询会话记忆，而非预加载全部记忆到系统提示词。
 * 对应三层对话响应架构优化中的"外脑不用当内脑"原则。
 *
 * P1-2（2026-11-25）：新增 `scope` / `type` 参数 —— 此前"有会话上下文时**只能**查会话记忆，
 * 无会话上下文时**只能**查全局"，主 Agent 无法主动跨会话检索；现在可显式选择
 * `session | global | all`，默认 `auto` 保持旧行为。
 */

import { Tool } from '@openliri/infra/utils/toolContract/Tool';
import { createToolResult } from '@openliri/infra/utils/toolContract/ToolResult';
import type { ToolUseContext } from '@openliri/infra/utils/toolContract/ToolUseContext';
import { ToolUtils } from '@modules/tools/utils/ToolUtils';

import { getLogger } from '@openliri/infra/monitoring';
import { DEFAULT_LOCALE } from '@openliri/infra/constants';
const logger = getLogger('tools:RecallMemoryTool:RecallMemoryTool');

/** 3-2：全局记忆命中的最小接口（Memory 子集） */
interface GlobalMemoryHit {
  content: string;
  createdAt: Date;
  metadata?: { source?: string; sessionId?: string; type?: string };
}

/** 会话记忆命中（`SessionMemoryManager.searchMemory` 的 MemoryItem 子集） */
interface SessionMemoryItemLike {
  content?: string;
  type?: string;
  timestamp?: string;
}

/** 会话记忆能力（窄接口，便于单测注入） */
export interface SessionMemoryLike {
  searchMemory(
    sessionId: string,
    query: string,
    topK?: number
  ): Promise<SessionMemoryItemLike[]>;
  getMemoryContext(sessionId: string): string;
}

/** 全局记忆能力（窄接口，便于单测注入） */
export interface GlobalMemoryLike {
  getRelevantMemories(
    query: string,
    limit?: number
  ): Promise<GlobalMemoryHit[]>;
}

/** 检索范围（P1-2） */
export type RecallScope = 'auto' | 'session' | 'global' | 'all';

/** 可注入依赖（缺省走真实实现；单测注入桩以避免模块级 mock） */
export interface RecallMemoryDeps {
  resolveSessionMemory?: () => Promise<SessionMemoryLike>;
  resolveGlobalMemory?: () => Promise<GlobalMemoryLike | null>;
}

/**
 * 3-2（2026-09-03）：全局记忆 manager 惰性单例——复用共享 MemoryManagerImpl
 * （避免每调用 new 实例的多实例检索索引竞态；T-①07 T1-5 起统一走 `@openliri/infra/memory`
 * `getMemoryManager()` 进程内共享工厂）。
 */
let _globalMemoryManager: GlobalMemoryLike | null = null;
async function resolveGlobalMemoryManager(): Promise<GlobalMemoryLike | null> {
  if (!_globalMemoryManager) {
    try {
      const { getMemoryManager } = await import('@openliri/infra/memory');
      _globalMemoryManager = getMemoryManager();
    } catch (err) {
      logger.warn('全局记忆 manager 初始化失败，回退会话内召回', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return _globalMemoryManager;
}

/** 默认会话记忆解析（app 会话引导层的同步单例） */
async function resolveSessionMemoryManager(): Promise<SessionMemoryLike> {
  const { getSessionMemoryManager } = await import(
    '@modules/session/bootstrap/SessionSystemBootstrap.js'
  );
  return getSessionMemoryManager();
}

/** 归一化 scope（非法值 ⇒ auto，保持旧行为） */
function normalizeScope(value: unknown): RecallScope {
  return value === 'session' || value === 'global' || value === 'all'
    ? value
    : 'auto';
}

/** 一条召回结果（内部结构） */
interface RecallHit {
  content: string;
  timestamp: string;
  source?: string;
}

/**
 * 出参结构（U-03，模型可见）：成功时恒为**格式化文本**（多条记忆以 `---` 分隔，含来源/时间）；
 * 无命中或失败时也是提示文本 ⇒ 标量 string，不带 properties。
 */
const RECALL_MEMORY_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'string',
  description:
    '格式化后的记忆条目文本（含来源与时间，条目间以 --- 分隔）；无命中或失败时为提示文本',
};

export class RecallMemoryTool {
  static create(deps: RecallMemoryDeps = {}): Tool {
    const resolveSession =
      deps.resolveSessionMemory ?? resolveSessionMemoryManager;
    const resolveGlobal =
      deps.resolveGlobalMemory ?? resolveGlobalMemoryManager;

    return {
      name: 'recall_memory',
      description:
        '查询记忆。默认（auto）有会话上下文时查当前会话、否则查全局长期记忆；可用 scope 显式选择 session/global/all（global 含梦境沉淀、PDCA 复盘等跨会话结论）。需要回顾用户偏好/历史结论/项目沉淀时使用。',
      outputJsonSchema: RECALL_MEMORY_OUTPUT_JSON_SCHEMA,
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
        {
          name: 'scope',
          type: 'string',
          description:
            '检索范围：auto=有会话上下文时查会话、否则查全局（默认）；session=仅当前会话；global=全局长期记忆（可跨会话）；all=会话与全局合并',
          required: false,
          default: 'auto',
          enum: ['auto', 'session', 'global', 'all'],
        },
        {
          name: 'type',
          type: 'string',
          description:
            '可选：按记忆类型过滤（如 decision / user_fact / session_summary）；不传=不过滤',
          required: false,
        },
      ],
      aliases: ['memory', 'recall', 'remember'],
      searchHint: 'memory recall remember search memory',
      isEnabled: () => true,
      /** PR-0：对象字面量实现无 `getRiskClass()` ⇒ 显式声明风险（lint:tool-risk 规则 3） */
      riskClass: 'read' as const,
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
        const typeFilter =
          typeof input.type === 'string' ? input.type.trim() : '';
        const requestedScope = normalizeScope(input.scope);
        const sessionId =
          (context as { sessionId?: string })?.sessionId || '';
        const scope: RecallScope =
          requestedScope === 'auto'
            ? sessionId
              ? 'session'
              : 'global'
            : requestedScope;

        try {
          const collected: RecallHit[] = [];
          const fallbackReasons: string[] = [];
          const addUnique = (hits: RecallHit[]): void => {
            for (const hit of hits) {
              if (collected.length >= limit) break;
              if (collected.some((existing) => existing.content === hit.content)) {
                continue;
              }
              collected.push(hit);
            }
          };

          if (!query) {
            // 无查询词：仅会话上下文可返回"全部记忆上下文"（既有语义）
            if ((scope === 'session' || scope === 'all') && sessionId) {
              const mm = await resolveSession();
              const ctx = mm.getMemoryContext(sessionId);
              if (ctx) {
                collected.push({ content: ctx, timestamp: '', source: 'session' });
              }
            } else {
              return createToolResult(
                '请提供 query 以检索记忆（无查询词时只能返回当前会话的全部记忆上下文）。',
                {
                  newMessages: [
                    {
                      role: 'system',
                      content: 'recall_memory 需要 query 才能检索。',
                    },
                  ],
                }
              );
            }
          } else {
            // ① 会话记忆
            if (scope === 'session' || scope === 'all') {
              if (!sessionId) {
                fallbackReasons.push('no-session-context');
              } else {
                try {
                  const mm = await resolveSession();
                  const items = await mm.searchMemory(
                    sessionId,
                    query,
                    typeFilter ? limit * 3 : limit
                  );
                  addUnique(
                    items
                      .filter((item) => !typeFilter || item.type === typeFilter)
                      .map((item) => ({
                        content: item.content || '',
                        timestamp: item.timestamp || '',
                        source: 'session',
                      }))
                  );
                } catch (err) {
                  fallbackReasons.push('session-search-failed');
                  logger.warn('会话记忆检索失败', {
                    sessionId,
                    error: err instanceof Error ? err.message : String(err),
                  });
                }
              }
            }

            // ② 全局长期记忆
            if (scope === 'global' || scope === 'all') {
              const mm = await resolveGlobal();
              if (!mm) {
                fallbackReasons.push('global-manager-unavailable');
              } else {
                try {
                  const memories = await mm.getRelevantMemories(
                    query,
                    typeFilter ? limit * 3 : limit
                  );
                  addUnique(
                    memories
                      .filter(
                        (m) =>
                          !typeFilter ||
                          (m.metadata as { type?: string } | undefined)
                            ?.type === typeFilter
                      )
                      .map((m) => ({
                        content: m.content || '',
                        timestamp: m.createdAt
                          ? m.createdAt.toISOString()
                          : '',
                        source:
                          (m.metadata?.source as string | undefined) ||
                          (m.metadata?.sessionId
                            ? `session:${m.metadata.sessionId}`
                            : 'global'),
                      }))
                  );
                } catch (err) {
                  fallbackReasons.push('global-search-failed');
                  logger.warn('全局记忆检索失败', {
                    error: err instanceof Error ? err.message : String(err),
                  });
                }
              }
            }
          }

          // P1-2：回退/零命中结构化观测（模型可见面只给结论，细节在日志）
          logger.info('recall_memory 检索完成', {
            requestedScope,
            scope,
            type: typeFilter || undefined,
            count: collected.length,
            fallbackReasons,
          });

          if (collected.length === 0) {
            const hint = fallbackReasons.includes('no-session-context')
              ? '未找到相关记忆（当前无会话上下文；可用 scope="global" 检索全局长期记忆）。'
              : fallbackReasons.includes('global-manager-unavailable')
                ? '全局记忆暂不可用，未找到相关记忆。'
                : scope === 'global'
                  ? '未找到全局相关记忆。'
                  : '未找到相关记忆。';
            return createToolResult(hint, {
              newMessages: [
                { role: 'system', content: hint },
              ],
            });
          }

          const formatted = collected
            .map((r, i) => {
              const meta = [
                r.source ? `来源:${r.source}` : '',
                r.timestamp
                  ? new Date(r.timestamp).toLocaleString(DEFAULT_LOCALE)
                  : '',
              ]
                .filter(Boolean)
                .join(' · ');
              return `[${i + 1}]${meta ? ` (${meta})` : ''}\n${r.content}`;
            })
            .join('\n\n---\n\n');

          const executionTime = ToolUtils.calculateExecutionTime(startTime);
          const scopeLabel =
            scope === 'session'
              ? '当前会话'
              : scope === 'global'
                ? '全局'
                : '会话与全局';

          return createToolResult(formatted, {
            newMessages: [
              {
                role: 'system',
                content: `已从${scopeLabel}记忆中找到 ${collected.length} 条相关记录（耗时 ${executionTime}ms）。`,
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
          // U-03：懒加载包装器从快照读 ⇒ 声明必须同时出现在 getInfo（否则等于没声明）
          outputJsonSchema: RECALL_MEMORY_OUTPUT_JSON_SCHEMA,
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

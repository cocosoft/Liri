/**
 * RecallMemoryTool — 记忆召回工具
 *
 * 让 AI 在需要时按需查询会话记忆，而非预加载全部记忆到系统提示词。
 * 对应三层对话响应架构优化中的"外脑不用当内脑"原则。
 *
 * P1-2（2026-11-25）：新增 `scope` / `type` 参数；**收集逻辑**收敛到
 * `@openliri/infra/memory#searchMemory`（infra 唯一实现；MCP `memory_search` 共用），
 * 本工具只负责参数归一与结果格式化。
 */

import { Tool } from '@openliri/infra/utils/toolContract/Tool';
import { createToolResult } from '@openliri/infra/utils/toolContract/ToolResult';
import type { ToolUseContext } from '@openliri/infra/utils/toolContract/ToolUseContext';
import { ToolUtils } from '@modules/tools/utils/ToolUtils';

import { DEFAULT_LOCALE } from '@openliri/infra/constants';

/** 会话记忆能力（窄接口；与统一服务侧结构一致，便于注入桩） */
export interface SessionMemoryLike {
  searchMemory(
    sessionId: string,
    query: string,
    topK?: number
  ): Promise<Array<{ content?: string; type?: string; timestamp?: string }>>;
  getMemoryContext(sessionId: string): string;
}

/** 全局记忆能力（窄接口） */
export interface GlobalMemoryLike {
  getRelevantMemories(
    query: string,
    limit?: number
  ): Promise<
    Array<{
      content: string;
      createdAt: Date;
      metadata?: {
        source?: string;
        sessionId?: string;
        type?: string;
        name?: string;
        tags?: string[];
      };
    }>
  >;
}

/** transcript 条目最小结构（与统一服务侧一致） */
export interface TranscriptEntryLike {
  role?: string;
  content?: unknown;
  timestamp?: number;
  lastEventSeq?: number;
}

/** 可注入依赖（缺省走真实实现；单测注入桩以避免模块级 mock） */
export interface RecallMemoryDeps {
  resolveSessionMemory?: () => Promise<SessionMemoryLike>;
  resolveGlobalMemory?: () => Promise<GlobalMemoryLike | null>;
  /** 团队记忆检索（Phase 1 共享目录；缺省走真实团队目录） */
  resolveTeamMemory?: () => Promise<{
    search(
      query: string,
      limit?: number
    ): Promise<
      Array<{
        content: string;
        timestamp: string;
        type?: string;
        name?: string;
        tags?: string[];
        id?: string;
      }>
    >;
  }>;
  /** transcript 兜底检索（记忆零命中时） */
  searchTranscript?: (
    sessionId: string,
    query: string
  ) => Promise<Array<{ entries: TranscriptEntryLike[] }>>;
}

/** 检索范围（P1-2；`team` 为团队记忆目录） */
export type RecallScope = 'auto' | 'session' | 'team' | 'global' | 'all';

/** 归一化 scope（非法值 ⇒ auto，保持旧行为） */
function normalizeScope(value: unknown): RecallScope {
  return value === 'session' ||
    value === 'team' ||
    value === 'global' ||
    value === 'all'
    ? value
    : 'auto';
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
    return {
      name: 'recall_memory',
      description:
        '查询记忆。默认（auto）有会话上下文时查当前会话、否则查全局长期记忆；可用 scope 显式选择 session/team/global/all（global 含梦境沉淀、PDCA 复盘等跨会话结论；team 为团队记忆）。需要回顾用户偏好/历史结论/项目沉淀时使用。',
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
            '检索范围：auto=有会话上下文时查会话、否则查全局（默认）；session=仅当前会话；team=团队记忆（共享目录）；global=全局长期记忆（可跨会话）；all=会话、团队与全局合并',
          required: false,
          default: 'auto',
          enum: ['auto', 'session', 'team', 'global', 'all'],
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
        const sessionId = (context as { sessionId?: string })?.sessionId || '';

        try {
          // P1-2：统一检索服务（infra 唯一实现；与 MCP `memory_search` 共用）
          const { searchMemory } = await import('@openliri/infra/memory');
          const { scope, hits, fallbackReasons } = await searchMemory(
            {
              scope: requestedScope,
              query,
              sessionId,
              type: typeFilter,
              limit,
            },
            deps
          );

          if (hits.length === 0) {
            // 2026-11-25 第 3 批：检索**失败**≠没有命中。原实现把 `*-failed` 一律渲染成
            // "未找到相关记忆"，模型会据此认为"确实没有这条记忆"而放弃重试。
            const failureReasons = fallbackReasons.filter((r) =>
              r.endsWith('-failed')
            );
            const hint = failureReasons.length
              ? `记忆检索失败（${failureReasons.join(' / ')}）：这是检索异常，**不是**"没有相关记忆"；可稍后重试，或改用其他 scope。`
              : fallbackReasons.includes('query-required')
                ? '请提供 query 以检索记忆（无查询词时只能返回当前会话的全部记忆上下文）。'
                : fallbackReasons.includes('no-session-context')
                  ? '未找到相关记忆（当前无会话上下文；可用 scope="global" 检索全局长期记忆）。'
                  : fallbackReasons.includes('global-manager-unavailable')
                    ? '全局记忆暂不可用，未找到相关记忆。'
                    : fallbackReasons.includes('transcript-no-hits')
                      ? '未找到相关记忆（原始会话记录中也没有匹配内容）。'
                      : scope === 'global'
                        ? '未找到全局相关记忆。'
                        : '未找到相关记忆。';
            return createToolResult(hint, {
              newMessages: [{ role: 'system', content: hint }],
            });
          }

          const formatted = hits
            .map((r, i) => {
              const meta = [
                r.source ? `来源:${r.source}` : '',
                r.role ? `角色:${r.role}` : '',
                typeof r.seq === 'number' ? `事件#${r.seq}` : '',
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

          const hasTranscript = hits.some((h) => h.source === 'transcript');
          return createToolResult(formatted, {
            newMessages: [
              {
                role: 'system',
                content: hasTranscript
                  ? `记忆无命中，已回退到原始会话记录：${hits.length} 条引用（耗时 ${executionTime}ms）。`
                  : `已从${scopeLabel}记忆中找到 ${hits.length} 条相关记录（耗时 ${executionTime}ms）。`,
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

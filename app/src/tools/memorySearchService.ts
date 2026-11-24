// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 记忆检索统一服务（P1-2，2026-11-25）
 *
 * 背景：`recall_memory`（工具）、MCP `memory_search`（`app/src/entrypoints/mcp-memory.ts`）
 * 此前各自拼"会话 / 全局"两套检索逻辑 —— 工具侧只在有会话上下文时查会话、MCP 只查全局。
 * 本模块把**收集逻辑**收敛为单一实现（`searchMemory`），调用方只负责参数与展示格式。
 *
 * 边界（如实）：`MemoryTool`（`packages/tool-agent/.../memory/MemoryTool.ts`）走的是
 * `SearchTool.advancedSearch`（tags / sortBy 等另一套能力），**未**并入本服务。
 */

import { getLogger } from '@openliri/infra/monitoring';

const logger = getLogger('tools:memory-search');

/** 检索范围（`auto` = 有会话上下文则 session，否则 global） */
export type MemorySearchScope = 'auto' | 'session' | 'global' | 'all';

/** 一条检索命中（跨源统一结构） */
export interface MemorySearchHit {
  content: string;
  /** ISO 时间（会话记忆项无时间 ⇒ 空串） */
  timestamp: string;
  /** 来源标注：`session` / `global` / `session:<id>` / 记忆自身的 `metadata.source` */
  source: string;
  /** 记忆类型（过滤与展示用） */
  type?: string;
  /** 全局记忆的 id / 名称 / 标签（会话命中无这些字段） */
  id?: string;
  name?: string;
  tags?: string[];
  /** 全局记忆关联的会话 id（若有） */
  sessionId?: string;
}

export interface MemorySearchOptions {
  scope?: MemorySearchScope;
  query: string;
  sessionId?: string;
  /** 按记忆类型过滤（不传 = 不过滤） */
  type?: string;
  limit?: number;
}

export interface MemorySearchOutcome {
  /** 实际生效的范围（`auto` 已解析） */
  scope: Exclude<MemorySearchScope, 'auto'>;
  hits: MemorySearchHit[];
  /**
   * 回退原因（结构化观测）：
   * `query-required` / `no-session-context` / `session-search-failed` /
   * `global-manager-unavailable` / `global-search-failed`
   */
  fallbackReasons: string[];
}

/** 会话记忆能力（窄接口） */
export interface SessionMemorySource {
  searchMemory(
    sessionId: string,
    query: string,
    topK?: number
  ): Promise<Array<{ content?: string; type?: string; timestamp?: string }>>;
  getMemoryContext(sessionId: string): string;
}

/** 全局记忆能力（窄接口） */
export interface GlobalMemorySource {
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

/** 可注入依赖（缺省走真实实现；单测注入桩） */
export interface MemorySearchDeps {
  resolveSessionMemory?: () => Promise<SessionMemorySource>;
  resolveGlobalMemory?: () => Promise<GlobalMemorySource | null>;
}

let _globalMemoryManager: GlobalMemorySource | null = null;

async function resolveGlobalMemoryManager(): Promise<GlobalMemorySource | null> {
  if (!_globalMemoryManager) {
    try {
      const { getMemoryManager } = await import('@openliri/infra/memory');
      _globalMemoryManager = getMemoryManager();
    } catch (err) {
      logger.warn('全局记忆 manager 初始化失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return _globalMemoryManager;
}

async function resolveSessionMemoryManager(): Promise<SessionMemorySource> {
  const { getSessionMemoryManager } =
    await import('@modules/session/bootstrap/SessionSystemBootstrap.js');
  return getSessionMemoryManager();
}

function normalizeLimit(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 5;
}

/**
 * 统一记忆检索（会话 / 全局 / 合并），按 `type` 过滤，按内容去重并受 `limit` 约束。
 *
 * `all` 的顺序：会话命中在前、全局命中在后（调用方据此展示）。过滤时扩采 `limit*3`
 * 再截断，避免"先截断再过滤"导致命中被误杀。
 */
export async function searchMemory(
  options: MemorySearchOptions,
  deps: MemorySearchDeps = {}
): Promise<MemorySearchOutcome> {
  const limit = normalizeLimit(options.limit);
  const query = (options.query ?? '').trim();
  const typeFilter = (options.type ?? '').trim();
  const sessionId = options.sessionId ?? '';
  const requested = options.scope ?? 'auto';
  const scope: Exclude<MemorySearchScope, 'auto'> =
    requested === 'auto' ? (sessionId ? 'session' : 'global') : requested;

  const resolveSession =
    deps.resolveSessionMemory ?? resolveSessionMemoryManager;
  const resolveGlobal = deps.resolveGlobalMemory ?? resolveGlobalMemoryManager;

  const hits: MemorySearchHit[] = [];
  const fallbackReasons: string[] = [];
  const addUnique = (items: MemorySearchHit[]): void => {
    for (const hit of items) {
      if (hits.length >= limit) break;
      if (hits.some((existing) => existing.content === hit.content)) continue;
      hits.push(hit);
    }
  };

  // 无查询词：只能返回会话记忆上下文（既有语义）
  if (!query) {
    if ((scope === 'session' || scope === 'all') && sessionId) {
      const mm = await resolveSession();
      const ctx = mm.getMemoryContext(sessionId);
      if (ctx) hits.push({ content: ctx, timestamp: '', source: 'session' });
    }
    return {
      scope,
      hits,
      fallbackReasons: hits.length === 0 ? ['query-required'] : [],
    };
  }

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
              ...(item.type ? { type: item.type } : {}),
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
            .filter((m) => !typeFilter || m.metadata?.type === typeFilter)
            .map((m) => ({
              content: m.content || '',
              timestamp: m.createdAt ? m.createdAt.toISOString() : '',
              source:
                m.metadata?.source ||
                (m.metadata?.sessionId
                  ? `session:${m.metadata.sessionId}`
                  : 'global'),
              ...(m.metadata?.type ? { type: m.metadata.type } : {}),
              ...(m.metadata?.name ? { name: m.metadata.name } : {}),
              ...(m.metadata?.tags ? { tags: m.metadata.tags } : {}),
              ...(m.metadata?.sessionId
                ? { sessionId: m.metadata.sessionId }
                : {}),
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

  logger.info('记忆检索完成', {
    requestedScope: requested,
    scope,
    type: typeFilter || undefined,
    count: hits.length,
    fallbackReasons,
  });

  return { scope, hits, fallbackReasons };
}

/**
 * 记忆检索统一服务（P1-2 / P2-2 下沉，2026-11-25）
 *
 * 归属：**infra**（唯一实现）。调用方只负责参数与展示：
 * - `recall_memory`（`packages/tool-agent`）、MCP `memory_search`、HTTP `/v1/memory/search`；
 * - `MemoryTool` / `SearchToolImpl.advancedSearch`（tags/type/sortBy 等高级过滤）。
 *
 * 依赖方向：infra ← app / tool-agent（会话记忆与 transcript 由调用方以**端口注入**，
 * infra 不反向依赖 app）。
 *
 * 默认实现（无需注入）：
 * - 全局长期记忆：本包 `getMemoryManager()`；
 * - 团队记忆：`resolveTeamMemoryDir()` + `MemoryRetrieverImpl`（无嵌入走关键词）。
 * 会话记忆 / transcript：**必须由调用方注入**（app 侧适配 `SessionMemoryManager` / 会话网关）。
 */

import { getLogger } from '@openliri/infra/monitoring';
import { resolveTeamMemoryDir } from '../../environment/paths';
import { getMemoryManager } from '../MemoryManager';
import { MemoryRetrieverImpl } from '../retrievers/MemoryRetriever';
import type { Memory } from '../types/Memory';

const logger = getLogger('memory:search');

/**
 * 检索范围（`auto` = 有会话上下文则 session，否则 global）。
 * `team` = 团队记忆目录（共享目录版落地内容，独立于个人记忆）。
 */
export type MemorySearchScope = 'auto' | 'session' | 'team' | 'global' | 'all';

/** 一条检索命中（跨源统一结构） */
export interface MemorySearchHit {
  content: string;
  /** ISO 时间（会话记忆项无时间 ⇒ 空串） */
  timestamp: string;
  /** 来源标注：`session` / `global` / `team` / `session:<id>` / 记忆自身的 `metadata.source` */
  source: string;
  /** 记忆类型（过滤与展示用） */
  type?: string;
  /** 全局/团队记忆的 id / 名称 / 标签（会话命中无这些字段） */
  id?: string;
  name?: string;
  tags?: string[];
  /** 全局记忆关联的会话 id（若有） */
  sessionId?: string;
  /** transcript 兜底：消息角色（user / assistant） */
  role?: string;
  /** transcript 兜底：消息写盘时刻的会话事件 seq（`UnifiedMessage.lastEventSeq`） */
  seq?: number;
}

/** transcript 条目最小结构（与 `UnifiedMessage` 对齐；注解条目不参与兜底） */
export interface TranscriptEntryLike {
  role?: string;
  content?: unknown;
  timestamp?: number;
  lastEventSeq?: number;
}

/** transcript 检索能力（注入桩或真实网关适配） */
export type TranscriptSearcher = (
  sessionId: string,
  query: string
) => Promise<Array<{ entries: TranscriptEntryLike[] }>>;

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
   * `query-required` / `no-session-context` / `session-search-unavailable` /
   * `session-search-failed` / `team-search-failed` / `global-manager-unavailable` /
   * `global-search-failed` / `transcript-fallback` / `transcript-no-hits` /
   * `transcript-unavailable` / `transcript-search-failed`
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
  /** 高级检索（无查询词时列全部）用；缺省 = 不可用 */
  getAllMemories?: () => Promise<Memory[]>;
}

/** 团队记忆能力（窄接口；共享目录内容，独立目录） */
export interface TeamMemorySource {
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
}

/** 可注入依赖（缺省：全局/团队走真实实现；会话/transcript 无默认值） */
export interface MemorySearchDeps {
  resolveSessionMemory?: () => Promise<SessionMemorySource>;
  resolveTeamMemory?: () => Promise<TeamMemorySource>;
  resolveGlobalMemory?: () => Promise<GlobalMemorySource | null>;
  /** transcript 兜底检索（缺省 = 不可用 ⇒ `transcript-unavailable`） */
  searchTranscript?: TranscriptSearcher;
}

async function resolveGlobalMemoryManager(): Promise<GlobalMemorySource | null> {
  try {
    return getMemoryManager();
  } catch (err) {
    logger.warn('全局记忆 manager 初始化失败', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

let teamRetrieverCache: { dir: string; retriever: MemoryRetrieverImpl } | null =
  null;

/** 默认团队记忆检索：对团队目录复用 `MemoryRetrieverImpl`；目录变更时重建实例。 */
async function resolveTeamMemorySource(): Promise<TeamMemorySource> {
  const dir = resolveTeamMemoryDir();
  if (!teamRetrieverCache || teamRetrieverCache.dir !== dir) {
    teamRetrieverCache = { dir, retriever: new MemoryRetrieverImpl(dir) };
  }
  const retriever = teamRetrieverCache.retriever;
  return {
    async search(query, limit) {
      const memories = await retriever.hybridSearch(query, limit);
      return memories.map((m) => ({
        content: m.content ?? '',
        timestamp: m.updatedAt.toISOString(),
        ...(m.metadata.type ? { type: m.metadata.type } : {}),
        ...(m.metadata.name ? { name: m.metadata.name } : {}),
        ...(m.metadata.tags ? { tags: m.metadata.tags } : {}),
        id: m.id,
      }));
    },
  };
}

/** 条目内容压成单行摘要（≤160 字符） */
function transcriptSnippet(content: unknown): string {
  const text =
    typeof content === 'string' ? content : JSON.stringify(content ?? '');
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 160 ? `${oneLine.slice(0, 160)}…` : oneLine;
}

function normalizeLimit(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 5;
}

/**
 * 统一记忆检索（会话 / 团队 / 全局 / 合并），按 `type` 过滤，按内容去重并受 `limit` 约束。
 *
 * `all` 的顺序：会话 → 团队 → 全局（调用方据此展示）。过滤时扩采 `limit*3`
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

  const resolveSession = deps.resolveSessionMemory;
  const resolveTeam = deps.resolveTeamMemory ?? resolveTeamMemorySource;
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
      if (!resolveSession) {
        fallbackReasons.push('session-search-unavailable');
      } else {
        const mm = await resolveSession();
        const ctx = mm.getMemoryContext(sessionId);
        if (ctx) hits.push({ content: ctx, timestamp: '', source: 'session' });
      }
    }
    return {
      scope,
      hits,
      fallbackReasons: hits.length === 0 ? ['query-required', ...fallbackReasons] : [],
    };
  }

  // ① 会话记忆
  if (scope === 'session' || scope === 'all') {
    if (!sessionId) {
      fallbackReasons.push('no-session-context');
    } else if (!resolveSession) {
      fallbackReasons.push('session-search-unavailable');
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

  // ①b 团队记忆（独立目录，不混入个人记忆）
  if (scope === 'team' || scope === 'all') {
    try {
      const team = await resolveTeam();
      const items = await team.search(query, typeFilter ? limit * 3 : limit);
      addUnique(
        items
          .filter((item) => !typeFilter || item.type === typeFilter)
          .map((item) => ({
            content: item.content || '',
            timestamp: item.timestamp || '',
            source: 'team',
            ...(item.type ? { type: item.type } : {}),
            ...(item.name ? { name: item.name } : {}),
            ...(item.tags ? { tags: item.tags } : {}),
            ...(item.id ? { id: item.id } : {}),
          }))
      );
    } catch (err) {
      fallbackReasons.push('team-search-failed');
      logger.warn('团队记忆检索失败', {
        error: err instanceof Error ? err.message : String(err),
      });
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

  // ③ transcript 兜底：仅"会话相关范围 + 记忆零命中"时，回退到原始会话记录
  if (
    hits.length === 0 &&
    sessionId &&
    (scope === 'session' || scope === 'all')
  ) {
    const searchTranscript = deps.searchTranscript;
    if (!searchTranscript) {
      fallbackReasons.push('transcript-unavailable');
    } else {
      try {
        const results = await searchTranscript(sessionId, query);
        const entries = (results ?? []).flatMap((r) => r.entries ?? []);
        for (const entry of entries) {
          if (hits.length >= limit) break;
          // 注解条目（无 role）不参与兜底
          if (typeof entry.role !== 'string') continue;
          const snippet = transcriptSnippet(entry.content);
          if (!snippet) continue;
          hits.push({
            content: snippet,
            timestamp:
              typeof entry.timestamp === 'number'
                ? new Date(entry.timestamp).toISOString()
                : '',
            source: 'transcript',
            role: entry.role,
            ...(typeof entry.lastEventSeq === 'number'
              ? { seq: entry.lastEventSeq }
              : {}),
          });
        }
        fallbackReasons.push(
          hits.length > 0 ? 'transcript-fallback' : 'transcript-no-hits'
        );
      } catch (err) {
        fallbackReasons.push('transcript-search-failed');
        logger.warn('transcript 兜底检索失败', {
          sessionId,
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

/** 高级检索选项（`MemoryTool` / `SearchToolImpl` 的能力面） */
export interface AdvancedMemorySearchOptions {
  query?: string;
  /** 标签（**全部**命中才保留，与原 `advancedSearch` 语义一致） */
  tags?: string[];
  type?: string;
  startDate?: Date;
  endDate?: Date;
  priority?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'relevance';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
}

/**
 * 高级检索（与 `searchMemory` 同一模块的唯一实现）。
 *
 * - 有 `query` ⇒ 复用全局记忆的语义/关键词检索（`getRelevantMemories`），
 *   `sortBy='relevance'` 保留检索顺序；
 * - 无 `query` ⇒ 列全部长期记忆（需端口提供 `getAllMemories`，缺省 = 空数组）；
 * - `tags/type/日期/priority` 过滤与 `createdAt|updatedAt` 排序在这里统一实现。
 */
export async function advancedSearchMemories(
  options: AdvancedMemorySearchOptions = {},
  deps: MemorySearchDeps = {}
): Promise<Memory[]> {
  const limit = normalizeLimit(options.limit ?? 10);
  const query = (options.query ?? '').trim();
  const resolveGlobal = deps.resolveGlobalMemory ?? resolveGlobalMemoryManager;
  const global = await resolveGlobal();
  if (!global) return [];

  const overFetch = (options.tags?.length ?? 0) > 0 || options.type ? limit * 3 : limit;
  let memories: Memory[] = query
    ? ((await global.getRelevantMemories(query, Math.max(overFetch, 100))) as Memory[])
    : global.getAllMemories
      ? await global.getAllMemories()
      : [];

  if (options.tags && options.tags.length > 0) {
    const tags = options.tags;
    memories = memories.filter(
      (m) =>
        Array.isArray(m.metadata?.tags) &&
        tags.every((tag) => m.metadata.tags!.includes(tag))
    );
  }
  if (options.type) {
    memories = memories.filter((m) => m.metadata?.type === options.type);
  }
  if (options.startDate) {
    memories = memories.filter((m) => m.createdAt >= options.startDate!);
  }
  if (options.endDate) {
    memories = memories.filter((m) => m.createdAt <= options.endDate!);
  }
  if (options.priority) {
    memories = memories.filter((m) => {
      // priority 在元数据里可能是数字或字符串：按字符串比较，保持旧行为
      const value = (m.metadata as { priority?: unknown } | undefined)?.priority;
      return value !== undefined && String(value) === options.priority;
    });
  }

  const sortBy = options.sortBy;
  if (sortBy === 'createdAt' || sortBy === 'updatedAt') {
    const desc = options.sortOrder !== 'asc';
    memories = [...memories].sort((a, b) => {
      const delta = a[sortBy].getTime() - b[sortBy].getTime();
      return desc ? -delta : delta;
    });
  }

  return memories.slice(0, limit);
}

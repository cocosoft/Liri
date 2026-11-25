// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 记忆检索统一服务 —— **app 侧适配层**（P1-2，2026-11-25；P2-2 下沉 2026-11-25）
 *
 * 单一实现在 `packages/infra/src/memory/services/MemorySearchService.ts`（infra 归属）；
 * 本文件只负责注入 app 专有能力：
 * - 会话记忆（`SessionMemoryManager`）；
 * - transcript 兜底（经 `getCoreAPI()` 取会话网关）。
 *
 * 调用方（`recall_memory` / MCP `memory_search` / HTTP）保持原有导入路径不变。
 */

import { getLogger } from '@openliri/infra/monitoring';
import {
  searchMemory as searchMemoryCore,
  type MemorySearchDeps,
  type MemorySearchOptions,
  type MemorySearchOutcome,
  type SessionMemorySource,
  type TranscriptSearcher,
} from '@openliri/infra/memory';

export type {
  MemorySearchScope,
  MemorySearchHit,
  TranscriptEntryLike,
  TranscriptSearcher,
  MemorySearchOptions,
  MemorySearchOutcome,
  SessionMemorySource,
  GlobalMemorySource,
  TeamMemorySource,
  MemorySearchDeps,
  AdvancedMemorySearchOptions,
} from '@openliri/infra/memory';

const logger = getLogger('tools:memory-search');

async function resolveSessionMemoryManager(): Promise<SessionMemorySource> {
  const { getSessionMemoryManager } =
    await import('@modules/session/bootstrap/SessionSystemBootstrap.js');
  return getSessionMemoryManager();
}

/**
 * 默认 transcript 检索：经 `getCoreAPI()` 取会话网关（`SessionGateway.searchTranscript`）。
 * 工具运行期 CoreAPI 已初始化；MCP 无会话上下文时不会走到该分支。
 */
async function resolveTranscriptSearcher(): Promise<TranscriptSearcher | null> {
  try {
    const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl.js');
    return async (sessionId, query) => {
      const results = await getCoreAPI()
        .getChatManager()
        .getSessionGateway()
        .searchTranscript(sessionId, query);
      // 把 `TranscriptEntry`（含无 role 的注解）压成最小结构后再交给服务
      return results.map((result) => ({
        entries: result.entries.map((entry) => {
          const candidate = entry as {
            role?: string;
            content?: unknown;
            timestamp?: number;
            lastEventSeq?: number;
          };
          return {
            role: candidate.role,
            content: candidate.content,
            timestamp: candidate.timestamp,
            lastEventSeq: candidate.lastEventSeq,
          };
        }),
      }));
    };
  } catch (err) {
    logger.warn('会话 transcript 检索不可用（跳过兜底）', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * 统一记忆检索（会话 / 团队 / 全局）：注入 app 能力后委托 infra 唯一实现。
 *
 * 未传 `deps.resolveGlobalMemory` / `deps.resolveTeamMemory` 时由 infra 用真实实现兜底。
 */
export async function searchMemory(
  options: MemorySearchOptions,
  deps: MemorySearchDeps = {}
): Promise<MemorySearchOutcome> {
  const transcript =
    deps.searchTranscript ?? (await resolveTranscriptSearcher());
  return searchMemoryCore(options, {
    ...deps,
    resolveSessionMemory:
      deps.resolveSessionMemory ?? resolveSessionMemoryManager,
    ...(transcript ? { searchTranscript: transcript } : {}),
  });
}

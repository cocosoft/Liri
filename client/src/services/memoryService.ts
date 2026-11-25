import { httpLegacy as http } from "./httpClient";
import { ENDPOINTS } from "./endpoints";
import { getBackendBaseUrl } from "./backendUrl";

export type MemoryType =
  | "user_identity"
  | "user_preference"
  | "project_context"
  | "knowledge"
  | "system_instruction";

export interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  summary: string;
  weight: number;
  createdAt: number;
  updatedAt: number;
  tags: string[];
  metadata: Record<string, unknown>;
}

export interface MemorySearchResult {
  memory: Memory;
  score: number;
  matchedContent: string;
}

export interface MemoryWeight {
  type: MemoryType;
  count: number;
  totalWeight: number;
  averageWeight: number;
}

export interface MemorySyncStatus {
  isSyncing: boolean;
  lastSyncTime: number | null;
  pendingChanges: number;
  syncProgress: number;
}

/** v1.2: 记忆系统运行状态（替代 MemorySyncStatus） */
export interface MemorySystemStats {
  totalMemories: number;
  withVectors: number;
  byType: Record<string, number>;
  recentCount: number;
  aging: {
    expiringCount: number;
    oldestMemoryAge: number;
    lastCleanupAt: number | null;
  };
  index: {
    indexedCount: number;
    vectorCacheSize: number;
  };
}

/** 团队记忆同步状态（与后端 `TeamMemorySyncStatus` 枚举同值） */
export type TeamMemorySyncStatus =
  | "synced"
  | "syncing"
  | "conflict"
  | "error"
  | "not_synced";

/** 团队记忆同步记录（`sync-history.jsonl` 末 10 条） */
export interface TeamMemorySyncRecordView {
  timestamp: string;
  status: TeamMemorySyncStatus;
  syncedMemories: number;
  error?: string;
}

/** 网络版团队记忆同步状态（2N-4 设置页状态；只读，不含令牌） */
export interface TeamMemoryNetworkStatus {
  /** `serverUrl` 已配置（网络版启用条件） */
  configured: boolean;
  teamId: string;
  /** 后端 `SyncStatus`：idle / syncing / success / conflict / error / not_configured */
  status: string;
  lastSyncAt: number | null;
  lastError: string | null;
}

/** 单轮同步历史（`sync-history.jsonl`，数值已收敛） */
export interface TeamSyncAuditEntry {
  at: string | null;
  pulled: number;
  pushed: number;
  pullConflicts: number;
  pushConflicts: number;
  rejectedSecrets: number;
  errors: number;
}

/** 团队记忆同步审计报表（2N-7） */
export interface TeamSyncAuditReport {
  cycles: number;
  pulled: number;
  pushed: number;
  conflicts: number;
  rejectedSecrets: number;
  errors: number;
  lastAt: string | null;
  /** 有错误的轮次占比（0..1） */
  errorRate: number;
  recent: TeamSyncAuditEntry[];
}

/** 手动触发一轮网络同步的返回（2N-8；字段与后端 `SyncResult` 同值） */
export interface TeamSyncRunResult {
  success: boolean;
  uploaded: number;
  downloaded: number;
  skipped: number;
  archived: number;
  deleted: number;
  /** 推送被密钥扫描拒发的条数（2N-9；不计入 errors） */
  rejected: number;
  conflicts: string[];
  errors: string[];
  duration: number;
}

export interface TeamMemoryStatus {
  configured: boolean;
  sharedDir: string;
  status: TeamMemorySyncStatus;
  lastSyncAt: number | null;
  records: TeamMemorySyncRecordView[];
  /** 网络版同步状态（后端 2N-4 新增；旧后端缺省） */
  network?: TeamMemoryNetworkStatus;
}

/** 冲突候选（`conflicts.json`；两侧 hash 缺失 = 该侧文件不存在） */
export interface TeamConflictCandidate {
  id: string;
  directions: string[];
  localFile: string;
  sharedFile: string;
  localHash: string | null;
  sharedHash: string | null;
  /** 候选来源：`network` = 网络版推送 412/409（无两侧文件；采纳走后端 `resolveNetworkConflict`） */
  source?: "network";
}

export type TeamConflictResolution = "keep_local" | "keep_shared";

export interface TeamConflicts {
  configured: boolean;
  sharedDir: string;
  generatedAt: string | null;
  total: number;
  candidates: TeamConflictCandidate[];
}

export interface MemorySearchParams {
  query: string;
  type?: MemoryType;
  limit?: number;
  offset?: number;
}

export interface MemoryListParams {
  type?: MemoryType;
  sortBy?: "createdAt" | "updatedAt" | "weight";
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

interface BackendSummary {
  id: string;
  contentPreview: string;
  type: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface BackendMemory {
  id: string;
  content: string;
  metadata: {
    name: string;
    description: string;
    type: string;
    tags: string[];
    priority?: number;
    createdAt: string;
    updatedAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

function toClientMemory(m: BackendMemory): Memory {
  return {
    id: m.id,
    type: (m.metadata.type as MemoryType) || "knowledge",
    content: m.content,
    summary:
      m.content.length > 100 ? m.content.slice(0, 100) + "..." : m.content,
    weight:
      typeof m.metadata.priority === "number"
        ? Math.max(1, m.metadata.priority)
        : 1,
    createdAt: new Date(m.createdAt).getTime(),
    updatedAt: new Date(m.updatedAt).getTime(),
    tags: m.metadata.tags || [],
    metadata: m.metadata as unknown as Record<string, unknown>,
  };
}

const memoryService = {
  async list(
    params?: MemoryListParams,
  ): Promise<{ memories: Memory[]; total: number }> {
    const url = new URL(ENDPOINTS.memory.base, getBackendBaseUrl());
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }
    const response = await http.get<{
      success: boolean;
      memories: BackendMemory[];
    }>(url.pathname + url.search);
    const memories = (response.memories || []).map(toClientMemory);
    return { memories, total: memories.length };
  },

  async get(id: string): Promise<Memory> {
    const response = await http.get<{
      success: boolean;
      memory: BackendMemory;
    }>(ENDPOINTS.memory.byId(id));
    return toClientMemory(response.memory);
  },

  async create(
    memory: Omit<Memory, "id" | "createdAt" | "updatedAt">,
  ): Promise<Memory> {
    const response = await http.post<{
      success: boolean;
      memory: BackendMemory;
    }>(ENDPOINTS.memory.base, memory);
    return toClientMemory(response.memory);
  },

  async update(id: string, updates: Partial<Memory>): Promise<Memory> {
    const response = await http.put<{
      success: boolean;
      memory: BackendMemory;
    }>(ENDPOINTS.memory.byId(id), updates);
    return toClientMemory(response.memory);
  },

  async delete(id: string): Promise<void> {
    await http.delete<{ success: boolean }>(ENDPOINTS.memory.byId(id));
  },

  async deleteAll(): Promise<number> {
    const response = await http.delete<{
      success: boolean;
      deletedCount: number;
    }>(ENDPOINTS.memory.base);
    return response.deletedCount;
  },

  async search(
    params: MemorySearchParams,
  ): Promise<{ results: MemorySearchResult[]; total: number }> {
    const url = new URL(ENDPOINTS.memory.search, getBackendBaseUrl());
    if (params.query) url.searchParams.set("query", params.query);
    if (params.type) url.searchParams.set("type", params.type);
    if (params.limit) url.searchParams.set("limit", String(params.limit));
    if (params.offset) url.searchParams.set("offset", String(params.offset));
    const response = await http.get<{
      success: boolean;
      memories: BackendMemory[];
    }>(url.pathname + url.search);
    const results: MemorySearchResult[] = (response.memories || []).map((m) => {
      const memory = toClientMemory(m);
      return {
        memory,
        score: 1,
        matchedContent: m.content.slice(0, 100),
      };
    });
    return { results, total: results.length };
  },

  /** 团队记忆同步状态（共享目录版 + 网络版） */
  async getTeamMemoryStatus(): Promise<TeamMemoryStatus> {
    const response = await http.get<{
      success: boolean;
      configured: boolean;
      sharedDir: string;
      status: TeamMemorySyncStatus;
      lastSyncAt: number | null;
      records: TeamMemorySyncRecordView[];
      network?: TeamMemoryNetworkStatus;
    }>(ENDPOINTS.memory.teamStatus);
    return {
      configured: response.configured,
      sharedDir: response.sharedDir,
      status: response.status,
      lastSyncAt: response.lastSyncAt,
      records: response.records || [],
      // 修复（2026-11-25）：此前漏传 `network`，面板永远看不到网络同步状态
      network: response.network,
    };
  },

  /** 团队记忆同步审计报表（2N-7：只读聚合 sync-history.jsonl） */
  async getTeamMemoryAudit(): Promise<TeamSyncAuditReport> {
    const response = await http.get<{
      success: boolean;
      report: TeamSyncAuditReport;
    }>(ENDPOINTS.memory.teamAudit);
    return response.report;
  },

  /** 团队记忆冲突候选（只读；取舍需人工点击） */
  async getTeamConflicts(): Promise<TeamConflicts> {
    const response = await http.get<{
      success: boolean;
      configured: boolean;
      sharedDir: string;
      generatedAt: string | null;
      total: number;
      candidates: TeamConflictCandidate[];
    }>(ENDPOINTS.memory.teamConflicts);
    return {
      configured: response.configured,
      sharedDir: response.sharedDir,
      generatedAt: response.generatedAt,
      total: response.total,
      candidates: response.candidates || [],
    };
  },

  /**
   * 手动触发一轮网络同步（2N-8）。
   *
   * `full=true` ⇒ 清空基线做全量重同步。未配置 `serverUrl` 或已有同步在跑时
   * 后端返回 400/409，`http` 层按错误上抛（不伪造成功）。
   */
  async triggerTeamMemorySync(full = false): Promise<TeamSyncRunResult> {
    const response = await http.post<{
      success: boolean;
      result: TeamSyncRunResult;
    }>(ENDPOINTS.memory.teamSync, { full });
    return response.result;
  },

  /** 人工采纳冲突的一侧（不自动改写；密钥命中时后端 409） */
  async resolveTeamConflict(
    id: string,
    resolution: TeamConflictResolution,
  ): Promise<void> {
    await http.post<{ success: boolean; id: string; resolution: string }>(
      ENDPOINTS.memory.teamConflictResolve,
      { id, resolution },
    );
  },

  async getSummary(id: string): Promise<BackendSummary> {
    const response = await http.get<{
      success: boolean;
      summary: BackendSummary;
    }>(ENDPOINTS.memory.summary(id));
    return response.summary;
  },

  async getWeights(): Promise<MemoryWeight[]> {
    const response = await http.get<{
      success: boolean;
      weights: MemoryWeight[];
    }>(ENDPOINTS.memory.weights);
    return response.weights || [];
  },

  async getStats(): Promise<MemorySystemStats> {
    const response = await http.get<{
      success: boolean;
      stats: MemorySystemStats;
    }>(ENDPOINTS.memory.stats);
    return response.stats;
  },

  async triggerCleanup(): Promise<{
    cleanedCount: number;
    remainingCount: number;
  }> {
    const response = await http.post<{
      success: boolean;
      result: {
        cleanedCount: number;
        remainingCount: number;
        reindexed: boolean;
      };
    }>(ENDPOINTS.memory.sync);
    return {
      cleanedCount: response.result.cleanedCount,
      remainingCount: response.result.remainingCount,
    };
  },

  async triggerConsolidate(): Promise<{
    duplicateGroups: number;
    totalRemoved: number;
    removedIds: string[];
  }> {
    const response = await http.post<{
      success: boolean;
      result: {
        duplicateGroups: number;
        totalRemoved: number;
        spaceSaved: number;
        removedIds: string[];
      };
    }>(ENDPOINTS.memory.consolidate);
    return {
      duplicateGroups: response.result.duplicateGroups,
      totalRemoved: response.result.totalRemoved,
      removedIds: response.result.removedIds,
    };
  },

  /** 从文件创建记忆 */
  async createFromFile(
    filePath: string,
    name?: string,
    tags?: string[],
  ): Promise<Memory> {
    const response = await http.post<{
      success: boolean;
      memory: BackendMemory;
    }>(ENDPOINTS.memory.createFromFile, { filePath, name, tags });
    return toClientMemory(response.memory);
  },

  /** 客户端导出为 JSON 文件 */
  async exportAllAsJson(): Promise<void> {
    const { memories } = await this.list();
    const json = JSON.stringify(memories, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `memory-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  /**
   * 触发一轮梦境
   *
   * 2026-11-25：后端改走 `DreamEngine` 管线（写 `dream_cycles` + 广播 `dream:cycle:completed`），
   * 故返回值改为「是否已执行」，处理结果经周期列表 / SSE 呈现。
   */
  async triggerDream(): Promise<{ triggered: boolean; source: string }> {
    const response = await http.post<{
      success: boolean;
      result: { triggered: boolean; source: string };
    }>(ENDPOINTS.memory.dream);
    return response.result;
  },

  /** 获取梦境周期列表 */
  async getDreamCycles(params?: {
    page?: number;
    pageSize?: number;
    triggerSource?: string;
    status?: string;
    sortOrder?: string;
  }): Promise<{
    cycles: Array<{
      cycleId: string;
      startedAt: number;
      completedAt: number;
      triggerSource: string;
      status: string;
      sessionsScanned: number;
      sessionsProcessed: number;
      memoriesCreated: number;
      memoriesRefined: number;
      knowledgeFilesUpdated: number;
      soulUpdated: boolean;
      userProfileUpdated: boolean;
      insights: string[];
      errors: string[];
      processedSessionIds: string[];
    }>;
    total: number;
  }> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.pageSize) searchParams.set("pageSize", String(params.pageSize));
    if (params?.triggerSource)
      searchParams.set("triggerSource", params.triggerSource);
    if (params?.status) searchParams.set("status", params.status);
    if (params?.sortOrder) searchParams.set("sortOrder", params.sortOrder);

    const query = searchParams.toString();
    const url = `${ENDPOINTS.memory.dreamCycles}${query ? `?${query}` : ""}`;

    const response = await http.get<{
      success: boolean;
      cycles: Array<{
        cycleId: string;
        startedAt: number;
        completedAt: number;
        triggerSource: string;
        status: string;
        sessionsScanned: number;
        sessionsProcessed: number;
        memoriesCreated: number;
        memoriesRefined: number;
        knowledgeFilesUpdated: number;
        soulUpdated: boolean;
        userProfileUpdated: boolean;
        insights: string[];
        errors: string[];
        processedSessionIds: string[];
      }>;
      total: number;
    }>(url);
    return { cycles: response.cycles, total: response.total };
  },

  /** 获取梦境周期详情 */
  async getDreamCycle(cycleId: string): Promise<{
    cycleId: string;
    startedAt: number;
    completedAt: number;
    triggerSource: string;
    status: string;
    snapshotTime: number;
    sessionsScanned: number;
    sessionsProcessed: number;
    knowledgeFilesProcessed: number;
    memoriesCreated: number;
    memoriesRefined: number;
    knowledgeFilesUpdated: number;
    soulUpdated: boolean;
    userProfileUpdated: boolean;
    processedSessionIds: string[];
    processedKnowledgeFiles: string[];
    memoryCount: number;
    insights: string[];
    errors: string[];
    soulConflicts: number;
    userConflicts: number;
  }> {
    const response = await http.get<{
      success: boolean;
      cycle: {
        cycleId: string;
        startedAt: number;
        completedAt: number;
        triggerSource: string;
        status: string;
        snapshotTime: number;
        sessionsScanned: number;
        sessionsProcessed: number;
        knowledgeFilesProcessed: number;
        memoriesCreated: number;
        memoriesRefined: number;
        knowledgeFilesUpdated: number;
        soulUpdated: boolean;
        userProfileUpdated: boolean;
        processedSessionIds: string[];
        processedKnowledgeFiles: string[];
        memoryCount: number;
        insights: string[];
        errors: string[];
        soulConflicts: number;
        userConflicts: number;
      };
    }>(ENDPOINTS.memory.dreamCycle(cycleId));
    return response.cycle;
  },
};

export { memoryService };

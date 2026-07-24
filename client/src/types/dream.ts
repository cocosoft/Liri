export interface DreamLogEntry {
  id: string;
  type: "dream:started" | "dream:completed" | "dream:failed";
  taskId: string;
  summary: string;
  sessionsCount: number;
  insightsGenerated: number;
  timestamp: number;
}

export interface DreamLogResponse {
  logs: DreamLogEntry[];
  total: number;
  stats: {
    totalCompleted: number;
    totalFailed: number;
    totalSessions: number;
    totalInsights: number;
    lastDreamAt: number | null;
  };
}

/** 梦境周期摘要（来自 /v1/memory/dream/cycles） */
export interface DreamCycleSummary {
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
}

/** 梦境周期列表响应 */
export interface DreamCycleListResponse {
  success: boolean;
  cycles: DreamCycleSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/** 梦境周期详情（来自 /v1/memory/dream/cycles/:cycleId） */
export interface DreamCycleDetail {
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
}

/** 梦境周期详情响应 */
export interface DreamCycleDetailResponse {
  success: boolean;
  cycle: DreamCycleDetail;
}

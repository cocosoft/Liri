/**
 * 驾驶舱服务（P39-b-2，2026-11-02）
 *
 * 面板嵌在「运行状况」页（`/v1/cockpit`），不新增页面。
 * 数据全部来自 P34 的 workitems + ticket_assignments；缺样本指标为 `undefined`（显示 —）。
 */
import { httpLegacy as http } from "./httpClient";
import { ENDPOINTS } from "./endpoints";

export interface CockpitItemDto {
  id: string;
  title?: string;
  facts: {
    ended?: boolean;
    latestAssignment?: { state: string; report?: string };
  };
  costTokens?: number;
  succeeded?: boolean;
  lastAction?: string;
  sessionId?: string;
}

export interface CockpitGroupDto {
  key: string;
  label: string;
  items: CockpitItemDto[];
}

export interface CockpitEffectCountsDto {
  pending: number;
  attempting: number;
  settled: number;
  failed: number;
}

export interface CockpitSnapshotDto {
  generatedAt: number;
  groups: CockpitGroupDto[];
  metrics: {
    total: number;
    personCount: number;
    humanInterventionRate: number;
    endedCount: number;
    completionRate?: number;
    avgCostTokens?: number;
  };
  /** `null` = 计数读取失败（显示 —，不按 0 计） */
  effects: CockpitEffectCountsDto | null;
}

export interface CockpitHistoryDto {
  workItem: {
    id: string;
    title?: string;
    status: string;
    updatedAt?: number;
    workspaceDir?: string;
    sessionId?: string;
  };
  assignments: Array<{
    assignmentId: string;
    executor: string;
    state: string;
    reportState?: string;
    reportText?: string;
    sessionId?: string;
    startedAt: number;
    endedAt?: number;
  }>;
  executions: Array<{
    executionId: string;
    status: string;
    startedAt: number;
    updatedAt?: number;
    sessionId?: string;
    workspaceDir?: string;
  }>;
}

export interface CockpitTakeoverDto {
  sessionId: string;
  workspaceId?: string;
}

export const cockpitService = {
  getSnapshot: async (): Promise<CockpitSnapshotDto> => {
    return http.get<CockpitSnapshotDto>(ENDPOINTS.cockpit.snapshot);
  },

  getHistory: async (workItemId: string): Promise<CockpitHistoryDto> => {
    return http.get<CockpitHistoryDto>(ENDPOINTS.cockpit.history(workItemId));
  },

  takeover: async (workItemId: string): Promise<CockpitTakeoverDto> => {
    return http.post<CockpitTakeoverDto>(
      ENDPOINTS.cockpit.takeover(workItemId),
      {},
    );
  },
};

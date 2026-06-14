/**
 * 计划/PDCA/看板 API 服务
 * 对应后端 LocalHTTPService 中的 Plans & Flows / PDCA / Kanban 处理器
 */
import { httpLegacy as http } from "./httpClient";

/* ========== 计划管理 ========== */

export interface Plan {
  id: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed" | "aborted";
  steps: PlanStep[];
  createdAt?: number;
}

export interface PlanStep {
  id: string;
  description: string;
  status: string;
  acceptanceCriteria?: string;
  retryCount: number;
  maxRetries: number;
  result?: string;
  error?: string;
}

export interface CreatePlanInput {
  goal: string;
  steps?: string[];
}

export const planService = {
  /** 获取所有计划 */
  list: async (): Promise<Plan[]> => {
    const res = await http.get<any>("/v1/plans");
    if (Array.isArray(res)) return res as Plan[];
    if (res && Array.isArray(res.data)) return res.data as Plan[];
    return [];
  },

  /** 获取单个计划详情 */
  get: async (id: string): Promise<Plan | null> => {
    try {
      const res = await http.get<Plan>(`/v1/plans/${encodeURIComponent(id)}`);
      return res ?? null as Plan | null;
    } catch {
      return null;
    }
  },

  /** 创建计划 */
  create: async (input: CreatePlanInput): Promise<Plan | null> => {
    try {
      const res = await http.post<Plan>("/v1/plans", input);
      return res ?? null as Plan | null;
    } catch {
      return null;
    }
  },

  /** 执行计划 */
  execute: async (id: string): Promise<boolean> => {
    try {
      await http.post(`/v1/plans/${encodeURIComponent(id)}/execute`, {});
      return true;
    } catch {
      return false;
    }
  },

  /** 中止计划 */
  abort: async (id: string): Promise<boolean> => {
    try {
      await http.post(`/v1/plans/${encodeURIComponent(id)}/abort`, {});
      return true;
    } catch {
      return false;
    }
  },
};

/* ========== PDCA 管理 ========== */

export interface PdcaStatus {
  taskId: string;
  planId: string;
  phase: string;
  description: string;
  plan?: Plan;
  progress?: {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
    percent: number;
  };
}

export const pdcaService = {
  /** 获取 PDCA 列表 */
  list: async (): Promise<PdcaStatus[]> => {
    try {
      const res = await http.post<any>("/v1/pdca/list", {});
      if (Array.isArray(res)) return res as PdcaStatus[];
      if (res && Array.isArray(res.data)) return res.data as PdcaStatus[];
      return [];
    } catch {
      return [];
    }
  },

  /** 获取 PDCA 状态 */
  getStatus: async (id: string): Promise<PdcaStatus | null> => {
    try {
      const res = await http.get<PdcaStatus>(`/v1/pdca/${encodeURIComponent(id)}`);
      return res ?? null as PdcaStatus | null;
    } catch {
      return null;
    }
  },

  /** 启动 PDCA */
  start: async (description: string, sessionId?: string): Promise<string | null> => {
    try {
      const res = await http.post<{ taskId: string }>("/v1/pdca/start", { description, sessionId });
      return (res as any)?.taskId ?? null;
    } catch {
      return null;
    }
  },
};

/* ========== 看板管理 ========== */

export interface KanbanCard {
  id: string;
  title: string;
  description: string;
  columnId: string;
  assignee?: string;
  priority: "high" | "medium" | "low";
  tags: string[];
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export const kanbanService = {
  /** 获取所有看板卡片 */
  list: async (): Promise<KanbanCard[]> => {
    const res: any = await http.get("/v1/kanban");
    if (Array.isArray(res)) return res as KanbanCard[];
    if (res?.data && Array.isArray(res.data)) return res.data as KanbanCard[];
    return [];
  },

  /** 创建卡片 */
  create: async (card: { title: string; description?: string; priority?: string }): Promise<boolean> => {
    try {
      await http.post("/v1/kanban", card);
      return true;
    } catch {
      return false;
    }
  },

  /** 更新卡片 */
  update: async (id: string, data: Partial<KanbanCard>): Promise<boolean> => {
    try {
      await http.put(`/v1/kanban/${encodeURIComponent(id)}`, data);
      return true;
    } catch {
      return false;
    }
  },

  /** 删除卡片 */
  delete: async (id: string): Promise<boolean> => {
    try {
      await http.delete(`/v1/kanban/${encodeURIComponent(id)}`);
      return true;
    } catch {
      return false;
    }
  },

  /** 移动卡片到其他列 */
  move: async (id: string, columnId: string): Promise<boolean> => {
    try {
      await http.post(`/v1/kanban/${encodeURIComponent(id)}/move`, { columnId });
      return true;
    } catch {
      return false;
    }
  },
};

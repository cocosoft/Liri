/**
 * GoalService — 会话级目标（`task_goals`）API 封装（X11，2026-10-05）
 *
 * 复用 HTTP 客户端唯一入口 `http`（返回 `ApiResponse<T>`），对齐 taskService.ts 范式。
 * 后端契约见 `app/src/infrastructure/http/handlers/routes/goal-routes.ts`：
 * - `GET   /v1/goals?sessionId=<id>[&active=1]` ⇒ `{ goals, count }`
 * - `POST  /v1/goals` `{ objective, sessionId?, tokenBudget? }` ⇒ `{ goal }`
 * - `PATCH /v1/goals/{id}` `{ objective?, tokenBudget? }` ⇒ `{ goal }`
 *
 * 注：本 service 仅服务聊天区会话级「目标条」；PDCA `/goal`（`goal_metrics`）由
 * planService/pdcaService 分治，二者不得混放（Spec `goal-entity.md` §D6）。
 */
import { http } from "./httpClient";
import type { TaskGoalDto } from "../types/events";
import { createLogger } from "@/utils/logger";

const logger = createLogger("services:goalService");

// ─── 响应类型（与后端 goal-routes.ts 一致） ───

interface GoalListResponse {
  goals: TaskGoalDto[];
  count: number;
}

interface GoalResponse {
  goal: TaskGoalDto;
}

export const goalService = {
  /**
   * 列出某会话的目标
   * `GET /v1/goals?sessionId=<id>[&active=1]`
   */
  async list(params: {
    sessionId: string;
    activeOnly?: boolean;
  }): Promise<TaskGoalDto[]> {
    const query: Record<string, string> = { sessionId: params.sessionId };
    if (params.activeOnly) query.active = "1";
    const res = await http.get<GoalListResponse>("/v1/goals", {
      params: query,
    });
    if (!res.ok) {
      logger.warn("获取目标列表失败", { error: res.error });
      return [];
    }
    return res.data?.goals ?? [];
  },

  /**
   * 创建目标
   * `POST /v1/goals`（`tokenBudget` 可选，须为**正有限数**，否则后端 400）
   */
  async create(params: {
    objective: string;
    sessionId?: string;
    tokenBudget?: number;
  }): Promise<TaskGoalDto | null> {
    const res = await http.post<GoalResponse>("/v1/goals", params);
    if (!res.ok) {
      logger.warn("创建目标失败", { error: res.error });
      return null;
    }
    return res.data?.goal ?? null;
  },

  /**
   * 更新目标（objective / tokenBudget）
   * `PATCH /v1/goals/{id}`（终态目标不可改写 ⇒ 后端 409）
   */
  async update(
    id: string,
    changes: { objective?: string; tokenBudget?: number },
  ): Promise<TaskGoalDto | null> {
    const res = await http.patch<GoalResponse>(
      `/v1/goals/${encodeURIComponent(id)}`,
      changes,
    );
    if (!res.ok) {
      logger.warn("更新目标失败", { error: res.error });
      return null;
    }
    return res.data?.goal ?? null;
  },
};

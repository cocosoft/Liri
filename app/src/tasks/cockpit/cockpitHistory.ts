/**
 * 驾驶舱「一件工作的完整历史」与「一键接管」判定（P39-b-2，2026-11-02）
 *
 * 方案：`dev_docs/20261102/Liri常驻自主执行升级方案-20261102.md` §5 P39。
 *
 * 纯函数：**不读库、不读时钟、不写状态** —— 数据由 HTTP 层装配后传入，便于单测与复算。
 *
 * 诚实边界：
 * - 只回放**已存在**的事实（工作项行 / 派工 / 执行）；缺数据不补造；
 * - 接管不新建会话（用户裁定 A）：没有可用会话 ⇒ `no_takeover_session`（handler 回 409）。
 */
import type { TicketAssignmentRecord } from '../ticketAssignmentStore';

/** 执行记录的最小事实（由调用方从 `ExecutionStore` 映射，app 不依赖 service 类型） */
export interface CockpitExecutionFact {
  executionId: string;
  status: string;
  startedAt: number;
  updatedAt?: number;
  sessionId?: string;
  workspaceDir?: string;
}

/** 工作项的最小事实（工作项行里只取展示所需字段） */
export interface CockpitWorkItemFact {
  id: string;
  title?: string;
  status: string;
  updatedAt?: number;
  workspaceDir?: string;
  sessionId?: string;
}

export interface CockpitHistory {
  workItem: CockpitWorkItemFact;
  /** 派工记录（按 `startedAt` 升序） */
  assignments: TicketAssignmentRecord[];
  /** 执行记录（按 `startedAt` 升序） */
  executions: CockpitExecutionFact[];
}

/** 装配完整历史（排序不改动入参；时间相同保持原相对顺序） */
export function buildCockpitHistory(input: {
  workItem: CockpitWorkItemFact;
  assignments: readonly TicketAssignmentRecord[];
  executions: readonly CockpitExecutionFact[];
}): CockpitHistory {
  return {
    workItem: { ...input.workItem },
    assignments: [...input.assignments].sort(
      (a, b) => a.startedAt - b.startedAt
    ),
    executions: [...input.executions].sort((a, b) => a.startedAt - b.startedAt),
  };
}

/**
 * 接管候选会话：**最新派工优先**，其次工作项行自身的 `session_id`。
 *
 * @returns `undefined` ⇒ 没有可接管会话（不猜、不新建；会话是否真实存在由 HTTP 层校验）
 */
export function pickTakeoverSessionId(input: {
  latestAssignmentSessionId?: string;
  workItemSessionId?: string;
}): string | undefined {
  if (input.latestAssignmentSessionId) return input.latestAssignmentSessionId;
  if (input.workItemSessionId) return input.workItemSessionId;
  return undefined;
}

/**
 * 任务编排并发/规模护栏上限集中定义（1-4，2026-09-03）
 *
 * Agent/任务编排相关的并发与规模上限单一事实来源——不再散落各文件魔法数。
 * 环境变量可覆盖（对齐 TASK_GOAL_MAX_TURNS / CHANNEL_MAX_COUNT 既有模式，启动前设置生效）：
 *   TASK_MAX_TEAMMATES        → maxTeammates      默认 10（同 session 并行 teammate 数）
 *   TASK_AGENT_CONCURRENCY    → agentConcurrency  默认 5（AgentTool 同类型并发数）
 *   TASK_SUBAGENT_DEPTH       → subagentDepth     默认 3（子代理嵌套深度）
 *   TASK_MAX_TASKS_PER_CALL   → maxTasksPerCall   默认 20（create_task_list 单次条数）
 *   TASK_MAX_SUBTASKS         → maxSubtasks       默认 5（目标分解子任务数）
 *
 * 设计约束：
 * - 本文件为零依赖 leaf（不 import @modules/config 等 barrel，避免引入模块循环
 *   导致 import-time 初始化 TDZ——此前 const 表 + configManager 曾触发 TaskDecomposer 顶层求值失败）。
 * - 以 getter 函数形式导出（每次读取 env），供模块顶层 const 安全求值。
 */

function limitFromEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isInteger(raw) && raw > 0 ? raw : fallback;
}

export interface TaskConcurrencyLimits {
  /** 同会话并行 teammate 数量上限（原 TeammateManager 魔法数 10） */
  maxTeammates: number;
  /** AgentTool 同类并发上限（原 DEFAULT_AGENT_CONFIG.maxConcurrentAgents=5） */
  agentConcurrency: number;
  /** 子代理嵌套深度上限（原 AgentTool.MAX_SUBAGENT_DEPTH=3） */
  subagentDepth: number;
  /** create_task_list 单次调用任务数上限（原 MAX_TASKS_PER_CALL=20） */
  maxTasksPerCall: number;
  /** 目标分解子任务数上限（原 TaskDecomposer.MAX_SUBTASKS=5） */
  maxSubtasks: number;
}

/** 读取当前任务并发/规模上限（env 覆盖 + 默认回退） */
export function getTaskConcurrencyLimits(): TaskConcurrencyLimits {
  return {
    maxTeammates: limitFromEnv('TASK_MAX_TEAMMATES', 10),
    agentConcurrency: limitFromEnv('TASK_AGENT_CONCURRENCY', 5),
    subagentDepth: limitFromEnv('TASK_SUBAGENT_DEPTH', 3),
    maxTasksPerCall: limitFromEnv('TASK_MAX_TASKS_PER_CALL', 20),
    maxSubtasks: limitFromEnv('TASK_MAX_SUBTASKS', 5),
  };
}

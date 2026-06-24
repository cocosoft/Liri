/**
 * 编排事件类型
 *
 * 定义 DAG 编排执行过程中的 SSE 事件流，
 * 供前端实时展示编排过程和 Rule Check Gate 状态。
 */

import { AgentEventType } from './types';

// ========== 编排事件类型扩展 ==========

/** 编排事件类型常量（扩展 AgentEventType） */
export const OrchestrationEventType = {
  // ========== DAG 编排 ==========

  /** 编排开始（含任务列表和依赖图） */
  ORCH_START: 'orch:dag:start',
  /** 单个任务开始执行 */
  ORCH_TASK_START: 'orch:dag:task:start',
  /** 任务进度更新 */
  ORCH_TASK_PROGRESS: 'orch:dag:task:progress',
  /** 单个任务完成 */
  ORCH_TASK_END: 'orch:dag:task:end',
  /** 编排完成 */
  ORCH_END: 'orch:dag:end',
  /** 编排出错 */
  ORCH_ERROR: 'orch:dag:error',
  /** 任务步骤开始 */
  ORCH_STEP_START: 'orch:dag:step:start',
  /** 任务步骤增量输出 */
  ORCH_STEP_DELTA: 'orch:dag:step:delta',
  /** 任务步骤完成 */
  ORCH_STEP_COMPLETED: 'orch:dag:step:completed',

  // ========== PLAN 计划执行 ==========

  /** 计划开始执行 */
  PLAN_START: 'orch:plan:start',
  /** 计划步骤开始 */
  PLAN_STEP_START: 'orch:plan:step:start',
  /** 计划步骤完成 */
  PLAN_STEP_COMPLETED: 'orch:plan:step:completed',
  /** 计划进度更新 */
  PLAN_PROGRESS: 'orch:plan:progress',
  /** 计划完成 */
  PLAN_COMPLETED: 'orch:plan:completed',

  // ========== Agent Chain 链式调用 ==========

  /** 链式调用开始 */
  CHAIN_START: 'orch:chain:start',
  /** 链式调用步骤事件 */
  CHAIN_STEP: 'orch:chain:step',
  /** 链式调用完成 */
  CHAIN_END: 'orch:chain:end',

  // ========== Rule Check Gate ==========

  /** 规则检查开始 */
  RULE_CHECK_START: 'orch:rule:check:start',
  /** 规则检查进度 */
  RULE_CHECK_PROGRESS: 'orch:rule:check:progress',
  /** 规则检查通过 */
  RULE_CHECK_PASS: 'orch:rule:check:pass',
  /** 规则检查失败 */
  RULE_CHECK_FAIL: 'orch:rule:check:fail',
  /** 规则检查需要人工审核 */
  RULE_CHECK_REVIEW: 'orch:rule:check:review',

  // ========== Council 辩论 ==========

  /** Council 辩论开始 */
  COUNCIL_START: 'orch:council:start',
  /** Council 辩论回合开始 */
  COUNCIL_ROUND_START: 'orch:council:round:start',
  /** Council Agent 开始发言 */
  COUNCIL_AGENT_SPEAKING: 'orch:council:agent:speaking',
  /** Council Agent 发言内容（单条完整内容） */
  COUNCIL_AGENT_DELTA: 'orch:council:agent:delta',
  /** Council 辩论回合 */
  COUNCIL_ROUND: 'orch:council:round',
  /** Council 辩论结束 */
  COUNCIL_END: 'orch:council:end',
  /** Council 辩论详情（用户追问时推送） */
  COUNCIL_DETAIL: 'orch:council:detail',

  // ========== Swarm 群组 ==========

  /** Swarm 任务分配 */
  SWARM_DISPATCH: 'orch:swarm:dispatch',
  /** Swarm Agent 状态变更 */
  SWARM_AGENT_STATUS: 'orch:swarm:agent:status',
  /** Swarm 执行完成 */
  SWARM_COMPLETE: 'orch:swarm:complete',

  // ========== 三层上下文 ==========

  /** 上下文层加载 */
  CONTEXT_LAYER_LOAD: 'orch:context:layer:load',
  /** 规则注入 */
  CONTEXT_RULE_INJECT: 'orch:context:rule:inject',

  // ========== 并行执行（方案 7） ==========

  /** 并行执行开始 */
  PARALLEL_START: 'orch:parallel:start',
  /** 并行子任务开始 */
  PARALLEL_TASK_START: 'orch:parallel:task:start',
  /** 并行子任务完成 */
  PARALLEL_TASK_COMPLETE: 'orch:parallel:task:complete',
  /** 并行执行完成 */
  PARALLEL_END: 'orch:parallel:end',

  // ========== Token 追踪（方案 0c） ==========

  /** Token 使用量上报 */
  TOKEN_USAGE: 'orch:token:usage',
} as const;

export type OrchestrationEventTypeValue =
  (typeof OrchestrationEventType)[keyof typeof OrchestrationEventType];

// ========== 编排事件数据载荷类型 ==========

/** 编排开始事件数据 */
export interface OrchStartData {
  /** 工作项 ID */
  workItemId: string;
  /** 任务定义列表 */
  tasks: Array<{
    id: string;
    name: string;
    dependsOn: string[];
  }>;
  /** 执行层级（每层可并行） */
  layers: string[][];
  /** 总任务数 */
  totalTasks: number;
}

/** 任务开始事件数据 */
export interface OrchTaskStartData {
  /** 任务 ID */
  taskId: string;
  /** 任务名称 */
  taskName: string;
  /** 所在层级 */
  layer: number;
  /** 同层并行任务数 */
  parallelCount: number;
}

/** 任务进度事件数据 */
export interface OrchTaskProgressData {
  /** 任务 ID */
  taskId: string;
  /** 进度百分比 (0-100) */
  progress: number;
  /** 进度描述 */
  message: string;
}

/** 任务完成事件数据 */
export interface OrchTaskEndData {
  /** 任务 ID */
  taskId: string;
  /** 任务名称 */
  taskName: string;
  /** 是否成功 */
  success: boolean;
  /** 结果内容 */
  content?: string;
  /** 错误信息 */
  error?: string;
  /** 耗时（毫秒） */
  durationMs: number;
}

/** 规则检查事件数据 */
export interface RuleCheckData {
  /** 检查规则 ID */
  ruleId: string;
  /** 规则名称 */
  ruleName: string;
  /** 检查的文件 */
  filePath?: string;
  /** 检查结果描述 */
  message: string;
  /** 是否通过 */
  passed: boolean;
  /** 是否需要人工审核 */
  needsReview: boolean;
}

/** Council 辩论回合数据 */
export interface CouncilRoundData {
  /** 回合编号 */
  round: number;
  /** 发言 Agent ID */
  agentId: string;
  /** 发言 Agent 名称 */
  agentName: string;
  /** 发言内容 */
  content: string;
  /** 立场（support/oppose/neutral） */
  stance: 'support' | 'oppose' | 'neutral';
  /** 置信度 (0-1) */
  confidence: number;
}

/** Council 辩论回合开始事件数据 */
export interface CouncilRoundStartData {
  /** 回合编号 */
  round: number;
  /** 总回合数 */
  totalRounds: number;
  /** session ID */
  sessionId: string;
}

/** Council Agent 开始发言事件数据 */
export interface CouncilAgentSpeakingData {
  /** Agent ID */
  agentId: string;
  /** Agent 名称 */
  agentName: string;
  /** 回合编号 */
  round: number;
  /** session ID */
  sessionId: string;
}

/** Council Agent 发言内容增量事件数据 */
export interface CouncilAgentDeltaData {
  /** Agent ID */
  agentId: string;
  /** Agent 名称 */
  agentName: string;
  /** 内容块（完整发言或增量块） */
  content: string;
  /** 回合编号 */
  round: number;
  /** 是否该 Agent 发言结束 */
  isFinal: boolean;
  /** session ID */
  sessionId: string;
}

/** Council 辩论结束数据 */
export interface CouncilEndData {
  /** 总回合数 */
  totalRounds: number;
  /** 最终结论 */
  conclusion: string;
  /** 各 Agent 投票结果 */
  votes: Array<{
    agentId: string;
    agentName: string;
    vote: 'support' | 'oppose' | 'abstain';
    reason: string;
  }>;
  /** 胜出方案 */
  winningProposal: string;
}

/** Council 辩论详情（用户追问时返回） */
export interface CouncilDetailData {
  /** 原始议题 */
  topic: string;
  /** 所有回合记录 */
  rounds: CouncilRoundData[];
  /** 辩论结论 */
  conclusion: CouncilEndData;
  /** 开始时间 */
  startTime: string;
  /** 结束时间 */
  endTime: string;
}

/** Swarm Agent 状态数据 */
export interface SwarmAgentStatusData {
  /** Agent ID */
  agentId: string;
  /** Agent 名称 */
  agentName: string;
  /** Agent 角色 */
  role: string;
  /** 状态 */
  status: 'idle' | 'running' | 'completed' | 'error';
  /** 当前任务 */
  currentTask?: string;
  /** 关联的 Agent ID */
  connections: string[];
}

/** Swarm 调度数据 */
export interface SwarmDispatchData {
  /** 总任务数 */
  totalTasks: number;
  /** Agent 分配 */
  assignments: Array<{
    agentId: string;
    taskIds: string[];
  }>;
}

// ========== 并行执行事件数据（方案 7） ==========

/** 并行执行开始事件数据 */
export interface ParallelStartData {
  /** 总任务数 */
  totalTasks: number;
  /** 任务描述列表 */
  tasks: Array<{
    description: string;
    agentType?: string;
    name?: string;
  }>;
}

/** 并行子任务开始事件数据 */
export interface ParallelTaskStartData {
  /** Agent ID */
  agentId: string;
  /** 任务名称 */
  taskName: string;
  /** 任务描述 */
  description: string;
}

/** 并行子任务完成事件数据 */
export interface ParallelTaskCompleteData {
  /** Agent ID */
  agentId: string;
  /** 任务名称 */
  taskName: string;
  /** 是否成功 */
  success: boolean;
  /** 输出内容 */
  output?: string;
  /** 错误信息 */
  error?: string;
  /** 耗时 */
  durationMs: number;
}

/** 并行执行完成事件数据 */
export interface ParallelEndData {
  /** 总任务数 */
  totalTasks: number;
  /** 成功任务数 */
  completedTasks: number;
  /** 失败任务数 */
  failedTasks: number;
}

/** 上下文层加载数据 */
export interface ContextLayerData {
  /** 层级编号 */
  layer: number;
  /** 层级名称 */
  layerName: string;
  /** 加载的内容概要 */
  summary: string;
  /** 注入的规则数 */
  rulesCount?: number;
  /** 注入的知识条目数 */
  knowledgeCount?: number;
  /** 注入的工具数 */
  toolsCount?: number;
}

/** DAG 步骤开始事件数据 */
export interface OrchStepStartData {
  /** 任务 ID */
  taskId: string;
  /** 步骤名称 */
  stepName: string;
  /** 依赖的步骤名列表 */
  dependsOn?: string[];
}

/** DAG 步骤增量输出事件数据 */
export interface OrchStepDeltaData {
  /** 任务 ID */
  taskId: string;
  /** 步骤名称 */
  stepName: string;
  /** 增量输出内容 */
  output: string;
}

/** DAG 步骤完成事件数据 */
export interface OrchStepCompletedData {
  /** 任务 ID */
  taskId: string;
  /** 步骤名称 */
  stepName: string;
  /** 耗时（毫秒） */
  duration: number;
  /** 状态 */
  status: 'success' | 'failed';
}

/** 计划开始执行事件数据 */
export interface PlanStartData {
  /** 计划 ID */
  planId: string;
  /** 计划描述 */
  description: string;
  /** 总步骤数 */
  totalSteps: number;
}

/** 计划步骤开始事件数据 */
export interface PlanStepStartData {
  /** 计划 ID */
  planId: string;
  /** 步骤索引 */
  stepIndex: number;
  /** 步骤名称 */
  stepName: string;
  /** 步骤描述 */
  description: string;
}

/** 计划步骤完成事件数据 */
export interface PlanStepCompletedData {
  /** 计划 ID */
  planId: string;
  /** 步骤索引 */
  stepIndex: number;
  /** 执行结果摘要 */
  result?: string;
}

/** 计划进度更新事件数据 */
export interface PlanProgressData {
  /** 计划 ID */
  planId: string;
  /** 已完成步骤数 */
  completedSteps: number;
  /** 总步骤数 */
  totalSteps: number;
  /** 进度百分比 (0-100) */
  percentage: number;
}

/** Agent Chain 链式调用开始事件数据 */
export interface ChainStartData {
  /** 链 ID */
  chainId: string;
  /** 链名称 */
  chainName: string;
  /** 总步骤数 */
  totalSteps: number;
  /** 输入内容 */
  input: string;
}

/** Agent Chain 步骤事件数据 */
export interface ChainStepData {
  /** 链 ID */
  chainId: string;
  /** 步骤索引（从 1 开始） */
  stepIndex: number;
  /** 总步骤数 */
  totalSteps: number;
  /** 步骤名称 */
  stepName: string;
  /** 步骤状态 */
  status: 'running' | 'completed' | 'failed' | 'skipped' | 'aborted';
  /** 输出内容 */
  output?: string;
  /** 错误信息 */
  error?: string;
  /** 耗时（毫秒） */
  durationMs?: number;
}

/** Agent Chain 链式调用完成事件数据 */
export interface ChainEndData {
  /** 链 ID */
  chainId: string;
  /** 链名称 */
  chainName: string;
  /** 最终状态 */
  status: 'completed' | 'failed' | 'aborted';
  /** 总耗时（毫秒） */
  totalDurationMs: number;
  /** 总 Token 用量 */
  totalTokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** 错误信息 */
  error?: string;
}

/** 编排状态枚举 */
export type OrchestrationStatus =
  | 'idle'
  | 'planning'
  | 'executing'
  | 'checking'
  | 'completed'
  | 'failed';

/** 编排状态快照 */
export interface OrchestrationSnapshot {
  /** 工作项 ID */
  workItemId: string;
  /** 编排状态 */
  status: OrchestrationStatus;
  /** 任务进度 */
  tasks: Array<{
    id: string;
    name: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    dependsOn: string[];
    progress: number;
    result?: string;
    error?: string;
    durationMs?: number;
  }>;
  /** 规则检查结果 */
  ruleChecks: Array<{
    ruleId: string;
    ruleName: string;
    passed: boolean;
    needsReview: boolean;
  }>;
  /** 执行层级 */
  layers: string[][];
  /** 当前层级 */
  currentLayer: number;
  /** 开始时间 */
  startTime: string;
  /** 更新时间 */
  updatedAt: string;
}

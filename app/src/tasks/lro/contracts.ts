/**
 * lro/contracts.ts — LongRunningTaskOrchestrator 的类型契约与角色常量
 *
 * 由 `tasks/LongRunningTaskOrchestrator.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §44）：**只搬不改**（含全部原注释）。
 * 依赖方向：本模块**零依赖宿主** ⇒ 无循环；公开类型由宿主 **re-export** 保持公开面。
 */

import type { PdcaPhase } from '@modules/core';
import type { Plan, PlanStep, PlanProgress } from '../TaskOrchestrator';
import type { LifecycleEvent } from '../LifecycleTracker';
import type { AuditReport } from '../AuditReport';
import type { createAgentIsolation } from '@modules/agent';

/** PDCA 状态快照（前端查询用） */
export interface PdcaStatus {
  taskId: string;
  planId: string;
  phase: PdcaPhase;
  plan?: Plan;
  progress?: PlanProgress;
  currentStep?: PlanStep;
  awaitUserDecision: boolean;
  decisionPrompt?: string;
  audit?: AuditReport;
  lifecycle: LifecycleEvent[];
}

/** PDCA 监控指标 */
export interface PdcaMetrics {
  /** 总 PDCA 循环次数 */
  totalCycles: number;
  /** 总步骤数 */
  totalSteps: number;
  /** 完成步骤数 */
  completedSteps: number;
  /** 失败步骤数 */
  failedSteps: number;
  /** 平均每步耗时（ms） */
  avgStepDurationMs: number;
  /** 平均 Review 分数（0-100） */
  avgReviewScore: number;
  /** Review 通过率 */
  reviewPassRate: number;
  /** 工具调用失败导致步骤失败数 */
  toolFailureSteps: number;
  /** 中断率（aborted / total） */
  abortRate: number;
}

/** 子 Agent 执行句柄 */
export interface SubAgentHandle {
  agentId: string;
  isolation: ReturnType<typeof createAgentIsolation>;
  output: string;
  completed: boolean;
  error?: string;
}

/**
 * 角色配置
 */
export interface RoleConfig {
  name: string;
  toolsets: string[];
  systemPrompt: string;
}

export const PLANNER_ROLE: RoleConfig = {
  name: 'Planner',
  toolsets: ['research', 'search', 'file'],
  systemPrompt:
    '你是一个任务规划师。分析用户需求，将复杂任务拆解为可执行的步骤序列。每个步骤需包含验收标准（完成后可验证的标准）。只输出分析结果，不执行任何代码或文件修改。',
};

export const EXECUTOR_ROLE: RoleConfig = {
  name: 'Executor',
  toolsets: ['terminal', 'code', 'file', 'browser', 'search'],
  systemPrompt:
    '你是一个任务执行者。严格按照给定的步骤描述和验收标准执行。完成后汇报执行结果。',
};

/** 默认执行器函数类型 */
export type ExecutorFn = (params: {
  systemPrompt: string;
  userPrompt: string;
  tools: string[];
  isolation: ReturnType<typeof createAgentIsolation>;
}) => Promise<string>;

/**
 * §5 P1: 任务消息回写格式（长程任务 → 对话会话）
 * RC-C（08-09）：任务内工具已从 LLM 模拟改为真实执行（globalToolManager），
 * content 为真实执行摘要文本，前端据 isTaskMessage 渲染为摘要样式。
 */
export interface TaskMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
}

/**
 * D5（M6，2026-08-13）：阶段回退增量 replan 记录
 * escalate 时捕获失败步骤与缺陷清单，重开循环时注入增量 replan 指令。
 */
export interface EscalationRecord {
  stepId: string;
  stepDescription: string;
  /** 缺陷清单（severity + description） */
  defects: string[];
}

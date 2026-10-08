/**
 * lro/contracts.ts — LongRunningTaskOrchestrator 的类型契约与角色常量
 *
 * 由 `tasks/LongRunningTaskOrchestrator.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §44）：**只搬不改**（含全部原注释）。
 * 依赖方向：本模块**零依赖宿主** ⇒ 无循环；公开类型由宿主 **re-export** 保持公开面。
 */

import type { PdcaPhase } from '@modules/core';
import type { TaskType } from '@modules/ai';
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
 *
 * 2026-10-08（LRTO 步骤"执行不了"根因修复）：原 `toolsets: string[]` 抄的是 hermes
 * 工具集名（`terminal` / `research` / `code` …），本仓**没有这些工具** ⇒ 展开后
 * 23 个名字中 19 个永不命中 ⇒ 步骤实际拿到 0 个可用工具（实测 73 步 / 0 次工具调用）。
 * 现改为声明**任务类型**，工具名由 `getRealToolNamesForTask()` 从 `TOOL_CATEGORIES`
 * 单一事实源派生 —— **禁止手写工具名清单**。
 */
export interface RoleConfig {
  name: string;
  /** 任务类型（对齐 `modelRouter` 的 TaskType）：同时用于 ① 模型解析（任务分工/DB）② 工具范围派生 */
  taskType: TaskType;
  /** 是否给该角色装配工具。Planner 为**纯推理**角色（只输出 JSON 计划、不执行工具）⇒ false */
  useTools: boolean;
  systemPrompt: string;
}

export const PLANNER_ROLE: RoleConfig = {
  name: 'Planner',
  // 规划阶段用推理强模型（对齐 `modelRouter.DEFAULT_PHASE_TASK_MAP.plan`）
  taskType: 'coding',
  useTools: false,
  systemPrompt:
    '你是一个任务规划师。分析用户需求，将复杂任务拆解为可执行的步骤序列。每个步骤需包含验收标准（完成后可验证的标准）。只输出分析结果，不执行任何代码或文件修改。',
};

export const EXECUTOR_ROLE: RoleConfig = {
  name: 'Executor',
  // 自主代理全集（文件/终端/代码/搜索/网络/知识库/任务/代理/会话/系统/MCP）
  taskType: 'agent',
  useTools: true,
  systemPrompt:
    '你是一个任务执行者。严格按照给定的步骤描述和验收标准执行。完成后汇报执行结果。',
};

/** 步骤执行器回传的工具调用（与 `ParsedToolCall` 同形） */
export interface ExecutorToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * 步骤执行器返回值：纯文本，或"文本 + 工具调用"。
 *
 * 2026-10-08：原为 `Promise<string>` ⇒ 无法回传 `tool_calls` ⇒ `callModel` 只能 yield
 * 纯文本 ⇒ `executeTools` **结构性不可达**（日志指纹：`callModel 完成` 84 次、
 * `executeTools 开始执行` 0 次）。现扩展为可携带 `toolCalls`。
 */
export type ExecutorResult =
  | string
  | { content: string; toolCalls?: ExecutorToolCall[] };

/** 默认执行器函数类型 */
export type ExecutorFn = (params: {
  systemPrompt: string;
  userPrompt: string;
  /** 本次可用的**真实**工具名（由 `RoleConfig.taskType` 派生，禁止手写） */
  tools: string[];
  /** 模型解析用任务类型（任务分工 / DB 唯一事实来源） */
  taskType: TaskType;
  isolation: ReturnType<typeof createAgentIsolation>;
}) => Promise<ExecutorResult>;

/**
 * 步骤执行器返回值归一（兼容自定义 executor 仍返回 `string` 的旧形态）。
 *
 * 单一事实源：Orchestrator / ReviewGate / GoalEvaluateGate 三处共用 —— 原先三处
 * 各自声明了一份"同构"的 executor 形状，字符串/对象两种返回形态也各写一遍。
 */
export function normalizeExecutorResult(result: ExecutorResult): {
  content: string;
  toolCalls: ExecutorToolCall[];
} {
  if (typeof result === 'string') return { content: result, toolCalls: [] };
  return { content: result.content ?? '', toolCalls: result.toolCalls ?? [] };
}

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

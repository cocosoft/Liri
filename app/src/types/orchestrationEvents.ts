// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 编排事件名词汇表（core 层自持，零依赖）
 *
 * H5-① 收口（台账 D-67）：原定义于 `agent/events/OrchestrationEvents.ts`（app 层），
 * 而 `core/events/EventBusOTelBridge.ts`、`core/events/OrchestrationMetrics.ts`、
 * `core/events/TokenTracker.ts` 三处亦需该常量 ⇒ 定义下沉至 core 层 types 模块，
 * 由上层 `agent/events/OrchestrationEvents.ts` 转出（app → core 合法），消除 core → app 倒挂。
 *
 * 载荷类型（`OrchStartData` 等）与派生函数（`deriveParallelEndData`）**留在原处**：
 * 它们属 app 层领域载荷，core 侧不需要（同 D-57 的"只下沉名字、不下沉载荷"口径）。
 */

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

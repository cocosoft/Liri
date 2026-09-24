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
 * 工作流能力 seam 的契约类型（词汇表）
 *
 * 命名约定（R02）：不复用 workspace 域的 `WorkflowStep` / `WorkflowResult`，
 * 避免同名类型在同一语义空间重复定义。
 */

/**
 * 运行停止原因：封闭联合，seam 所有，消费方可穷举。
 *
 * - `completed`：全部步骤按序执行完成
 * - `cancelled`：运行被取消（当前已定义但未产生，取消 API 属 P1-4）
 * - `error`：约定义非法以外的失败（步骤失败 / 未知工作流 / 未注册 Provider）
 */

import type { RootCauseCandidate } from '@modules/core/systemgraph';

export type WorkflowStopReason = 'completed' | 'cancelled' | 'error';

/** 单个步骤的定义（声明式，可含依赖） */
export interface WorkflowStepSpec {
  /** 步骤唯一标识（同一工作流内唯一） */
  id: string;
  /** 人类可读描述（用于日志与进度展示） */
  description: string;
  /** 实际调用的工具名；领域别名由各 Provider 自行解析 */
  tool: string;
  /** 步骤参数（可选，与运行时参数合并） */
  params?: Record<string, unknown>;
  /** 前置步骤 id 列表（由 seam 做静态校验与拓扑排序） */
  dependsOn?: string[];
}

/** 一个工作流的定义 */
export interface WorkflowDefinition {
  /** 工作流名称（全局唯一，跨 Provider 汇总时用于查找） */
  name: string;
  description: string;
  steps: WorkflowStepSpec[];
}

/**
 * 运行结果。
 *
 * - `value` 仅在 `stopReason === 'completed'` 时有意义
 * - 非 `completed` 时 `error` 必须非空（消费方据此报错，不得报告部分输出）
 */
export interface WorkflowRunResult {
  stopReason: WorkflowStopReason;
  /** 已成功完成的步骤 id（按执行顺序） */
  completedSteps: string[];
  value?: unknown;
  error?: string;
}

/** 跨 Provider 汇总的工作流条目 */
export interface WorkflowSummary {
  name: string;
  description: string;
  providerId: string;
}

// ─── run 级观察与记录（P1-3） ──────────────────────────────────────────────

/**
 * 工作流 run 观察者（run 级 + 成员级）。
 *
 * seam 只负责**通知**，不负责落盘：事件写入权集中在 chat loop 层
 * （`ChatManager.appendStreamEvent` → `EventLogStorage`，唯一权威）。
 * 观察者由调用方（工具）注入，把 run 记录随 `ToolResult.metadata` 带出，
 * 最终由 `MessageToEventMigrator.convertMessage` 投影为持久事件。
 *
 * 成员级回调是 `WorkflowStepObserver` 的超集：一次注入即可收齐两级事件。
 */
export interface WorkflowRunObserver extends WorkflowStepObserver {
  onRunStart?(info: WorkflowRunStartInfo): void;
  onRunEnd?(info: WorkflowRunEndInfo): void;
}

/** run 开始信息 */
export interface WorkflowRunStartInfo {
  /** 运行标识（engine 生成；与 run_end 配对） */
  runId: string;
  workflow: string;
  providerId: string;
  /** 计划执行的步骤 id（拓扑序） */
  steps: string[];
  /** 开始时间戳（ms） */
  startedAt: number;
}

/** run 结束信息 */
export interface WorkflowRunEndInfo {
  runId: string;
  workflow: string;
  providerId: string;
  stopReason: WorkflowStopReason;
  /** 已完成的步骤 id */
  completedSteps: string[];
  /** 首个未完成的步骤 id（仅 stopReason='error' 时给出） */
  failedStep?: string;
  error?: string;
  /** 总耗时（ms） */
  durationMs: number;
  /**
   * P0-2（接线期②）：失败步骤的**上游根因候选集**，按因果强度降序（`score`）。
   *
   * 仅在 `stopReason === 'error'`、能定位 `failedStep`、且该步骤在计划内时给出；
   * 每条候选自带 `pathEvidenceRefs`（形如 `run:<runId>#step:<stepId>`）供独立复核。
   *
   * 局限（勿误读为"已落盘/已可回放"）：本期只产出**运行时结论**；把它带出到工具元数据与
   * session 事件的**持久化投影尚未接线**（见 spec §一 与 §六）。
   */
  rootCauseCandidates?: RootCauseCandidate[];
}

// ─── 成员级（步骤）观察与记录（P1-3 待续） ────────────────────────────────

/**
 * 步骤结束结果（成员级封闭联合）。
 *
 * 不含 `skipped`：当前执行器在首个失败步骤即终止，不产生"跳过"分支。
 */
export type WorkflowStepOutcome = 'completed' | 'failed' | 'cancelled';

/**
 * Provider 侧步骤上报契约（Provider → seam）。
 *
 * Provider 只上报**自己观察到的事实**：`runId` 由 seam 账本注入（Provider 无需知晓），
 * `durationMs` 由账本按 start/end 时间戳计算，避免两处各算一份而漂移。
 *
 * 未实现上报的 Provider 可忽略该参数（观察为可选能力），此时不变式由账本兜底合成。
 */
export interface WorkflowStepReporter {
  onStepStart?(report: WorkflowStepStartReport): void;
  onStepEnd?(report: WorkflowStepEndReport): void;
}

/** 步骤开始上报（Provider → seam） */
export interface WorkflowStepStartReport {
  /** 步骤 id（与 `WorkflowStepSpec.id` 同源；seam 据此校验其是否在计划内） */
  stepId: string;
  /** 实际调用的工具名 */
  tool: string;
  /** 人类可读描述 */
  description: string;
  /** 开始时间戳（ms） */
  startedAt: number;
}

/** 步骤结束上报（Provider → seam） */
export interface WorkflowStepEndReport {
  stepId: string;
  outcome: WorkflowStepOutcome;
  /** 失败原因（`outcome !== 'completed'` 时应给出） */
  error?: string;
}

/**
 * 步骤观察者（seam → 消费方）。
 *
 * 配对不变式由 seam 账本保证：每次 `onStepStart` 在本 run 内**恰好**对应一次
 * `onStepEnd`（Provider 未上报结束时由账本合成，`synthesized: true`）。
 */
export interface WorkflowStepObserver {
  onStepStart?(info: WorkflowStepStartInfo): void;
  onStepEnd?(info: WorkflowStepEndInfo): void;
}

/** 步骤开始信息（已注入 `runId`） */
export interface WorkflowStepStartInfo extends WorkflowStepStartReport {
  runId: string;
}

/** 步骤结束信息 */
export interface WorkflowStepEndInfo extends WorkflowStepEndReport {
  runId: string;
  /** 回填自配对的 start：保证 `step_end` 事件自包含，读取端无需跨事件关联 */
  tool: string;
  description: string;
  /** 耗时（ms，由账本计算） */
  durationMs: number;
  /**
   * 由 seam **强制结算**（Provider 未上报结束——例如取消宽限期到期后 Provider 仍在后台执行）。
   * 读取端据此区分"真实结束"与"宿主兜底结算"。
   */
  synthesized?: boolean;
}

/**
 * 单个步骤的记录（start/end 配对）。
 *
 * `end` 可选是**装配期**的现实：消费方在 `onStepStart` 时即创建条目、在 `onStepEnd` 时回填。
 * 不变式要求是"一次 run 结束时 `end` 必须已回填"，由账本保证（并在集成测试中断言）。
 */
export interface WorkflowStepRecord {
  start: WorkflowStepStartInfo;
  end?: WorkflowStepEndInfo;
}

/** run 记录载体（随 `ToolResult.metadata.workflowRun` 传递） */
export interface WorkflowRunRecord {
  start?: WorkflowRunStartInfo;
  end?: WorkflowRunEndInfo;
  /** 成员级步骤记录（按执行序） */
  steps?: WorkflowStepRecord[];
}

/**
 * 工作流执行选项（P1-4）。
 *
 * 收拢为 options 包而非继续追加位置参数，避免签名为 `execute(name, params, observer?, signal?, …)`。
 */
export interface WorkflowExecuteOptions {
  /** run 级观察者（P1-3） */
  observer?: WorkflowRunObserver;
  /**
   * 外部取消信号（P1-4）：中止后 seam 不再推进，Provider 在**步骤边界**返回 `cancelled`。
   *
   * 局限：同进程直调下无法中断"正在执行中"的单个步骤，仅在其后的边界生效；
   * 该局限随 P2-2（执行隔离）消除。
   */
  signal?: AbortSignal;
  /**
   * 取消宽限期（ms，P2-2）。
   *
   * 外部 signal 中止后，若 Provider 在该时长内仍未结算，则**强制结算**为 `cancelled`
   * （正在执行的步骤仍在后台跑完，其结果被丢弃——本仓步骤为进程内工具调用，无法中断）。
   * 默认 5000；`0` 表示中止即结算。
   */
  gracePeriodMs?: number;
}

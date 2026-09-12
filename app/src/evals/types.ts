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
 * Agent 能力评测 — 类型定义（D2 骨架，2026-09-12）
 *
 * 判分分层（可信度排序，来自 τ-bench / SWE-bench 的做法）：
 *   L1 环境终态断言（文件系统/DB 实际变化）—— 首选，确定性
 *   L2 工具调用序列断言 —— L1 覆盖不到的过程约束
 *   L3 LLM-as-judge —— 仅开放式文本答案；本骨架**不实现**（需先用 L1 校验样本校准）
 *
 * 指标：`pass^1`（单次通过率）与 `pass^k`（k 次全通过才算通过）—— 后者才是可用性门槛。
 */

/** 断言结果（L1/L2 均为确定性判据） */
export interface AssertResult {
  /** 是否通过 */
  pass: boolean;
  /** 失败原因（pass=false 时必填） */
  reason?: string;
}

/** 任务执行上下文（供断言读取环境终态） */
export interface EvalContext {
  /** 隔离工作区（Agent 的 cwd，断言从这里读文件终态） */
  workspace: string;
  /** 隔离的 pyapp 根（LIRI_HOME，第三层） */
  home: string;
  /** 隔离的数据目录（LIRI_DATA_DIR，第二层；含副本 DB） */
  dataDir: string;
  /** Agent 的最终回答文本（供 L2/文本类断言） */
  finalText: string;
  /** 本次会话 ID */
  sessionId: string;
  /** 本次实际使用的模型 */
  model: string;
}

/** 一条评测任务 */
export interface EvalTask {
  /** 稳定 ID（报告与回归对照的键） */
  id: string;
  /** 人读名称 */
  name: string;
  /** 判分层级（本骨架仅 L1/L2） */
  level: 'L1' | 'L2';
  /**
   * 构造发给 Agent 的提示词。
   *
   * 传入隔离工作区绝对路径 —— **不要**写"当前工作目录"：DAEMON 模式会把进程 cwd
   * 设为项目根（`main.ts` 的 `process.chdir(resolveProjectRoot())`），与评测工作区不是同一个地方。
   */
  prompt: (workspace: string) => string;
  /**
   * 期望结果：
   *   'pass' — 正常任务，断言应通过
   *   'fail' — **控制任务**：断言应当失败，用于证明判分器"能判会失败"（防判分器恒真）
   */
  expect?: 'pass' | 'fail';
  /** 任务前置（可选）：在隔离工作区里预置初始状态 */
  setup?: (
    ctx: Pick<EvalContext, 'workspace' | 'home' | 'dataDir'>
  ) => Promise<void>;
  /** L1/L2 断言（读环境终态与过程证据） */
  assert: (ctx: EvalContext) => Promise<AssertResult>;
  /** 单次超时（毫秒），默认 180000 */
  timeoutMs?: number;
}

/** 单次执行结果 */
export interface EvalAttempt {
  /** 第几次（1..k） */
  index: number;
  /** 断言结果（控制任务需与 expect 相反才算"符合预期"） */
  assertion: AssertResult;
  /** 是否符合该任务的期望（expect 与 assertion.pass 的关系） */
  asExpected: boolean;
  durationMs: number;
  /** 模型用量（若流内返回） */
  promptTokens?: number;
  completionTokens?: number;
  /** 执行异常（进程/网络级失败） */
  error?: string;
  /** Agent 最终回答（截断保存，便于失败复盘） */
  finalText?: string;
}

/** 单任务汇总 */
export interface EvalTaskResult {
  task: EvalTask;
  attempts: EvalAttempt[];
  /** 原始断言通过次数（控制任务天然为 0） */
  assertPassCount: number;
  /** **符合预期率** = 满足 task.expect 的次数 / 次数（控制任务即"被判为失败"的比例） */
  pass1: number;
  /** k 次全部符合预期 */
  passK: boolean;
}

/** 一轮评测汇总 */
export interface EvalRunSummary {
  startedAt: string;
  finishedAt: string;
  model: string;
  k: number;
  tasks: EvalTaskResult[];
  /** 全部任务 pass^k 的占比 */
  passKRate: number;
  /** 全部任务 pass^1 的均值 */
  pass1Mean: number;
  /** 判分器自检：控制任务是否都被判为"符合预期失败" */
  judgeSanityOk: boolean;
}

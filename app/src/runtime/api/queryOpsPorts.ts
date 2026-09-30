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
 * 查询日志运维 —— **服务层端口**（C1「口径 C」：`query` 域单点收尾；2026-09-30 台账 D-111）
 *
 * **范围（本批 = 1 处：`analytics-handlers.ts` 的 2 个动态导入 + 2 个类型位）**。
 * ⚠️ 本端口只覆盖**动态组**所需面；`query` 域的**静态并集**（`checkpoint-handlers` 的
 * `TAORLoop` · `research-handlers` 的 3 条）**未纳入本批**，见 spec §3.14。
 *
 * ⚠️ 端口**禁止引用 app 类型**（`R00-001` 连类型导入也计）：仅**调用方实际读字段**者给**最小投影 DTO**。
 */

/** 工具调用统计投影（调用方读 `totalToolCalls` / `uniqueToolsUsed` / `topTools`） */
export interface QueryToolStatsDto {
  totalToolCalls: number;
  uniqueToolsUsed: number;
  /** 调用方仅透传给 `JSON.stringify` ⇒ 用 `unknown[]` */
  topTools: unknown[];
}

/** 错误统计投影（调用方读 `totalCalls` / `totalErrors` / `errorRate` / `topErrors`） */
export interface QueryErrorStatsDto {
  totalCalls: number;
  totalErrors: number;
  errorRate: number;
  /** 调用方仅透传给 `JSON.stringify` ⇒ 用 `unknown[]` */
  topErrors: unknown[];
}

// ==================== `query` 域静态面（2026-09-30 台账 D-117）====================

/**
 * TAOR 循环**类型镜像**（**纯类型位**；`checkpoint-handlers` 的实例注册表用）。
 * ⚠️ 端口**不引 app 类型** ⇒ 按调用方**实际调用的 2 个方法**做最小结构镜像
 * （app 侧 `TAORLoop` 结构上满足本接口 ⇒ `registerTAORLoop` 入参零 cast）。
 */
export interface TaorLoopPort {
  getCheckpointsForSession(): Promise<unknown>;
  resumeFromCheckpoint(checkpointId?: string | undefined): Promise<boolean>;
}

/** 研究模式 LLM 调用函数类型（逐字镜像 `ResearchCallModel`） */
export type ResearchCallModelDto = (
  messages: Array<{ role: string; content: string }>,
  signal: AbortSignal
) => AsyncGenerator<{ content?: string }>;

/** 候选方案（逐字镜像 `CandidateProposal`） */
export interface CandidateProposalDto {
  agentId: string;
  perspective: string;
  content: string;
  tokensUsed: number;
  durationMs: number;
}

/** 被驳候选（逐字镜像 `CandidateObjection`；`verdict` 收敛为 `string`） */
export interface CandidateObjectionDto {
  agentId: string;
  perspective: string;
  objections: string[];
  verdict: string;
  confidence: number;
}

/** 竞争编排结果（逐字镜像 `CompetitiveOrchestrationResult`） */
export interface CompetitiveOrchestrationResultDto {
  content: string;
  success: boolean;
  approved: CandidateProposalDto[];
  rejected: CandidateObjectionDto[];
  candidates: CandidateProposalDto[];
  stats: {
    totalTokens: number;
    totalDurationMs: number;
    candidateCount: number;
    approvedCount: number;
    rejectedCount: number;
  };
}

/** 查询日志运维端口（调用方均**不传 `limit`** ⇒ 端口不收参，用 app 侧默认值） */
export interface QueryOpsPort {
  /** 原 `getQueryLogStore().getToolStats()` */
  getToolStats(): Promise<QueryToolStatsDto>;
  /** 原 `getQueryLogStore().getErrorStats()` */
  getErrorStats(): Promise<QueryErrorStatsDto>;

  // ---- `query` 域静态面（2026-09-30 台账 D-117）----
  /**
   * 原 `new CompetitiveStrategyOrchestrator(config).run(description, signal)`
   * （引擎实例内聚；`config` 含 `callModel` / `recordPitfall` 等**回调实参**，
   * 按**原调用点实参**逐字收 ⇒ `Record<string, unknown>`）。
   */
  runCompetitiveOrchestration(
    description: string,
    signal: AbortSignal,
    config: Record<string, unknown>
  ): Promise<CompetitiveOrchestrationResultDto>;
}

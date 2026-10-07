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

/**
 * 研究编排装配配置（**最小投影**：两个调用方实际传入字段的并集；逐字镜像
 * `CompetitiveOrchestratorConfig` 的相应子集）。
 *
 * A7（2026-10-01）：原为 `Record<string, unknown>` 透传 ⇒ 调用点失去编译期 config 校验
 * （台账 D-117 自述该代价）。改为类型化 DTO 后，app 侧装配点 `runResearchOrchestration`
 * 的入参在此边界上由编译器守住；Impl 侧不再需要 `as never`。
 *
 * 注：**不收 `perspectiveCount`** —— 默认值（2，成本护栏）的单一事实源在编排器构造器内。
 */
export interface ResearchOrchestrationConfigDto {
  callModel: ResearchCallModelDto;
  generatorCallModel?: ResearchCallModelDto;
  verifierCallModel?: ResearchCallModelDto;
  recordPitfall?: (rec: {
    description: string;
    error: string;
    source: 'verifier';
    contextSig?: string;
  }) => void;
}

/**
 * 编排模式目录项（**PC-6**，2026-10-07）—— 结构镜像 app 层 `PatternCatalogEntry`
 * （`query/patternAssembler.ts`）。
 *
 * ⚠️ 按端口约定**不引 app 类型**（`R00-001` 连类型导入也计）⇒ 此处为**结构镜像**；
 * `route` 收敛为 `string`（闭集 `PatternRunRoute` 的单一事实源在 app 层）。
 */
export interface OrchestrationPatternDto {
  name: string;
  displayName: string;
  /** 适用场景（人类可读） */
  when: string;
  roles: string[];
  /** 角色 → 承担方绑定 */
  bindings: { role: string; providers: string[] }[];
  assembler: string;
  /** 装配状态：`ready` 已接线 / `unavailable` 未接线（`reason` 说明） */
  status: 'ready' | 'unavailable';
  route?: string;
  reason?: string;
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
   * —— A7（2026-10-01）起改经 app 侧**装配点** `runResearchOrchestration`，
   * 本端口只做跨层转调；`config` 由 `Record<string, unknown>` 收敛为类型化
   * `ResearchOrchestrationConfigDto`（恢复调用点的编译期校验）。
   */
  runCompetitiveOrchestration(
    description: string,
    signal: AbortSignal,
    config: ResearchOrchestrationConfigDto
  ): Promise<CompetitiveOrchestrationResultDto>;

  /**
   * 原 `listPatternCatalog()`（`query/patternAssembler.ts`，PC-6）—— 编排模式**只读目录**
   * （注册表 + 装配状态），供 `GET /v1/patterns` 展示；不含任何会话/运行期状态。
   */
  listOrchestrationPatterns(): Promise<OrchestrationPatternDto[]>;
}

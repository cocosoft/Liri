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
 * 工作空间运维 —— **服务层端口**（C1「口径 C」：`workspace` 域**动态组**收尾；2026-09-30 台账 D-111）
 *
 * **范围（本批仅 `project-artifact-handlers.ts` 的**动态**取用）**：
 * `ProjectItemStore`（动态）× 1 · `createProjectStore` + `WorkItemStore`（动态）× 5。
 * ⚠️ 该文件的 `workspace` **静态**取用（`ProjectItemStore` × 5 等）与其余 13 个文件的
 * `workspace` 并集（共 38 处）**未纳入本批**，见 spec §3.14。
 *
 * ⚠️ 端口**禁止引用 app 类型**（`R00-001` 连类型导入也计）：仅**调用方实际读字段**者给**最小投影 DTO**。
 */

/** 项目条目投影（调用方读 7 字段以映射为成果） */
export interface ProjectItemBriefDto {
  id: string;
  projectId: string;
  sessionId?: string | undefined;
  messageId?: string | undefined;
  title: string;
  content: string;
  createdAt: string;
}

/**
 * 项目存储**句柄**（`createProjectStore(resolveDataDir(), new WorkItemStore(resolveDataDir()))`）。
 * ⚠️ `get` 在 app 侧为**同步** ⇒ 句柄方法**保持同步**（规则 37）。
 * ⚠️ P4 追加 `list` / `create` / `update` / `delete`（`project-handlers` 需要；该方法原仅供
 * `project-artifact-handlers` 读 `sandboxPath`）。
 */
export interface ProjectStorePort {
  /** 原 `store.get(projectId)`（`null` = 项目不存在） */
  get(projectId: string): { sandboxPath?: string | undefined } | null;
  list(workspaceId: string): unknown;
  /** app 侧返回值仅被读 `id` ⇒ 最小投影 */
  create(data: Record<string, unknown>): { id: string };
  update(projectId: string, updates: Record<string, unknown>): unknown;
  delete(projectId: string): boolean;
}

/** 项目条目类型（逐字镜像 `ProjectItemStore` 的 `ItemKind`） */
export type ItemKindDto = 'context' | 'artifact';

/** 项目条目**投影**（调用方读 `type` / `content`；`upsert` 参数需完整字段） */
export interface ProjectItemDto {
  id: string;
  projectId: string;
  kind: ItemKindDto;
  type?: string | undefined;
  title: string;
  content: string;
  sessionId?: string | undefined;
  messageId?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

/**
 * 项目条目存储**句柄**（`new ProjectItemStore(projectId, resolveDataDir())`）。
 * ⚠️ 与 D-111 的 `listProjectItemArtifacts(projectId)`（单次 `initialize→list→close`）**互补**：
 * 本句柄供调用方在**一次已初始化会话内**做多步操作（迁移判定 / upsert / list / delete）。
 * 方法均 app 侧**异步**（走 SQLite）。
 */
export interface ProjectItemStorePort {
  initialize(): Promise<void>;
  close(): Promise<void>;
  needsMigration(): boolean;
  migrateFromLegacy(): Promise<unknown>;
  list(kind?: ItemKindDto | undefined): Promise<ProjectItemDto[]>;
  upsert(item: ProjectItemDto): Promise<void>;
  delete(id: string): Promise<void>;
}

/** 项目上下文条目（**纯类型位**；逐字镜像 `ProjectContext`） */
export interface ProjectContextDto {
  type: 'goal' | 'scope' | 'constraint' | 'requirement' | 'knowledge';
  content: string;
  domain?: string | undefined;
  line: number;
}

/** Agent 角色投影（P1；调用方仅读 `id`，其余整对象透传 `JSON.stringify`） */
export interface AgentRoleBriefDto {
  id?: string | undefined;
}

/** Agent 角色存储**句柄**（P1；单例 `getAgentRoleStore()`，方法均**异步**） */
export interface AgentRoleStorePort {
  listAll(): Promise<unknown>;
  getByAgentId(
    agentId: string
  ): Promise<AgentRoleBriefDto | null | undefined>;
  insert(data: Record<string, unknown>): Promise<unknown>;
  /** app 侧返回值未被使用 ⇒ 声明 `void`（实现侧 `await` 且不返回） */
  update(id: string, data: Record<string, unknown>): Promise<void>;
  delete(id: string): Promise<void>;
}

/** 团队存储**句柄**（P1；`createTeamStore(teamsDir)` 工厂，方法均**同步** ⇒ 规则 37） */
export interface TeamStorePort {
  list(workspaceId: string): unknown;
  create(data: Record<string, unknown>): unknown;
  get(teamId: string): unknown;
  update(teamId: string, data: Record<string, unknown>): unknown;
  delete(teamId: string): unknown;
  addMember(teamId: string, data: Record<string, unknown>): unknown;
  removeMember(teamId: string, memberId: string): unknown;
  updateMemberRole(teamId: string, memberId: string, role: unknown): unknown;
}

/**
 * 编排智能**句柄**（P1）—— 5 个**单例**聚合为一个句柄：
 * 调用方按名解构（`const { riskDetector } = await …getOrchIntelligence()`）⇒ **调用点零改动**。
 * ⚠️ 方法均为 app 侧**同步**形态（规则 37）。
 */
export interface OrchIntelligencePort {
  changeImpactAnalyzer: {
    analyze(changedFiles: unknown, changedContent: string): unknown;
  };
  riskDetector: {
    detect(title: string, description: string, changedFiles: unknown): unknown;
    getRiskSummary(risks: unknown): unknown;
  };
  decisionClassifier: {
    classify(
      title: string,
      description: string,
      impactResult: unknown,
      risks: unknown
    ): unknown;
  };
  escalationManager: {
    recordEscalation(
      workItemId: string,
      type: string,
      description: string,
      suggestedDirection: string
    ): unknown;
    shouldEscalate(workItemId: string, type: string): unknown;
    getEscalationAdvice(workItemId: string): unknown;
    getActiveEscalations(): unknown;
  };
  resourceScheduler: {
    requestResource(
      workItemId: string,
      resources: unknown,
      priority: number
    ): unknown;
    getResourceStatus(): unknown;
  };
}

/** 工作流步骤**类型位镜像**（P1；逐字镜像 app 侧结构 ⇒ 内建模板常量零改动） */
export interface WorkflowStepDto {
  id: string;
  name: string;
  description: string;
  type: 'manual' | 'auto' | 'review';
  dependsOn?: string[] | undefined;
  suggestedAgentRole?: string | undefined;
  estimatedMinutes?: number | undefined;
}

/** 工作流模板**类型位镜像**（P1） */
export interface WorkflowTemplateDto {
  id: string;
  name: string;
  description: string;
  category: string;
  steps: WorkflowStepDto[];
  author: string;
  isPublic: boolean;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
  tags?: string[] | undefined;
}

// ==================== P2（2026-09-30 台账 D-114）====================

/** 工作项状态（逐字镜像 `@modules/workspace/types` 的 `WorkItemStatus`） */
export type WorkItemStatusDto =
  | 'pending'
  | 'running'
  | 'paused'
  | 'review'
  | 'done'
  | 'failed';

/** 工作项类型（逐字镜像 `WorkItemType`） */
export type WorkItemTypeDto =
  | 'task'
  | 'bug'
  | 'feature'
  | 'refactor'
  | 'docs'
  | 'decision'
  | 'pdca';

/**
 * 工作项**投影**（调用方实际读字段：编排快照 / 搜索过滤 / 排序 / 回顾统计）。
 * ⚠️ 运行时为完整 `WorkItem` ⇒ 未声明的字段仍会经 `JSON.stringify` 透出。
 */
export interface WorkItemBriefDto {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  type: WorkItemTypeDto;
  status: WorkItemStatusDto;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | undefined;
  tags?: string[] | undefined;
  priority?: number | undefined;
  assignment?: { assignee: { id: string } } | undefined;
}

/**
 * 工作项存储**句柄**（`createWorkItemStore`；方法均 app 侧**同步** ⇒ 规则 37）。
 * ⚠️ P3 追加 `create` / `update`（`workspaces-handlers` 需要）。
 */
export interface WorkItemStorePort {
  get(id: string): WorkItemBriefDto | null;
  list(workspaceId: string): WorkItemBriefDto[];
  create(data: Record<string, unknown>): WorkItemBriefDto;
  update(
    id: string,
    data: Record<string, unknown>
  ): WorkItemBriefDto | null;
}

/** 历史工作项搜索查询（逐字镜像 `WorkItemSearchQuery`） */
export interface WorkItemSearchQueryDto {
  keywords?: string | undefined;
  dateRange?: { start: string; end: string } | undefined;
  status?: WorkItemStatusDto[] | undefined;
  type?: WorkItemTypeDto[] | undefined;
  tags?: string[] | undefined;
  assigneeId?: string | undefined;
  sortBy?: 'createdAt' | 'updatedAt' | 'priority' | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/** 历史工作项搜索结果（逐字镜像 `WorkItemSearchResult`） */
export interface WorkItemSearchResultDto {
  items: WorkItemBriefDto[];
  total: number;
  query: WorkItemSearchQueryDto;
  searchedAt: string;
}

/** 工作空间配置**投影**（调用方读 `defaultAgents` / `agentModelBindings` / `defaultModel` / `availableModels`） */
export interface LiriWorkspaceConfigDto {
  defaultAgents?: Array<Record<string, unknown>> | undefined;
  agentModelBindings?: unknown[] | undefined;
  defaultModel?: string | undefined;
  availableModels?: unknown[] | undefined;
}

/** `.liri/` 目录探测结果（逐字镜像 `LiriDetectionResult`） */
export interface LiriDetectionResultDto {
  found: boolean;
  path?: string | undefined;
  subdirs?: string[] | undefined;
  configFiles?: string[] | undefined;
}

/**
 * 工作空间**上下文句柄**（P2 建 · P3 扩展）—— 内聚 app 侧
 * `createLiriConfigManager(wsPath)` + `createWorkItemStore(manager.dir, manager)`
 * + `createChangeSetStore(manager.dir)` + `createProjectStore(manager.dir, workItemStore)`
 * 的**同一实例**耦合。⚠️ 方法均**同步**（app 侧同步，规则 37）。
 */
export interface WorkspaceContextPort {
  /** 原 `manager.dir`（`.liri/` 目录） */
  readonly dir: string;
  loadConfig(): LiriWorkspaceConfigDto;
  /** 原 `manager.updateConfig(updates)`（返回值在 P3 被 `JSON.stringify` 使用 ⇒ 声明 `unknown`） */
  updateConfig(partial: Record<string, unknown>): unknown;
  /** 原 `manager.init()`（创建 `.liri/` 目录结构） */
  init(): void;
  /** 原 `manager.detect()` */
  detect(): LiriDetectionResultDto;
  /** 原 `manager.getSummary()` */
  getSummary(): Record<string, unknown>;
  /** 原 `manager.loadRules()`（`rules.md` 内容） */
  loadRules(): string;
  /** 原 `manager.saveRules(content)` */
  saveRules(content: string): void;
  /** 原 `createWorkItemStore(manager.dir, manager)`（**同一 manager 实例**） */
  getWorkItemStore(): WorkItemStorePort;
  /** 原 `createChangeSetStore(manager.dir)` */
  getChangeSetStore(): ChangeSetStorePort;
  /** 原 `createProjectStore(manager.dir, workItemStore)`（**同一 workItemStore 实例**） */
  getProjectStore(): WorkspaceProjectStorePort;
}

/** 变更集存储**句柄**（`createChangeSetStore`；方法均 app 侧**同步** ⇒ 规则 37） */
export interface ChangeSetStorePort {
  listByWorkItem(workItemId: string): unknown;
  create(params: Record<string, unknown>): unknown;
  get(id: string): unknown;
  recordFileChange(
    changesetId: string,
    path: string,
    change: string,
    additions?: number | undefined,
    deletions?: number | undefined
  ): unknown;
  updateStatus(id: string, status: string): unknown;
  getSummary(changesetId: string): unknown;
}

/**
 * 工作空间**项目存储**句柄（`createProjectStore(manager.dir, workItemStore)`）。
 * ⚠️ 与 D-111 的 `ProjectStorePort`（全局 `resolveDataDir()` 版）**存储位置不同**，故并存。
 * 方法均 app 侧**同步**（规则 37）。
 */
export interface WorkspaceProjectStorePort {
  list(workspaceId: string): unknown;
  create(params: Record<string, unknown>): unknown;
  get(projectId: string): unknown;
  update(projectId: string, updates: Record<string, unknown>): unknown;
  delete(projectId: string): boolean;
  buildBoard(projectId: string): unknown;
  getRules(projectId: string): string;
  saveRules(projectId: string, content: string): void;
  getTemplates(): unknown;
  createWorkItemFromTemplate(
    projectId: string,
    params: Record<string, unknown>
  ): unknown;
}

/** 任务状态（逐字镜像 `TaskStatus`） */
export type TaskStatusDto =
  | 'planning'
  | 'pending'
  | 'active'
  | 'paused'
  | 'review'
  | 'completed'
  | 'archived'
  | 'failed'
  | 'cancelled';

/** 任务类型（逐字镜像 `TaskType`） */
export type TaskTypeDto =
  | 'project'
  | 'phase'
  | 'story'
  | 'task'
  | 'bug'
  | 'feature'
  | 'refactor'
  | 'docs'
  | 'decision';

/** 任务优先级（逐字镜像 `TaskPriority`） */
export type TaskPriorityDto = 0 | 1 | 2 | 3;

/**
 * 统一任务节点**投影**（逐字镜像 `TaskNode` 的**调用方可见字段**；
 * 与 app 侧结构**双向兼容** ⇒ 句柄参数/返回值零 cast）。
 */
export interface TaskNodeDto {
  id: string;
  workspaceId: string;
  projectId?: string | undefined;
  title: string;
  description: string;
  type: TaskTypeDto;
  status: TaskStatusDto;
  priority: TaskPriorityDto;
  tags: string[];
  parentId?: string | undefined;
  dependsOn: string[];
  estimatedEffort?: string | undefined;
  assignee?: string | undefined;
  sessionId?: string | undefined;
  progress: number;
  createdAt: string;
  updatedAt: string;
}

/** 任务存储**句柄**（`@modules/workspace/TaskStore` **单例**；方法均**异步**） */
export interface TaskStorePort {
  initialize(): Promise<void>;
  listByWorkspace(workspaceId: string): Promise<TaskNodeDto[]>;
  listByProject(projectId: string): Promise<TaskNodeDto[]>;
  listByStatus(
    workspaceId: string,
    status: TaskStatusDto
  ): Promise<TaskNodeDto[]>;
  get(id: string): Promise<TaskNodeDto | null>;
  save(node: TaskNodeDto): Promise<void>;
  update(
    id: string,
    updates: Record<string, unknown>
  ): Promise<TaskNodeDto | null>;
  delete(id: string): Promise<boolean>;
  listChildren(parentId: string): Promise<TaskNodeDto[]>;
}

/** Council 单条发言**投影**（调用方读 `round` / `timestamp`，其余整条 `JSON.stringify`） */
export interface CouncilStatementDto {
  round: number;
  timestamp: number;
  [key: string]: unknown;
}

/** Council 会话**投影**（调用方读 `sessionId` / `phase` / `statements` / `finalProposal`） */
export interface CouncilSessionDto {
  sessionId: string;
  phase: string;
  statements: CouncilStatementDto[];
  finalProposal?: unknown;
}

/** Council 引擎**句柄**（`getCouncilEngine()` 单例；方法均**同步** ⇒ 规则 37） */
export interface CouncilEnginePort {
  createSession(
    workspaceId: string,
    topic: string,
    context: unknown,
    agents: unknown,
    options: { maxRounds: number }
  ): { sessionId: string };
  getSession(sessionId: string): CouncilSessionDto | null;
  getActiveSessionsByWorkspace(workspaceId: string): unknown;
}

/** 规则专业领域（逐字镜像 `@modules/workspace/RuleEngine` 的 `RuleSpecialization`） */
export type RuleSpecializationDto =
  | 'all'
  | 'security'
  | 'performance'
  | 'architecture'
  | 'data'
  | 'frontend'
  | 'backend'
  | 'test'
  | 'custom';

/** 规则引擎**句柄**（`getRuleEngine(workspacePath?)` 单例；方法均**同步** ⇒ 规则 37） */
export interface RuleEnginePort {
  listRules(): unknown;
  readRule(specialization: RuleSpecializationDto): string | null;
  writeRule(specialization: RuleSpecializationDto, content: string): void;
  appendRule(specialization: RuleSpecializationDto, content: string): void;
  loadRulesForWorkItem(
    title: string,
    description: string,
    changedFiles: string[]
  ): unknown;
  getRulesOverview(): unknown;
}

/** 成本报告（**纯类型位**；逐字镜像 `@modules/workspace/types` 的 `CostReport`） */
export interface CostReportDto {
  id: string;
  workspaceId: string;
  totalCostUSD: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  modelBreakdown: Record<
    string,
    { model: string; costUSD: number; tokens: number; requestCount: number }
  >;
  budgetStatus: 'ok' | 'warning' | 'exceeded';
  budgetUtilization: number;
  generatedAt: string;
  period: 'daily' | 'weekly' | 'monthly' | 'total';
}

/** 工作空间运维端口 */
export interface WorkspaceOpsPort {
  /**
   * 原 `new ProjectItemStore(projectId, resolveDataDir())` + `initialize()` +
   * `list('artifact')` + `close()`（⚠️ **`close()` 已内聚** —— 原调用点在 `finally` 中关闭）。
   */
  listProjectItemArtifacts(projectId: string): Promise<ProjectItemBriefDto[]>;
  /**
   * 原 `createProjectStore(resolveDataDir(), new WorkItemStore(resolveDataDir()))`
   * （含 `resolveDataDir()` 依赖，已内聚到实现侧）。
   */
  getProjectStore(): Promise<ProjectStorePort>;

  // ---- P1（5 文件 / 5 处；2026-09-30 台账 D-113）----
  /** 原 `bottleneckAnalyzer.analyze(steps)`（**单例** · 单方法 ⇒ 原子方法） */
  analyzeBottlenecks(steps: unknown): Promise<unknown>;
  /** 原 `getAgentRoleStore()`（**单例** ⇒ 句柄） */
  getAgentRoleStore(): Promise<AgentRoleStorePort>;
  /**
   * 原 `createTeamStore(path.join(wsPath, '.liri', 'teams'))`
   * （⚠️ `path.join` 留在**调用方** ⇒ 端口收 **`teamsDir`**，不引入 `node:path` 依赖）。
   */
  getTeamStore(teamsDir: string): Promise<TeamStorePort>;
  /** 原 `@modules/workspace/OrchIntelligence` 的 5 个**单例**（聚合句柄，规则 26/37） */
  getOrchIntelligence(): Promise<OrchIntelligencePort>;

  // ---- P2（6 文件 / 11 处；2026-09-30 台账 D-114）----
  /**
   * 原 `createLiriConfigManager(wsPath)` + `createWorkItemStore(manager.dir, manager)`
   * （**同一 manager 实例**耦合 ⇒ 已内聚到实现侧）。
   */
  getWorkspaceContext(wsPath: string): Promise<WorkspaceContextPort>;
  /** 原 `getCouncilEngine()`（**单例** ⇒ 句柄） */
  getCouncilEngine(): Promise<CouncilEnginePort>;
  /**
   * 原 `setCouncilEmitter(cb)`（⚠️ 原为**模块加载期副作用** ⇒ 现由调用方
   * **首次取用引擎前**调用，语义等价：任何 `createSession` 之前均已绑定）。
   */
  setCouncilEmitter(cb: (event: { sessionId: string }) => void): Promise<void>;
  /** 原 `new CouncilOrchestrator(engine).runDebate(sessionId)`（引擎实例内聚） */
  runCouncilDebate(sessionId: string): Promise<void>;
  /** 原 `(getCouncilEngine() as …).emit(event)`（保留 `typeof emit === 'function'` 守卫） */
  emitCouncilEvent(event: unknown): Promise<void>;
  /** 原 `getRuleEngine(workspacePath?)`（**单例**；传路径即替换全局实例） */
  getRuleEngine(workspacePath?: string): Promise<RuleEnginePort>;

  // ---- P3（1 文件 / 6 能力面；2026-09-30 台账 D-115）----
  /** 原 `detectLiriDir(startPath)`（模块级函数） */
  detectLiriDir(startPath: string): Promise<LiriDetectionResultDto>;
  /** 原 `taskStore`（`@modules/workspace/TaskStore` **单例**；方法均**异步**） */
  getTaskStore(): Promise<TaskStorePort>;

  // ---- P4（2 文件；2026-09-30 台账 D-116）----
  /**
   * 原 `new ProjectItemStore(projectId, resolveDataDir())`（**静态**取用；
   * ⚠️ D-111 的 `listProjectItemArtifacts` 为**动态**取用同一实现类 —— 二者互补，不重复实现）。
   */
  getProjectItemStore(projectId: string): Promise<ProjectItemStorePort>;
}

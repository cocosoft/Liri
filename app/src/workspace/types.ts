/**
 * .liri/ 工作空间配置类型定义
 *
 * 对应工作空间根目录下的 .liri/ 目录结构：
 * ├─ config.json          ← 工作空间偏好（模型偏好、AI 策略、成本控制）
 * ├─ rules.md             ← 硬约束规则（嵌入 AI 上下文）
 * ├─ knowledge.json       ← 关联的知识库
 * ├─ tools.json           ← 项目级 MCP / Skill 配置
 * ├─ workflows/           ← 工作流模板定义
 * ├─ agents/              ← Agent 注册表
 * ├─ projects/            ← 项目级配置
 * ├─ teams/               ← 团队配置
 * └─ memory/              ← 工作空间级记忆
 */

// ========== 配置结构 ==========

/** 模型偏好 */
export interface LiriModelPreference {
  /** 默认模型 ID */
  defaultModel?: string;
  /** Plan 模式下的模型 */
  planModel?: string;
  /** Do 模式下的模型 */
  doModel?: string;
  /** 分析/审查等高复杂度场景的模型 */
  analysisModel?: string;
}

/** AI 策略配置 */
export interface LiriAIStrategy {
  /** 自动接受改动（skip review）：true = AI 改完直接提交，false = 改完等用户审核 */
  autoAccept?: boolean;
  /** 代码审查严格程度：strict / normal / relaxed */
  reviewStrictness?: 'strict' | 'normal' | 'relaxed';
  /** 是否自动创建备份 */
  autoBackup?: boolean;
  /** 最大并行工作项数 */
  maxParallelWorkItems?: number;
}

/** 成本控制 */
export interface LiriCostControl {
  /** 每日 Token 预算上限 */
  dailyBudgetTokens?: number;
  /** 每月费用预算上限（USD） */
  monthlyBudgetUSD?: number;
  /** 告警阈值（0.0-1.0） */
  alertThreshold?: number;
  /** 是否强制限制（true = 超过后拒绝执行） */
  hardLimit?: boolean;
  /** 高价模型仅在哪些场景使用 */
  expensiveModelOnlyFor?: string[];
}

/** 工作空间配置（config.json） */
export interface LiriWorkspaceConfig {
  /** 工作空间名称 */
  name?: string;
  /** 工作空间描述 */
  description?: string;
  /** 模型偏好 */
  models?: LiriModelPreference;
  /** AI 策略 */
  aiStrategy?: LiriAIStrategy;
  /** 成本控制 */
  costControl?: LiriCostControl;
  /** 默认 Swarm Agent 列表 */
  defaultAgents?: Array<{
    id?: string;
    name?: string;
    role?: string;
  }>;
  /** Agent-Model 绑定配置 */
  agentModelBindings?: Array<{
    agentRole: string;
    model: string;
    maxTokens: number;
    temperature: number;
  }>;
  /** 默认模型 */
  defaultModel?: string;
  /** 可用模型列表 */
  availableModels?: Array<{
    id: string;
    name: string;
    provider: string;
  }>;
  /** 自定义设置 */
  custom?: Record<string, unknown>;
}

/** 知识库关联配置（knowledge.json） */
export interface LiriKnowledgeConfig {
  /** 关联的知识库 ID 列表 */
  knowledgeBaseIds?: string[];
  /** 是否自动索引项目文件 */
  autoIndex?: boolean;
  /** 索引排除模式 */
  indexExcludePatterns?: string[];
}

/** 工具配置（tools.json） */
export interface LiriToolConfig {
  /** 启用的 MCP 服务器列表 */
  mcpServers?: string[];
  /** 启用的 Skill 列表 */
  skills?: string[];
  /** 禁用的工具列表 */
  disabledTools?: string[];
}

/** 工作空间级记忆条目 */
export interface LiriMemoryEntry {
  /** 来源标签（如 "auto:workitem" 表示自动沉淀） */
  tag?: string;
  /** 来源标识 */
  source?: string;
  /** 记忆标题 */
  title?: string;
  /** 记忆内容 */
  content?: string;
  /** 工作项 ID */
  workItemId?: string;
  /** 经验摘要 */
  summary: string;
  /** 关键决策 */
  decisions?: string[];
  /** 遇到的坑 */
  pitfalls?: string[];
  /** 创建时间 */
  createdAt: string;
  /** 关联的文件 */
  relatedFiles?: string[];
  /** 附加元数据 */
  metadata?: Record<string, unknown>;
}

/** 工作空间级记忆（memory.json） */
export interface LiriMemoryConfig {
  /** 记忆条目列表 */
  entries: LiriMemoryEntry[];
  /** 最后更新时间 */
  lastUpdated: string;
}

// ========== 变更集 ==========

/** 文件变更状态 */
export type FileChangeType = 'added' | 'modified' | 'deleted';

/** 单个文件变更 */
export interface FileChange {
  /** 文件路径（相对于工作空间根目录） */
  path: string;
  /** 变更类型 */
  change: FileChangeType;
  /** 变更前行数 */
  additions?: number;
  /** 变更后行数 */
  deletions?: number;
  /** 变更状态 */
  status: 'pending' | 'verified' | 'failed';
}

/** 变更集 */
export interface ChangeSet {
  /** 变更集 ID */
  id: string;
  /** 关联的工作项 ID */
  workItemId: string;
  /** 变更描述 */
  description: string;
  /** 文件变更列表 */
  files: FileChange[];
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  /** 状态 */
  status: 'pending' | 'reviewing' | 'accepted' | 'rejected';
}

// ========== 工作项生命周期 ==========

/** 工作项状态 */
export type WorkItemStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'review'
  | 'done'
  | 'failed';

/** 工作项类型 */
export type WorkItemType =
  | 'task'
  | 'bug'
  | 'feature'
  | 'refactor'
  | 'docs'
  | 'decision'
  | 'pdca';

/** 工作项 */
export interface WorkItem {
  /** 唯一标识 */
  id: string;
  /** 所属工作空间 ID */
  workspaceId: string;
  /** 标题 */
  title: string;
  /** 描述 */
  description: string;
  /** 类型 */
  type: WorkItemType;
  /** 生命周期状态 */
  status: WorkItemStatus;
  /** 关联的会话 ID */
  sessionId?: string;
  /** 变更集 */
  changeSet?: ChangeSet;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  /** 完成时间 */
  completedAt?: string;
  /** 标签 */
  tags?: string[];
  /** 优先级：1=最高，5=最低 */
  priority?: number;
  /** 分配记录 */
  assignment?: AssignmentRecord;
  /** 预估影响范围 */
  estimatedImpact?: string;
  /** 风险提示 */
  riskWarnings?: string[];
}

// ========== .liri/ 目录检测 ==========

/** .liri/ 目录检测结果 */
export interface LiriDetectionResult {
  /** 是否找到 .liri/ 目录 */
  found: boolean;
  /** .liri/ 目录路径 */
  path?: string;
  /** 已存在的子目录 */
  subdirs?: string[];
  /** 已存在的配置文件 */
  configFiles?: string[];
}

// ========== 项目（Project） ==========

/** 项目状态 */
export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived';

/** 项目阶段 */
export type ProjectPhase = 'draft' | 'active' | 'archived' | 'completed';

/** 项目上下文类型（映射到 rules.md ### [type] 标记） */
export type ProjectContextType =
  | 'goal'
  | 'scope'
  | 'constraint'
  | 'requirement'
  | 'knowledge';

/** 项目上下文条目（从 rules.md 解析的结构化视图） */
export interface ProjectContext {
  /** 上下文类型对应的 type 标记 */
  type: ProjectContextType;
  /** 条目内容 */
  content: string;
  /** 所属领域（rules.md 的 ## 节标题） */
  domain?: string;
  /** 来源行号 */
  line: number;
}

/** 项目 */
export interface Project {
  /** 唯一标识 */
  id: string;
  /** 所属工作空间 ID */
  workspaceId: string;
  /** 项目名称 */
  name: string;
  /** 项目描述 */
  description: string;
  /** 项目状态 */
  status: ProjectStatus;
  /** 项目阶段（内部字段，不暴露到 UI） */
  phase: ProjectPhase;
  /** 关联的工作项 ID 列表 */
  workItemIds: string[];
  /** 关联的 PDCA 任务 ID 列表 */
  pdcaIds: string[];
  /** 项目级规则文件路径（相对于 .liri/） */
  rulesFile?: string;
  /** 项目模板类型 */
  template?: WorkItemType;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  /** 完成时间 */
  completedAt?: string;
  /** 标签 */
  tags?: string[];
  /** 项目专属文件夹路径（用户可访问的真实目录） */
  sandboxPath?: string;
}

/** 工作项模板 */
export interface WorkItemTemplate {
  /** 模板类型 */
  type: WorkItemType;
  /** 模板名称 */
  name: string;
  /** 模板描述 */
  description: string;
  /** 默认标签 */
  defaultTags?: string[];
  /** 默认优先级 */
  defaultPriority?: number;
  /** 建议的检查项 */
  checklist?: string[];
  /** 建议的预估影响范围 */
  estimatedImpact?: string;
  /** 风险提示 */
  riskWarnings?: string[];
}

/** 项目看板列 */
export interface ProjectBoardColumn {
  /** 列 ID（对应 WorkItemStatus） */
  id: WorkItemStatus;
  /** 列标题 */
  title: string;
  /** 该列的工作项 */
  items: WorkItem[];
}

/** 项目看板 */
export interface ProjectBoard {
  /** 项目 ID */
  projectId: string;
  /** 各状态列 */
  columns: ProjectBoardColumn[];
}

// ========== 统一任务模型（Phase A: 与 WorkItem/ProjectNode 并存） ==========

/**
 * 任务类型（合并 WorkItemType + 前端 ProjectNodeType）
 * - 规划层: project, phase, story
 * - 执行层: task, bug, feature, refactor, docs, decision
 */
export type TaskType =
  | 'project'
  | 'phase'
  | 'story'
  | 'task'
  | 'bug'
  | 'feature'
  | 'refactor'
  | 'docs'
  | 'decision';

/**
 * 任务状态（合并 WorkItemStatus + 前端 ProjectStatus）
 * 流水线: planning → pending → active → review → completed → archived
 * 旁路: paused (暂停), failed (异常终止)
 */
export type TaskStatus =
  | 'planning'
  | 'pending'
  | 'active'
  | 'paused'
  | 'review'
  | 'completed'
  | 'archived'
  | 'failed';

/** 任务优先级（0=最高/P0, 3=最低/P3，前端展示映射） */
export type TaskPriority = 0 | 1 | 2 | 3;

/**
 * 统一任务节点（替代 WorkItem + 前端 ProjectNode）
 *
 * 同时承载"规划分解"（parentId, dependsOn, estimatedEffort）
 * 和"执行跟踪"（sessionId, changeSet, assignment）两种视角。
 */
export interface TaskNode {
  // ── 核心标识 ──
  id: string;
  workspaceId: string;
  /** 所属项目 ID（可选——独立 WorkItem 无项目） */
  projectId?: string;

  // ── 内容 ──
  title: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  tags: string[];

  // ── 树结构（原前端 ProjectNode）──
  /** 父节点 ID（单向引用，替代 children[] 数组） */
  parentId?: string;
  /** 依赖节点 ID 列表 */
  dependsOn: string[];
  /** 预估工时（如 "2d", "4h"） */
  estimatedEffort?: string;

  // ── 执行跟踪（原 WorkItem）──
  /** 负责人 */
  assignee?: string;
  /** 关联会话 ID */
  sessionId?: string;
  /** 变更集 */
  changeSet?: ChangeSet;
  /** 预估影响范围 */
  estimatedImpact?: string;
  /** 风险提示 */
  riskWarnings?: string[];

  // ── 进度 ──
  /** 完成百分比 0-100 */
  progress: number;

  // ── 时间戳（统一 ISO 8601 字符串）──
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 项目 V2（含 TaskNode 树）
 *
 * 与现有 Project 并存，Phase C 后替换。
 */
export interface ProjectV2 {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  /** 原始需求文本 */
  sourceRequirements?: string;
  /** 顶层 TaskNode ID 列表 */
  rootTaskIds: string[];
  status: 'planning' | 'active' | 'paused' | 'completed' | 'archived';
  /** 聚合进度 0-100 */
  progress: number;
  createdAt: string;
  updatedAt: string;
}

// ========== 团队（Team） ==========

/** 团队成员角色 */
export type TeamRole = 'owner' | 'admin' | 'member' | 'viewer';

/** 团队成员 */
export interface TeamMember {
  /** 成员 ID */
  id: string;
  /** 成员名称 */
  name: string;
  /** 角色 */
  role: TeamRole;
  /** 加入时间 */
  joinedAt: string;
  /** 是否是 Agent */
  isAgent?: boolean;
  /** Agent 绑定的模型 */
  model?: string;
}

/** 团队 */
export interface Team {
  /** 唯一标识 */
  id: string;
  /** 所属工作空间 ID */
  workspaceId: string;
  /** 团队名称 */
  name: string;
  /** 团队描述 */
  description: string;
  /** 团队成员列表 */
  members: TeamMember[];
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  /** 标签 */
  tags?: string[];
}

/** 工作项分配目标 */
export interface Assignee {
  /** 分配类型 */
  type: 'human' | 'agent' | 'team';
  /** 分配目标 ID */
  id: string;
  /** 分配目标名称 */
  name: string;
}

/** 工作项分配记录 */
export interface AssignmentRecord {
  /** 分配目标 */
  assignee: Assignee;
  /** 分配时间 */
  assignedAt: string;
  /** 分配者 */
  assignedBy: string;
}

// ========== 工作流模板（Workflow Template） ==========

/** 工作流步骤 */
export interface WorkflowStep {
  /** 步骤 ID */
  id: string;
  /** 步骤名称 */
  name: string;
  /** 步骤描述 */
  description: string;
  /** 步骤类型 */
  type: 'manual' | 'auto' | 'review';
  /** 依赖的步骤 ID 列表 */
  dependsOn?: string[];
  /** 建议的 Agent 角色 */
  suggestedAgentRole?: string;
  /** 预计耗时（分钟） */
  estimatedMinutes?: number;
}

/** 工作流模板 */
export interface WorkflowTemplate {
  /** 模板 ID */
  id: string;
  /** 模板名称 */
  name: string;
  /** 模板描述 */
  description: string;
  /** 适用场景 */
  category: string;
  /** 步骤列表 */
  steps: WorkflowStep[];
  /** 创建者 */
  author: string;
  /** 是否公开 */
  isPublic: boolean;
  /** 使用次数 */
  usageCount: number;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  /** 标签 */
  tags?: string[];
}

// ========== 对话式成本感知 ==========

/** 成本报告 */
export interface CostReport {
  /** 报告 ID */
  id: string;
  /** 工作空间 ID */
  workspaceId: string;
  /** 总成本（美元） */
  totalCostUSD: number;
  /** 总 Token 数 */
  totalTokens: number;
  /** 输入 Token 数 */
  inputTokens: number;
  /** 输出 Token 数 */
  outputTokens: number;
  /** 各模型成本明细 */
  modelBreakdown: Record<
    string,
    {
      model: string;
      costUSD: number;
      tokens: number;
      requestCount: number;
    }
  >;
  /** 预算状态 */
  budgetStatus: 'ok' | 'warning' | 'exceeded';
  /** 预算利用率（0-1） */
  budgetUtilization: number;
  /** 报告时间 */
  generatedAt: string;
  /** 周期 */
  period: 'daily' | 'weekly' | 'monthly' | 'total';
}

// ========== 对话式回顾 ==========

/** 历史工作项搜索查询 */
export interface WorkItemSearchQuery {
  /** 关键词 */
  keywords?: string;
  /** 日期范围 */
  dateRange?: { start: string; end: string };
  /** 状态过滤 */
  status?: WorkItemStatus[];
  /** 类型过滤 */
  type?: WorkItemType[];
  /** 标签过滤 */
  tags?: string[];
  /** 分配者过滤 */
  assigneeId?: string;
  /** 排序字段 */
  sortBy?: 'createdAt' | 'updatedAt' | 'priority';
  /** 排序方向 */
  sortOrder?: 'asc' | 'desc';
  /** 分页 */
  limit?: number;
  offset?: number;
}

/** 历史工作项搜索结果 */
export interface WorkItemSearchResult {
  /** 匹配的工作项 */
  items: WorkItem[];
  /** 总数 */
  total: number;
  /** 查询条件 */
  query: WorkItemSearchQuery;
  /** 搜索时间 */
  searchedAt: string;
}

/**
 * 项目/调度领域类型
 *
 * 由 graph.ts + schedule.ts 归并（GR15-002）。
 */

// ─── 知识图谱 ───

/** 边 */
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type: string;
  direction: "directed" | "symmetric";
  domain?: string;
  attributes: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/** 图统计 */
export interface GraphStats {
  totalEdges: number;
  byType: Record<string, number>;
  /** D2 起 = 节点表总数（含孤立实体） */
  totalEntities: number;
  /** 由边派生的端点数（旧口径，供界面标注与对照） */
  derivedEntities: number;
}

/** 实体（节点）档案记录（D2；`aliases`/`tags`/`attributes` 为 JSON **字符串**，与库中存储一致） */
export interface GraphNodeRecord {
  node_id: string;
  domain: string;
  kind: string;
  slug: string;
  name: string;
  description: string;
  aliases: string;
  tags: string;
  attributes: string;
  source: "auto" | "manual";
  created_at: number;
  updated_at: number;
  /** 关联边数（孤立实体为 0；列表接口附带） */
  degree?: number;
}

export interface GraphNodesResponse {
  nodes: GraphNodeRecord[];
  total: number;
  limit: number;
}

/**
 * 实体档案可写字段（身份字段 id 不可改）
 *
 * O15-B：`kind` 已归为档案属性（实体分类标签），不再参与 ID，可修改。
 */
export interface GraphNodeArchivePatch {
  kind?: string;
  name?: string;
  description?: string;
  aliases?: string[];
  tags?: string[];
  attributes?: Record<string, unknown>;
}

/** 图数据 API 响应 */
export interface GraphEdgesResponse {
  edges: GraphEdge[];
  stats: GraphStats;
}

/** 实体（由边派生：distinct 端点 + 度数） */
export interface GraphEntity {
  id: string;
  /** 关联边数（出 + 入） */
  degree: number;
}

/** 实体列表响应（GET /v1/knowledge/graph/entities） */
export interface GraphEntitiesResponse {
  entities: GraphEntity[];
  total: number;
}

/** 新增/更新关系的请求体 */
export interface GraphEdgeInput {
  from: string;
  to: string;
  type: string;
  direction?: "directed" | "symmetric";
  domain?: string;
  attributes?: Record<string, unknown>;
}

/** 批量新增结果（POST /v1/knowledge/graph/edges/bulk） */
export interface GraphBulkCreateResult {
  submitted: number;
  ok: number;
  failed: Array<{ index: number; reason: string }>;
}

// ─── D5 审计与撤销 ───

/** 审计动作 */
export type GraphAuditAction =
  "create" | "update" | "delete" | "restore" | "undo" | "cleanup" | "import";

/** 审计条目（GET /v1/knowledge/graph/audit） */
export interface GraphAuditEntry {
  auditId: string;
  edgeId?: string;
  action: GraphAuditAction;
  origin: "manual" | "auto";
  actor: string;
  note?: string;
  createdAt: number;
}

/** 审计列表响应 */
export interface GraphAuditResponse {
  entries: GraphAuditEntry[];
  total: number;
}

/** 撤销结果（POST /v1/knowledge/graph/audit/:id/undo） */
export interface GraphUndoResult {
  undone: boolean;
  action: GraphAuditAction;
  edgeId?: string;
  message: string;
}

// ─── 知识本体（.schema，只读） ───

/** 本体实体类型条目（GET /v1/knowledge/schema） */
export interface OntologyEntity {
  kind: string;
  displayName: string;
  description: string;
  fieldCount: number;
  terminal: boolean;
}

/** 本体关系类型条目 */
export interface OntologyEdge {
  type: string;
  displayName: string;
  endpoints: { from: string; to: string };
  direction: "directed" | "symmetric";
}

/** 本体文件（B2c 起三个文件均可写） */
export type OntologySchemaFile = "entities.yaml" | "edges.yaml" | "xref.yaml";

/** 表单模式：单文件结构化模型（"可识别才映射"，见设计方案 §11.2） */
export interface OntologyFormFileModel {
  /** false → 前端禁用表单，仅展示 reason（禁止有损转换） */
  expressible: boolean;
  reason?: string;
  /** 行数据；行内未知键**原样保留**（避免静默丢字段） */
  rows?: Array<Record<string, unknown>>;
}

export interface OntologyFormModels {
  entities: OntologyFormFileModel;
  edges: OntologyFormFileModel;
}

/** 原始 YAML 文本（文件缺失 → null；文件**存在但无法解析**时仍返回文本，便于修复） */
export type OntologyRawFiles = Record<OntologySchemaFile, string | null>;

/** D6-3：知识域清单条目 */
export interface OntologyDomainItem {
  name: string;
  label: string;
  description: string;
  keywordTags: string[];
  wikiPageCount: number;
  /** 默认域（缺省域，不可删除） */
  isDefault: boolean;
}

export interface OntologyDomainList {
  defaultDomain: string;
  domains: OntologyDomainItem[];
}

/** 单个文件的 diff 预览结果 */
export interface OntologyFileDiff {
  /** unified diff 文本；无差异为空串 */
  diff: string;
  additions: number;
  deletions: number;
  /** 文件过大未做对比 */
  skipped?: boolean;
}

/** diff 预览响应（POST /v1/knowledge/schema/diff，键为文件名） */
export interface OntologyDiffResult {
  diffs: Record<string, OntologyFileDiff>;
}

/** 单个历史备份（GET /v1/knowledge/schema/backup） */
export interface OntologyBackupEntry {
  /** 备份标识 = 目录名（时间戳），恢复时原样回传 */
  id: string;
  /** ISO 时间；目录名无法解析时为 null */
  createdAt: string | null;
  files: Array<{ name: string; size: number }>;
}

export interface OntologyBackupList {
  schemaDir: string;
  /** 保留份数上限（与写入时的清理策略一致） */
  keep: number;
  backups: OntologyBackupEntry[];
}

/** 恢复结果（POST /v1/knowledge/schema/backup/{id}/restore） */
export interface OntologyRestoreResult {
  restored: boolean;
  file: string;
  from: string;
  /** 恢复前状态的备份路径（可再恢复回去） */
  previousBackup: string | null;
  effective: { entities: number; edges: number; xref: number };
  note: string;
}

/** 本体概要（GET /v1/knowledge/schema） */
export interface OntologySchemaInfo {
  /** freeform=未约束；constrained=已声明白名单 */
  mode: "freeform" | "constrained";
  /** D6-3：本次查询的域（未传为 null） */
  domain: string | null;
  /** D6-4：是否存在"文件继承自全局"（**逐文件**判定） */
  domainFallback: boolean;
  /** 本体目录（= 写入目标目录；默认域即全局 `.schema/`） */
  schemaDir: string;
  /** D6-4：写入目标目录（非默认域 = 该域目录） */
  writeDir?: string;
  /** D6-4：逐文件来源目录（供 UI 明示"该文件继承自全局"） */
  fileDirs?: Record<string, string>;
  files: { entities: boolean; edges: boolean; xref: boolean };
  counts: { entities: number; edges: number; xref: number };
  /**
   * 关系类型白名单（D4 处置面板消费：用于计算"白名单外类型"）
   *
   * ⚠️ 响应**不含** `entities[]`（O14 已收敛：实体详情在 `form.entities.rows` 与 `raw` 中都有）
   */
  edges: OntologyEdge[];
  /** 表单模式的结构化模型（含可表达性判定） */
  form: OntologyFormModels;
  /** 各文件原始 YAML 文本（原始 YAML 模式编辑用） */
  raw: OntologyRawFiles;
}

/** 本体写入结果（PUT /v1/knowledge/schema/{file}，服务端校验通过后才会返回） */
export interface OntologyWriteResult {
  written: boolean;
  file: string;
  path: string;
  /** 写前备份路径；原文件不存在时为 null */
  backup: string | null;
  effective: { entities: number; edges: number; xref: number };
  /** 服务端提示，如"写入只影响下一次编译" */
  note: string;
}

/** 单个校验问题 */
export interface OntologySchemaIssue {
  level: "error" | "warning";
  file: string;
  item?: number;
  message: string;
}

/** 校验结果（POST /v1/knowledge/schema/validate，恒 200 + ok 标记） */
export interface OntologyValidationResult {
  ok: boolean;
  errors: OntologySchemaIssue[];
  warnings: OntologySchemaIssue[];
  summary: { entities: number; edges: number; xref: number };
}

// ─── 调度 ───

export interface ScheduleConfig {
  type: "cron" | "interval" | "once";
  cronExpression?: string;
  intervalMinutes?: number;
  scheduledTime?: number;
  enabled: boolean;
}

export interface ExecutionRecord {
  id: string;
  taskId: string;
  startTime: number;
  endTime?: number;
  status: "completed" | "failed";
  result?: string;
  error?: string;
  tokenUsed?: number;
}

export type ScheduleMode = "cron" | "every" | "at";

export interface CronTask {
  id: string;
  name: string;
  expression: string;
  description: string;
  prompt?: string;
  enabled: boolean;
  scheduleMode?: ScheduleMode;
  scheduleDisplay?: string;
  silent?: boolean;
  lastRun?: number;
  nextRun?: number;
  lastDurationMs?: number;
  lastStatus?: "ok" | "error" | "skipped";
  lastError?: string;
  consecutiveErrors?: number;
  status: "idle" | "running" | "error";
}

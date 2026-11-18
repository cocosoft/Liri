import { httpLegacy as http, HTTPClientError } from "./httpClient";
import { ENDPOINTS } from "./endpoints";
import type { ApiError } from "../types/system";

/** 规则作用域（后端 `describePermissionRuleScope` 的派生字段，非落盘字段） */
export type PermissionRuleScope = "session" | "workspace" | "tool" | "global";

/** 规则来源侧：审批卡生成 / 用户手建 */
export type PermissionRuleOrigin = "approval" | "user";

export interface PermissionRule {
  id: string;
  behavior: "allow" | "deny" | "ask";
  toolName: string;
  contentPattern?: string;
  /** PR-2：「始终允许」档的参数指纹摘要（存在 ⇒ 该规则只对同一指纹生效） */
  inputFingerprint?: string;
  /** G3：「本工作区永久信任」的作用域根（审批生成，只读可撤销） */
  workspaceRoot?: string | null;
  source: string;
  priority: number;
  createdAt: string | null;
  updatedAt: string | null;
  /**
   * PR-2：settings 文件来源的规则（只读合并视图）。
   * 真实来源在 settings 文件里，面板只展示、不可经 `tool_rules.json` 接口删除。
   */
  readOnly?: boolean;
  /** R0：作用域（派生字段；settings 来源同样带） */
  scope?: PermissionRuleScope;
  /** R3：来源侧 —— 审批生成（只读、可撤销）或用户手建 */
  origin?: PermissionRuleOrigin;
  /** R3：审批时间（审批生成规则；旧规则回落 createdAt；非审批规则为 null） */
  approvedAt?: string | null;
  /** R3：批准者身份 —— 后端未落库，恒为 null（如实展示，不编造） */
  approvedBy?: string | null;
  /** R5：决策链真实判定命中次数（从未命中 ⇒ 0；settings 来源无此字段） */
  hitCount?: number;
  /** R5：最近命中时间（从未命中 ⇒ null） */
  lastHitAt?: string | null;
}

export interface PermissionRulesSummary {
  total: number;
  allow: number;
  deny: number;
  ask: number;
}

/** R3：审批生成规则的分组视图（与扁平 `rules` 同源，只读派生） */
export interface ApprovalRulesGroup {
  count: number;
  rules: PermissionRule[];
  /** 后端口径说明（原样展示；不参与前端分支） */
  note: string;
}

/** R3/F2：「暂停持久化放行」当前状态 */
export interface ApprovalPauseState {
  /** 兼容字段 = 全局暂停（旧后端/旧客户端口径） */
  enabled: boolean;
  /** 全局暂停（与 `enabled` 同值；F2 起显式返回） */
  global?: boolean;
  /** 按会话暂停的会话 id 列表（F2） */
  sessions?: string[];
  /** 按工作区根暂停的根路径列表（F2；服务端归一化后返回） */
  workspaces?: string[];
  configKey: string;
}

/** R2b：用户手建 allow 规则的预算用量（超限时写接口 409） */
export interface AllowBudget {
  limit: number;
  used: number;
}

/** R1.5：B 体系命令级策略（只读视图；未配置 ⇒ null） */
export interface CommandRuleEntry {
  pattern: string;
  matchType?: "prefix" | "regex";
  type?: "blacklist" | "whitelist";
  label?: string;
}

export interface CommandRulesView {
  readOnly: boolean;
  source: string;
  mode: "whitelist" | "blacklist";
  blacklist: CommandRuleEntry[];
  whitelist: CommandRuleEntry[];
  note: string;
}

/** R5：未收录命令摘要中的单条（窗口内某命令名的频次） */
export interface UnknownCommandHead {
  head: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  /** 最近一次的命令原文（已去敏，供归类） */
  latestSurface: string;
}

/** R5：近 N 天未收录命令摘要（无样本 ⇒ null，不编造 0） */
export interface UnknownCommandSuggestions {
  sinceDays: number;
  headCount: number;
  sampleCount: number;
  topHeads: UnknownCommandHead[];
}

export interface PermissionRulesResponse {
  rules: PermissionRule[];
  summary: PermissionRulesSummary;
  /** R3：来源=审批 的分组（只读派生视图） */
  approvalRules?: ApprovalRulesGroup;
  /** R3：暂停全部持久化放行的开关状态 */
  approvalPause?: ApprovalPauseState;
  /** R5：近 N 天被转审批的未收录命令（无样本 ⇒ null） */
  unknownCommandSuggestions?: UnknownCommandSuggestions | null;
  /** R1.5：B 体系命令级策略（只读；未配置 ⇒ null） */
  commandRules?: CommandRulesView | null;
  /** R2b：allow 预算用量 */
  allowBudget?: AllowBudget;
  /** 影子规则（遮蔽冲突）检测：deny/allow 规则互相遮蔽时提示，防止权限配置漏洞 */
  shadowDetection?: {
    shadowedCount: number;
    isValid: boolean;
    suggestions: string[];
    shadowedRules: Array<{
      reason: string;
      severity: "warning" | "error";
      shadowingIndex: number;
      shadowedRule: PermissionRule;
      shadowingRule: PermissionRule;
    }>;
  };
}

/** R5：单条规则命中统计 / 「长期未命中」报告 */
export interface StaleRuleInfo {
  ruleId: string;
  toolName: string;
  behavior: string;
  origin: PermissionRuleOrigin;
  contentPattern?: string;
  /** 从未命中 ⇒ null */
  lastHitAt: number | null;
  createdAt: number;
}

export interface RuleHitReport {
  /** 判定"未命中"的窗口（天） */
  staleDays: number;
  /** 开始计数的时刻 */
  countingSince: number;
  /** 已观察天数（向下取整） */
  observationDays: number;
  /**
   * 观察期是否已满 `staleDays`。
   * `false` ⇒ **不得**展示"未命中"结论（否则把"还没开始计数"误报成"规则没用"）。
   */
  observationComplete: boolean;
  staleRules: StaleRuleInfo[];
}

/** 同键不同行为（规则文件健康视图） */
export interface RuleKeyConflict {
  key: string;
  behaviors: string[];
  ids: string[];
}

/** 规则文件健康视图 GET /v1/permissions/rules/health（纯只读） */
export interface PermissionRulesHealth {
  generatedAt: number;
  path: string;
  exists: boolean;
  sizeBytes: number | null;
  lastModified: string | null;
  fileHash: string | null;
  loadedHash: string | null;
  externalChangeDetected: boolean;
  parseError: string | null;
  fileRuleCount: number | null;
  memoryRuleCount: number;
  duplicateCount: number;
  conflicts: RuleKeyConflict[];
  ruleHits: RuleHitReport;
}

/** R5：影响预演的逐条基准前后结论 */
export interface RuleImpactCase {
  toolName: string;
  command: string;
  before: "allow" | "ask" | "deny";
  after: "allow" | "ask" | "deny";
  /** `true` = 该基准被新规则变差（ask/allow → deny） */
  degraded: boolean;
}

/** R5：影响预演结果（409 `error.impact` 的结构） */
export interface RuleImpactPreview {
  mode: "auto" | "default";
  cases: RuleImpactCase[];
  /** 变差的基准命令（非空 ⇒ 写接口要求显式确认） */
  degradedCommands: string[];
  degraded: boolean;
  /** 口径说明（原样展示） */
  note: string;
}

/** 规则写接口的结构化错误体（R2 冲突/损坏/预算、R5 影响预演） */
export interface PermissionRuleWriteFailure {
  code: string;
  message: string;
  impact?: RuleImpactPreview;
  conflicts?: PermissionRule[];
  /** R2b：allow 预算超限时的当前上限（后端随错误体返回时可用） */
  limit?: number;
}

/** 类型守卫：`error.impact` 是否为影响预演结构 */
function isRuleImpactPreview(value: unknown): value is RuleImpactPreview {
  if (value === null || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  return (
    Array.isArray(raw.cases) &&
    Array.isArray(raw.degradedCommands) &&
    typeof raw.degraded === "boolean"
  );
}

/**
 * 读结构化错误体（写接口 409/403/400）。
 *
 * 返回 `null` = 不是本仓结构化错误（网络错误 / 非 JSON 错误体）——
 * 调用方据此走通用提示，**不靠 message 文案判断分支**（`CS02`）。
 */
export function readRuleWriteFailure(
  error: unknown,
): PermissionRuleWriteFailure | null {
  if (!(error instanceof HTTPClientError)) return null;
  const payload = (error.body as ApiError | undefined)?.payload;
  if (payload === null || typeof payload !== "object") return null;
  const raw = (payload as { error?: unknown }).error;
  if (raw === null || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  const code = typeof body.code === "string" ? body.code : "";
  if (!code) return null;
  return {
    code,
    message: typeof body.message === "string" ? body.message : error.message,
    ...(isRuleImpactPreview(body.impact) ? { impact: body.impact } : {}),
    ...(Array.isArray(body.conflicts)
      ? { conflicts: body.conflicts as PermissionRule[] }
      : {}),
    ...(typeof body.limit === "number" ? { limit: body.limit } : {}),
  };
}

/** 细粒度 RBAC 快照（GET /v1/permissions/rbac） */
export interface RbacRole {
  id: string;
  name: string;
  description?: string;
  ruleCount: number;
}

export interface RbacUser {
  id: string;
  name: string;
  roles: string[];
  ruleCount: number;
}

export interface RbacResource {
  id: string;
  type: string;
  name: string;
  path?: string;
  ruleCount: number;
}

export interface RbacBinding {
  id: string;
  resourceId: string;
  operation: string;
  action: string;
  roleId?: string;
  userId?: string;
  priority: number;
}

export interface RbacSnapshot {
  roles: RbacRole[];
  users: RbacUser[];
  resources: RbacResource[];
  bindings: RbacBinding[];
}

/** 工具权限规则管理（P1-5：对应后端 /v1/permissions/rules） */
export const permissionService = {
  async listRules(): Promise<PermissionRulesResponse> {
    return http.get<PermissionRulesResponse>(ENDPOINTS.permissions.rules);
  },

  /**
   * 新增规则。
   *
   * R5：若影响预演发现"基准命令变差" ⇒ 后端 409（`error.code='impact'`，**未写状态**），
   * 调用方需 `confirmImpact: true` 重试（见 `readRuleWriteFailure`）。
   */
  async addRule(
    behavior: "allow" | "deny" | "ask",
    toolName: string,
    contentPattern?: string,
    options?: { confirmImpact?: boolean },
  ): Promise<void> {
    return http.post(ENDPOINTS.permissions.rules, {
      behavior,
      toolName,
      contentPattern,
      ...(options?.confirmImpact !== undefined
        ? { confirmImpact: options.confirmImpact }
        : {}),
    });
  },

  /**
   * 编辑规则（R2：仅 `behavior` / `contentPattern`，`toolName` 不可改）。
   *
   * 为什么不再"删除+新增"：旧做法在新增被 409 拦住时，旧规则**已被删除**（不可逆的
   * 半完成状态）；PUT 是单次原子写，且同样支持 `confirmImpact` 重试。
   */
  async updateRule(
    ruleId: string,
    patch: {
      behavior?: "allow" | "deny" | "ask";
      contentPattern?: string | null;
      confirmImpact?: boolean;
    },
  ): Promise<void> {
    return http.put(ENDPOINTS.permissions.ruleById(ruleId), patch);
  },

  async deleteRule(ruleId: string): Promise<void> {
    return http.delete(ENDPOINTS.permissions.ruleById(ruleId));
  },

  /** R0/R5：规则文件健康视图（只读；含规则命中统计） */
  async getRulesHealth(): Promise<PermissionRulesHealth> {
    return http.get<PermissionRulesHealth>(ENDPOINTS.permissions.rulesHealth);
  },

  /**
   * R3/F2：写入暂停状态。
   *
   * - `{ global }` ⇒ 全局暂停（等于旧 `enabled` 语义，保留既有会话级条目）；
   * - `{ sessions }` ⇒ 按会话暂停（整体替换，其他会话不受影响）；
   * - `{ workspaces }` ⇒ 按工作区根暂停（整体替换；根由服务端统一归一化后比较）。
   */
  async updateApprovalPause(patch: {
    global?: boolean;
    sessions?: string[];
    workspaces?: string[];
  }): Promise<ApprovalPauseState & { message: string }> {
    return http.post<ApprovalPauseState & { message: string }>(
      ENDPOINTS.permissions.approvalsPause,
      patch,
    );
  },

  /** R3：全局暂停 / 恢复全部持久化放行（旧调用方语义不变） */
  async setApprovalPause(
    enabled: boolean,
  ): Promise<ApprovalPauseState & { message: string }> {
    return permissionService.updateApprovalPause({ global: enabled });
  },

  /** 细粒度 RBAC 快照（角色 / 用户 / 资源 / 绑定） */
  async getRbac(): Promise<RbacSnapshot> {
    return http.get<RbacSnapshot>(ENDPOINTS.permissions.rbac);
  },

  /**
   * 执行 RBAC 变更（复用 CLI 语法，如 `role bind guest bash allow`）
   *
   * 后端经 `CommandsOpsPort` 走同一个命令执行器 ⇒ 本面板与 CLI 行为一致。
   */
  async runRbac(
    command: string,
  ): Promise<{ success: boolean; message: string }> {
    return http.post<{ success: boolean; message: string }>(
      ENDPOINTS.permissions.rbac,
      { command },
    );
  },
};

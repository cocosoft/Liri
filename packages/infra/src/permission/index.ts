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
 * 权限系统模块统一导出
 */

export {
  PermissionMode,
  PERMISSION_MODES,
  PERMISSION_MODE_NAMES,
  PERMISSION_MODE_SYMBOLS,
  getPermissionModeDescription,
  shouldAvoidPermissionPrompts,
} from './PermissionMode';

export {
  PermissionBehavior,
  PermissionRuleSource,
} from './types/PermissionRule';

export type {
  PermissionRuleValue,
  PermissionRule,
} from './types/PermissionRule';

// LRO-07（2026-10-26）：规则拒绝的结构化回传（工具结果 `metadata.permissionDeny`）
export type { PermissionDenyInfo } from './types/PermissionDecision';

export type {
  PermissionRuleEntry,
  PermissionUpdateDestination,
  PermissionUpdate,
} from './PermissionRule';

export type {
  PermissionDecisionReason,
  PermissionResult,
  PermissionAllowDecision,
  PermissionDenyDecision,
  PermissionAskDecision,
  PermissionPassthroughDecision,
  PermissionDecision,
} from './PermissionResult';

export {
  getRuleBehaviorDescription,
  createAllowDecision,
  createDenyDecision,
  createAskDecision,
  createPassthroughDecision,
} from './PermissionResult';

export {
  getEmptyToolPermissionContext,
  getAllowRules,
  getDenyRules,
  getAskRules,
  getRuleByContentsForToolName,
  hasPermissionsToUseTool,
  type ToolPermissionContext,
} from './permissions';

export {
  checkReadPermissionForTool,
  checkWritePermissionForTool,
  isDangerousFile,
  isInDangerousDirectory,
  containsPathTraversal,
  isWithinWorkingDirectory,
  DANGEROUS_FILES,
  DANGEROUS_DIRECTORIES,
} from './filesystem';

export {
  loadPermissionsFromSettings,
  loadAllPermissionSettings,
} from './permissionsLoader';

export {
  applyPermissionUpdate,
  persistPermissionUpdates,
  type PermissionUpdateOperation,
} from './PermissionUpdateSchema';

// P3（2026-11-03）：`EnhancedPermissionEngine`（未接线旧轨）已摘除 barrel 出口。
// 六步核查（CD01-CD04）：全仓零 import / 零动态导入 / 零配置注册 / 零测试引用；
// 该类与 `permission/PermissionManager` 的规则引擎重复，保留只会形成第三套语义。

// P0-2（2026-10-27，权限归一化）：命令级黑白名单（B 体系）判定单点。
// 工具侧（`tools/bash/bashSecurityGate`）经本 barrel 取用 ⇒ 满足 R03-002 子入口约束。
export {
  evaluateCommandRules,
  readCommandRulesConfig,
  type CommandRuleLike,
  type CommandRulesSettings,
  type CommandRuleVerdict,
} from './commandRulePolicy';

export {
  ShadowedRuleDetector,
  shadowedRuleDetector,
} from './utils/ShadowedRuleDetector';
export type {
  ShadowedRuleInfo,
  ShadowedRuleDetectionResult,
} from './utils/ShadowedRuleDetector';

// P1（2026-11-04）：审批卡的**唯一构造点**（判定前 / 执行后两条路径共用）
export { buildToolApprovalCard } from './toolApprovalSubmission';
export type {
  ToolApprovalCard,
  ToolApprovalCardInput,
} from './toolApprovalSubmission';

// P1（2026-11-04）：权限判定的**唯一出口**（归一为 `PolicyDecision`，不复制判定链）
export { resolvePolicy } from './resolvePolicy';
export type {
  PolicyDecision,
  PolicyDecisionPort,
  PolicyEvidence,
  PolicyEvidenceSource,
  PolicyVerdict,
  ResolvePolicyRequest,
} from './resolvePolicy';

export {
  PermissionCache,
  PermissionRuleValidator,
  permissionCache,
  generateInputHash,
  checkPermissionsWithCache,
} from './PermissionCache';

export {
  checkDangerousCommand,
  validatePath,
  checkFileOperationPermission,
  checkNetworkOperationPermission,
  checkProcessOperationPermission,
  PermissionPolicyManager,
} from './PermissionPolicies';

// 工具执行审批链路（P0-3/P0-6）：已批准命令放行缓存
export {
  ApprovedCommandRegistry,
  getApprovedCommandRegistry,
  // P2-4（2026-11-07）：审批档位字面量常量（`'once'` 的真语义 = 命令指纹 TTL 档）
  APPROVAL_SCOPE_COMMAND_TTL,
  normalizeCommand,
  hashCommand,
  hashCommandForExecution,
  hashEnvForApproval,
  computeScopeDigest,
  getBaseCommand,
  toolCallApprovalKey,
  isToolCallApproved,
  hashApprovalFingerprint,
} from './ApprovedCommandRegistry';
export type {
  ApprovalEntry,
  ApprovalScope,
  ApprovalSnapshot,
} from './ApprovedCommandRegistry';
// P2（2026-11-04，方案 §3.3）：任务档审批作用域 —— 会话活跃任务解析端口
export { setActiveTaskIdResolver, getActiveTaskId } from './activeTaskScope';
export type { ActiveTaskIdResolver } from './activeTaskScope';

// PR-2（2026-10-23）：授权维度（工具+参数指纹）与「始终允许」规则
export {
  resolveApprovalFingerprint,
  normalizeApprovalPath,
  previewApprovalFingerprint,
} from './approvalFingerprint';
export type { ApprovalFingerprintDeclaringTool } from './approvalFingerprint';

// PR-1（2026-10-23）：审批卡提交前去重（同指纹复用，防僵尸卡）
export { findPendingApprovalId } from './inboxApprovalDedupe';
export type { PendingApprovalLookup } from './inboxApprovalDedupe';

// P5-5（2026-10-28）：审批四段判定内核（规格 `.trae/specs/p5-runtime-hardening-specs.md` §1）
export {
  APPROVAL_REPLY_TO_DECISION,
  APPROVAL_STAGES,
  advanceApproval,
  isApprovalExecutable,
  resolveApprovalDecision,
  resolveRecordScope,
  startApprovalChain,
} from './approvalStages';
export type {
  ApprovalAdvanceOptions,
  ApprovalAdvanceResult,
  ApprovalChainState,
  ApprovalDecisionValue,
  ApprovalStage,
} from './approvalStages';

// P5-1（2026-10-28）：审批四段**事件打点**（开关 + 注入式落盘出口）
// 规格 §1.2 A1/A2；落盘出口由入口注入（`runtime/api/approvalAuditSink`），
// 避免 `permission`(infra) 反向依赖 `chat`/`runtime`。
export {
  DEFAULT_APPROVAL_FOUR_STAGE_CONFIG,
  emitApprovalAudit,
  newApprovalId,
  parseApprovalFourStageConfig,
  readApprovalFourStageConfig,
  setApprovalAuditSink,
} from './approvalAudit';
export type {
  ApprovalAuditEvent,
  ApprovalAuditSink,
  ApprovalDecidedAudit,
  ApprovalFourStageConfig,
  ApprovalPresentedAudit,
  ApprovalRecordedAudit,
  ApprovalRequestedAudit,
} from './approvalAudit';

// Risk classification (Phase 3: OpenWorker-style)
export {
  RiskClass,
  inferRiskClass,
  resolveRiskClass,
  detectChainedCommand,
} from './types/RiskClass';

export { DenialTracker, denialTracker } from './trackers/DenialTracker';

export {
  PermissionMetricsStore,
  permissionMetrics,
} from './metrics/PermissionMetricsStore';

// 2026-08-30 R03-002 收敛：PermissionManager / FineGrainedPermissionManager / RuleManager / Permission 统一出口
export {
  PermissionManager,
  createPermissionManager,
} from './PermissionManager';
// D2（2026-10-11）：权限管理器注入断言（生产 fail-fast，G9）
export { assertPermissionManagerInjected } from './assertPermissionInjected';
// P1（2026-11-03）：工具授权**单一入口**（Agent 主链 + HTTP/CoreAPI 路径共用）
export { authorizeToolCall } from './authorizeToolCall';
export type {
  AuthorizeOutcome,
  AuthorizeToolCallRequest,
  ToolAuthorizeContext,
  ToolPermissionPort,
  ToolPermissionPortResult,
} from './authorizeToolCall';
export {
  FineGrainedPermissionManager,
  createFineGrainedPermissionManager,
} from './FineGrainedPermissionManager';
export { RuleManager, deduplicateRules } from './RuleManager';
export type { RuleContext } from './RuleManager';
// P2-1（2026-11-03）：统一 Rule 模型（A / settings / B-command / StandingRule 只读投影）
export {
  permissionRulesToUnified,
  settingsToUnified,
  commandRulesToUnified,
  standingRulesToUnified,
  mergeUnifiedRules,
  diffUnifiedRules,
  groupBySource,
  parseSettingsRuleText,
  renderRuleSourceDocRows,
  RULE_SOURCE_DOC_ROWS,
} from './unifiedRule';
export type {
  UnifiedRule,
  UnifiedRuleScope,
  UnifiedRuleBehavior,
  UnifiedRuleSourceKey,
  UnifiedRuleMatcher,
  UnifiedRuleDiff,
  SettingsRulesInput,
  CommandRulesInput,
} from './unifiedRule';
// P2-1：StandingRule 类型已由统一模型消费，补 barrel 出口（值类型仍走原模块单例）
export type { StandingRule } from './StandingRuleEngine';
export {
  ResourceType,
  OperationType,
  PermissionAction,
  RoleType,
} from './Permission';

// P33（2026-11-02）：授权强度模型（准入判定，与上面的动作拦截正交）
export {
  STRENGTH_RANK,
  ADMISSION_DEFAULTS,
  isInferred,
  resolveAdmissionCell,
  resolveAdmission,
  evaluateGate,
  admitsInferred,
  decideAcceptance,
  revalidateMandate,
  diffPolicyEffects,
  buildPolicyVersion,
} from './policyStrength';
export type {
  Strength,
  AdmissionCell,
  AdmissionDecision,
  AcceptMode,
  AdmissionTable,
  GateReason,
  GateFacts,
  GateResult,
  MandateBasis,
  Mandate,
  RevalidationFacts,
  RevalidationFailure,
  RevalidationResult,
  PolicySnapshot,
  PolicyEffect,
  AcceptanceDecision,
  AutonomyPolicyRule,
  AutonomyPolicyConfig,
} from './types/PolicyStrength';

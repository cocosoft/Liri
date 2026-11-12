/**
 * 权限决策主链路（P1 拆分，2026-11-12）
 *
 * 从 `PermissionManager.checkPermissionInner` / `executePermissionHooks` 原样搬出：
 * 钩子优先 → 按（会话级优先的）生效模式分派五档处理器 → 非幂等重试升级 → 审计。
 * 判定顺序、文案与日志**逐字不变**；差异只有一处 —— 实例状态改为经
 * `DecisionPipelineDeps` 显式传入（每次调用按当前实例状态构建，不缓存）。
 */
import { getLogger } from '@openliri/infra/monitoring';

import type { PermissionHookService } from '../PermissionHookService';
import { PermissionMode } from '../PermissionMode';
import type { RuleContext } from '../RuleManager';
import type { DenialTracker } from '../trackers/DenialTracker';
import type { PermissionContext } from '../types/PermissionContext';
import { createPermissionContext } from '../types/PermissionContext';
import {
  PermissionDecision,
  PermissionDecisionType,
  createAllowDecision,
  createAskDecision,
  createDenyDecision,
} from '../types/PermissionDecision';
import type {
  PermissionHookContext,
  PermissionHookDecision,
} from '../types/PermissionHook';
import type { RuleMatcherPermissionContext } from '../utils/RuleMatcher';
import type { Tool } from '../PermissionChecker';
import { auditDecision } from './decisionTelemetry';
import {
  ModeHandlerDeps,
  handleAuto,
  handleBypassPermissions,
  handleDefault,
  handleDontAsk,
  handlePlan,
} from './modeHandlers';
import { resolveEffectiveMode } from './moduleScope';

const logger = getLogger('permission:manager');

/** 决策主链路可见的实例状态（拆分前是 `this.*`） */
export interface DecisionPipelineDeps {
  /** 进程默认权限档（会话级 `context.permissionMode` 可覆盖） */
  mode: PermissionMode;
  toolPermissionContext: RuleMatcherPermissionContext;
  permissionHookService: PermissionHookService;
  denialTracker: DenialTracker;
  /** 五档处理器依赖（调用方按当前实例状态构建，不缓存） */
  modeHandlerDeps: ModeHandlerDeps;
}

/**
 * 检查工具权限（内部实现，决策主链路）
 * @param toolOrName 工具对象或工具名称
 * @param input 工具输入
 * @param context 权限上下文（可选）
 * @returns 权限决策
 */
export async function checkPermissionInner(
  deps: DecisionPipelineDeps,
  toolOrName: Tool | string,
  input: Record<string, unknown>,
  context?: PermissionContext,
  /** R07-3（2026-10-07）：非幂等工具「重试」理由（见本方法末的模式豁免升级） */
  forceAskReason?: string
): Promise<PermissionDecision> {
  // 获取工具名称
  const toolName =
    typeof toolOrName === 'string' ? toolOrName : toolOrName.name;

  // 创建权限上下文
  const permissionContext =
    context ||
    createPermissionContext({
      toolName,
      input,
    });

  // 创建规则上下文
  const ruleContext: RuleContext = {
    alwaysAllowRules: deps.toolPermissionContext.alwaysAllowRules,
    alwaysDenyRules: deps.toolPermissionContext.alwaysDenyRules,
    alwaysAskRules: deps.toolPermissionContext.alwaysAskRules,
  };

  // 1. 执行权限钩子
  const hookDecision = await executePermissionHooks(
    deps.permissionHookService,
    deps.mode,
    toolName,
    input,
    permissionContext
  );
  if (hookDecision) {
    let decision: PermissionDecision;
    if (hookDecision.behavior === 'allow') {
      decision = createAllowDecision(
        hookDecision.message || 'Allowed by permission hook'
      );
    } else if (hookDecision.behavior === 'deny') {
      deps.denialTracker.trackDenial(toolName, permissionContext.sessionId);
      decision = createDenyDecision(
        hookDecision.message || 'Denied by permission hook'
      );
    } else {
      decision = createAskDecision(
        hookDecision.message || 'Ask requested by permission hook'
      );
    }
    auditDecision(decision, toolName, input);
    return decision;
  }

  // 2. 根据权限模式执行不同的检查逻辑
  // （2026-10-23 PR-3b：原「沙箱自动允许」分支已删除 —— 死接线 + 按工具名猜；）
  // （其职责由 `PermissionChecker` 风险默认档前的沙箱豁免 S1–S4 承担。）
  // P1（2026-11-04）：**会话级模式优先于进程默认档**。执行入口把会话元数据
  // `permission_mode` 放进 `context.permissionMode`；缺省（CLI / 后台 / 未设置）用
  // `deps.mode`（来自 `PERMISSION_MODE` 环境变量，见构造器）。不改全局单例 ⇒ 并发会话不串档。
  // 2026-11-11：三层优先级收敛到 `resolveEffectiveMode()`（判定与审计标签共用）。
  const effectiveMode = resolveEffectiveMode(
    permissionContext.permissionMode,
    deps.mode
  );
  let decision: PermissionDecision;
  switch (effectiveMode) {
    case PermissionMode.BYPASS:
      decision = handleBypassPermissions();
      break;
    case PermissionMode.DONT_ASK:
      decision = await handleDontAsk(
        deps.modeHandlerDeps,
        toolOrName,
        input,
        permissionContext,
        ruleContext
      );
      break;
    case PermissionMode.PLAN:
      decision = await handlePlan(
        deps.modeHandlerDeps,
        toolOrName,
        input,
        permissionContext,
        ruleContext
      );
      break;
    case PermissionMode.AUTO:
      decision = await handleAuto(
        deps.modeHandlerDeps,
        toolOrName,
        input,
        permissionContext,
        ruleContext
      );
      break;
    case PermissionMode.DEFAULT:
    default:
      decision = await handleDefault(
        deps.modeHandlerDeps,
        toolOrName,
        input,
        permissionContext,
        ruleContext
      );
      break;
  }

  // R07-3（2026-10-07）：非幂等工具「重试」⇒ 把**本该放行**的调用升级为 `ask`（审批）。
  // 复用既有 ask⇒Inbox 通路（本方法调用方 `checkPermissionForTool` 提交卡片）⇒ 不新建审批机制。
  // - D4：**只升级 `allow`** ⇒ `deny` 永不被削弱（安全姿态单调）；
  // - D2：`bypass` / `dontAsk` 是用户/自动化**显式**"不要打断"（无人值守依赖），不覆盖
  //   —— 否则无人值守流程会永久挂在 `awaiting_approval`。
  if (
    forceAskReason &&
    decision.type === PermissionDecisionType.ALLOW &&
    effectiveMode !== PermissionMode.BYPASS &&
    effectiveMode !== PermissionMode.DONT_ASK
  ) {
    decision = createAskDecision(forceAskReason);
    logger.info('permission:non_idempotent_retry_escalated', {
      tool: toolName,
      mode: effectiveMode,
    });
  }

  auditDecision(decision, toolName, input);
  return decision;
}

/**
 * 执行权限钩子
 * @param toolName 工具名称
 * @param input 工具输入
 * @param context 权限上下文
 * @returns 钩子决策或null
 */
export async function executePermissionHooks(
  permissionHookService: PermissionHookService,
  mode: PermissionMode,
  toolName: string,
  input: Record<string, unknown>,
  context: PermissionContext
): Promise<PermissionHookDecision | null> {
  const hookContext: PermissionHookContext = {
    toolName,
    toolUseID: '',
    input,
    permissionMode: mode,
    context,
    abortSignal: undefined,
  };

  return await permissionHookService.executeHooks(hookContext);
}

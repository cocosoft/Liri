/**
 * 权限**五档模式处理器**（P1 拆分，2026-11-12）
 *
 * 从 `PermissionManager.ts` 原样搬出：`bypass` / `dontAsk` / `default` / `plan` / `auto`。
 * 判定顺序、文案、日志与拆分前**逐字一致**；差异只有一处 —— 实例状态改为经
 * `ModeHandlerDeps` 显式传入（不再 `this.`），便于后续按档独立演进与单测。
 */
import { feature } from '@openliri/kernel';
import { handleError } from '@openliri/infra/error';
import { getLogger } from '@openliri/infra/monitoring';
import { detectIntentActionDeviation } from '@openliri/infra/utils/toolContract/intentActionDeviation';
import { isCommandToolName } from '@openliri/infra/utils/toolContract/toolRoles';

import { hashApprovalFingerprint } from '../ApprovedCommandRegistry';
import {
  PermissionChecker,
  Tool,
  checkCommandCustomRules,
} from '../PermissionChecker';
import type { RuleContext, RuleManager } from '../RuleManager';
import { resolveApprovalFingerprint } from '../approvalFingerprint';
import type { ClassifierManager } from '../classifiers/auto-mode-classifier-manager';
import { checkReadonlyCommand } from '../classifiers/readonly-command-allowlist';
import type { DenialTracker } from '../trackers/DenialTracker';
import type { PermissionContext } from '../types/PermissionContext';
import {
  createAllowDecision,
  createAskDecision,
  createDenyDecision,
  PermissionDecision,
  PermissionDecisionType,
} from '../types/PermissionDecision';
import { PermissionBehavior } from '../types/PermissionRule';
import { denyByRule } from './denyByRule';
import {
  defaultAllowWarnedTools,
  logBypassObservabilityOnce,
  resolveFineGrainedRoles,
} from './moduleScope';

const logger = getLogger('permission:manager');

/** 处理器可见的实例状态（拆分前是 `this.*`；语义与生命周期不变） */
export interface ModeHandlerDeps {
  ruleManager: RuleManager;
  denialTracker: DenialTracker;
  classifierManager: ClassifierManager;
  messages: Array<{ role: string; content: string }>;
  defaultBehavior: 'allow' | 'deny';
  permissionChecker: PermissionChecker;
  checkFineGrainedRules: (
    toolName: string,
    userId: string | undefined,
    effectiveRoles: string[],
    sessionId?: string
  ) => Promise<{
    deny?: PermissionDecision;
    ask?: PermissionDecision;
    allow?: PermissionDecision;
  }>;
}

  /**
   * 处理绕过权限检查模式
   * @returns 权限决策
   */
  export function handleBypassPermissions(): PermissionDecision {
    // P0-3（2026-10-27，权限归一化）：bypass 无条件放行且**不查 killswitch**
    // （`BypassPermissionsKillswitch` 在决策链零调用点）。此处只加可观测，不改语义。
    logBypassObservabilityOnce();
    return createAllowDecision('Bypassing permissions check');
  }

  /**
   * 处理不询问模式
   * @param toolOrName 工具对象或工具名称
   * @param input 工具输入
   * @param context 权限上下文
   * @returns 权限决策
   */
  export async function handleDontAsk(
  deps: ModeHandlerDeps,
    toolOrName: Tool | string,
    input: Record<string, unknown>,
    context: PermissionContext,
    ruleContext?: RuleContext
  ): Promise<PermissionDecision> {
    const toolName =
      typeof toolOrName === 'string' ? toolOrName : toolOrName.name;

    // 1. A 体系工具级 deny：deny 永远优先于任何 allow（含 RBAC allow）
    // P0-2（2026-11-11）：**显式 deny 不因「连续拒绝」升级为 ask** —— deny 可批准
    // 等于把安全规则变成建议；计数器只用于统计/升级提示，不改变 deny 结论。
    const denyRule = deps.ruleManager.getDenyRuleForTool(toolName);
    if (denyRule) {
      deps.denialTracker.trackDenial(toolName, context.sessionId);
      return denyByRule(toolName, denyRule);
    }

    // 2. RBAC（角色 / 用户 / 资源）：deny 优先；ask 在本档**转拒绝**（"不询问"语义）；
    //    allow 等同允许规则（放在 A 体系 allow 之后，不越过任何 deny）。
    const effectiveRoles = resolveFineGrainedRoles(
      context.userRoles,
      context.userRole
    );
    const fineGrained = await deps.checkFineGrainedRules(
      toolName,
      context.userId,
      effectiveRoles,
      context.sessionId
    );
    if (fineGrained.deny) {
      deps.denialTracker.trackDenial(toolName, context.sessionId);
      return fineGrained.deny;
    }
    if (fineGrained.ask) {
      deps.denialTracker.trackDenial(toolName, context.sessionId);
      return createDenyDecision('Dont ask mode, denying fine-grained ask');
    }

    // 2.5（P0-3，2026-11-11）：本档此前**跳过**命令级黑白名单与指纹规则 ⇒
    // 「不询问」反而放行了用户明确 deny 的命令。以下与 default 档同序、ask 转拒绝：
    //   - 命令黑名单 / whitelist 未命中 ⇒ deny；白名单命中 ⇒ allow（显式放行）；
    //   - 内容 / 指纹级 deny ⇒ deny；内容 / 指纹级 ask ⇒ deny（不询问）。
    if (isCommandToolName(toolName) && typeof input.command === 'string') {
      const cmdDecision = checkCommandCustomRules(input.command);
      if (cmdDecision) {
        return cmdDecision.type === PermissionDecisionType.ASK
          ? createDenyDecision(
              `Dont ask mode, denying ask: ${cmdDecision.reason ?? 'command rule'}`
            )
          : cmdDecision;
      }
    }

    const approvalFingerprint = hashApprovalFingerprint(
      resolveApprovalFingerprint(toolOrName, input)
    );
    const matchOptions = { fingerprint: approvalFingerprint };
    const matchingDenyRule = deps.ruleManager.getMatchingRule(
      toolName,
      input,
      PermissionBehavior.DENY,
      ruleContext,
      matchOptions
    );
    if (matchingDenyRule) {
      deps.denialTracker.trackDenial(toolName, context.sessionId);
      return denyByRule(toolName, matchingDenyRule, approvalFingerprint);
    }

    const askRule = deps.ruleManager.getAskRuleForTool(toolName, ruleContext);
    if (askRule) {
      return createDenyDecision(
        `Dont ask mode, denying ask rule from ${askRule.source}`
      );
    }
    const matchingAskRule = deps.ruleManager.getMatchingRule(
      toolName,
      input,
      PermissionBehavior.ASK,
      ruleContext,
      matchOptions
    );
    if (matchingAskRule) {
      return createDenyDecision(
        `Dont ask mode, denying ask rule from ${matchingAskRule.source}`
      );
    }

    // 3. A 体系允许规则
    if (deps.permissionChecker.isToolAllowed(toolOrName, context)) {
      return createAllowDecision('Tool is allowed by permission rule');
    }

    // 4. RBAC allow
    if (fineGrained.allow) return fineGrained.allow;

    // 跟踪拒绝（"不询问"档不因连续拒绝改判为 ask —— 那是自相矛盾的）
    deps.denialTracker.trackDenial(toolName, context.sessionId);

    return createDenyDecision('Dont ask mode, denying permission');
  }



  /**
   * 处理默认模式
   * @param toolOrName 工具对象或工具名称
   * @param input 工具输入
   * @param context 权限上下文
   * @param ruleContext 规则上下文
   * @returns 权限决策
   */
  export async function handleDefault(
  deps: ModeHandlerDeps,
    toolOrName: Tool | string,
    input: Record<string, unknown>,
    context: PermissionContext,
    ruleContext?: RuleContext
  ): Promise<PermissionDecision> {
    const toolName =
      typeof toolOrName === 'string' ? toolOrName : toolOrName.name;

    // 检查安全工具白名单
    if (deps.classifierManager.isAllowlistedTool(toolName)) {
      return createAllowDecision('Tool is on safe allowlist');
    }

    // 使用新的规则管理器检查
    const denyRule = deps.ruleManager.getDenyRuleForTool(toolName, ruleContext);
    if (denyRule) {
      deps.denialTracker.trackDenial(toolName, context.sessionId);
      return denyByRule(toolName, denyRule);
    }

    // D 体系（角色 / 用户 / 资源）规则：deny 在此立即返回（先于一切 ask/allow）；
    // ask / allow 两档在本函数后段按“ask 先于 allow”的安全顺序返回。
    // 身份位由调用方传入（本地身份经 getEffectivePermissionRole 映射为 admin，2026-11-11）。
    const effectiveRoles = resolveFineGrainedRoles(
      context.userRoles,
      context.userRole
    );
    const fineGrained = await deps.checkFineGrainedRules(
      toolName,
      context.userId,
      effectiveRoles,
      context.sessionId
    );
    if (fineGrained.deny) return fineGrained.deny;

    // P1-2: 命令内容级黑白名单（「设置→自定义规则」B 体系）—
    // 黑名单命中 deny；whitelist 模式命中 allow（覆盖工具级 ask 规则，实现"白名单免审批"）
    // P1（2026-11-07）：命令类工具扩到 powershell/pwsh（此前只对 bash 生效）
    if (isCommandToolName(toolName) && typeof input.command === 'string') {
      const cmdDecision = checkCommandCustomRules(input.command);
      if (cmdDecision) return cmdDecision;
    }

    // LRO-D1（2026-10-26）：**内容级 / 指纹级 deny 必须先于一切 ask / allow 评估**。
    // 原顺序把"工具级 ask / 工具级 allow"排在内容 deny 之前 ⇒ 一条「始终允许此工具」
    // 会静默越过针对该工具的内容 deny（安全排序不对称）。
    // 指纹摘要与审批落盘**同源**：`hashApprovalFingerprint(resolveApprovalFingerprint(...))`。
    const approvalFingerprint = hashApprovalFingerprint(
      resolveApprovalFingerprint(toolOrName, input)
    );
    const matchOptions = { fingerprint: approvalFingerprint };

    const matchingDenyRule = deps.ruleManager.getMatchingRule(
      toolName,
      input,
      PermissionBehavior.DENY,
      ruleContext,
      matchOptions
    );
    if (matchingDenyRule) {
      deps.denialTracker.trackDenial(toolName, context.sessionId);
      return denyByRule(toolName, matchingDenyRule, approvalFingerprint);
    }

    const askRule = deps.ruleManager.getAskRuleForTool(toolName, ruleContext);
    if (askRule) {
      return createAskDecision(`Asked by rule from ${askRule.source}`);
    }

    const matchingAskRule = deps.ruleManager.getMatchingRule(
      toolName,
      input,
      PermissionBehavior.ASK,
      ruleContext,
      matchOptions
    );
    if (matchingAskRule) {
      return createAskDecision(`Asked by rule from ${matchingAskRule.source}`);
    }

    // D 体系 ask：排在工具级 ask 之后、allow 之前（ask 不越过 allow）
    if (fineGrained.ask) return fineGrained.ask;

    const allowRule = deps.ruleManager.toolAlwaysAllowedRule(
      toolName,
      ruleContext
    );
    if (allowRule) {
      return createAllowDecision(`Allowed by rule from ${allowRule.source}`);
    }

    const matchingAllowRule = deps.ruleManager.getMatchingRule(
      toolName,
      input,
      PermissionBehavior.ALLOW,
      ruleContext,
      matchOptions
    );
    if (matchingAllowRule) {
      return createAllowDecision(
        `Allowed by rule from ${matchingAllowRule.source}`
      );
    }

    // D 体系 allow：所有 deny / ask 与显式 allow 之后才生效（安全兜底）
    if (fineGrained.allow) return fineGrained.allow;

    // 语义护栏「便宜版」（2026-10-21）：意图-动作偏离 ⇒ 升级为 ask（**不直接拒绝**）。
    // 位置在所有显式规则之后、默认行为之前 —— 用户显式 allow/deny/ask 规则始终优先。
    if (feature('INTENT_ACTION_DEVIATION_GUARD')) {
      const goalText =
        typeof context.metadata?.['goalText'] === 'string'
          ? (context.metadata['goalText'] as string)
          : undefined;
      const deviation = detectIntentActionDeviation({
        ...(goalText !== undefined ? { goalText } : {}),
        toolName,
        input,
      });
      if (deviation.deviated && deviation.reason) {
        return createAskDecision(deviation.reason);
      }
    }

    // 没有规则匹配，按默认行为决定（P0-2：PERMISSION_DEFAULT_BEHAVIOR=deny 时 fail-closed）
    if (deps.defaultBehavior === 'deny') {
      return createDenyDecision('No matching rules, default denying');
    }
    // P0-3（2026-10-27，权限归一化）：`defaultBehavior='allow'` 属"无规则即放行"，
    // 是与 fail-closed 相反的默认；按**工具**去重记一次，便于统计"权限空转"面。
    if (!defaultAllowWarnedTools.has(toolName)) {
      defaultAllowWarnedTools.add(toolName);
      logger.warn('权限默认放行（无规则匹配，defaultBehavior=allow）', {
        reasonCode: 'default_allow',
        toolName,
      });
    }
    return createAllowDecision('No matching rules, default allowing');
  }

  /**
   * 处理「每步确认」档（`plan`，2026-11-11 前同时承担 ask / alwaysAsk 的语义）：
   * 每次工具调用都返回 ask，不自动放行（allow 规则也不生效）。
   */
  export async function handlePlan(
  deps: ModeHandlerDeps,
    toolOrName: Tool | string,
    input: Record<string, unknown>,
    context: PermissionContext,
    ruleContext?: RuleContext
  ): Promise<PermissionDecision> {
    const toolName =
      typeof toolOrName === 'string' ? toolOrName : toolOrName.name;

    // P0-4（2026-11-11）：本档此前**无条件 ask** ⇒ 显式 deny / 命令黑名单 / RBAC deny
    // 全部被绕过（"每步确认"比 default 更宽松，且把禁止项变成可批准）。
    // 现在：硬 deny 仍然 deny，"每步确认"只作用于**未被禁止**的调用。
    const denyRule = deps.ruleManager.getDenyRuleForTool(toolName, ruleContext);
    if (denyRule) {
      deps.denialTracker.trackDenial(toolName, context.sessionId);
      return denyByRule(toolName, denyRule);
    }

    const effectiveRoles = resolveFineGrainedRoles(
      context.userRoles,
      context.userRole
    );
    const fineGrained = await deps.checkFineGrainedRules(
      toolName,
      context.userId,
      effectiveRoles,
      context.sessionId
    );
    if (fineGrained.deny) return fineGrained.deny;

    if (isCommandToolName(toolName) && typeof input.command === 'string') {
      const cmdDecision = checkCommandCustomRules(input.command);
      if (cmdDecision?.type === PermissionDecisionType.DENY) {
        return cmdDecision;
      }
    }

    const approvalFingerprint = hashApprovalFingerprint(
      resolveApprovalFingerprint(toolOrName, input)
    );
    const matchingDenyRule = deps.ruleManager.getMatchingRule(
      toolName,
      input,
      PermissionBehavior.DENY,
      ruleContext,
      { fingerprint: approvalFingerprint }
    );
    if (matchingDenyRule) {
      deps.denialTracker.trackDenial(toolName, context.sessionId);
      return denyByRule(toolName, matchingDenyRule, approvalFingerprint);
    }

    return createAskDecision('Plan mode, requiring user approval');
  }

  /**
   * 处理自动模式
   * @param toolOrName 工具对象或工具名称
   * @param input 工具输入
   * @param context 权限上下文
   * @param ruleContext 规则上下文
   * @returns 权限决策
   */
  export async function handleAuto(
  deps: ModeHandlerDeps,
    toolOrName: Tool | string,
    input: Record<string, unknown>,
    context: PermissionContext,
    ruleContext?: RuleContext
  ): Promise<PermissionDecision> {
    const toolName =
      typeof toolOrName === 'string' ? toolOrName : toolOrName.name;

    // 1. 检查安全工具白名单
    if (deps.classifierManager.isAllowlistedTool(toolName)) {
      deps.denialTracker.trackSuccess(toolName, context.sessionId);
      return createAllowDecision('Tool is on safe allowlist');
    }

    // 2. 检查规则
    // P0-2（2026-11-11）：显式 deny 不因连续拒绝升级为 ask（同上）。
    const denyRule = deps.ruleManager.getDenyRuleForTool(toolName, ruleContext);
    if (denyRule) {
      deps.denialTracker.trackDenial(toolName, context.sessionId);
      return denyByRule(toolName, denyRule);
    }

    // 2.1（2026-11-11）RBAC（角色 / 用户 / 资源）与 default 档同口径：
    // deny 先于一切 ask/allow；ask / allow 在后段按“ask 先于 allow”返回。
    // 身份位由调用方传入（本地身份映射为 admin）。
    const effectiveRoles = resolveFineGrainedRoles(
      context.userRoles,
      context.userRole
    );
    const fineGrained = await deps.checkFineGrainedRules(
      toolName,
      context.userId,
      effectiveRoles,
      context.sessionId
    );
    if (fineGrained.deny) return fineGrained.deny;

    // P1-2: 命令内容级黑白名单（「设置→自定义规则」B 体系）— 与 handleDefault 一致
    // P1（2026-11-07）：命令类工具扩到 powershell/pwsh（此前只对 bash 生效）
    if (isCommandToolName(toolName) && typeof input.command === 'string') {
      const cmdDecision = checkCommandCustomRules(input.command);
      if (cmdDecision) return cmdDecision;
    }

    const askRule = deps.ruleManager.getAskRuleForTool(toolName, ruleContext);
    if (askRule) {
      return createAskDecision(`Asked by rule from ${askRule.source}`);
    }

    // RBAC ask：排在工具级 ask 之后、allow 之前（ask 不越过 allow）
    if (fineGrained.ask) return fineGrained.ask;

    const allowRule = deps.ruleManager.toolAlwaysAllowedRule(
      toolName,
      ruleContext
    );
    if (allowRule) {
      deps.denialTracker.trackSuccess(toolName, context.sessionId);
      return createAllowDecision(`Allowed by rule from ${allowRule.source}`);
    }

    // RBAC allow：显式绑定优先于只读短路与分类器（deny / ask 已在上面处理）
    if (fineGrained.allow) return fineGrained.allow;

    // 2.5（2026-11-09，B4 follow-up）：只读命令短路。
    // 用户显式 deny / ask / allow 规则（上面）优先；这里只放行结构上只读的单一命令，
    // 含管道/重定向/命令替换、`find -exec`、`git` 非只读子命令等继续走分类器。
    if (isCommandToolName(toolName) && typeof input.command === 'string') {
      const readonly = checkReadonlyCommand(input.command);
      if (readonly.allowed) {
        deps.denialTracker.trackSuccess(toolName, context.sessionId);
        return createAllowDecision(readonly.reason);
      }
    }

    // 3. 使用自动分类器
    try {
      const classifierDecision = await deps.classifierManager.classify(
        toolName,
        input,
        deps.messages
      );

      if (classifierDecision.requiresApproval) {
        // 2026-11-11（P5-approval）：`cp` / `mv` 这类"常见但可能不可逆"的命令
        // 不硬拒也不静默放行 ⇒ 转人工审批（用户可在审批卡上决定）。
        return createAskDecision(
          classifierDecision.reason || 'Requires approval by auto classifier'
        );
      }

      if (classifierDecision.shouldBlock) {
        // P0-2：分类器判定为阻断（deny）时保持 deny；连续拒绝只做统计，不升高为可批准
        deps.denialTracker.trackDenial(toolName, context.sessionId);

        return createDenyDecision(
          classifierDecision.reason || 'Blocked by auto classifier'
        );
      } else {
        deps.denialTracker.trackSuccess(toolName, context.sessionId);
        return createAllowDecision(
          classifierDecision.reason || 'Allowed by auto classifier'
        );
      }
    } catch (error) {
      await handleError(error, {
        module: 'permission:manager',
        action: 'classifier_check',
      });
      // P8（2026-11-12）：分类器异常 ⇒ **fail-closed 到 ask**（可人工批准）。
      // 此前是 fail-open（静默放行）：分类器真抛错时（如本轮遇到的 ReferenceError）
      // 所有"需要判定"的命令会被直接放行 —— 比"未知命令 ⇒ ask"危险得多。
      // 只读命令已在 §2.5 短路（`checkReadonlyCommand`），不经过本分支；
      // 故本改动只影响"本来就要判定"的命令，坏一次不至于全面放行或全面阻断。
      logger.warn('权限分类器异常，转人工审批（fail-closed）', {
        reasonCode: 'classifier_fail_closed_ask',
        toolName,
        error: error instanceof Error ? error.message : String(error),
      });
      return createAskDecision(
        'Classifier unavailable, manual approval required'
      );
    }
  }

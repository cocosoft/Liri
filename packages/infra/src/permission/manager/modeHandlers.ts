/**
 * 权限**五档模式处理器**（P1 拆分，2026-11-12）
 *
 * 从 `PermissionManager.ts` 原样搬出：`bypass` / `dontAsk` / `default` / `plan` / `auto`。
 * 判定顺序、文案、日志与拆分前**逐字一致**；差异只有一处 —— 实例状态改为经
 * `ModeHandlerDeps` 显式传入（不再 `this.`），便于后续按档独立演进与单测。
 */
import { feature } from '@openliri/kernel';
import { configManager } from '@openliri/infra/config';
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
// P0（2026-11-17）：许愿式的执行侧契约（demand 下非危险 ask 降级为自动放行）
import { shouldAutoAllowUnderDemand } from '../autonomyPermission';
// B3（2026-11-17）：demand 硬拒词表 + killswitch（提权/安装/解释器/发布等保持 ask）
import {
  explainDemandHardDeny,
  isDemandAutoAllowEnabled,
} from '../demandHardDeny';
// B3 影子（2026-11-19）：只记录命中、不改变判定
import {
  isPermissionShadowEnabled,
  recordPermissionShadow,
  toHardDenyShadowRecord,
  toQuotaShadowRecord,
} from '../permissionShadow';
// B3 余项（2026-11-17）：每会话自动放行配额（默认不限）+ 摘要日志
import { consumeDemandAutoAllow } from '../demandAutoAllowQuota';
import { extractWriteTargets } from '../classifiers/write-targets';
import { splitCommandSegments } from '../classifiers/command-segments';
import { isWithinWorkingDirectory } from '../filesystem';
import type { RuleContext, RuleManager } from '../RuleManager';
import { resolveApprovalFingerprint } from '../approvalFingerprint';
import type { ClassifierManager } from '../classifiers/auto-mode-classifier-manager';
import { checkReadonlyCommand } from '../classifiers/readonly-command-allowlist';
import { checkCompoundReadOnly } from '../../security/compoundReadOnly';
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
import { bypassPermissionsKillswitch } from '../utils/BypassPermissionsKillswitch';
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
    // F12（2026-11-22）：接入 killswitch —— 显式禁用（运行时 `disable()` 或
    // `PERMISSION_BYPASS_DISABLED=true`）后不得继续无条件放行。
    const envDisabled =
      (configManager.env('PERMISSION_BYPASS_DISABLED', '') ?? '')
        .trim()
        .toLowerCase() === 'true';
    if (bypassPermissionsKillswitch.isDisabled() || envDisabled) {
      return createDenyDecision('Bypass permissions disabled by killswitch');
    }
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
        `Dont ask mode, denying ask rule from ${askRule.source}`,
        askRule
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
        `Dont ask mode, denying ask rule from ${matchingAskRule.source}`,
        matchingAskRule
      );
    }

    // 3. A 体系允许规则（带规则归属：R3 命中计数需要 ruleId）
    const allowedRule = deps.permissionChecker.findAllowRule(
      toolOrName,
      context
    );
    if (allowedRule) {
      return createAllowDecision('Tool is allowed by permission rule', allowedRule);
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
      return createAskDecision(`Asked by rule from ${askRule.source}`, askRule);
    }

    const matchingAskRule = deps.ruleManager.getMatchingRule(
      toolName,
      input,
      PermissionBehavior.ASK,
      ruleContext,
      matchOptions
    );
    if (matchingAskRule) {
      return createAskDecision(
        `Asked by rule from ${matchingAskRule.source}`,
        matchingAskRule
      );
    }

    // D 体系 ask：排在工具级 ask 之后、allow 之前（ask 不越过 allow）
    if (fineGrained.ask) return fineGrained.ask;

    const allowRule = deps.ruleManager.toolAlwaysAllowedRule(
      toolName,
      ruleContext
    );
    if (allowRule) {
      return createAllowDecision(
        `Allowed by rule from ${allowRule.source}`,
        allowRule
      );
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
        `Allowed by rule from ${matchingAllowRule.source}`,
        matchingAllowRule
      );
    }

    // 安全工具白名单（F2，2026-11-22）：**必须排在全部 deny / ask 之后**。
    // 原位置在函数开头 ⇒ 一个名字含白名单关键词的工具（如 `budget_set` 含 `get`）
    // 会静默越过用户显式 deny 规则；与下方 LRO-D1「deny 先于一切 allow」自相矛盾。
    // 这里只把「风险默认 ask」降为 allow，不越过任何人工拦截。
    if (deps.classifierManager.isAllowlistedTool(toolName)) {
      return createAllowDecision('Tool is on safe allowlist');
    }

    // D 体系 allow：所有 deny / ask 与显式 allow 之后才生效（安全兜底）
    if (fineGrained.allow) return fineGrained.allow;

    // 语义护栏「便宜版」（2026-10-21）：意图-动作偏离 ⇒ 升级为 ask（**不直接拒绝**）。
    // 位置在所有显式规则之后、默认行为之前 —— 用户显式 allow/deny/ask 规则始终优先。
    // 2026-11-13（观察期真机）：护栏对 `bash` 一视同仁 ⇒ `cd X && findstr … | more`
    // 这类**结构性只读**检索被规则化误判成"会变更状态"，每查一次弹一张审批卡。
    // 只读判据复用只读目录的单一事实源（简单命令 + 复合只读），不含任何写/执行段才跳过。
    if (feature('INTENT_ACTION_DEVIATION_GUARD')) {
      const command =
        typeof input['command'] === 'string' ? input['command'] : undefined;
      const structurallyReadOnly = command
        ? checkReadonlyCommand(command).allowed ||
          checkCompoundReadOnly(command).allowed
        : false;
      if (!structurallyReadOnly) {
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
    // 2026-11-13（G4 观察期 A 方案）：结构化标记"未覆盖"——审计与围栏不再只靠 reason 文本判断。
    return createAllowDecision(
      'No matching rules, default allowing',
      undefined,
      { ruleCoverage: 'uncovered' }
    );
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

    // 检查规则
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

    // 2026-11-25（真机 `cargo` 每命令一卡）：**call 级规则在 auto 档同样生效**。
    //
    // 原实现 auto 档只查**工具级**规则（`toolMatchesRule` 明确排除 `contentPattern`）⇒
    // 用户在设置页/审批卡加的内容级 allow（如 `^cargo build.*`）在 auto 档**静默失效**，
    // 命令仍被分类器判"未收录 ⇒ ask"（实测 `cargo build` / `cargo test` 每条都弹卡）。
    // 与 `handleDefault` 保持同一顺序（deny 先于一切 ask/allow，见 LRO-D1），
    // 指纹摘要与审批落盘同源。
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
      return createAskDecision(`Asked by rule from ${askRule.source}`, askRule);
    }

    const matchingAskRule = deps.ruleManager.getMatchingRule(
      toolName,
      input,
      PermissionBehavior.ASK,
      ruleContext,
      matchOptions
    );
    if (matchingAskRule) {
      return createAskDecision(
        `Asked by rule from ${matchingAskRule.source}`,
        matchingAskRule
      );
    }

    // RBAC ask：排在工具级 ask 之后、allow 之前（ask 不越过 allow）
    if (fineGrained.ask) return fineGrained.ask;

    // 安全工具白名单（F2，2026-11-22）：**必须排在全部 deny / ask 之后** ——
    // 原位置在函数开头，会越过用户显式 deny / ask（与 default 档同因）。
    if (deps.classifierManager.isAllowlistedTool(toolName)) {
      deps.denialTracker.trackSuccess(toolName, context.sessionId);
      return createAllowDecision('Tool is on safe allowlist');
    }

    const allowRule = deps.ruleManager.toolAlwaysAllowedRule(
      toolName,
      ruleContext
    );
    if (allowRule) {
      deps.denialTracker.trackSuccess(toolName, context.sessionId);
      return createAllowDecision(
        `Allowed by rule from ${allowRule.source}`,
        allowRule
      );
    }

    // 2026-11-25：call 级 allow（内容模式 / 指纹）—— 与 `handleDefault` 同口径，
    // 让"这条命令始终允许"在 auto 档也真正免审批（此前只对工具级规则生效）。
    const matchingAllowRule = deps.ruleManager.getMatchingRule(
      toolName,
      input,
      PermissionBehavior.ALLOW,
      ruleContext,
      matchOptions
    );
    if (matchingAllowRule) {
      deps.denialTracker.trackSuccess(toolName, context.sessionId);
      return createAllowDecision(
        `Allowed by rule from ${matchingAllowRule.source}`,
        matchingAllowRule
      );
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
        deps.messages,
        // R4（2026-11-17）：采样上下文（只进采样记录，不影响判定）
        {
          permissionMode: context.permissionMode,
          ...(context.autonomy ? { autonomy: context.autonomy } : {}),
        }
      );

      if (classifierDecision.requiresApproval) {
        // 2026-11-11（P5-approval）：`cp` / `mv` 这类"常见但可能不可逆"的命令
        // 不硬拒也不静默放行 ⇒ 转人工审批（用户可在审批卡上决定）。
        // P0（2026-11-17）：许愿式（demand）承诺"中途最多问一次" —— 非危险且**无工作区外写**
        // 的命令不再逐条打断（真机会话 session_mwk2fakzf30b34b448：19 张卡里 12 张属此类）。
        // deny 档（危险命令 / 敏感路径）在上方已返回，不受本降级影响。
        // 2026-11-17（B3）：demand 专用硬拒词表 + killswitch ——
        // 提权/安装/计划任务/解释器/发布等不进分类器危险词表的命令**保持 ask**；
        // `<prefix>DEMAND_AUTO_ALLOW=false` 可整体回退到 P0 前行为。
        if (
          isDemandAutoAllowEnabled() &&
          shouldAutoAllowUnderDemand({
            autonomy: context.autonomy,
            requiresApproval: true,
            writeOutsideWorkspace: hasWriteTargetOutsideWorkspace(context),
          })
        ) {
          // 2026-11-19（B3 影子）：把"是否硬拒"从条件里提出，改为分支判断 —— **判定逐字不变**
          // （命中 ⇒ 落到下方 ask），另按 `PERMISSION_SHADOW` 记一条台账供观察。
          const deny = explainDemandHardDeny(
            typeof input.command === 'string' ? input.command : ''
          );
          if (deny.hit) {
            if (isPermissionShadowEnabled()) {
              void recordPermissionShadow(
                toHardDenyShadowRecord({
                  toolName,
                  command:
                    typeof input.command === 'string' ? input.command : '',
                  sessionId: context.sessionId,
                  mode: context.permissionMode,
                  ...(deny.matched ? { matched: deny.matched } : {}),
                  ...(deny.matchedBy ? { matchedBy: deny.matchedBy } : {}),
                })
              );
            }
          } else {
            // B3 余项：每会话配额（默认 0 = 不限）；用尽 ⇒ **回落 ask**（不 deny，
            // 也不改变非 demand 会话）。计数同时驱动周期摘要日志。
            const quota = consumeDemandAutoAllow({
              sessionId: context.sessionId,
              toolName,
            });
            if (!quota.allowed && isPermissionShadowEnabled()) {
              void recordPermissionShadow(
                toQuotaShadowRecord({
                  toolName,
                  sessionId: context.sessionId,
                  mode: context.permissionMode,
                  count: quota.count,
                  limit: quota.limit,
                })
              );
            }
            if (quota.allowed) {
              deps.denialTracker.trackSuccess(toolName, context.sessionId);
              logger.info('permission:demand_auto_allow', {
                toolName,
                sessionId: context.sessionId,
                reason: classifierDecision.reason,
                autoAllowCount: quota.count,
                autoAllowLimit: quota.limit,
              });
              return createAllowDecision(
                `demand: 自动放行（${classifierDecision.reason || 'approved'}）`
              );
            }
            // 落到下面的 createAskDecision（quota 命中告警已在配额模块内落一次）
          }
        }
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

/**
 * P0（2026-11-17）：**写类命令**（目标无法从参数可靠界定）—— demand 下仍转人工。
 *
 * `extractWriteTargets` 只识别下载器具名参数与重定向；`cp`/`mv`/`rm` 等的目标
 * 可能落在工作区外 ⇒ 不能因为"demand"就自动放行（安全姿态不回退）。
 */
const DEMAND_WRITE_COMMANDS: ReadonlySet<string> = new Set([
  'cp',
  'mv',
  'rm',
  'del',
  'erase',
  'rd',
  'rmdir',
  'ren',
  'rename',
  'mkdir',
  'md',
  'touch',
  'tee',
  'ln',
  'copy',
  'move',
  'xcopy',
  'robocopy',
  'mklink',
  'copy-item',
  'move-item',
  'remove-item',
  'rename-item',
  'new-item',
  'set-content',
  'add-content',
  'clear-content',
  'set-item',
  'set-itemproperty',
  'new-itemproperty',
  'remove-itemproperty',
  'expand-archive',
  'compress-archive',
  'out-file',
  'tee-object',
]);

/**
 * P0（2026-11-17）：命令是否声明了**会话工作区之外**的写目标（或本身是写类命令）。
 *
 * - 无命令面 / 无写目标 ⇒ `false`（只读命令，可被 demand 自动放行）；
 * - 写类命令（目标无法可靠界定）⇒ `true`（保持人工）；
 * - 取不到工作区边界（无 `workspaceRoots` 也无 `workspacePath`）⇒ `true`（fail-closed）。
 */
function hasWriteTargetOutsideWorkspace(context: PermissionContext): boolean {
  const command = context.input?.command;
  if (typeof command !== 'string' || !command.trim()) return false;
  const segments = splitCommandSegments(command);
  const writeHead = segments.some((segment) =>
    DEMAND_WRITE_COMMANDS.has(
      (segment.text.trim().split(/\s+/)[0] ?? '').toLowerCase()
    )
  );
  if (writeHead) return true;
  const targets = extractWriteTargets(command);
  if (targets.length === 0) return false;
  const roots = (context.workspaceRoots ?? []).filter(
    (root): root is string => typeof root === 'string' && root.length > 0
  );
  const effectiveRoots =
    roots.length > 0
      ? roots
      : context.workspacePath
        ? [context.workspacePath]
        : [];
  if (effectiveRoots.length === 0) return true;
  return targets.some(
    (target) =>
      !effectiveRoots.some((root) => isWithinWorkingDirectory(target, root))
  );
}

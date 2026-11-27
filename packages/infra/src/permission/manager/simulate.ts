/**
 * 权限判定**模拟**（R0，2026-11-17；治理方案 §3.3）
 *
 * 目的：设置页「模拟」按钮 —— 输入一条命令 / 一次工具调用，回答
 * 「命中哪条规则 + 最终 allow|ask|deny + 原因」，且**不执行任何工具、不写任何状态**。
 *
 * 硬约束（CS01 / 方案 §9「simulate 与实际判定漂移」）：
 * - **不复写匹配逻辑**：直接调用 `handleAuto` / `handleDefault`（真实判定链的同一实现）；
 * - **不落审计、不计数**：不走 `checkPermissionInner`（那里会写安全审计与决策计数）；
 *   拒绝跟踪器用**新建实例**，避免模拟污染真实会话的连续拒绝计数；
 * - 规则命中列表用 `RuleManager` 既有查询（`getMatchingRule`）反查，仅供展示。
 *
 * 明确不参与模拟的部分（如实标注，不冒充"最终判定"）：
 * - 权限钩子（`PermissionHookService`）—— 可能带外部副作用；
 * - 细粒度 RBAC —— 需要请求级身份（角色 / 用户），模拟入参里没有；
 *   仅"资源=工具名"的绑定与身份无关，但本版为保证"不误报 deny"仍按跳过处理。
 */
import type { ClassifierManager } from '../classifiers/auto-mode-classifier-manager';
import { isCommandToolName } from '@openliri/infra/utils/toolContract/toolRoles';
import {
  checkCommandCustomRules,
  type PermissionChecker,
} from '../PermissionChecker';
import type { PermissionMode } from '../PermissionMode';
import type { RuleContext, RuleManager } from '../RuleManager';
import { DenialTracker } from '../trackers/DenialTracker';
import {
  createPermissionContext,
  type PermissionContext,
} from '../types/PermissionContext';
import {
  PermissionDecisionType,
  type PermissionDecision,
} from '../types/PermissionDecision';
import {
  PermissionBehavior,
  type PermissionRule,
} from '../types/PermissionRule';
import type { RuleMatcherPermissionContext } from '../utils/RuleMatcher';
import { hashApprovalFingerprint } from '../ApprovedCommandRegistry';
import { resolveApprovalFingerprint } from '../approvalFingerprint';
import type { ApprovalPauseScope } from '../approvalPause';
import { handleAuto, handleDefault, type ModeHandlerDeps } from './modeHandlers';

/** 可模拟的权限档（其余档位没有"规则判定"语义，不提供模拟） */
export type SimulatablePermissionMode = 'auto' | 'default';

/** 可模拟的权限档列表（供 HTTP 层校验与文案复用） */
export const SIMULATABLE_PERMISSION_MODES: ReadonlyArray<SimulatablePermissionMode> =
  ['auto', 'default'];

/** 档位守卫（收敛 `includes` 的类型窄化，避免散落断言；入参放宽为 string 供 HTTP 校验复用） */
export function isSimulatablePermissionMode(
  mode: string
): mode is SimulatablePermissionMode {
  return SIMULATABLE_PERMISSION_MODES.includes(
    mode as SimulatablePermissionMode
  );
}

/** 模拟入参 */
export interface SimulatePermissionRequest {
  toolName: string;
  /** 工具入参（命令类工具通常是 `{ command }`） */
  input: Record<string, unknown>;
  /** 权限档；缺省 ⇒ 用调用方（进程 / 实例）当前档 */
  mode?: PermissionMode;
  /** 会话自主度（`demand` 会触发 P0 的非危险命令降级） */
  autonomy?: 'interactive' | 'demand';
  /** 会话工作区根（用于 `workspaceRoot` 规则的匹配闸） */
  workspaceRoots?: string[];
  /**
   * 会话 id（F2，2026-11-27）：用于「按会话暂停审批规则」的同源判定。
   *
   * 执行链的 `ruleContext.pauseScope` 一直带 `sessionId`，模拟此前只带工作区根
   * ⇒ 被暂停的会话里"执行 deny（或收紧）、模拟仍按旧规则给 allow"。不传 ⇒ 只按全局暂停。
   */
  sessionId?: string;
}

/** B 体系（`permission.customRules.commandRules`）对本次命令的结论（只读展示） */
export interface CustomRuleVerdictView {
  behavior: 'allow' | 'ask' | 'deny';
  reason: string;
}

/** 模拟结果（只读 DTO） */
export interface SimulatePermissionResult {
  /** 最终判定 */
  decision: 'allow' | 'ask' | 'deny';
  /** 判定原因（与真实链同一文案） */
  reason: string;
  /** 实际参与判定的权限档 */
  mode: PermissionMode;
  /** 命中规则的完整列表（按 deny / ask / allow 顺序，各取首个命中） */
  matchedRules: PermissionRule[];
  /**
   * R1.5（2026-11-17）：B 体系命令黑白名单对本次命令的结论。
   *
   * 与判定链**同一读取点**（`checkCommandCustomRules`）—— 用于区分"被 A 体系规则拦"
   * 还是"被命令级黑白名单拦"。非命令工具 / 未配置 ⇒ `null`。
   */
  customRuleVerdict: CustomRuleVerdictView | null;
  /** 未参与模拟的部分（如实标注） */
  evaluated: {
    rbac: 'skipped';
    hooks: 'skipped';
  };
}

/** 模拟所需的实例状态（由 `PermissionManager` 显式传入，不复制判定链） */
export interface SimulatePermissionDeps {
  ruleManager: RuleManager;
  permissionChecker: PermissionChecker;
  classifierManager: ClassifierManager;
  toolPermissionContext: RuleMatcherPermissionContext;
  defaultBehavior: 'allow' | 'deny';
  /** 实例当前权限档（请求未指定 mode 时使用） */
  mode: PermissionMode;
}

/** 规则上下文（与 `decisionPipeline` 同构：settings 来源规则并入口径一致） */
function toRuleContext(
  toolPermissionContext: RuleMatcherPermissionContext,
  pauseScope?: ApprovalPauseScope
): RuleContext {
  return {
    alwaysAllowRules: toolPermissionContext.alwaysAllowRules,
    alwaysDenyRules: toolPermissionContext.alwaysDenyRules,
    alwaysAskRules: toolPermissionContext.alwaysAskRules,
    // F2：模拟与真实链同口径 —— 带上请求里的工作区根，否则「按工作区暂停」在模拟里不生效
    ...(pauseScope ? { pauseScope } : {}),
  };
}

/**
 * 反查本次判定**实际会读取**的规则（只读展示）。
 *
 * 必须按档位区分，否则会"显示命中、实际没判"（与真实链漂移）：
 * - `auto`（`handleAuto`）：只查**工具级**规则（`toolMatchesRule` 排除内容模式与指纹）；
 * - `default`（`handleDefault`）：工具级 → 内容/指纹级，逐档同序（同一批 `RuleManager` 查询）。
 */
function collectMatchedRules(
  deps: SimulatePermissionDeps,
  mode: 'auto' | 'default',
  toolName: string,
  input: Record<string, unknown>,
  ruleContext: RuleContext,
  matchOptions: { fingerprint: string; workspaceRoots?: string[] }
): PermissionRule[] {
  const out: PermissionRule[] = [];
  const push = (rule: PermissionRule | null): void => {
    if (rule && !out.some((r) => r.id === rule.id)) out.push(rule);
  };

  // 2026-11-25：auto 档与 default 档**同序**（工具级 → call 级；deny → ask → allow）——
  // `handleAuto` 已补 call 级规则，模拟若仍只收工具级会让"命中规则"一栏与真实判定不一致。
  for (const behavior of [
    PermissionBehavior.DENY,
    PermissionBehavior.ASK,
    PermissionBehavior.ALLOW,
  ]) {
    // 与 handleDefault 同序：先工具级查询，再内容/指纹级
    push(
      behavior === PermissionBehavior.DENY
        ? deps.ruleManager.getDenyRuleForTool(toolName, ruleContext)
        : behavior === PermissionBehavior.ASK
          ? deps.ruleManager.getAskRuleForTool(toolName, ruleContext)
          : deps.ruleManager.toolAlwaysAllowedRule(toolName, ruleContext)
    );
    push(
      deps.ruleManager.getMatchingRule(
        toolName,
        input,
        behavior,
        ruleContext,
        matchOptions
      )
    );
  }
  return out;
}

/**
 * 模拟一次权限判定（只读；不执行工具）。
 *
 * @throws 当 `mode` 不是 `auto` / `default`（调用方应先校验，避免静默给出错误档位的结论）
 */
export async function simulatePermissionDecision(
  deps: SimulatePermissionDeps,
  request: SimulatePermissionRequest
): Promise<SimulatePermissionResult> {
  const mode = request.mode ?? deps.mode;
  if (!isSimulatablePermissionMode(mode)) {
    throw new Error(
      `不支持的模拟权限档：${mode}（仅 ${SIMULATABLE_PERMISSION_MODES.join(' / ')}）`
    );
  }

  const context: PermissionContext = createPermissionContext({
    toolName: request.toolName,
    input: request.input,
    permissionMode: mode,
    autonomy: request.autonomy,
    workspaceRoots: request.workspaceRoots,
    ...(request.sessionId ? { sessionId: request.sessionId } : {}),
  });
  // F2（2026-11-27）：与执行链同口径 —— 暂停范围带上**会话 id**（此前只带工作区根，
  // 导致「按会话暂停」在模拟里不生效：执行已收紧、模拟仍按旧规则给 allow）。
  const pauseScope: ApprovalPauseScope | undefined =
    request.sessionId || request.workspaceRoots
      ? {
          ...(request.sessionId ? { sessionId: request.sessionId } : {}),
          ...(request.workspaceRoots
            ? { workspaceRoots: request.workspaceRoots }
            : {}),
        }
      : undefined;
  const ruleContext = toRuleContext(deps.toolPermissionContext, pauseScope);

  // 与真实判定链**同一处理器**；差异仅在依赖侧：新建拒绝跟踪器（不污染真实计数），
  // RBAC 回调返回空（无请求级身份可用）。
  const handlerDeps: ModeHandlerDeps = {
    ruleManager: deps.ruleManager,
    denialTracker: new DenialTracker(),
    classifierManager: deps.classifierManager,
    messages: [],
    defaultBehavior: deps.defaultBehavior,
    permissionChecker: deps.permissionChecker,
    checkFineGrainedRules: async () => ({}),
  };

  const decision: PermissionDecision =
    mode === 'auto'
      ? await handleAuto(
          handlerDeps,
          request.toolName,
          request.input,
          context,
          ruleContext
        )
      : await handleDefault(
          handlerDeps,
          request.toolName,
          request.input,
          context,
          ruleContext
        );

  // 指纹与真实链同源（`hashApprovalFingerprint(resolveApprovalFingerprint(...))`），
  // 否则"始终允许"规则在模拟里永远显示不命中。
  const fingerprint = hashApprovalFingerprint(
    resolveApprovalFingerprint(request.toolName, request.input)
  );
  const matchedRules = collectMatchedRules(
    deps,
    mode,
    request.toolName,
    request.input,
    ruleContext,
    {
      fingerprint,
      ...(request.workspaceRoots
        ? { workspaceRoots: request.workspaceRoots }
        : {}),
    }
  );

  return {
    decision:
      decision.type === PermissionDecisionType.ALLOW
        ? 'allow'
        : decision.type === PermissionDecisionType.DENY
          ? 'deny'
          : 'ask',
    reason: decision.reason,
    mode,
    matchedRules,
    customRuleVerdict: resolveCustomRuleVerdict(
      request.toolName,
      request.input
    ),
    evaluated: { rbac: 'skipped', hooks: 'skipped' },
  };
}

/** B 体系命令规则结论（与判定链同一读取点；非命令工具 ⇒ null） */
function resolveCustomRuleVerdict(
  toolName: string,
  input: Record<string, unknown>
): CustomRuleVerdictView | null {
  const command = typeof input['command'] === 'string' ? input['command'] : undefined;
  if (!isCommandToolName(toolName) || command === undefined) return null;
  const decision = checkCommandCustomRules(command);
  if (!decision) return null;
  return {
    behavior:
      decision.type === PermissionDecisionType.ALLOW
        ? 'allow'
        : decision.type === PermissionDecisionType.DENY
          ? 'deny'
          : 'ask',
    reason: decision.reason,
  };
}

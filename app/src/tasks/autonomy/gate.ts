/**
 * 自主触发准入判定（P33-a，2026-11-02）
 *
 * 方案：`dev_docs/20261102/Liri常驻自主执行升级方案-20261102.md` §5 **P33-a**。
 *
 * 只在**新的 Trigger→Ticket 入口**（P35 sink）调用；交互路径与既有 alwayson 运行时不动。
 *
 * 判定顺序（复用 infra 纯函数，不另写一套）：
 * 1. 配置 `enabled=false` ⇒ 直接放行（行为与改造前一致）；
 * 2. 线程/工作区过滤；
 * 3. 内部来源映射为「机器发送者」：`human=false, listedBot=来源开关, listened=来源开关`；
 * 4. `evaluateGate()`（`off` / 来源关闭 ⇒ 拒绝）；
 * 5. 规则命中 + 风险不是 high ⇒ `positive`；
 * 6. `decideAcceptance()`（`observe` 只返回 `wouldAccept`，不接单）。
 */
import {
  decideAcceptance,
  evaluateGate,
  resolveAdmission,
  resolveAdmissionCell,
  type AutonomyPolicyConfig,
  type GateReason,
  type Mandate,
  type MandateBasis,
  type Strength,
} from '@openliri/infra/permission';

/** 内部来源的触发事实（调用方只提供"是什么"，不提供判定） */
export interface AutonomyTriggerFacts {
  sourceId: string;
  threadKey: string;
  triggerId: string;
  /** 计划风险（可选；cron 无风险概念 ⇒ 不因风险拒绝） */
  riskLevel?: 'low' | 'medium' | 'high';
  /** 工作区（可选；用于 `filters.workspaceIds`） */
  workspaceId?: string;
}

/** 忽略原因（GateReason + 三个策略层原因；闭集，不写自由文本） */
export type AutonomyIgnoreReason =
  | GateReason
  | 'filtered_out'
  | 'rules_unmatched'
  | 'risk_high'
  | 'mode_observe';

export interface AutonomyGateDecision {
  action: 'accept' | 'ignore';
  /** `observe` 下"我会怎么做"（记录用；`action` 仍为 ignore） */
  wouldAccept: boolean;
  policyId: string;
  matchedRuleIds: string[];
  strength?: Strength;
  via?: MandateBasis['via'];
  reason?: AutonomyIgnoreReason;
  /** 仅 `action==='accept'` 且策略启用时出现（写入 Ticket） */
  mandate?: Mandate;
}

/** 判断线程/工作区是否被配置过滤（空过滤器 = 不过滤） */
function isFilteredOut(
  config: AutonomyPolicyConfig,
  trigger: AutonomyTriggerFacts
): boolean {
  const prefixes = config.filters?.threadPrefixes ?? [];
  if (
    prefixes.length > 0 &&
    !prefixes.some((prefix) => trigger.threadKey.startsWith(prefix))
  ) {
    return true;
  }
  const workspaces = config.filters?.workspaceIds ?? [];
  if (
    workspaces.length > 0 &&
    (!trigger.workspaceId || !workspaces.includes(trigger.workspaceId))
  ) {
    return true;
  }
  return false;
}

/**
 * 单次 Trigger 的准入判定（**纯函数**）。
 *
 * - 配置未启用 ⇒ `accept`（不产生 Mandate，不改变既有行为）；
 * - `observe` ⇒ `ignore` + `wouldAccept`；
 * - `auto` ⇒ 规则命中且风险非 high 才 `accept`。
 */
export function evaluateAutonomyTrigger(input: {
  policy: AutonomyPolicyConfig;
  policyId: string;
  trigger: AutonomyTriggerFacts;
}): AutonomyGateDecision {
  const { policy, policyId, trigger } = input;

  // 总开关关闭：不判定、不记录、不产生 Mandate（行为与改造前一致）
  if (!policy.enabled) {
    return {
      action: 'accept',
      wouldAccept: true,
      policyId,
      matchedRuleIds: [],
    };
  }

  if (isFilteredOut(policy, trigger)) {
    return {
      action: 'ignore',
      wouldAccept: false,
      policyId,
      matchedRuleIds: [],
      reason: 'filtered_out',
    };
  }

  const sourceEnabled = policy.sources[trigger.sourceId] === true;
  const matchedRuleIds = policy.rules
    .filter(
      (rule) =>
        rule.enabled &&
        (!rule.sources ||
          rule.sources.length === 0 ||
          rule.sources.includes(trigger.sourceId))
    )
    .map((rule) => rule.id);

  // 内部来源无人类发送者 ⇒ 走 machineGate 分支（只认来源开关，且只能是 inferred）
  const cell = resolveAdmissionCell(sourceEnabled, true);
  const admission = resolveAdmission(policy.admission, trigger.sourceId, cell);

  const gate = evaluateGate({
    human: false,
    addressed: true,
    followup: false,
    directMessage: false,
    allowed: sourceEnabled,
    listedBot: sourceEnabled,
    listened: sourceEnabled,
    ...(cell ? { cell } : {}),
    admission,
    mode: policy.acceptMode,
  });

  if (!gate.admitted) {
    return {
      action: 'ignore',
      wouldAccept: false,
      policyId,
      matchedRuleIds,
      reason: gate.reason,
    };
  }

  const riskOk = trigger.riskLevel !== 'high';
  const positive = riskOk && matchedRuleIds.length > 0;
  const acceptance = decideAcceptance({
    strength: gate.strength,
    mode: policy.acceptMode,
    positive,
  });

  if (acceptance.action === 'ignore') {
    const reason: AutonomyIgnoreReason = !riskOk
      ? 'risk_high'
      : matchedRuleIds.length === 0
        ? 'rules_unmatched'
        : 'mode_observe';
    return {
      action: 'ignore',
      wouldAccept: acceptance.wouldAccept,
      policyId,
      matchedRuleIds,
      strength: gate.strength,
      via: gate.via,
      reason,
    };
  }

  return {
    action: 'accept',
    wouldAccept: true,
    policyId,
    matchedRuleIds,
    strength: gate.strength,
    via: gate.via,
    mandate: {
      strength: gate.strength,
      basis: {
        via: gate.via,
        ...(gate.cell ? { cell: gate.cell } : {}),
        rules: matchedRuleIds,
        policyVersion: policyId,
      },
      scope: {
        source: trigger.sourceId,
        thread: trigger.threadKey,
        ...(trigger.workspaceId ? { workspaceId: trigger.workspaceId } : {}),
      },
    },
  };
}

/**
 * Policy 配置变更的**效果投递**（P33，2026-11-02）
 *
 * 方案：`dev_docs/20261102/Liri常驻自主执行升级方案-20261102.md` §5 **P33-a**：
 * 配置变更只产三类效果（命中规则变更 / 发送者失格 / `auto→非 auto` 时推断项
 * `proactive:false`），**不撤销 Mandate、不取消在途工作**。
 *
 * 实现要点：
 * - 变更检测：比较 `policyId`（由配置派生）——首个快照只建立基线，不投递；
 * - 作用面：**在途**工作项（status 非终态）且带合法 `mandate`；已结束项交给
 *   `revalidate.ts` 在消息唤醒时处理；
 * - 投递：写结构化日志 + 在工作项上落 `policyEffect` 标记（供面板/审计读），
 *   不新增状态位、不改调度。
 *
 * 接入点：`cronTriggerWiring.onJobStart`（每次 cron 到点先观察一次；仅变更时做 IO）。
 */
import {
  diffPolicyEffects,
  resolveAdmission,
  type AdmissionCell,
  type Mandate,
  type PolicyEffect,
  type PolicySnapshot,
} from '@openliri/infra/permission';
import { getLogger } from '@openliri/infra/monitoring';

import {
  listPdcaWorkItems,
  PDCA_TERMINAL_STATUSES,
  writePdcaWorkItem,
} from '../PdcaWorkItemBridge';
import {
  computeAutonomyPolicyId,
  type LoadedAutonomyPolicy,
} from './policyConfig';
import { parseMandate } from './revalidate';

const logger = getLogger('tasks:autonomy-policy-change');

/** 一条受影响的工作项（`policyEffect` 即 `diffPolicyEffects` 的三类效果） */
export interface PolicyEffectEntry {
  ticketId: string;
  effect: PolicyEffect;
}

/** 一次配置变更的投递结果 */
export interface PolicyChangeDelivery {
  fromPolicyId: string;
  toPolicyId: string;
  affected: PolicyEffectEntry[];
}

export interface PolicyChangeOptions {
  listWorkItems?: () => Promise<ReadonlyArray<Record<string, unknown>>>;
  writeWorkItem?: (record: Record<string, unknown>) => Promise<void>;
  now?: () => number;
}

/** 在途工作项（非终态 + 合法 mandate） */
interface InFlightTicket {
  id: string;
  mandate: Mandate;
  row: Record<string, unknown>;
}

/** 按（来源 + 准入单元格）构造快照：`diffPolicyEffects` 对同组使用同一份事实 */
function snapshotFor(
  policy: LoadedAutonomyPolicy,
  source: string,
  cell: AdmissionCell | undefined
): PolicySnapshot {
  const config = policy.config;
  const admissionStrength = cell
    ? resolveAdmission(config.admission, source, cell)
    : undefined;
  return {
    version: computeAutonomyPolicyId(config),
    mode: config.acceptMode,
    enabledRuleIds: new Set(
      config.rules.filter((rule) => rule.enabled).map((rule) => rule.id)
    ),
    ruleText: new Map(config.rules.map((rule) => [rule.id, rule.text])),
    senderAllowed: config.sources[source] === true,
    botListed: config.sources[source] === true,
    ...(admissionStrength ? { admissionStrength } : {}),
  };
}

/**
 * 计算变更效果（**纯函数**：不读库、不写库、不读时钟）。
 *
 * 按 `(来源, admission cell)` 分组后分别调 `diffPolicyEffects`，避免把不同来源的
 * sender/bot 事实混用（内部来源的 sender 资格 = 来源开关）。
 */
export function computePolicyEffects(
  previous: LoadedAutonomyPolicy,
  current: LoadedAutonomyPolicy,
  tickets: ReadonlyArray<Pick<InFlightTicket, 'id' | 'mandate'>>
): Map<string, PolicyEffect> {
  const groups = new Map<
    string,
    {
      source: string;
      cell: AdmissionCell | undefined;
      items: Array<{ id: string; mandate: Mandate }>;
    }
  >();

  for (const ticket of tickets) {
    const source = ticket.mandate.scope.source;
    const cell = ticket.mandate.basis.cell;
    const key = `${source}|${cell ?? ''}`;
    const group = groups.get(key) ?? { source, cell, items: [] };
    group.items.push({ id: ticket.id, mandate: ticket.mandate });
    groups.set(key, group);
  }

  const effects = new Map<string, PolicyEffect>();
  for (const group of groups.values()) {
    const diff = diffPolicyEffects(
      group.items,
      snapshotFor(previous, group.source, group.cell),
      snapshotFor(current, group.source, group.cell)
    );
    for (const [ticketId, effect] of diff) effects.set(ticketId, effect);
  }
  return effects;
}

/** 投递一次变更：日志 + 在途工作项上的 `policyEffect` 标记（失败只告警） */
async function deliverPolicyChange(
  previous: LoadedAutonomyPolicy,
  current: LoadedAutonomyPolicy,
  options: PolicyChangeOptions
): Promise<PolicyChangeDelivery> {
  const list = options.listWorkItems ?? listPdcaWorkItems;
  const write = options.writeWorkItem ?? writePdcaWorkItem;
  const now = options.now ?? Date.now;

  let rows: ReadonlyArray<Record<string, unknown>>;
  try {
    rows = await list();
  } catch (error) {
    logger.warn('读取工作项失败（跳过 Policy 变更投递）', {
      error: String(error),
    });
    return {
      fromPolicyId: previous.policyId,
      toPolicyId: current.policyId,
      affected: [],
    };
  }

  const inFlight: InFlightTicket[] = [];
  for (const row of rows) {
    const id = typeof row.id === 'string' ? row.id : '';
    if (!id || PDCA_TERMINAL_STATUSES.has(String(row.status ?? ''))) continue;
    const mandate = parseMandate(row.mandate);
    if (!mandate) continue;
    inFlight.push({ id, mandate, row });
  }

  const effects = computePolicyEffects(previous, current, inFlight);
  const affected: PolicyEffectEntry[] = [...effects.entries()].map(
    ([ticketId, effect]) => ({ ticketId, effect })
  );

  logger.info('autonomy.policy.changed', {
    fromPolicyId: previous.policyId,
    toPolicyId: current.policyId,
    inFlightTickets: inFlight.length,
    affectedTickets: affected.length,
    effects: affected,
  });

  const byId = new Map(inFlight.map((ticket) => [ticket.id, ticket]));
  for (const entry of affected) {
    const ticket = byId.get(entry.ticketId);
    if (!ticket) continue;
    const at = new Date(now()).toISOString();
    try {
      await write({
        ...ticket.row,
        policyEffect: {
          ...entry.effect,
          fromPolicyId: previous.policyId,
          toPolicyId: current.policyId,
          at,
        },
        updatedAt: at,
      });
    } catch (error) {
      logger.warn('Policy 变更效果落盘失败（不阻断）', {
        ticketId: entry.ticketId,
        error: String(error),
      });
    }
  }

  return {
    fromPolicyId: previous.policyId,
    toPolicyId: current.policyId,
    affected,
  };
}

/** 变更观察器（每个实例独立维护上一份快照；生产用进程级单例） */
export interface PolicyChangeTracker {
  /**
   * 观察一份当前策略。
   *
   * 首次调用只建立基线；`policyId` 未变 ⇒ `null`；变化 ⇒ 投递一次并返回结果。
   */
  observe(current: LoadedAutonomyPolicy): Promise<PolicyChangeDelivery | null>;
}

export function createPolicyChangeTracker(
  options: PolicyChangeOptions = {}
): PolicyChangeTracker {
  let last: LoadedAutonomyPolicy | null = null;
  return {
    async observe(current) {
      const previous = last;
      last = current;
      if (!previous || previous.policyId === current.policyId) return null;
      try {
        return await deliverPolicyChange(previous, current, options);
      } catch (error) {
        logger.warn('Policy 变更投递异常（不阻断调用方）', {
          error: String(error),
        });
        return null;
      }
    },
  };
}

let defaultTracker: PolicyChangeTracker | null = null;

/** 进程级单例（cron 接线使用；测试请用 `createPolicyChangeTracker`） */
export function getPolicyChangeTracker(): PolicyChangeTracker {
  defaultTracker ??= createPolicyChangeTracker();
  return defaultTracker;
}

/**
 * 驾驶舱快照（P39，2026-11-02）—— **纯聚合、零 IO**
 *
 * 方案：`dev_docs/20261102/Liri常驻自主执行升级方案-20261102.md` §5 P39 / §6。
 * 参考：`dsh:docs/005:7-24,50-57`（三问、按 stage 分组、诚实状态原则）。
 *
 * 三个设计约束（照方案落地）：
 * 1. **stage 派生为主视角**：分组键来自 `deriveTicketStage()`（P34），不新增状态位；
 * 2. **可勾稽**：分组由"逐项 push"构造 ⇒ 任何分组数字**恒等于**其列表长度；
 *    `checkCockpitInvariants()` 供面板/测试做二次断言；
 * 3. **健康态不占空间**：空分组不输出（`groups` 里没有该项，而不是 0 条的空列表）。
 *
 * 本模块不读库、不读时钟（`now` 由调用方传）⇒ 可单测、可复算。
 */
import {
  TICKET_STAGE_IDLE_KEY,
  deriveTicketStage,
  ticketStageKey,
  type TicketFacts,
} from '../ticketStage';

/** 面板卡片的最小输入（由调用方从 workitems / assignments / executions 组装） */
export interface CockpitItem {
  /** 工作项 id（唯一；重复会被 `checkCockpitInvariants` 报出） */
  id: string;
  title?: string;
  /** stage 派生所需事实（P34） */
  facts: TicketFacts;
  /** 累计 tokens（缺省 ⇒ 不计入均值，不按 0 处理） */
  costTokens?: number;
  /** 已结束且达成（`ended` 组内区分成功/失败；缺省 ⇒ 计入 ended 但不计入完成率分子） */
  succeeded?: boolean;
  /** 最后一次动作（展示用，不参与判定） */
  lastAction?: string;
}

/** 分组（`key` 与 `ticketStageKey()` 同源） */
export interface CockpitGroup {
  key: string;
  label: string;
  items: CockpitItem[];
}

/** 面板指标（口径见方案 §6；无样本 ⇒ 该指标为 `undefined`，不编造 0） */
export interface CockpitMetrics {
  total: number;
  /** 卡在人这里的项数（`person/*` 合计） */
  personCount: number;
  /** = personCount / total（无项 ⇒ 0） */
  humanInterventionRate: number;
  endedCount: number;
  /** = 成功结束 / 已结束（无已结束项 ⇒ undefined） */
  completionRate?: number;
  /** = 有成本样本的项均值（无样本 ⇒ undefined） */
  avgCostTokens?: number;
}

export interface CockpitSnapshot {
  generatedAt: number;
  /** 按展示顺序排列；**空分组不出现** */
  groups: CockpitGroup[];
  metrics: CockpitMetrics;
}

/**
 * 展示顺序（参考实现：人先、工作/排队次之、idle、ended）。
 *
 * 键取值与 `ticketStageKey()` 一致 ⇒ 新增派生标签时必须同步本表（单一顺序事实源）。
 */
export const COCKPIT_GROUP_ORDER = [
  'person:delivery',
  'person:answer',
  'person:review',
  'person:blocked',
  'person:failed',
  'working:queued',
  'working',
  TICKET_STAGE_IDLE_KEY,
  'ended',
] as const;

/** 分组展示名（只影响文案；不含判定） */
export const COCKPIT_GROUP_LABELS: Readonly<Record<string, string>> = {
  'person:delivery': '待投递重试',
  'person:answer': '待你回答',
  'person:review': '待你验收',
  'person:blocked': '受阻待你处理',
  'person:failed': '失败待你决定',
  'working:queued': '排队中',
  working: '执行中',
  [TICKET_STAGE_IDLE_KEY]: '空闲',
  ended: '已结束',
};

/** 是否属于"卡在人这里"的分组（与 `isPersonStage` 同口径，按键前缀判定） */
export function isPersonGroupKey(key: string): boolean {
  return key.startsWith('person:');
}

/**
 * 构建快照（主入口）。
 *
 * @param items 全部工作项（调用方负责只传"本面板范围"内的项）
 * @param now 生成时刻（epoch ms）
 */
export function buildCockpitSnapshot(
  items: readonly CockpitItem[],
  now: number = Date.now()
): CockpitSnapshot {
  const buckets = new Map<string, CockpitItem[]>();
  for (const item of items) {
    const key = ticketStageKey(deriveTicketStage(item.facts));
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  const groups: CockpitGroup[] = [];
  for (const key of COCKPIT_GROUP_ORDER) {
    const bucket = buckets.get(key);
    // 健康态不占空间：空分组不输出
    if (!bucket || bucket.length === 0) continue;
    groups.push({
      key,
      label: COCKPIT_GROUP_LABELS[key] ?? key,
      items: bucket,
    });
  }

  const metrics = computeMetrics(items, groups);
  return { generatedAt: now, groups, metrics };
}

/** 指标计算（唯一实现；`groups` 只用于 person 计数，避免二次派生） */
function computeMetrics(
  items: readonly CockpitItem[],
  groups: readonly CockpitGroup[]
): CockpitMetrics {
  const total = items.length;
  const personCount = groups
    .filter((g) => isPersonGroupKey(g.key))
    .reduce((sum, g) => sum + g.items.length, 0);

  const ended = items.filter(
    (i) => deriveTicketStage(i.facts).stage === 'ended'
  );
  // 完成率只在**有 `succeeded` 事实**的已结束项上计算：缺该字段的项既不算成功也不算失败，
  // 否则会把"未记录结果"误报成 0%（CS06：不臆造）。
  const endedKnown = ended.filter((i) => typeof i.succeeded === 'boolean');
  const succeededEnded = endedKnown.filter((i) => i.succeeded === true).length;

  const costs = items
    .map((i) => i.costTokens)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

  return {
    total,
    personCount,
    humanInterventionRate: total === 0 ? 0 : personCount / total,
    endedCount: ended.length,
    ...(endedKnown.length > 0
      ? { completionRate: succeededEnded / endedKnown.length }
      : {}),
    ...(costs.length > 0
      ? { avgCostTokens: costs.reduce((a, b) => a + b, 0) / costs.length }
      : {}),
  };
}

/** 面板自洽性检查（返回违规描述；空数组 = 自洽） */
export function checkCockpitInvariants(
  snapshot: CockpitSnapshot,
  items: readonly CockpitItem[]
): string[] {
  const violations: string[] = [];

  const inGroups = snapshot.groups.reduce((sum, g) => sum + g.items.length, 0);
  if (inGroups !== items.length) {
    violations.push(`分组总数 ${inGroups} ≠ 项总数 ${items.length}`);
  }
  if (snapshot.metrics.total !== items.length) {
    violations.push(
      `指标 total ${snapshot.metrics.total} ≠ 项总数 ${items.length}`
    );
  }

  const seen = new Set<string>();
  for (const group of snapshot.groups) {
    for (const item of group.items) {
      if (seen.has(item.id)) {
        violations.push(`重复工作项 id：${item.id}`);
      }
      seen.add(item.id);
      // 数字恒等于列表长度：分组长度与列表本身不可能不一致（构造保证）；
      // 这里再校验"分组键与派生 stage 一致"，防止有人手工拼快照
      const expected = ticketStageKey(deriveTicketStage(item.facts));
      if (group.key !== expected) {
        violations.push(
          `工作项 ${item.id} 被放进 ${group.key}，派生结果应为 ${expected}`
        );
      }
    }
  }

  for (const group of snapshot.groups) {
    if (group.items.length === 0) {
      violations.push(`空分组不应输出：${group.key}`);
    }
  }

  return violations;
}

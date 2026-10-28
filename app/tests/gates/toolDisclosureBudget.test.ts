/**
 * AC-16 模型可见面预算 · 棘轮门禁（P4-1，2026-10-28）
 *
 * 背景：`dev_docs/20261027/Liri架构优化方案-20261027.md` AC-16 ——「默认披露集 ≤12 且
 * schema ≤1.5k token；`TOOL_NAMES_COUNT` 只减不增」。此前**没有任何门禁测量披露面**：
 * 工具总数 82 是已知的，但"模型每轮真实看到哪些工具 / 多大"从未被观测。
 *
 * 本门禁的口径（**全部实测，不手写清单**；CS01）：
 *   - 披露面 = `loadTools(new ToolFactory(), getAllBuiltinToolLoaders())` 真实装配
 *     → `ToolRegistry.getToolSchemas()` → `filterToolsByTask(…, 'default')`
 *     （与 `streamMessageToolSelection` 同源判定 ⇒ 测的就是模型真实看到的那一面）
 *   - 工具总数 = 生成物 `TOOL_NAMES_COUNT`（**不用实例化条数**：后者随变体开关变化，
 *     测试环境未注入变体层时为 80、生产为 82 ⇒ 会随环境抖动）
 *   - `structuralTokens`：抹掉所有 `description` / `searchTips` 后的 JSON **字符数 / 4**
 *     （**与 locale 无关**；且与仓内 `estimateTokens` 的非 CJK 口径一致）。
 *     ⚠️ 不用 `estimateTokens()`：它对**无空格 JSON** 会走 `words*1.3 + chars*0.05` 分支
 *     （整段 JSON 只有 1 个"词"）⇒ 实测 37,622 字符被估成 1,884 token（真实 ≈9,400），
 *     不可加总、也不可比（2026-10-28 实测纠正，见方案附录 D.5）。
 *   - `sourceDescriptionChars`：源码描述字符数（`tool.getInfo()`，含参数描述；同样与 locale 无关）
 *
 * 棘轮语义：总数 / 披露集数 / 结构 token 三项 + 描述字符 四项**只减不增**；披露集**成员名单**同样冻结
 * （新增工具进入默认面 ⇒ 必须显式评审并下调/上调基线）。缩小 ⇒ 提示下调基线锁定成果。
 *
 * ## 度量口径纠正（2026-10-28，AC-16b）
 * 初版把 `getToolSchemas()` 的**整个对象**当"模型可见面"，得 2,253。实测纠正：
 * provider 出站只经 `tools/toolNameCodec.buildToolDefinitions`（OpenAI 兼容
 * `tools[].function.{name,description,parameters}`；Anthropic 侧走
 * `toolDefinitionConverter`，同样只取 `input_schema`）——
 * **`output_schema` / `aliases` / `searchTips` 从未下发给任何 provider**（`output_schema`
 * 全仓**零读取方**，只有写入方 `ToolRegistry.getToolSchemas`）。故拆成两个指标分别冻结：
 *   - `providerSurfaceTokens`（**新**，承 AC-16b 目标 ≤1,500）：`buildToolDefinitions()` 投影后的结构 token
 *     ⇒ 实测 **1,397**（已达标）；
 *   - `structuralTokens`（旧口径，**保留冻结** 2,253）：继续防 `context/model-input` 事件载荷膨胀。
 * 与 D.5 的 `estimateTokens` 纠正同一性质：**口径错了就改口径并把两个数都记账**，不是放宽阈值。
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { TOOL_NAMES_COUNT } from '../../src/constants/toolNames.generated';
import { ToolFactory } from '../../src/tools/ToolFactory';
import { ToolRegistry } from '../../src/tools/ToolRegistry';
import { filterToolsByTask } from '../../src/tools/toolCategories';
import { buildToolDefinitions } from '../../src/tools/toolNameCodec';
import {
  getAllBuiltinToolLoaders,
  loadTools,
} from '../../src/tools/utils/ToolManagerUtils';

const BASELINE_PATH = resolve(
  import.meta.dir,
  '../../../.trae/architecture/tool-disclosure-baseline.json'
);

/** 披露面实测快照 */
export interface DisclosureSnapshot {
  /** 可实例化内置工具总数（口径 = 生成物 `TOOL_NAMES_COUNT`） */
  totalToolCount: number;
  /** 默认任务（`taskType='default'`）下模型可见的工具数 */
  disclosureCount: number;
  /** 默认披露集成员（升序；比 count 更强 —— 换掉一个工具也必报） */
  disclosureNames: string[];
  /** 披露面 schema 的**结构** token（抹掉 description 后估算，与 locale 无关） */
  structuralTokens: number;
  /**
   * **真正下发给 provider** 的结构 token（`buildToolDefinitions()` 投影后；
   * 排除 `output_schema` / `aliases` / `searchTips` —— 三者从不出现在任何 provider 请求里）。
   * AC-16b 的目标（≤1,500）以此为准。
   */
  providerSurfaceTokens: number;
  /** 披露面工具/参数的**源码**描述字符数（与 locale 无关） */
  sourceDescriptionChars: number;
}

export interface DisclosureBaseline extends DisclosureSnapshot {
  version: number;
  targets: { disclosureCount: number; providerSurfaceTokens: number };
  /** 基线自报的"是否已达 AC-16 目标"（谎报 ⇒ 必报） */
  targetMet: boolean;
}

export interface DisclosureComparison {
  problems: string[];
  /** 缩小提示（非失败；用于把成果锁进基线） */
  shrink: string | null;
}

/** 参与数值棘轮的指标（键 → 中文标签）；`disclosureNames` 单独按集合比对 */
const METRICS: ReadonlyArray<
  [Exclude<keyof DisclosureSnapshot, 'disclosureNames'>, string]
> = [
  ['totalToolCount', '可实例化工具总数'],
  ['disclosureCount', '默认披露集工具数'],
  ['structuralTokens', 'schema 对象结构 token（含不下发字段）'],
  ['providerSurfaceTokens', '模型可见（provider）结构 token'],
  ['sourceDescriptionChars', '披露面源码描述字符数'],
];

/**
 * 棘轮比对（**纯函数**，供门禁自证/负向夹具共用）。
 *
 * fail-closed：基线缺字段 / 非数值 / 名单与 count 不自洽 ⇒ 直接判违规
 * （不得因"读不懂基线"而放行，AR-3）。
 */
export function compareDisclosureBudget(
  current: DisclosureSnapshot,
  baseline: DisclosureBaseline
): DisclosureComparison {
  if (
    !Number.isFinite(baseline.targets?.disclosureCount) ||
    !Number.isFinite(baseline.targets?.providerSurfaceTokens)
  ) {
    return {
      problems: ['非法基线：缺少 targets（披露面目标值）'],
      shrink: null,
    };
  }
  for (const [key] of METRICS) {
    if (!Number.isFinite(baseline[key]) || baseline[key] <= 0) {
      return {
        problems: [`非法基线：指标 ${key} 缺失或非正数（不得当作 0 违规通过）`],
        shrink: null,
      };
    }
  }
  if (
    !Array.isArray(baseline.disclosureNames) ||
    baseline.disclosureNames.length !== baseline.disclosureCount
  ) {
    return {
      problems: ['非法基线：disclosureNames 缺失或与 disclosureCount 不一致'],
      shrink: null,
    };
  }

  const problems: string[] = [];
  const shrunk: string[] = [];
  for (const [key, label] of METRICS) {
    if (current[key] > baseline[key]) {
      problems.push(
        `${label}增长：${baseline[key]} → ${current[key]}（AC-16 只减不增）`
      );
    } else if (current[key] < baseline[key]) {
      shrunk.push(`${label} ${baseline[key]} → ${current[key]}`);
    }
  }

  const frozen = new Set(baseline.disclosureNames);
  const live = new Set(current.disclosureNames);
  const added = [...live].filter((n) => !frozen.has(n)).sort();
  const removed = [...frozen].filter((n) => !live.has(n)).sort();
  if (added.length > 0) {
    problems.push(
      `默认披露集新增工具：${added.join('、')}（新增披露面必须显式评审并更新基线）`
    );
  }
  if (removed.length > 0) {
    shrunk.push(`披露集移除 ${removed.join('、')}`);
  }

  const meetsTarget =
    current.disclosureCount <= baseline.targets.disclosureCount &&
    current.providerSurfaceTokens <= baseline.targets.providerSurfaceTokens;
  if (baseline.targetMet && !meetsTarget) {
    problems.push(
      '基线谎报已达 AC-16 目标（targetMet=true）但实测未达：' +
        `${current.disclosureCount}/${baseline.targets.disclosureCount} 个工具、` +
        `${current.providerSurfaceTokens}/${baseline.targets.providerSurfaceTokens} 模型可见结构 token`
    );
  } else if (!baseline.targetMet && meetsTarget) {
    shrunk.push('已达 AC-16 目标（12 个工具 / 1500 模型可见结构 token）');
  }

  return {
    problems,
    shrink:
      shrunk.length > 0
        ? `已缩小：${shrunk.join('；')} ⇒ 请下调基线锁定成果`
        : null,
  };
}

/** 抹掉所有 `description` / `searchTips` 值（保留键 ⇒ 结构不变）—— 让口径与 locale 无关 */
function stripDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripDescriptions);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] =
        k === 'description' || k === 'searchTips' ? '' : stripDescriptions(v);
    }
    return out;
  }
  return value;
}

/** 结构 token = 抹描述后的 JSON 字符数 / 4（可加总、跨机器稳定） */
function structuralTokensOf(value: unknown): number {
  return Math.ceil(JSON.stringify(stripDescriptions(value)).length / 4);
}

/** 实测默认披露面（真实实例化 + 与生产同源的裁剪函数） */
export function measureDisclosure(): DisclosureSnapshot {
  const tools = loadTools(new ToolFactory(), getAllBuiltinToolLoaders());
  const registry = new ToolRegistry();
  for (const tool of tools) registry.registerTool(tool);
  const defaults = filterToolsByTask(registry.getToolSchemas(), 'default');
  const defaultNames = new Set(defaults.map((s) => s.name));

  const sourceDescriptionChars = tools
    .filter((t) => defaultNames.has(t.name))
    .reduce((sum, t) => {
      const info = t.getInfo();
      const paramChars = (info.params ?? []).reduce(
        (n, p) => n + (p.description?.length ?? 0),
        0
      );
      return sum + (info.description?.length ?? 0) + paramChars;
    }, 0);

  return {
    totalToolCount: TOOL_NAMES_COUNT,
    disclosureCount: defaults.length,
    disclosureNames: [...defaultNames].sort(),
    structuralTokens: structuralTokensOf(defaults),
    providerSurfaceTokens: structuralTokensOf(buildToolDefinitions(defaults)),
    sourceDescriptionChars,
  };
}

function readBaseline(): DisclosureBaseline {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as DisclosureBaseline;
}

const baseline = readBaseline();
const current = measureDisclosure();

describe('AC-16 模型可见面预算 · 棘轮', () => {
  it('默认披露面四项指标均不超过基线（只减不增），成员名单冻结', () => {
    // 防空转（恒真守卫）：测量面必须真的非空
    expect(current.totalToolCount).toBeGreaterThan(0);
    expect(current.disclosureCount).toBeGreaterThan(0);
    expect(current.disclosureNames.length).toBe(current.disclosureCount);
    const { problems } = compareDisclosureBudget(current, baseline);
    expect(problems).toEqual([]);
  });

  it('生成物与基线对齐：`TOOL_NAMES_COUNT` = 基线工具总数', () => {
    expect(baseline.totalToolCount).toBe(TOOL_NAMES_COUNT);
  });

  it('缩小 ⇒ 通过并提示下调基线（锁住成果）', () => {
    const bigger: DisclosureBaseline = {
      ...baseline,
      disclosureCount: baseline.disclosureCount + 1,
      disclosureNames: [...baseline.disclosureNames, 'legacy_tool'],
    };
    const comparison = compareDisclosureBudget(current, bigger);
    expect(comparison.problems).toEqual([]);
    expect(comparison.shrink).toContain('下调基线');
  });

  it('门禁自证（负向夹具）：披露集 +1 ⇒ 必报', () => {
    const comparison = compareDisclosureBudget(
      { ...current, disclosureCount: current.disclosureCount + 1 },
      baseline
    );
    expect(comparison.problems.length).toBeGreaterThan(0);
    expect(comparison.problems.join('\n')).toContain('默认披露集工具数增长');
  });

  it('门禁自证（负向夹具）：**换掉**披露集成员（数量不变）⇒ 必报', () => {
    const swapped = [...current.disclosureNames];
    swapped[0] = 'brand_new_tool';
    const comparison = compareDisclosureBudget(
      { ...current, disclosureNames: swapped.sort() },
      baseline
    );
    expect(comparison.problems.join('\n')).toContain('默认披露集新增工具');
    expect(comparison.problems.join('\n')).toContain('brand_new_tool');
  });

  it('门禁自证（负向夹具）：工具总数 / 结构 token / 描述字符 任一增长 ⇒ 必报', () => {
    for (const [key, label] of METRICS) {
      const bumped = Object.assign({}, current, {
        [key]: current[key] + 1,
      }) as DisclosureSnapshot;
      const comparison = compareDisclosureBudget(bumped, baseline);
      expect(comparison.problems.join('\n')).toContain(label);
    }
  });

  it('门禁自证（负向夹具）：基线谎报已达目标（targetMet=true）⇒ 必报', () => {
    // 目标已真达成 ⇒ 必须先构造"未达标"的实测值，才能证明 targetMet 的谎报会被抓
    const comparison = compareDisclosureBudget(
      {
        ...current,
        providerSurfaceTokens: current.providerSurfaceTokens + 1_000,
      },
      { ...baseline, targetMet: true }
    );
    // 两条都会报：① 该指标增长；② 基线谎报已达目标 —— 后者是本用例要钉死的那条
    expect(comparison.problems.join('\n')).toContain('谎报已达 AC-16 目标');
  });

  it('非法基线（缺 targets / 指标非正数 / 名单不自洽）⇒ 必报，不得静默通过', () => {
    const missingTargets = {
      ...baseline,
      targets: undefined,
    } as unknown as DisclosureBaseline;
    expect(
      compareDisclosureBudget(current, missingTargets).problems[0]!
    ).toContain('非法基线');

    const zeroMetric = { ...baseline, disclosureCount: 0 };
    expect(compareDisclosureBudget(current, zeroMetric).problems[0]!).toContain(
      '非法基线'
    );

    const inconsistent = {
      ...baseline,
      disclosureNames: baseline.disclosureNames.slice(1),
    };
    expect(
      compareDisclosureBudget(current, inconsistent).problems[0]!
    ).toContain('非法基线');
  });
});

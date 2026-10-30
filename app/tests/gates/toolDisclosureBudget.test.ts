/**
 * AC-16 模型可见面预算 · 棘轮门禁（P4-1，2026-10-28；P0-1 扩面，2026-10-30）
 *
 * 背景：`dev_docs/20261027/Liri架构优化方案-20261027.md` AC-16 ——「默认披露集 ≤12 且
 * schema ≤1.5k token；`TOOL_NAMES_COUNT` 只减不增」。此前**没有任何门禁测量披露面**：
 * 工具总数 82 是已知的，但"模型每轮真实看到哪些工具 / 多大"从未被观测。
 *
 * **P0-1（2026-10-30）扩面**：本门禁原先只测 `default`/`chat` 面；真机实测 `coding`/`agent`
 * 面单轮下发 **68 个工具 / 105.2 KB schema**（≈30k–42k token）却无任何上限 ⇒ 现把这三个
 * 任务面一起冻结（数量 / provider 结构 token / 成员名单，均只减不增）。
 *
 * 度量实现已外移到 `scripts/measure-tool-disclosure.ts`（门禁与
 * `bun run measure:tool-disclosure` 共用一份，CS01）：
 *   - 披露面 = `loadTools(...)` → `ToolRegistry.getToolSchemas()` → `filterToolsByTask(…, taskType)`
 *     （与 `streamMessageToolSelection` 同源判定 ⇒ 测的就是模型真实看到的那一面）；
 *   - `structuralTokens` = 抹掉 `description`/`searchTips` 后的 JSON **字符数 / 4**
 *     （与 locale 无关；`estimateTokens` 对无空格 JSON 会低估约 5 倍，故不用）；
 *   - `providerSurfaceTokens` = `buildToolDefinitions()` 投影后的同一算法（真正下发的字段）；
 *   - `sourceDescriptionChars` = 披露面工具的源码描述字符数（跨平台取最大，棘轮以最差平台为准）。
 *
 * 棘轮语义：`default` 面五项指标 + 成员名单冻结；`perTask` 逐面（数量 / token / 名单）冻结。
 * 缩小 ⇒ 提示下调基线锁定成果；增长 ⇒ 必报（fail-closed：基线缺字段也判违规）。
 */
import { describe, expect, it } from 'bun:test';

import {
  GATED_TASK_TYPES,
  compareDisclosureBudget,
  comparePerTaskBudgets,
  measureDisclosure,
  measureTaskSurfaces,
  readBaseline,
  type DisclosureBaseline,
  type DisclosureSnapshot,
} from '../../scripts/measure-tool-disclosure';
import { TOOL_NAMES_COUNT } from '../../src/constants/toolNames.generated';

const baseline = readBaseline();
const current = measureDisclosure();
const perTask = measureTaskSurfaces();

describe('AC-16 模型可见面预算 · 棘轮（default 面）', () => {
  it('默认披露面五项指标均不超过基线（只减不增），成员名单冻结', () => {
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
    const metrics = [
      'totalToolCount',
      'disclosureCount',
      'structuralTokens',
      'providerSurfaceTokens',
      'sourceDescriptionChars',
    ] as const;
    for (const key of metrics) {
      // 以**基线**为起点 +1（不能用 current：某指标可能低于基线 ⇒ +1 仍不越线，夹具会假绿）
      const bumped = Object.assign({}, current, {
        [key]: baseline[key] + 1,
      }) as DisclosureSnapshot;
      const comparison = compareDisclosureBudget(bumped, baseline);
      expect(comparison.problems.length).toBeGreaterThan(0);
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

describe('P0-1：coding / agent 任务面披露预算（此前无门禁）', () => {
  it('基线必须包含全部受门禁任务面（缺项 ⇒ 必报，不得当作通过）', () => {
    for (const taskType of GATED_TASK_TYPES) {
      expect(baseline.perTask?.[taskType]).toBeDefined();
    }
    expect(comparePerTaskBudgets(perTask, baseline).problems).toEqual([]);
  });

  it('三个任务面都测得非空快照（防空转守卫）', () => {
    for (const taskType of GATED_TASK_TYPES) {
      expect(perTask[taskType]?.disclosureCount ?? 0).toBeGreaterThan(0);
      expect(perTask[taskType].disclosureNames.length).toBe(
        perTask[taskType].disclosureCount
      );
    }
  });

  it('缩小 ⇒ 通过并提示下调基线', () => {
    const bigger: DisclosureBaseline = {
      ...baseline,
      perTask: {
        ...baseline.perTask,
        coding: {
          ...baseline.perTask!.coding,
          disclosureCount: baseline.perTask!.coding.disclosureCount + 1,
          disclosureNames: [
            ...baseline.perTask!.coding.disclosureNames,
            'legacy_tool',
          ],
        },
      },
    };
    const comparison = comparePerTaskBudgets(perTask, bigger);
    expect(comparison.problems).toEqual([]);
    expect(comparison.shrink).toContain('下调基线');
  });

  it('门禁自证（负向夹具）：coding 披露数 +1 / token +1 / 新增成员 ⇒ 必报', () => {
    const frozen = baseline.perTask!.coding;

    const moreTools = {
      ...perTask,
      coding: {
        ...perTask.coding,
        disclosureCount: frozen.disclosureCount + 1,
      },
    };
    expect(
      comparePerTaskBudgets(moreTools, baseline).problems.join('\n')
    ).toContain('任务面 coding 披露数增长');

    const moreTokens = {
      ...perTask,
      coding: {
        ...perTask.coding,
        providerSurfaceTokens: frozen.providerSurfaceTokens + 1,
      },
    };
    expect(
      comparePerTaskBudgets(moreTokens, baseline).problems.join('\n')
    ).toContain('任务面 coding 模型可见结构 token 增长');

    const swapped = {
      ...perTask,
      coding: {
        ...perTask.coding,
        disclosureNames: [
          ...frozen.disclosureNames.slice(1),
          'brand_new_tool',
        ].sort(),
      },
    };
    expect(
      comparePerTaskBudgets(swapped, baseline).problems.join('\n')
    ).toContain('任务面 coding 披露集新增工具');
  });

  it('门禁自证（负向夹具）：基线缺 perTask / 缺某任务面 / 名单不自洽 ⇒ 必报', () => {
    const noPerTask = { ...baseline, perTask: undefined } as DisclosureBaseline;
    expect(comparePerTaskBudgets(perTask, noPerTask).problems[0]!).toContain(
      '缺少 perTask'
    );

    const missingAgent: DisclosureBaseline = {
      ...baseline,
      perTask: {
        default: baseline.perTask!.default,
        coding: baseline.perTask!.coding,
      },
    };
    expect(
      comparePerTaskBudgets(perTask, missingAgent).problems.join('\n')
    ).toContain('缺少任务面 agent');

    const inconsistent: DisclosureBaseline = {
      ...baseline,
      perTask: {
        ...baseline.perTask,
        coding: {
          ...baseline.perTask!.coding,
          disclosureNames: baseline.perTask!.coding.disclosureNames.slice(1),
        },
      },
    };
    expect(
      comparePerTaskBudgets(perTask, inconsistent).problems.join('\n')
    ).toContain('disclosureNames 与 disclosureCount 不一致');
  });
});

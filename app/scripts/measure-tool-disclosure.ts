#!/usr/bin/env bun
/**
 * measure-tool-disclosure.ts — AC-16 披露面度量的**唯一实现**（2026-10-30 外移自门禁测试）
 *
 * 为什么外移：AC-16 门禁（`tests/gates/toolDisclosureBudget.test.ts`）原本只测 `default`
 * 面；真机实测 `coding`/`agent` 面单轮下发 **68 个工具 / 105.2 KB**（≈30k–42k token），
 * 却**没有门禁**。现在把"度量 + 棘轮比对 + 基线读写"收敛到这里：
 * - 门禁（bun test）与 CLI（`bun run measure:tool-disclosure`）共用同一实现（CS01）；
 * - CLI 支持 `--update` 写基线（与 `lint:state-ratchet --update` 同风格）。
 *
 * 口径（与 AC-16 原文一致，勿改）：
 * - 披露面 = `loadTools(new ToolFactory(), getAllBuiltinToolLoaders())`
 *   → `ToolRegistry.getToolSchemas()` → `filterToolsByTask(…, taskType)`
 *   （与 `streamMessageToolSelection` 同源判定 ⇒ 测的就是模型真实看到的那一面）；
 * - `structuralTokens` = 抹掉 `description`/`searchTips` 后的 JSON **字符数 / 4**
 *   （与 locale 无关；不用 `estimateTokens`，它对无空格 JSON 会低估约 5 倍）；
 * - `providerSurfaceTokens` = `buildToolDefinitions()` 投影后的同一算法
 *   （真正下发给 provider 的 name/description/parameters）；
 * - `sourceDescriptionChars` = 披露面工具的源码描述字符数（跨平台取最大，棘轮以最差平台为准）。
 *
 * 用法（app 目录下）：
 *   bun run measure:tool-disclosure            # 打印当前各任务面的实测值
 *   bun run measure:tool-disclosure --update   # 写回基线（只应由评审后的人工执行）
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { TOOL_NAMES_COUNT } from '../src/constants/toolNames.generated';
import { ToolFactory } from '../src/tools/ToolFactory';
import { ToolRegistry } from '../src/tools/ToolRegistry';
import { filterToolsByTask } from '../src/tools/toolCategories';
import { buildToolDefinitions } from '../src/tools/toolNameCodec';
import {
  getAllBuiltinToolLoaders,
  loadTools,
} from '../src/tools/utils/ToolManagerUtils';
import type { Tool } from '../src/tools/types/Tool';

export const BASELINE_PATH = resolve(
  import.meta.dir,
  '../../.trae/architecture/tool-disclosure-baseline.json'
);

/** 参与门禁的任务面：`default` 原有；`coding`/`agent` = 2026-10-30 P0-1 新增（此前无门禁） */
export const GATED_TASK_TYPES = ['default', 'coding', 'agent'] as const;
export type GatedTaskType = (typeof GATED_TASK_TYPES)[number];

export interface DisclosureSnapshot {
  /** 可实例化内置工具总数（口径 = 生成物 `TOOL_NAMES_COUNT`） */
  totalToolCount: number;
  /** 该任务面下模型可见的工具数 */
  disclosureCount: number;
  /** 披露集成员（升序；比 count 更强 —— 换掉一个工具也必报） */
  disclosureNames: string[];
  /** 披露面 schema 的**结构** token（抹掉 description 后估算，与 locale 无关） */
  structuralTokens: number;
  /** 真正下发给 provider 的结构 token */
  providerSurfaceTokens: number;
  /** 披露面工具/参数的**源码**描述字符数（与 locale 无关） */
  sourceDescriptionChars: number;
}

/** 非 default 任务面的快照（少两项"事件载荷/源码描述"指标：它们只对默认面冻结） */
export interface PerTaskSnapshot {
  disclosureCount: number;
  providerSurfaceTokens: number;
  disclosureNames: string[];
}

export interface DisclosureBaseline extends DisclosureSnapshot {
  version: number;
  targets: { disclosureCount: number; providerSurfaceTokens: number };
  /** 基线自报的"是否已达 AC-16 目标"（谎报 ⇒ 必报） */
  targetMet: boolean;
  /** 各任务面的冻结值（`default` 也在内，便于逐面比对；缺项 ⇒ 门禁失败） */
  perTask?: Record<string, PerTaskSnapshot>;
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
 * 棘轮比对（纯函数，门禁自证/负向夹具共用）。
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

/**
 * 逐任务面棘轮比对（P0-1）：数量 / provider token 只减不增，成员名单冻结。
 *
 * fail-closed：基线缺 `perTask` 或缺某个被门禁的任务面 ⇒ 直接判违规
 * （新增门禁面必须先在基线里登记，不能"没测过就当通过"）。
 */
export function comparePerTaskBudgets(
  current: Readonly<Record<string, PerTaskSnapshot>>,
  baseline: DisclosureBaseline,
  taskTypes: readonly string[] = GATED_TASK_TYPES
): DisclosureComparison {
  if (!baseline.perTask || typeof baseline.perTask !== 'object') {
    return {
      problems: ['非法基线：缺少 perTask（各任务面披露面冻结值）'],
      shrink: null,
    };
  }

  const problems: string[] = [];
  const shrunk: string[] = [];
  for (const taskType of taskTypes) {
    const frozen = baseline.perTask[taskType];
    const live = current[taskType];
    if (!frozen) {
      problems.push(`非法基线：缺少任务面 ${taskType} 的 perTask 冻结值`);
      continue;
    }
    if (!live) {
      problems.push(`测量缺失：任务面 ${taskType} 未产出快照（不得当作通过）`);
      continue;
    }
    if (!Number.isFinite(frozen.disclosureCount) || frozen.disclosureCount <= 0) {
      problems.push(`非法基线：任务面 ${taskType} 的 disclosureCount 非法`);
      continue;
    }
    if (
      !Array.isArray(frozen.disclosureNames) ||
      frozen.disclosureNames.length !== frozen.disclosureCount
    ) {
      problems.push(
        `非法基线：任务面 ${taskType} 的 disclosureNames 与 disclosureCount 不一致`
      );
      continue;
    }

    if (live.disclosureCount > frozen.disclosureCount) {
      problems.push(
        `任务面 ${taskType} 披露数增长：${frozen.disclosureCount} → ${live.disclosureCount}（只减不增）`
      );
    } else if (live.disclosureCount < frozen.disclosureCount) {
      shrunk.push(`任务面 ${taskType} 披露数 ${frozen.disclosureCount} → ${live.disclosureCount}`);
    }
    if (live.providerSurfaceTokens > frozen.providerSurfaceTokens) {
      problems.push(
        `任务面 ${taskType} 模型可见结构 token 增长：` +
          `${frozen.providerSurfaceTokens} → ${live.providerSurfaceTokens}（只减不增）`
      );
    } else if (live.providerSurfaceTokens < frozen.providerSurfaceTokens) {
      shrunk.push(
        `任务面 ${taskType} 结构 token ${frozen.providerSurfaceTokens} → ${live.providerSurfaceTokens}`
      );
    }

    const frozenNames = new Set(frozen.disclosureNames);
    const liveNames = new Set(live.disclosureNames);
    const added = [...liveNames].filter((n) => !frozenNames.has(n)).sort();
    if (added.length > 0) {
      problems.push(
        `任务面 ${taskType} 披露集新增工具：${added.join('、')}（必须显式评审并更新基线）`
      );
    }
  }

  return {
    problems,
    shrink: shrunk.length > 0 ? `已缩小：${shrunk.join('；')} ⇒ 请下调基线锁定成果` : null,
  };
}

/** 抹掉所有 `description` / `searchTips` 值（保留键 ⇒ 结构不变）—— 让口径与 locale 无关 */
function stripDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripDescriptions);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = k === 'description' || k === 'searchTips' ? '' : stripDescriptions(v);
    }
    return out;
  }
  return value;
}

/** 结构 token = 抹描述后的 JSON 字符数 / 4（可加总、跨机器稳定） */
function structuralTokensOf(value: unknown): number {
  return Math.ceil(JSON.stringify(stripDescriptions(value)).length / 4);
}

interface LoadedTools {
  registry: ToolRegistry;
  tools: Tool[];
}

/** 真实装配（只做一次；三个任务面共用同一注册表） */
function loadRegistry(): LoadedTools {
  const tools = loadTools(new ToolFactory(), getAllBuiltinToolLoaders());
  const registry = new ToolRegistry();
  for (const tool of tools) registry.registerTool(tool);
  return { registry, tools };
}

/** 实测某个任务面的披露面（真实实例化 + 与生产同源的裁剪函数） */
export function measureDisclosure(
  taskType: string = 'default',
  loaded: LoadedTools = loadRegistry()
): DisclosureSnapshot {
  const schemas = filterToolsByTask(loaded.registry.getToolSchemas(), taskType);
  const names = new Set(schemas.map((s) => s.name));

  const sourceDescriptionChars = loaded.tools
    .filter((t) => names.has(t.name))
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
    disclosureCount: schemas.length,
    disclosureNames: [...names].sort(),
    structuralTokens: structuralTokensOf(schemas),
    providerSurfaceTokens: structuralTokensOf(buildToolDefinitions(schemas)),
    sourceDescriptionChars,
  };
}

/** 一次装配、逐任务面测量（门禁用） */
export function measureTaskSurfaces(
  taskTypes: readonly string[] = GATED_TASK_TYPES
): Record<string, PerTaskSnapshot> {
  const loaded = loadRegistry();
  const out: Record<string, PerTaskSnapshot> = {};
  for (const taskType of taskTypes) {
    const snap = measureDisclosure(taskType, loaded);
    out[taskType] = {
      disclosureCount: snap.disclosureCount,
      providerSurfaceTokens: snap.providerSurfaceTokens,
      disclosureNames: snap.disclosureNames,
    };
  }
  return out;
}

export function readBaseline(path: string = BASELINE_PATH): DisclosureBaseline {
  return JSON.parse(readFileSync(path, 'utf8')) as DisclosureBaseline;
}

/**
 * 写回基线（`--update`）：`default` 面的五项指标 + perTask 逐面快照。
 *
 * ⚠️ 只应由**评审后的人工**执行：棘轮的意义是"增长必须显式"，自动写会绕过评审。
 */
export function updateBaseline(
  path: string = BASELINE_PATH,
  measure: {
    defaultSnap: DisclosureSnapshot;
    perTask: Record<string, PerTaskSnapshot>;
  } = (() => {
    const loaded = loadRegistry();
    const defaultSnap = measureDisclosure('default', loaded);
    const perTask: Record<string, PerTaskSnapshot> = {};
    for (const taskType of GATED_TASK_TYPES) {
      const snap =
        taskType === 'default'
          ? defaultSnap
          : measureDisclosure(taskType, loaded);
      perTask[taskType] = {
        disclosureCount: snap.disclosureCount,
        providerSurfaceTokens: snap.providerSurfaceTokens,
        disclosureNames: snap.disclosureNames,
      };
    }
    return { defaultSnap, perTask };
  })()
): DisclosureBaseline {
  const previous = readBaseline(path);
  const next: DisclosureBaseline = {
    ...previous,
    totalToolCount: measure.defaultSnap.totalToolCount,
    disclosureCount: measure.defaultSnap.disclosureCount,
    disclosureNames: measure.defaultSnap.disclosureNames,
    structuralTokens: measure.defaultSnap.structuralTokens,
    providerSurfaceTokens: measure.defaultSnap.providerSurfaceTokens,
    // `sourceDescriptionChars` 是**跨平台**指标（ubuntu 比 windows/macos 多约 70 字符）：
    // 基线口径是"取跨平台最大值"，因此本机（windows）测量值更小时**不得**下调 ——
    // 否则 Linux CI 会以"增长 3411 → 3481"误报（2026-10-30 实测踩到）。
    sourceDescriptionChars: Math.max(
      measure.defaultSnap.sourceDescriptionChars,
      previous.sourceDescriptionChars
    ),
    targetMet:
      measure.defaultSnap.disclosureCount <= previous.targets.disclosureCount &&
      measure.defaultSnap.providerSurfaceTokens <= previous.targets.providerSurfaceTokens,
    perTask: measure.perTask,
  };
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

if (import.meta.main) {
  // 与**生产同源**：先注入构建变体层（`feature()` 有"未注入即求值"的时序守卫）。
  // 放在 main 里动态导入：门禁测试（`NODE_ENV=test`）不受影响，仍按静态默认度量。
  await import('../src/bootstrap/initVariantFlags');
  const loaded = loadRegistry();
  const defaultSnap = measureDisclosure('default', loaded);
  const perTask: Record<string, PerTaskSnapshot> = {};
  for (const taskType of GATED_TASK_TYPES) {
    const snap = taskType === 'default' ? defaultSnap : measureDisclosure(taskType, loaded);
    perTask[taskType] = {
      disclosureCount: snap.disclosureCount,
      providerSurfaceTokens: snap.providerSurfaceTokens,
      disclosureNames: snap.disclosureNames,
    };
    console.log(
      `${taskType.padEnd(8)} 工具 ${String(snap.disclosureCount).padStart(3)} 个 · ` +
        `provider ${String(snap.providerSurfaceTokens).padStart(5)} token · ` +
        `structural ${String(snap.structuralTokens).padStart(5)} · ` +
        `源码描述 ${String(snap.sourceDescriptionChars).padStart(5)} 字符`
    );
  }

  if (process.argv.includes('--update')) {
    const next = updateBaseline(BASELINE_PATH, { defaultSnap, perTask });
    console.log(`已写回基线：${BASELINE_PATH}（perTask: ${Object.keys(next.perTask ?? {}).join(', ')}）`);
  } else {
    const baseline = readBaseline();
    const a = compareDisclosureBudget(defaultSnap, baseline);
    const b = comparePerTaskBudgets(perTask, baseline);
    const problems = [...a.problems, ...b.problems];
    if (problems.length > 0) {
      console.log('超出基线（需要评审或下调）：');
      for (const p of problems) console.log(`  - ${p}`);
      process.exitCode = 1;
    } else {
      console.log('未超出基线（只减不增）。');
      if (a.shrink) console.log(`  ${a.shrink}`);
      if (b.shrink) console.log(`  ${b.shrink}`);
    }
  }
}

// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 编排 pattern 的「装配入口」（A8 最后一公里 · 方案 B1，2026-10-04）
 *
 * 职责：把 `PatternSelection.descriptor.assembly.assembler` 解析为**可执行运行路由**
 * （复用既有实现），使装配描述不再只被测试期读取 —— 当前唯一生产消费者 =
 * `ChatManager._maybeLaunchPdca` 的研究分流。
 *
 * 边界（如实 · CS03/CS04）：
 * - **不新建编排运行时**：`competitive_strategy` 复用 A7 冻结的装配点
 *   （`runResearchOrchestration`，构造/默认/执行内聚其中，本层不复制构造逻辑）。
 * - `long_task_pdl` 的运行时（PlanDrivenLoop）存在，但由 ChatManager 快速路径策略
 *   （`_shouldUsePlanDrivenLoop`）**独立驱动**，不经 pattern 装配
 *   （D2 = 以运行时为准）⇒ 本层如实返回 `unavailable`（不静默空转）。
 * - `iterative_refine` / `parallel_distributed` 的**承担方均已存在实现**（见
 *   `patternAssembly.ts#PATTERN_PROVIDER_BINDINGS`），缺的是 **pattern 级装配入口与触发面**
 *   ⇒ 同 `unavailable`，**不臆造运行时/占位 stub**（CS04）。装配评估（含终局裁定与触发条件）
 *   见 `.trae/specs/pattern-wiring-closure.md` §5/§6。
 * - 13-P1-3（2026-10-05）：`self_verify` 升为 **ready** —— 复用**既有** `VerifierAgent`
 *   （配方 `verifyPolicy:'blocking'`），并返回执行配方供消费方配置该运行时。
 *   2026-10-07（`pattern-wiring-closure.md` §4）：**触发面已补齐**（选择规则新增 `verify`）
 *   ⇒ 「已接线 **且可达**」；生效受门控 `SELF_VERIFY_PATTERN`（默认 false）约束。
 *
 * 完备性：`ASSEMBLER_SPECS` 为 `Record<PatternAssemblerId, …>` ⇒ 闭集增项而漏登记
 * 即**编译失败**（防手写漂移）。
 *
 * 分层：本文件属 **app 层**（`query`），依赖 core 层 barrel `@modules/core`（合法方向）；
 * 不 import 任何 provider 实现（避免引入重依赖与跨模块边）。
 */

import type {
  PatternAssemblerId,
  PatternRecipe,
  PatternSelection,
} from '@modules/core';
import {
  feature,
  isPatternReachable,
  listPatterns,
  patternFeatureFlag,
  patternUnreachableReason,
  resolvePattern,
} from '@modules/core';
import { resolveDataSubDir } from '@modules/core/paths';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

/** 已接线的运行路由（闭集；13-P1-3 新增 `verify`） */
export type PatternRunRoute = 'research' | 'verify';

/**
 * 装配结果：可执行路由 **+ 执行配方**，或 显式不可用
 * （CS02：判定式状态字段，非用户可见字符串）。
 */
export type PatternInstantiation =
  | {
      status: 'ready';
      assembler: PatternAssemblerId;
      route: PatternRunRoute;
      /** 13-P1-3：执行配方（并发/验证/预算），供消费方配置**既有**运行时 */
      recipe: PatternRecipe;
    }
  | { status: 'unavailable'; assembler: PatternAssemblerId; reason: string };

/** 单个装配入口的规格：可执行路由（含配方） 或 不可用原因（二选一，必有其一） */
type AssemblerSpec =
  | { route: PatternRunRoute; recipe: PatternRecipe }
  | { reason: string };

/** 研究线路配方：对抗评审为**建议性**（不阻断主流程） */
const RESEARCH_RECIPE: PatternRecipe = {
  loopKind: 'research',
  verifyPolicy: 'advisory',
  budgetPolicy: 'default',
};

/** 自校验线路配方：验证**阻断式**（不通过即不放行）+ 严格预算 */
const VERIFY_RECIPE: PatternRecipe = {
  loopKind: 'verify',
  verifyPolicy: 'blocking',
  budgetPolicy: 'strict',
};

/**
 * assembler → 装配规格（**闭集全覆盖**；`Record` 形态编译期保证无漏配）。
 * 新增 `PatternAssemblerId` 而漏登记 ⇒ 编译失败。
 */
const ASSEMBLER_SPECS: Readonly<Record<PatternAssemblerId, AssemblerSpec>> = {
  competitive_strategy: { route: 'research', recipe: RESEARCH_RECIPE },
  // 2026-10-07（`.trae/specs/pattern-wiring-closure.md` §3「P0 措辞如实化」）：原文案把
  // 「无组合 / 无消费方」写作「无运行时」⇒ 读者会误以为**零部件也不存在**。实测
  // `patternAssembly.ts#PATTERN_PROVIDER_BINDINGS` 已把 8 个承担方**全部**解析到真实实现。
  // ⇒ 统一改**三段式**：承担方 / 装配入口 / 触发面（各段如实，缺哪段说哪段）。
  long_task_pdl: {
    reason:
      '承担方已就绪（plan_driven_loop=PlanDrivenLoop、task_decomposer=TaskDecomposer）／装配入口缺：运行时由 ChatManager 快速路径策略（_shouldUsePlanDrivenLoop）独立驱动，不经 pattern 装配（D2 = 以运行时为准）／触发面缺：选择层无规则',
  },
  iterative_refine: {
    reason:
      '承担方已就绪（generator=TAORLoop、reviewer=VerifierAgent；VerifierAgent 且已内建于 TAORLoop）／装配入口缺：无 pattern 级组合与消费方（装配评估见 spec `pattern-wiring-closure.md` §5，暂不实施）／触发面缺：选择层无规则（N4）',
  },
  parallel_distributed: {
    reason:
      '承担方已就绪（planner=TaskDecomposer、worker=ParallelAgentScheduler、aggregator=ResultAggregator）／装配入口缺：未裁定装配到哪条既有链（装配评估见 spec `pattern-wiring-closure.md` §6，暂不实施）／触发面缺：选择层无规则（N4）',
  },
  // 13-P1-3（2026-10-05）：`self_verify` 由 unavailable 升为 **ready** —— 复用既有 VerifierAgent
  // （配方 verifyPolicy:'blocking'）。
  // 2026-10-07（`pattern-wiring-closure.md` §4「P1」）：**触发面已补齐** ——
  // `core/patterns/PatternSelector#PATTERN_SELECTION_RULES` 新增 `verify` 规则 ⇒ 本模式现为
  // 「已接线 **且可达**」（此前"接线在、触发缺"的如实标注到此收口）；
  // 生效仍受门控 `SELF_VERIFY_PATTERN`（**默认 false**）约束。
  self_verify: { route: 'verify', recipe: VERIFY_RECIPE },
};

/**
 * 把 pattern 选择结果装配为**可执行路由 + 配方**（不可用则显式给出原因）。
 *
 * @param selection `selectPattern` 的返回值（携带 `descriptor.assembly`）
 */
export function instantiatePattern(
  selection: PatternSelection
): PatternInstantiation {
  const assembler = selection.descriptor.assembly.assembler;
  const spec = ASSEMBLER_SPECS[assembler];
  return 'route' in spec
    ? { status: 'ready', assembler, route: spec.route, recipe: spec.recipe }
    : { status: 'unavailable', assembler, reason: spec.reason };
}

/**
 * 编排模式**只读目录项**（PC-6，2026-10-07）
 *
 * 面向「可见性」：把注册表（`PatternDescriptor`）+ **装配状态**（`instantiatePattern`）
 * 合成一条可序列化的投影，供前端「编排模式」清单展示（含**未接线**者及其原因）。
 */
export interface PatternCatalogEntry {
  name: string;
  displayName: string;
  /** 适用场景（人类可读；取自描述层的 `when`） */
  when: string;
  roles: string[];
  /** 角色 → 承担方绑定（装配契约） */
  bindings: { role: string; providers: string[] }[];
  assembler: string;
  /** 装配状态：`ready` 已接线可执行 / `unavailable` 未接线（`reason` 说明） */
  status: 'ready' | 'unavailable';
  /** 可执行运行路由（仅 `ready`） */
  route?: PatternRunRoute;
  /** 未接线原因（仅 `unavailable`） */
  reason?: string;
  /**
   * **触发可达性**（2026-10-07 新增）：选择层是否会产出本模式。
   *
   * 与 `status`（装配层）是**两件事**：`status==='ready' && !reachable` 表示
   * 「接线已就位但当前**不可达**」（缺触发面）—— 面板此前把它谎报为可用。
   */
  reachable: boolean;
  /** 无触发面原因（仅 `reachable === false`） */
  unreachableReason?: string;
  /**
   * 命中后**仍需**开启的功能开关（仅出现在有门控的模式上）。
   *
   * `enabled` 为**本次读取时刻**的值（`core#feature` 读环境/常量）⇒ 非历史回放值。
   */
  featureGate?: { flag: string; enabled: boolean };
}

/**
 * 列出**全部**编排模式及其装配状态 + 触发可达性（PC-6 / 2026-10-07 可达性收口）。
 *
 * 纯函数，顺序 = 注册表声明序。
 *
 * ⚠️ 如实边界：`unavailable` 者**不是遗漏**，而是「无 pattern 级**装配入口**」或
 * 「运行时由别处独立驱动」（见各 `reason`，均已按**三段式**写明承担方/装配入口/触发面）；
 * `reachable: false` 者**不是缺漏**，而是「选择层无触发规则」（见 `unreachableReason`）。本函数**不改**任何判定 ——
 * 两个事实各自的唯一事实源分别是 `patternAssembler#ASSEMBLER_SPECS` 与
 * `core/patterns/PatternSelector#PATTERN_SELECTION_RULES`。
 */
export function listPatternCatalog(): PatternCatalogEntry[] {
  return listPatterns().map((descriptor) => {
    const instantiation = instantiatePattern(
      // 注册表键与描述同名 ⇒ 必有结果（`resolvePattern` 是 `PatternSelection` 唯一构造点）
      resolvePattern(descriptor.name)
    );
    const reachable = isPatternReachable(descriptor.name);
    const flag = patternFeatureFlag(descriptor.name);
    const base: PatternCatalogEntry = {
      name: descriptor.name,
      displayName: descriptor.displayName,
      when: descriptor.when,
      roles: [...descriptor.roles],
      bindings: descriptor.assembly.bindings.map((b) => ({
        role: b.role,
        providers: [...b.providers],
      })),
      assembler: descriptor.assembly.assembler,
      status: instantiation.status,
      reachable,
      // CS02：可达性与门控都是**结构化字段**；`flag` 名非空才给门控
      ...(flag ? { featureGate: { flag, enabled: feature(flag) } } : {}),
      ...(reachable
        ? {}
        : { unreachableReason: patternUnreachableReason(descriptor.name) }),
      ...(instantiation.status === 'ready'
        ? { route: instantiation.route }
        : { reason: instantiation.reason }),
    };
    return base;
  });
}

/** 静态快照结构（`~/.pyapp/data/reports/pattern_catalog.json` 的内容） */
export interface PatternCatalogSnapshot {
  generatedAt: string;
  entries: PatternCatalogEntry[];
}

/** 快照文件绝对路径（沿既有 `reports/` 约定，`project_rules §1.13`：不新建目录/不拼路径） */
export function patternCatalogSnapshotPath(
  dirPath: string = resolveDataSubDir('reports')
): string {
  return join(dirPath, 'pattern_catalog.json');
}

/**
 * 把当前模式目录**落盘**为静态快照（按需调用；用户诉求：留档 / 跨版本 diff）。
 *
 * 边界（如实）：
 * - 内容**确定性**（同版本恒定）⇒ 它不是运行期诊断主通道（那是 `pattern/decision` 事件）；
 * - 失败**不吞**：由调用方 `handleError` 决定呈现（本函数不静默返回伪成功）；
 * - `dirPath` 可注入（沿本仓 `resolveDataSubDir(...)` 默认值惯例）⇒ 便于用例指向临时目录。
 */
export async function writePatternCatalogSnapshot(dirPath?: string): Promise<{
  path: string;
  entryCount: number;
}> {
  const path = patternCatalogSnapshotPath(dirPath);
  const snapshot: PatternCatalogSnapshot = {
    generatedAt: new Date().toISOString(),
    entries: listPatternCatalog(),
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(snapshot, null, 2), 'utf8');
  return { path, entryCount: snapshot.entries.length };
}

/**
 * 配方 → 验证器配置（13-P1-3）：供消费方把配方应用到**既有** VerifierAgent
 * （不新建运行时；字段语义见 `VerifierAgentConfig`）。
 */
export function verifierConfigForRecipe(recipe: PatternRecipe): {
  enabled: boolean;
  failClosed: boolean;
  maxCycles?: number;
} {
  switch (recipe.verifyPolicy) {
    case 'off':
      return { enabled: false, failClosed: true };
    case 'advisory':
      return { enabled: true, failClosed: false };
    case 'blocking':
      return {
        enabled: true,
        failClosed: true,
        maxCycles: recipe.budgetPolicy === 'strict' ? 2 : undefined,
      };
  }
}

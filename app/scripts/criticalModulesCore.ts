/**
 * criticalModulesCore.ts — **CRITICAL 清单棘轮**纯逻辑核心（内核瘦身 P2）
 *
 * 与 `startupGraphCore.ts` 同分工：本文件只做比较、无 IO、无运行时 import，
 * 供 `scripts/lint-critical-modules.ts`（CI 门禁）与 `tests/gates/criticalModulesRatchet.test.ts`
 * （负向自证）共用 ⇒ 不会出现"门禁一套口径、测试另一套"。
 *
 * 棘轮语义（`内核瘦身-方案.md` §3 B3 / §4 P2）：
 *   - **启动面只允许收窄**：新增 CRITICAL 必须在基线里报备理由，否则 exit 1；
 *   - **清单外自动归 DEFERRED**（由 `LazyModuleStrategy.getModulePriority` 的默认值兑现）；
 *   - 已知模块（`MODULE_INITIALIZATION_ORDER`）**必须**在策略表登记 —— 未登记不会被任何
 *     阶段初始化（`getEssentialModuleIds` / `getDeferredModuleIds` / `getOnDemandModuleIds`
 *     都要求 `config` 存在）⇒ 属静默漏初始化，必须阻断。
 */

/** 一条 CRITICAL 登记（`reason` 即策略表的 `trigger`，也就是"为什么它必须进启动面"） */
export interface CriticalModuleEntry {
  id: string;
  reason: string;
}

/** 棘轮基线文件结构（`.trae/architecture/critical-modules-baseline.json`） */
export interface CriticalModulesBaseline {
  version: number;
  recordedAt?: string;
  note?: string;
  modules: CriticalModuleEntry[];
}

/** 比较结果：`violations` 阻断（exit 1），`hints` 只提示（exit 0） */
export interface CriticalModulesComparison {
  violations: string[];
  hints: string[];
  /** 当前有、基线无 ⇒ 未报备的新增 CRITICAL */
  added: string[];
  /** 基线有、当前无 ⇒ 已收窄，可下调基线 */
  removed: string[];
}

/** 理由的最小可辨识长度（"启动必需" 4 字；空串/占位符一律拒绝） */
const MIN_REASON_LENGTH = 2;

function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  }
  return [...dup];
}

/**
 * 比较「当前 CRITICAL 清单」与「基线」。
 *
 * @param current - 运行时从策略表取出的 CRITICAL 清单（`getCriticalModuleRegistry()`）
 * @param baseline - 棘轮基线
 * @param declaredIds - 策略表已登记的模块 id（`getDeclaredModuleIds()`）
 * @param orderedIds - 初始化顺序（`MODULE_INITIALIZATION_ORDER`）
 */
export function compareCriticalModules(
  current: readonly CriticalModuleEntry[],
  baseline: CriticalModulesBaseline,
  declaredIds: readonly string[],
  orderedIds: readonly string[]
): CriticalModulesComparison {
  const violations: string[] = [];
  const hints: string[] = [];

  const currentIds = current.map((e) => e.id);
  const baselineIds = baseline.modules.map((e) => e.id);

  for (const id of duplicates(currentIds)) {
    violations.push(
      `策略表里 \`${id}\` 重复登记为 CRITICAL（同一模块只能有一条）`
    );
  }
  for (const id of duplicates(baselineIds)) {
    violations.push(`基线里 \`${id}\` 重复出现（请 --update 重新生成）`);
  }

  // ① 理由必须存在：CRITICAL 的定义就是"必须解释为什么进启动面"
  for (const entry of current) {
    if (entry.reason.trim().length < MIN_REASON_LENGTH) {
      violations.push(
        `\`${entry.id}\` 登记为 CRITICAL 但没有说明理由（trigger 为空或过短）`
      );
    }
  }

  // ② 棘轮：新增 CRITICAL 必须先在基线报备
  const baselineSet = new Set(baselineIds);
  const added = currentIds.filter((id) => !baselineSet.has(id)).sort();
  for (const id of added) {
    violations.push(
      `\`${id}\` 被提升为 CRITICAL 但基线未报备（启动面回涨）——` +
        `要么改回 DEFERRED，要么在基线登记理由后 --update`
    );
  }

  // ③ 收窄是可喜的，但基线要及时下调，否则下次会误报
  const currentSet = new Set(currentIds);
  const removed = baselineIds.filter((id) => !currentSet.has(id)).sort();
  if (removed.length > 0) {
    hints.push(
      `CRITICAL 已收窄 ${removed.length} 项（${removed.join(', ')}）——` +
        `请运行 \`bun run lint:critical-modules --update\` 锁定成果`
    );
  }

  // ④ 理由变更不阻断（可能只是改措辞），但提示同步基线
  const baselineReason = new Map(baseline.modules.map((e) => [e.id, e.reason]));
  const drifted = current
    .filter(
      (e) => baselineReason.has(e.id) && baselineReason.get(e.id) !== e.reason
    )
    .map((e) => e.id);
  if (drifted.length > 0) {
    hints.push(
      `CRITICAL 理由文案变更（${drifted.join(', ')}）——建议 --update 同步基线`
    );
  }

  // ⑤ 未登记策略 = 任何阶段都不会初始化（静默漏初始化）
  const declaredSet = new Set(declaredIds);
  for (const id of orderedIds.filter((m) => !declaredSet.has(m))) {
    violations.push(
      `\`${id}\` 在 MODULE_INITIALIZATION_ORDER 里但未登记策略 ——` +
        `它不会被 CRITICAL / 批次 / 按需任一阶段初始化`
    );
  }

  return { violations, hints, added, removed };
}

/** 由当前清单生成基线（`--update` 用） */
export function toCriticalModulesBaseline(
  current: readonly CriticalModuleEntry[],
  recordedAt: string
): CriticalModulesBaseline {
  return {
    version: 1,
    recordedAt,
    note: 'CRITICAL 清单棘轮基线：新增条目必须在此报备理由；由 `bun run lint:critical-modules --update` 生成。',
    modules: [...current].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

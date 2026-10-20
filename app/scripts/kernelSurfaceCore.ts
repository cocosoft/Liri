/**
 * kernelSurfaceCore.ts — **C2 内核面 allowlist** 纯逻辑核心（内核瘦身 P3）
 *
 * 与 `startupGraphCore.ts` / `criticalModulesCore.ts` 同分工：只做比较、无 IO，
 * 供 `scripts/lint-kernel-surface.ts`（CI 门禁）与 `tests/gates/kernelSurfaceAllowlist.test.ts` 共用。
 *
 * 口径（`内核瘦身-方案.md` §2 C2 / §6 D4）：
 *   - 内核面 = `app/src/core` 的**顶层条目**（文件 / 目录），不是逐个文件 ——
 *     子目录内部重构不该让清单漂移，但**新增一个顶层子系统必须选择归属**；
 *   - 归属按**能力域**（6 个），不按文件；
 *   - 不属于内核能力的条目必须显式登记为**例外**并写明理由（"半内核半业务"的混合体在此暴露）。
 */

/** 6 个能力域（顺序即展示顺序） */
export const KERNEL_DOMAINS = [
  'state-events',
  'security-permission',
  'budget-ledger',
  'execution-loop',
  'ports-assembly',
  'base-utils',
] as const;

export type KernelDomain = (typeof KERNEL_DOMAINS)[number];

export type KernelSurfaceKind = 'file' | 'dir';

/** 一条归入某能力域的内核面条目 */
export interface KernelSurfaceEntry {
  id: string;
  kind: KernelSurfaceKind;
  domain: KernelDomain;
  /** 为什么它属于该域（必填，禁止空泛占位） */
  note: string;
}

/** 一条"在内核目录里但不属于内核能力"的例外 */
export interface KernelSurfaceException {
  id: string;
  kind: KernelSurfaceKind;
  /** 为什么它是例外（必填） */
  reason: string;
}

export interface KernelSurfaceAllowlist {
  version: number;
  recordedAt?: string;
  /** 扫描根（相对 app/），用于自描述与防止误用 */
  root: string;
  note?: string;
  /** 域 → 中文说明（必须覆盖全部 6 个域） */
  domains: Record<string, string>;
  entries: KernelSurfaceEntry[];
  exceptions: KernelSurfaceException[];
}

/** 实际扫描到的顶层条目 */
export interface KernelSurfaceActual {
  id: string;
  kind: KernelSurfaceKind;
}

export interface KernelSurfaceComparison {
  violations: string[];
  hints: string[];
  /** 域 → 条目数 */
  domainCounts: Record<string, number>;
}

/** 理由/说明的最小长度（拒绝"无"、"todo" 这类占位） */
const MIN_NOTE_LENGTH = 4;

function countDuplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  }
  return [...dup];
}

/**
 * 比较「实际内核面顶层条目」与「allowlist」。
 *
 * @param actual - 文件系统实际扫描结果（不含 `__tests__` / `*.md` / 空目录）
 * @param allowlist - 人工维护的 allowlist
 */
export function compareKernelSurface(
  actual: readonly KernelSurfaceActual[],
  allowlist: KernelSurfaceAllowlist
): KernelSurfaceComparison {
  const violations: string[] = [];
  const hints: string[] = [];

  const declaredDomains = Object.keys(allowlist.domains ?? {});
  for (const domain of KERNEL_DOMAINS) {
    if (!declaredDomains.includes(domain)) {
      violations.push(`allowlist.domains 缺少能力域 \`${domain}\` 的说明`);
    }
  }
  for (const domain of declaredDomains) {
    if (!(KERNEL_DOMAINS as readonly string[]).includes(domain)) {
      violations.push(`allowlist.domains 含未知能力域 \`${domain}\``);
    }
  }

  const entries = allowlist.entries ?? [];
  const exceptions = allowlist.exceptions ?? [];

  // ① 重复 / 交叉登记
  for (const id of countDuplicates(entries.map((e) => e.id))) {
    violations.push(`\`${id}\` 在 entries 里重复登记`);
  }
  for (const id of countDuplicates(exceptions.map((e) => e.id))) {
    violations.push(`\`${id}\` 在 exceptions 里重复登记`);
  }
  const entryIds = new Set(entries.map((e) => e.id));
  for (const ex of exceptions) {
    if (entryIds.has(ex.id)) {
      violations.push(
        `\`${ex.id}\` 同时出现在 entries 与 exceptions（只能二选一）`
      );
    }
  }

  // ② 域 / 理由 / kind 的完整性
  const domainCounts: Record<string, number> = {};
  for (const domain of KERNEL_DOMAINS) domainCounts[domain] = 0;

  for (const entry of entries) {
    if (!(KERNEL_DOMAINS as readonly string[]).includes(entry.domain)) {
      violations.push(
        `\`${entry.id}\` 的能力域 \`${entry.domain}\` 不在 6 个域内`
      );
    } else {
      domainCounts[entry.domain] = (domainCounts[entry.domain] ?? 0) + 1;
    }
    if ((entry.note ?? '').trim().length < MIN_NOTE_LENGTH) {
      violations.push(`\`${entry.id}\` 缺少归属理由（note 为空或过短）`);
    }
  }
  for (const ex of exceptions) {
    if ((ex.reason ?? '').trim().length < MIN_NOTE_LENGTH) {
      violations.push(`例外 \`${ex.id}\` 缺少理由（reason 为空或过短）`);
    }
  }

  // ③ 结构一致性：清单说是目录、实际是文件（或反之）⇒ 说明该条目被重构了，需重新确认
  const kindById = new Map(actual.map((a) => [a.id, a.kind]));
  for (const item of [...entries, ...exceptions]) {
    const actualKind = kindById.get(item.id);
    if (actualKind && actualKind !== item.kind) {
      violations.push(
        `\`${item.id}\` 在清单里是 ${item.kind}，实际是 ${actualKind}（结构已变，请重新确认归属）`
      );
    }
  }

  // ④ 未归类 = 新增内核面条目（棘轮：必须归域或报备为例外）
  const declared = new Set([
    ...entries.map((e) => e.id),
    ...exceptions.map((e) => e.id),
  ]);
  const unclassified = actual
    .filter((a) => !declared.has(a.id))
    .map((a) => `${a.id}${a.kind === 'dir' ? '/' : ''}`)
    .sort();
  for (const id of unclassified) {
    violations.push(
      `\`${id}\` 是内核面新增条目但未归类 —— 请归入 6 个能力域之一，` +
        `或在 exceptions 登记理由（它不属于内核能力）`
    );
  }

  // ⑤ 清单条目已不存在 ⇒ 可下调（不阻断，避免阻塞重构）
  const actualIds = new Set(actual.map((a) => a.id));
  const stale = [...entries.map((e) => e.id), ...exceptions.map((e) => e.id)]
    .filter((id) => !actualIds.has(id))
    .sort();
  if (stale.length > 0) {
    hints.push(
      `清单中有 ${stale.length} 条已不存在（${stale.join(', ')}）——建议同步清理`
    );
  }

  return { violations, hints, domainCounts };
}

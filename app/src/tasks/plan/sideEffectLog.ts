// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 副作用流水（D7 三期 · 一期，2026-11-14）
 *
 * 数据源：`security/rollback` 的轮级文件变更（`FileOperationTracker.getRoundChanges()`）。
 * 本批给该台账补了 `toolName`（可选）——**"工具 → 文件变更"的关联键**，是回放对照的前提。
 *
 * 本模块只做**读侧聚合**（纯函数）：
 * - 按 `toolName` 分组（工具名升序），组内按路径升序；
 * - 无 `toolName` 的条目单列 `unattributed`（旧数据 / Shell 副作用检测，绝不硬塞进某个工具）；
 * - `totals` 固定按 `created/deleted/modified/renamed/moved` 顺序计数（确定性）。
 *
 * 不做：写入（录制在 tracker 侧）、回放（需真实流水与幂等判定）、沙箱预演。
 */

/** 变更类型（与 `FileChange.type` 同值域；本地窄定义避免 app→infra 深路径依赖） */
export const SIDE_EFFECT_TYPES = [
  'created',
  'deleted',
  'modified',
  'renamed',
  'moved',
] as const;

export type SideEffectType = (typeof SIDE_EFFECT_TYPES)[number];

/** 一条记录（`FileChange` 的结构子集） */
export interface RecordedFileOp {
  path: string;
  type: SideEffectType;
  toolName?: string;
}

export interface SideEffectEntry {
  path: string;
  type: SideEffectType;
}

export interface ToolSideEffectGroup {
  toolName: string;
  entries: SideEffectEntry[];
  /** 该工具各类型计数（只含出现过的类型，键顺序固定） */
  counts: Partial<Record<SideEffectType, number>>;
}

export interface SideEffectLog {
  /** 已归属工具的组（按工具名升序） */
  groups: ToolSideEffectGroup[];
  /** 未标注工具的条目（按路径升序） */
  unattributed: SideEffectEntry[];
  /** 全量类型计数（固定键顺序） */
  totals: Record<SideEffectType, number>;
  /** 去重路径（升序） */
  paths: string[];
}

function emptyTotals(): Record<SideEffectType, number> {
  return { created: 0, deleted: 0, modified: 0, renamed: 0, moved: 0 };
}

function toEntry(op: RecordedFileOp): SideEffectEntry {
  return { path: op.path, type: op.type };
}

function countInto(
  counts: Partial<Record<SideEffectType, number>>,
  type: SideEffectType
): void {
  counts[type] = (counts[type] ?? 0) + 1;
}

/** 聚合（纯函数：同一输入 ⇒ 同一输出） */
export function buildSideEffectLog(
  operations: readonly RecordedFileOp[]
): SideEffectLog {
  const totals = emptyTotals();
  const byTool = new Map<string, SideEffectEntry[]>();
  const unattributed: SideEffectEntry[] = [];

  for (const op of operations) {
    totals[op.type] += 1;
    const entry = toEntry(op);
    const toolName = op.toolName?.trim();
    if (!toolName) {
      unattributed.push(entry);
      continue;
    }
    const list = byTool.get(toolName) ?? [];
    list.push(entry);
    byTool.set(toolName, list);
  }

  const groups: ToolSideEffectGroup[] = [...byTool.entries()]
    .map(([toolName, entries]) => {
      const counts: Partial<Record<SideEffectType, number>> = {};
      for (const entry of entries) countInto(counts, entry.type);
      return {
        toolName,
        entries: [...entries].sort((a, b) => a.path.localeCompare(b.path)),
        counts,
      };
    })
    .sort((a, b) => a.toolName.localeCompare(b.toolName));

  return {
    groups,
    unattributed: unattributed.sort((a, b) => a.path.localeCompare(b.path)),
    totals,
    paths: [...new Set(operations.map((op) => op.path))].sort(),
  };
}

/** 渲染为人读文本（供 `/plan preview` / 面板复用；确定性） */
export function renderSideEffectLog(log: SideEffectLog): string {
  const lines = ['## 文件副作用（本轮）'];
  if (log.groups.length === 0 && log.unattributed.length === 0) {
    return `${lines[0]}\n\n- 本轮没有记录到文件变更。`;
  }
  for (const group of log.groups) {
    const counts = SIDE_EFFECT_TYPES.filter((t) => group.counts[t])
      .map((t) => `${t} ${group.counts[t]}`)
      .join(' · ');
    lines.push(`- ${group.toolName}：${counts}`);
    for (const entry of group.entries) {
      lines.push(`  - [${entry.type}] ${entry.path}`);
    }
  }
  if (log.unattributed.length > 0) {
    lines.push('- 未归属工具（旧数据 / Shell 检测）：');
    for (const entry of log.unattributed) {
      lines.push(`  - [${entry.type}] ${entry.path}`);
    }
  }
  const totals = SIDE_EFFECT_TYPES.filter((t) => log.totals[t] > 0)
    .map((t) => `${t} ${log.totals[t]}`)
    .join(' · ');
  lines.push('', `合计：${totals}（路径 ${log.paths.length} 个）`);
  return lines.join('\n');
}

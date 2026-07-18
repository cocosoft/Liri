// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * MCP 工具列表漂移检测 (Drift Detection)
 *
 * 在 MCP 重连时分类工具列表变化，驱动重连策略。
 * 变化类型按缓存影响排序：identity ≈ append < edit < reorder < remove
 *
 */

/** 漂移类型（按缓存影响排序） */
export type DriftKind = 'identity' | 'append' | 'edit' | 'reorder' | 'remove';

/** 漂移建议操作 */
export type DriftAction = 'accept' | 'partial_accept' | 'reject';

/** MCP 工具规格（简化版） */
export interface McpToolSpec {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/** 漂移报告 */
export interface DriftReport {
  kind: DriftKind;
  /** 新增的工具名称 */
  added: string[];
  /** 移除的工具名称 */
  removed: string[];
  /** 名称和位置匹配但内容变化的工具名称 */
  edited: string[];
  /** 人类可读的漂移描述 */
  summary: string;
  /** 建议操作（生产化扩展） */
  action?: DriftAction;
  /** 漂移严重程度（0-1，1=最严重） */
  severity?: number;
}

/**
 * 分类工具列表漂移
 *
 * @param before 变更前的工具列表
 * @param after 变更后的工具列表
 * @returns 漂移分类报告
 */
export function classifyToolListDrift(
  before: readonly McpToolSpec[],
  after: readonly McpToolSpec[]
): DriftReport {
  const beforeNames = before.map((t) => t.name);
  const afterNames = after.map((t) => t.name);
  const beforeSet = new Set(beforeNames);
  const afterSet = new Set(afterNames);

  const added = afterNames.filter((n) => !beforeSet.has(n));
  const removed = beforeNames.filter((n) => !afterSet.has(n));

  const edited: string[] = [];
  const sharedLen = Math.min(before.length, after.length);
  for (let i = 0; i < sharedLen; i++) {
    if (
      beforeNames[i] === afterNames[i] &&
      hashSpec(before[i]!) !== hashSpec(after[i]!)
    ) {
      edited.push(beforeNames[i]!);
    }
  }

  let report: DriftReport;

  // Identity: 完全相同
  if (
    before.length === after.length &&
    edited.length === 0 &&
    beforeNames.every((n, i) => n === afterNames[i])
  ) {
    report = {
      kind: 'identity',
      added: [],
      removed: [],
      edited: [],
      summary: '工具列表无变化',
    };
  }
  // Remove: 有工具被移除 — 最严重
  else if (removed.length > 0) {
    report = {
      kind: 'remove',
      added,
      removed,
      edited,
      summary: `工具列表变化: 移除 ${removed.length} 个 (${removed.join(', ')}), 新增 ${added.length} 个`,
    };
  }
  // Append: 仅尾部追加，前置工具不变
  else if (
    after.length > before.length &&
    beforeNames.every(
      (n, i) =>
        n === afterNames[i] && hashSpec(before[i]!) === hashSpec(after[i]!)
    )
  ) {
    report = {
      kind: 'append',
      added,
      removed: [],
      edited: [],
      summary: `工具列表追加: 新增 ${added.length} 个 (${added.join(', ')})`,
    };
  }
  // 同名集合相同 → 位置或内容变化
  else if (
    beforeSet.size === afterSet.size &&
    [...beforeSet].every((n) => afterSet.has(n))
  ) {
    const positionsMatch = beforeNames.every((n, i) => n === afterNames[i]);
    if (positionsMatch) {
      report = {
        kind: 'edit',
        added: [],
        removed: [],
        edited,
        summary: `工具定义变更: ${edited.length} 个 (${edited.join(', ')})`,
      };
    } else {
      report = {
        kind: 'reorder',
        added: [],
        removed: [],
        edited,
        summary: `工具顺序重排: ${before.length} 个工具`,
      };
    }
  }
  // 既非纯追加也非同名集合 — 视为重排
  else {
    report = {
      kind: 'reorder',
      added,
      removed: [],
      edited,
      summary: `工具列表变化: 新增 ${added.length} 个, 编辑 ${edited.length} 个`,
    };
  }

  // 生产化扩展：计算严重程度和建议操作
  report.severity = calcDriftSeverity(report, before.length);
  report.action = suggestDriftAction(report);

  return report;
}

/**
 * 判断漂移是否可接受（identity 和 append 通常可自动接受）
 */
export function isDriftAcceptable(
  kind: DriftKind,
  accept: ReadonlyArray<'identity' | 'append'> = ['identity']
): boolean {
  if (kind === 'identity') return true;
  if (kind === 'append' && accept.includes('append')) return true;
  return false;
}

/** 规格哈希 */
function hashSpec(spec: McpToolSpec): string {
  return JSON.stringify(spec);
}

/**
 * 计算漂移严重程度（0-1）。
 * identity=0, append=0.1, edit=0.3, reorder=0.5, remove=0.7+。
 * 基于变更工具数量占总数的比例调整。
 */
export function calcDriftSeverity(
  report: DriftReport,
  totalBefore: number
): number {
  if (totalBefore === 0) return 0;

  const changedCount =
    report.added.length + report.removed.length + report.edited.length;
  const changeRatio = changedCount / Math.max(totalBefore, 1);

  switch (report.kind) {
    case 'identity':
      return 0;
    case 'append':
      return 0.1 + changeRatio * 0.1;
    case 'edit':
      return 0.3 + changeRatio * 0.2;
    case 'reorder':
      return 0.5 + changeRatio * 0.1;
    case 'remove':
      return 0.7 + changeRatio * 0.3;
  }
}

/**
 * 根据漂移报告建议操作。
 * - identity/append → accept（自动接受）
 * - edit（少量工具）→ partial_accept（部分接受，保留已有缓存）
 * - remove / edit（大量工具）→ reject（拒绝重连，需人工确认）
 */
export function suggestDriftAction(report: DriftReport): DriftAction {
  switch (report.kind) {
    case 'identity':
      return 'accept';
    case 'append':
      return 'accept';
    case 'edit':
      // 少量编辑可部分接受
      return report.edited.length <= 2 ? 'partial_accept' : 'reject';
    case 'reorder':
      return 'partial_accept';
    case 'remove':
      return 'reject';
  }
}

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

  // Identity: 完全相同
  if (
    before.length === after.length &&
    edited.length === 0 &&
    beforeNames.every((n, i) => n === afterNames[i])
  ) {
    return {
      kind: 'identity',
      added: [],
      removed: [],
      edited: [],
      summary: '工具列表无变化',
    };
  }

  // Remove: 有工具被移除 — 最严重
  if (removed.length > 0) {
    return {
      kind: 'remove',
      added,
      removed,
      edited,
      summary: `工具列表变化: 移除 ${removed.length} 个 (${removed.join(', ')}), 新增 ${added.length} 个`,
    };
  }

  // Append: 仅尾部追加，前置工具不变
  if (
    after.length > before.length &&
    beforeNames.every(
      (n, i) =>
        n === afterNames[i] && hashSpec(before[i]!) === hashSpec(after[i]!)
    )
  ) {
    return {
      kind: 'append',
      added,
      removed: [],
      edited: [],
      summary: `工具列表追加: 新增 ${added.length} 个 (${added.join(', ')})`,
    };
  }

  // 同名集合相同 → 位置或内容变化
  const sameNameSet =
    beforeSet.size === afterSet.size &&
    [...beforeSet].every((n) => afterSet.has(n));
  if (sameNameSet) {
    const positionsMatch = beforeNames.every((n, i) => n === afterNames[i]);
    if (positionsMatch) {
      return {
        kind: 'edit',
        added: [],
        removed: [],
        edited,
        summary: `工具定义变更: ${edited.length} 个 (${edited.join(', ')})`,
      };
    }
    return {
      kind: 'reorder',
      added: [],
      removed: [],
      edited,
      summary: `工具顺序重排: ${before.length} 个工具`,
    };
  }

  // 既非纯追加也非同名集合 — 视为重排
  return {
    kind: 'reorder',
    added,
    removed: [],
    edited,
    summary: `工具列表变化: 新增 ${added.length} 个, 编辑 ${edited.length} 个`,
  };
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

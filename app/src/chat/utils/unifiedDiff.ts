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
 * computeUnifiedDiff — 文件 unified diff 生成（E-1 diff emit，2026-08-23）
 *
 * 行级 LCS 最长公共子序列 → 编辑操作序列 → unified diff 文本（@@ hunk，带上下文）。
 * 供 CoreAPIImpl 在文件写入工具完成后计算 diff（文件前后内容 → diffData）。
 *
 * 输出格式（对齐前端 DiffData.diff）：
 *   --- a/<file>
 *   +++ b/<file>
 *   @@ -oldStart,oldCount +newStart,newCount @@
 *    context
 *   -removed
 *   +added
 */

/** unified diff 计算结果 */
export interface FileDiffResult {
  /** unified diff 文本（含 ---/+++ 头 + hunk） */
  diff: string;
  /** 新增行数 */
  additions: number;
  /** 删除行数 */
  deletions: number;
}

/**
 * 计算两个文件内容的 unified diff
 *
 * @param oldContent 变更前内容
 * @param newContent 变更后内容
 * @param filePath 文件路径（用于 ---/+++ 头，仅展示）
 * @param context hunk 上下文行数（默认 3）
 * @returns 无差异时 diff=''（调用方可据此跳过 emit）
 */
export function computeUnifiedDiff(
  oldContent: string,
  newContent: string,
  filePath = 'file',
  context = 3
): FileDiffResult {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  if (oldContent === newContent) {
    return { diff: '', additions: 0, deletions: 0 };
  }

  // 行级 LCS（自底向上 DP）
  const n = oldLines.length;
  const m = newLines.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0)
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        oldLines[i] === newLines[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  // 回溯生成操作序列（same/del/add）
  const ops: Array<{ type: 'same' | 'del' | 'add'; line: string }> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: 'same', line: oldLines[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ type: 'del', line: oldLines[i] });
      i++;
    } else {
      ops.push({ type: 'add', line: newLines[j] });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: 'del', line: oldLines[i] });
    i++;
  }
  while (j < m) {
    ops.push({ type: 'add', line: newLines[j] });
    j++;
  }

  const additions = ops.filter((o) => o.type === 'add').length;
  const deletions = ops.filter((o) => o.type === 'del').length;

  // 变更位置 → 带上下文的区间（合并重叠）
  const changedIdx: number[] = [];
  ops.forEach((o, idx) => {
    if (o.type !== 'same') changedIdx.push(idx);
  });
  if (changedIdx.length === 0) {
    return { diff: '', additions: 0, deletions: 0 };
  }
  const ranges: Array<[number, number]> = [];
  for (const idx of changedIdx) {
    const start = Math.max(0, idx - context);
    const end = Math.min(ops.length - 1, idx + context);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end);
    } else {
      ranges.push([start, end]);
    }
  }

  // 生成 unified diff 文本
  let body = '';
  for (const [start, end] of ranges) {
    let oldStart = 1;
    let newStart = 1;
    for (let k = 0; k < start; k++) {
      const o = ops[k];
      if (o.type === 'same') {
        oldStart++;
        newStart++;
      } else if (o.type === 'del') {
        oldStart++;
      } else {
        newStart++;
      }
    }
    let oldCount = 0;
    let newCount = 0;
    for (let k = start; k <= end; k++) {
      const o = ops[k];
      if (o.type === 'same') {
        oldCount++;
        newCount++;
      } else if (o.type === 'del') {
        oldCount++;
      } else {
        newCount++;
      }
    }
    body += `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n`;
    for (let k = start; k <= end; k++) {
      const o = ops[k];
      const prefix = o.type === 'same' ? ' ' : o.type === 'del' ? '-' : '+';
      body += prefix + o.line + '\n';
    }
  }

  const header = `--- a/${filePath}\n+++ b/${filePath}\n`;
  return { diff: header + body, additions, deletions };
}

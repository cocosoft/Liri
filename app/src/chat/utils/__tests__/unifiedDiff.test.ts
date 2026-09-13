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
 * computeUnifiedDiff 单测（E-1 diff emit，2026-08-23）
 *
 * 覆盖：无差异跳过、插入/删除 unified diff 正确、多 hunk、统计正确。
 */

import { describe, it, expect } from 'bun:test';
import { computeUnifiedDiff } from '../unifiedDiff';

describe('computeUnifiedDiff（E-1 diff）', () => {
  it('无差异 → diff=""（调用方据此跳过 emit）', () => {
    const r = computeUnifiedDiff('a\nb\nc\n', 'a\nb\nc\n');
    expect(r.diff).toBe('');
    expect(r.additions).toBe(0);
    expect(r.deletions).toBe(0);
  });

  it('新增行 → unified diff 含 + 行与 @@ hunk', () => {
    const r = computeUnifiedDiff('line1\nline2', 'line1\nline2\nline3', 'f.ts');
    expect(r.diff).toContain('--- a/f.ts');
    expect(r.diff).toContain('+++ b/f.ts');
    expect(r.diff).toContain('@@ ');
    expect(r.diff).toContain('+line3');
    expect(r.additions).toBe(1);
    expect(r.deletions).toBe(0);
  });

  it('删除行 → unified diff 含 - 行', () => {
    const r = computeUnifiedDiff('a\nb\nc\n', 'a\nc\n');
    expect(r.diff).toContain('-b');
    expect(r.additions).toBe(0);
    expect(r.deletions).toBe(1);
  });

  it('修改行（替换）→ 同时含 - 和 +', () => {
    const r = computeUnifiedDiff('old line\n', 'new line\n');
    expect(r.diff).toContain('-old line');
    expect(r.diff).toContain('+new line');
    expect(r.additions).toBe(1);
    expect(r.deletions).toBe(1);
  });

  it('相距足够远的不重叠变更 → 多个 @@ hunk', () => {
    const oldContent = Array.from(
      { length: 20 },
      (_, i) => `line${i + 1}`
    ).join('\n');
    const newContent = [
      ...oldContent.split('\n').slice(0, 2),
      'CHANGED_A',
      ...oldContent.split('\n').slice(2, 15),
      'CHANGED_B',
      ...oldContent.split('\n').slice(15),
    ].join('\n');
    const r = computeUnifiedDiff(oldContent, newContent);
    const hunkCount = (r.diff.match(/@@ /g) ?? []).length;
    expect(hunkCount).toBeGreaterThanOrEqual(2);
    expect(r.diff).toContain('+CHANGED_A');
    expect(r.diff).toContain('+CHANGED_B');
    expect(r.additions).toBe(2);
    expect(r.deletions).toBe(0);
  });

  it('空旧内容（新建文件）→ 全部为 + 行', () => {
    const r = computeUnifiedDiff('', 'hello\nworld\n');
    expect(r.diff).toContain('+hello');
    expect(r.additions).toBe(2);
    expect(r.deletions).toBe(0);
  });
});
